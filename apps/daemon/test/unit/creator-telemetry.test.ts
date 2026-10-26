import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorTelemetryOutbox } from '../../src/telemetry/outbox.js';
import {
  createCreatorTelemetryEvent,
  sanitizeCreatorTelemetryEvent,
  type CreatorTelemetryAccountSnapshot,
  type CreatorTelemetryEvent
} from '../../src/telemetry/events.js';
import { createCreatorTelemetrySink, creatorStageTelemetryOutcome } from '../../src/telemetry/creator.js';
import type { CreatorJob, CreatorStageRun } from '@opencreator/protocol';
import { registerTelemetryRoutes } from '../../src/telemetry/routes.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorIssueService } from '../../src/creator/issues.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { CreatorExecutorError } from '../../src/creator/executor.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';

let tempDir = '';
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

const account: CreatorTelemetryAccountSnapshot = {
  authState: 'signed_in',
  rechargeState: 'pending',
  accountStateObservedAt: '2026-10-26T00:00:00.000Z'
};

function event(eventId = '9d9dd73e-b27f-4f0f-a5ef-0f5763d04c1a'): CreatorTelemetryEvent {
  return {
    event_id: eventId,
    event_type: 'task_finished',
    occurred_at: '2026-10-26T00:00:01.000Z',
    task_id: 'creator_job_1',
    attempt_id: 'creator_stage_run_1',
    feature: 'smart-dubbing',
    outcome: 'failed',
    auth_state: 'signed_in',
    recharge_state: 'unknown',
    account_state_observed_at: '2026-10-26T00:00:00.000Z',
    failure: { error_code: 'creator_stage_failed' }
  };
}

describe('creator telemetry outbox', () => {
  it('persists, deduplicates, bounds and acknowledges events', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-outbox-'));
    const path = join(tempDir, 'app.sqlite');
    let db = openRuntimeDatabase(path);
    let outbox = createCreatorTelemetryOutbox(db, { maxPendingEvents: 50 });
    outbox.enqueue(event(), 'attempt:task_finished');
    outbox.enqueue({ ...event(), event_id: 'c5a6e39d-383e-4a24-bfba-5563a6b72dd1' }, 'attempt:task_finished');
    expect(outbox.count()).toBe(1);
    db.close();

    db = openRuntimeDatabase(path);
    outbox = createCreatorTelemetryOutbox(db);
    expect(outbox.list()).toEqual([event()]);
    const app = Fastify();
    void registerTelemetryRoutes(app, outbox);
    return app.ready().then(async () => {
      const page = await app.inject('/telemetry/events?limit=50');
      expect(page.statusCode).toBe(200);
      expect(page.json().events).toHaveLength(1);
      const rejected = await app.inject({
        method: 'POST', url: '/telemetry/events/ack', payload: { event_ids: ['not-a-uuid'] }
      });
      expect(rejected.statusCode).toBe(400);
      const acked = await app.inject({
        method: 'POST', url: '/telemetry/events/ack', payload: { event_ids: [event().event_id] }
      });
      expect(acked.json()).toEqual({ acknowledged: 1 });
      expect(outbox.list()).toEqual([]);
      await app.close();
      db.close();
    });
  });
});

describe('creator telemetry event safety', () => {
  it('drops arbitrary details and never emits raw error content', () => {
    const sanitized = sanitizeCreatorTelemetryEvent({
      ...event(),
      app_version: '3.2.9',
      failure: {
        stage: 'tts',
        executor: 'smart-dubbing',
        category: 'provider',
        error_code: 'creator_provider_request_failed',
        http_status: 502,
        provider: 'example',
        upstream_code: 'UPSTREAM_FAILED',
        retryable: true,
        retry_count: 1,
        progress_percent: 40,
        expected_count: 5,
        succeeded_count: 2,
        failed_count: 3,
        artifact_delivered: false,
        user_message: 'Creator stage failed.',
        detail: { prompt: 'secret', sourceText: 'secret' },
        technicalDetail: '/private/file.srt',
        stack: 'Error: secret'
      }
    } as CreatorTelemetryEvent);
    expect(sanitized.failure).toEqual({
      stage: 'tts', executor: 'smart-dubbing', category: 'provider',
      error_code: 'creator_provider_request_failed', http_status: 502,
      provider: 'example', upstream_code: 'UPSTREAM_FAILED', retryable: true,
      retry_count: 1, progress_percent: 40, expected_count: 5,
      succeeded_count: 2, failed_count: 3, artifact_delivered: false,
      user_message: 'Creator stage failed.'
    });
    expect(JSON.stringify(sanitized)).not.toContain('secret');
    expect(JSON.stringify(sanitized)).not.toContain('/private/file.srt');
  });
});

