import type { CreatorJob, CreatorStageRun, OpenCreatorIssue, PublicErrorFacts } from '@opencreator/protocol';
import type { CreatorTelemetryOutbox } from './outbox.js';
import type { FailureDiagnostic } from './diagnostic.js';
import { failureDiagnosticFromError } from './diagnostic.js';
import { traceEventId, traceToken, type CreatorTaskTrace } from './task-trace.js';
import {
  createCreatorTelemetryEvent,
  type CreatorTelemetryAccountSnapshot,
  type CreatorTelemetryOutcome
} from './events.js';

export type CreatorTelemetrySink = ReturnType<typeof createCreatorTelemetrySink>;

export function createCreatorTelemetrySink(input: {
  outbox: CreatorTelemetryOutbox;
  readAccount(job: CreatorJob): CreatorTelemetryAccountSnapshot;
  now?(): string;
  enabled?: boolean;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  let enabled = input.enabled !== false;
  let pending: CreatorTaskTrace[] = [];
  let scheduled = false;
  function trace(event: Omit<CreatorTaskTrace, 'event_id' | 'occurred_at' | 'feature'>, key?: string): void {
    if (!enabled) return;
    try {
      const critical = event.event_type === 'task_started' || event.event_type === 'task_state'
        || event.event_type === 'preflight_rejected' || (event.outcome !== undefined && event.outcome !== 'succeeded');
      if (pending.length >= 128) {
        if (!critical) return;
        pending.shift();
      }
      pending.push({ ...event, event_id: traceEventId(key), occurred_at: now(), feature: 'video-translation' });
      if (scheduled) return;
      scheduled = true;
      setImmediate(() => {
        const batch = pending;
        pending = [];
        scheduled = false;
        if (!enabled || batch.length === 0) return;
        void input.outbox.enqueueTrace(batch).catch(() => undefined);
      }).unref();
    } catch { /* Telemetry is best effort. */ }
  }
  const write = (
    eventType: 'task_started' | 'task_finished',
    job: CreatorJob,
    stage: CreatorStageRun,
    feature: string,
    outcome?: CreatorTelemetryOutcome,
    issue?: OpenCreatorIssue,
    diagnostic?: FailureDiagnostic,
    failureFacts?: PublicErrorFacts
  ) => {
    if (!enabled) return;
    try {
      const event = createCreatorTelemetryEvent({
        eventType,
        occurredAt: stage.finishedAt ?? now(),
        job,
        stage,
        feature,
        ...(outcome === undefined ? {} : { outcome }),
        account: input.readAccount(job),
        ...(issue === undefined ? {} : { issue }),
        ...(diagnostic === undefined ? {} : { diagnostic }),
        ...(failureFacts === undefined ? {} : { failureFacts })
      });
      if (feature === 'video-translation' && eventType === 'task_finished') {
        const failure = event.failure ? { ...event.failure } : undefined;
        if (failure) delete failure.user_message;
        trace({ event_type: 'stage_finished', task_id: job.id, stage_id: stage.stageId, attempt_id: stage.id,
          ...(outcome === undefined ? {} : { outcome }), ...(failure?.error_code ? { code: failure.error_code } : {}),
          ...(event.duration_ms === undefined ? {} : { duration_ms: event.duration_ms }),
          ...(failure?.request_id ? { gateway_request_id: failure.request_id } : {}),
          ...(failure ? { failure } : {}) }, `${stage.id}:finished`);
      }
      input.outbox.enqueue(event, `${stage.id}:${eventType}`);
    } catch {
      // Telemetry must never change Creator execution.
    }
  };

  return {
    setEnabled(value: boolean): void {
      if (!value) {
        enabled = false;
        pending = [];
        input.outbox.clear();
      } else {
        if (!enabled) input.outbox.clear();
        enabled = true;
      }
    },
    traceEnabled(): boolean { return enabled; },
    taskStarted(job: CreatorJob): void {
      if (job.templateId === 'video-translation') trace({ event_type: 'task_started', task_id: job.id }, `${job.id}:started`);
    },
    taskState(job: CreatorJob): void {
      if (job.templateId === 'video-translation') trace({ event_type: 'task_state', task_id: job.id,
        outcome: job.status, revision: job.revision }, `${job.id}:state:${job.revision}`);
    },
    preflightRejected(job: CreatorJob, stageId: string, error: unknown): void {
      if (job.templateId !== 'video-translation') return;
      try {
        const code = traceToken((error as { code?: unknown } | null)?.code) ?? 'creator_preflight_rejected';
        const diagnostic = failureDiagnosticFromError(error, 'creator.preflight');
        trace({ event_type: 'preflight_rejected', task_id: job.id, stage_id: traceToken(stageId) ?? 'unknown',
          operation: 'creator.preflight', outcome: 'needs_input', code,
          ...(diagnostic ? { failure: { diagnostic } } : {}) });
      } catch { /* Telemetry is best effort. */ }
    },
    traceStageStarted(job: CreatorJob, stage: CreatorStageRun): void {
      if (job.templateId === 'video-translation') trace({ event_type: 'stage_started', task_id: job.id,
        stage_id: stage.stageId, attempt_id: stage.id }, `${stage.id}:started`);
    },
    gatewayCall(event: Omit<CreatorTaskTrace, 'event_id' | 'occurred_at' | 'feature'>): void { trace(event); },
    stageStarted(job: CreatorJob, stage: CreatorStageRun, feature: string): void {
      write('task_started', job, stage, feature);
    },
    stageFinished(
      job: CreatorJob,
      stage: CreatorStageRun,
      feature: string,
      outcome: CreatorTelemetryOutcome,
      issue?: OpenCreatorIssue,
      diagnostic?: FailureDiagnostic,
      failureFacts?: PublicErrorFacts
    ): void {
      write('task_finished', job, stage, feature, outcome, issue, diagnostic, failureFacts);
    }
  };
}

export function creatorStageTelemetryOutcome(
  job: CreatorJob,
  stage: CreatorStageRun,
  unknownRemoteAcceptance = false
): CreatorTelemetryOutcome {
  if (unknownRemoteAcceptance) return 'unknown';
  if (stage.status === 'succeeded') {
    return stage.progress.status === 'partial_success' ? 'partial_success' : 'succeeded';
  }
  if (stage.status === 'canceled') return 'canceled';
  if (stage.status === 'interrupted') return 'interrupted';
  if (job.status === 'needs_input') return 'needs_input';
  return stage.status === 'failed' ? 'failed' : 'unknown';
}
