import type { CreatorJob, CreatorStageRun, OpenCreatorIssue, PublicErrorFacts } from '@opencreator/protocol';
import type { CreatorTelemetryOutbox } from './outbox.js';
import type { FailureDiagnostic } from './diagnostic.js';
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
      input.outbox.enqueue(createCreatorTelemetryEvent({
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
      }), `${stage.id}:${eventType}`);
    } catch {
      // Telemetry must never change Creator execution.
    }
  };

  return {
    setEnabled(value: boolean): void {
      if (!value) {
        enabled = false;
        input.outbox.clear();
      } else {
        if (!enabled) input.outbox.clear();
        enabled = true;
      }
    },
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