describe('creator stage telemetry outcome mapping', () => {
  it('preserves blocked, canceled, interrupted and unknown outcomes', () => {
    const job = { status: 'needs_input' } as CreatorJob;
    const stage = { status: 'failed', progress: {} } as CreatorStageRun;
    expect(creatorStageTelemetryOutcome(job, stage)).toBe('needs_input');
    expect(creatorStageTelemetryOutcome({ ...job, status: 'failed' }, stage)).toBe('failed');
    expect(creatorStageTelemetryOutcome(job, { ...stage, status: 'canceled' })).toBe('canceled');
    expect(creatorStageTelemetryOutcome(job, { ...stage, status: 'interrupted' })).toBe('interrupted');
    expect(creatorStageTelemetryOutcome(job, stage, true)).toBe('unknown');
    expect(creatorStageTelemetryOutcome(job, { ...stage, status: 'succeeded' })).toBe('succeeded');
    expect(creatorStageTelemetryOutcome(job, {
      ...stage,
      status: 'succeeded',
      progress: { status: 'partial_success' }
    })).toBe('partial_success');
  });

  it('records partial output impact without including creative content', () => {
    const finished = createCreatorTelemetryEvent({
      eventType: 'task_finished',
      occurredAt: '2026-10-26T00:00:01.000Z',
      job: { id: 'creator_job_1', artifacts: [{ status: 'completed' }] } as CreatorJob,
      stage: {
        id: 'creator_stage_run_1', stageId: 'generate', executor: 'image', attempt: 1,
        startedAt: null, finishedAt: null, errorCode: null,
        progress: { status: 'partial_success', percent: 60, total: 5, completed: 3, failed: 2 }
      } as unknown as CreatorStageRun,
      feature: 'image-generation',
      outcome: 'partial_success',
      account
    });
    expect(finished.failure).toMatchObject({
      progress_percent: 60,
      expected_count: 5,
      succeeded_count: 3,
      failed_count: 2,
      artifact_delivered: true,
      user_message: 'Creator stage partially succeeded.'
    });
  });
});

describe('creator stage telemetry lifecycle', () => {
  it('records success and needs_input with stable task and attempt ids', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-life-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const repository = createCreatorRepository(db);
    const templates = createDefaultCreatorTemplateRegistry();
    const service = createCreatorService({ repository, templates });
    const issueService = createCreatorIssueService(repository);
    const outbox = createCreatorTelemetryOutbox(db);
    const telemetry = createCreatorTelemetrySink({ outbox, readAccount: () => account });
    const successJob = service.createJob({ projectId: 'project_1', templateId: 'smart-dubbing', state: {} });
    const successRunner = createCreatorStageRunner({
      repository, templates, issueService, telemetry,
      executors: [{ id: 'smart-dubbing', run: async () => ({ outputs: [] }) }],
      workRoot: join(tempDir, 'jobs')
    });
    const succeeded = await successRunner.run(successJob.id, 'tts');
    await successRunner.close();
    const successEvents = outbox.list();
    expect(successEvents.map(item => item.event_type)).toEqual(['task_started', 'task_finished']);
    expect(successEvents[1]).toMatchObject({
      task_id: successJob.id, attempt_id: succeeded.id, feature: 'smart-dubbing', outcome: 'succeeded'
    });
    outbox.ack(successEvents.map(item => item.event_id));

    const waitingJob = service.createJob({ projectId: 'project_1', templateId: 'image-generation', state: {} });
    const waitingRunner = createCreatorStageRunner({
      repository, templates, issueService, telemetry,
      executors: [{ id: 'image', run: async () => ({ outputs: [] }) }],
      workRoot: join(tempDir, 'jobs'),
      beforeRun() {
        throw new CreatorExecutorError('creator_image_config_missing', '/private/prompt and secret.srt');
      }
    });
    const waiting = await waitingRunner.run(waitingJob.id, 'generate');
    await waitingRunner.close();
    expect(outbox.list().map(item => item.event_type)).toEqual(['task_finished']);
    const finished = outbox.list().find(item => item.event_type === 'task_finished');
    expect(finished).toMatchObject({
      task_id: waitingJob.id,
      attempt_id: waiting.id,
      feature: 'image-generation',
      outcome: 'needs_input',
      failure: {
        error_code: 'creator_image_config_missing',
        category: 'configuration',
        user_message: 'Creator stage needs input.'
      }
    });
    expect(JSON.stringify(finished)).not.toContain('/private');
    expect(JSON.stringify(finished)).not.toContain('secret');
    db.close();
  });

  it('records restart recovery as interrupted without folding the outcome', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-restart-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    let repository = createCreatorRepository(db);
    const templates = createDefaultCreatorTemplateRegistry();
    const service = createCreatorService({ repository, templates });
    const job = service.createJob({ projectId: 'project_1', templateId: 'smart-dubbing', state: {} });
    repository.createStageRun({ jobId: job.id, stageId: 'tts', executor: 'smart-dubbing', status: 'running' });
    repository = createCreatorRepository(db);
    const recovered = repository.listRecoveredInterruptedStageRuns?.() ?? [];
    const outbox = createCreatorTelemetryOutbox(db);
    const telemetry = createCreatorTelemetrySink({ outbox, readAccount: () => account });
    for (const stage of recovered) {
      const current = repository.getJob(stage.jobId)!;
      telemetry.stageFinished(current, stage, current.templateId, 'interrupted');
    }
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]).toMatchObject({
      task_id: job.id,
      attempt_id: recovered[0]!.id,
      outcome: 'interrupted',
      failure: { error_code: 'creator_stage_interrupted_on_restart' }
    });
    db.close();
  });
});
