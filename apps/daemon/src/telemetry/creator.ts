import type { CreatorJob, CreatorStageRun, OpenCreatorIssue } from '@opencreator/protocol';
import type { CreatorTelemetryOutbox } from './outbox.js';
import {
  createCreatorTelemetryEvent,
  type CreatorTelemetryAccountSnapshot,
  type CreatorTelemetryOutcome
} from './events.js';

export type CreatorTelemetrySink = ReturnType<typeof createCreatorTelemetrySink>;

export function createCreatorTelemetrySink(input: {
  outbox: CreatorTelemetryOutbox;
  readAccount(): CreatorTelemetryAccountSnapshot;
  now?(): string;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  const write = (
    eventType: 'task_started' | 'task_finished',
    job: CreatorJob,
    stage: CreatorStageRun,
    feature: string,
    outcome?: CreatorTelemetryOutcome,
    issue?: OpenCreatorIssue
  ) => {
    try {
      input.outbox.enqueue(createCreatorTelemetryEvent({
        eventType,
        occurredAt: stage.finishedAt ?? now(),
        job,
        stage,
        feature,
        ...(outcome === undefined ? {} : { outcome }),
        account: input.readAccount(),
        ...(issue === undefined ? {} : { issue })
      }), `${stage.id}:${eventType}`);
    } catch {
      // Telemetry must never change Creator execution.
    }
  };

  return {
    stageStarted(job: CreatorJob, stage: CreatorStageRun, feature: string): void {
      write('task_started', job, stage, feature);
    },
    stageFinished(
      job: CreatorJob,
      stage: CreatorStageRun,
      feature: string,
      outcome: CreatorTelemetryOutcome,
      issue?: OpenCreatorIssue
    ): void {
      write('task_finished', job, stage, feature, outcome, issue);
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
