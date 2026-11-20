import type { CreatorJob, CreatorStageRun, OpenCreatorIssue, PublicErrorFacts } from '@opencreator/protocol';
import type { CreatorTelemetryOutbox } from './outbox.js';
import type { FailureDiagnostic } from './diagnostic.js';
import { failureDiagnosticFromError } from './diagnostic.js';
import { supportsCreatorTaskTrace, traceEventId, traceToken, translationSourceAtLaunch, type CreatorTaskTrace } from './task-trace.js';
import {
  createCreatorTelemetryEvent,
  type CreatorTelemetryAccountSnapshot,
  type CreatorTelemetryOutcome
} from './events.js';

export type CreatorTelemetrySink = ReturnType<typeof createCreatorTelemetrySink>;

export function createCreatorTelemetrySink(input: {
  outbox: CreatorTelemetryOutbox;
  readAccount(job: CreatorJob): CreatorTelemetryAccountSnapshot;
  readStartAccount?(): Pick<CreatorTaskTrace, 'auth_state' | 'account_id' | 'payment_state'>;
  readExecutionMode?(job: CreatorJob): CreatorTaskTrace['execution_mode'];
  now?(): string;
  enabled?: boolean;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  let enabled = input.enabled !== false;
  let pending: CreatorTaskTrace[] = [];
  let scheduled = false;
  function scheduleTraceFlush(): void {
    if (scheduled || !enabled || pending.length === 0) return;
    scheduled = true;
    setImmediate(async () => {
      const batch = pending;
      pending = [];
      try {
        if (enabled && batch.length > 0) await input.outbox.enqueueTrace(batch);
      } catch {
      } finally {
        scheduled = false;
        scheduleTraceFlush();
      }
    }).unref();
  }
  function trace(event: Omit<CreatorTaskTrace, 'event_id' | 'occurred_at'>, key?: string): void {
    if (!enabled || !supportsCreatorTaskTrace(event.feature)) return;
    try {
      const critical = event.event_type === 'task_started' || event.event_type === 'task_state'
        || event.event_type === 'preflight_rejected' || (event.outcome !== undefined && event.outcome !== 'succeeded');
      if (pending.length >= 128) {
        if (!critical) return;
        pending.shift();
      }
      pending.push({ ...event, event_id: traceEventId(key), occurred_at: now() });
      scheduleTraceFlush();
    } catch { /* Telemetry is best effort. */ }
  }
  const readExecutionMode = (job: CreatorJob): CreatorTaskTrace['execution_mode'] => {
    if (job.templateId === 'video-download') return 'local';
    try { return input.readExecutionMode?.(job); } catch { return undefined; }
  };
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
      if (supportsCreatorTaskTrace(job.templateId) && eventType === 'task_finished') {
        const failure = event.failure ? { ...event.failure } : undefined;
        if (failure) delete failure.user_message;
        const executionMode = readExecutionMode(job);
        trace({ event_type: 'stage_finished', feature: job.templateId, task_id: job.id, stage_id: stage.stageId, attempt_id: stage.id,
          ...(executionMode ? { execution_mode: executionMode } : {}),
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
      if (!enabled || !supportsCreatorTaskTrace(job.templateId)) return;
      let identity: Pick<CreatorTaskTrace, 'auth_state' | 'account_id' | 'payment_state'> | undefined;
      try { identity = input.readStartAccount?.(); } catch { /* Leave unobserved. */ }
      let source: CreatorTaskTrace['translation_source'];
      try { source = translationSourceAtLaunch(job); } catch { source = undefined; }
      trace({ event_type: 'task_started', feature: job.templateId, task_id: job.id, ...identity,
        ...(source ? { translation_source: source } : {}) }, `${job.id}:started`);
    },
    taskState(job: CreatorJob): void {
      trace({ event_type: 'task_state', feature: job.templateId, task_id: job.id,
        outcome: job.status, revision: job.revision }, `${job.id}:state:${job.revision}`);
    },
    preflightRejected(job: CreatorJob, stageId: string, error: unknown, blockedChecks?: readonly { id: string }[]): void {
      if (!enabled || !supportsCreatorTaskTrace(job.templateId)) return;
      try {
        const code = traceToken((error as { code?: unknown } | null)?.code) ?? 'creator_preflight_rejected';
        const executionMode = readExecutionMode(job);
        const diagnostic = failureDiagnosticFromError(error, 'creator.preflight');
        const steps = blockedChecks?.slice(0, 4).flatMap(({ id }) => {
          const check = traceToken(id);
          return check ? [{ operation: 'creator.preflight', code: check, result: 'failed' as const }] : [];
        });
        if (diagnostic && !diagnostic.steps && steps?.length) diagnostic.steps = steps;
        trace({ event_type: 'preflight_rejected', feature: job.templateId, task_id: job.id, stage_id: traceToken(stageId) ?? 'unknown',
          ...(executionMode ? { execution_mode: executionMode } : {}),
          operation: 'creator.preflight', outcome: 'needs_input', code,
          ...(diagnostic ? { failure: { diagnostic } } : {}) });
      } catch { /* Telemetry is best effort. */ }
    },
    traceStageStarted(job: CreatorJob, stage: CreatorStageRun): void {
      trace({ event_type: 'stage_started', feature: job.templateId, task_id: job.id,
        stage_id: stage.stageId, attempt_id: stage.id }, `${stage.id}:started`);
    },
    gatewayCall(event: Omit<CreatorTaskTrace, 'event_id' | 'occurred_at'>): void { trace(event); },
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
