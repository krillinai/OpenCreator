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
import { attachFailureDiagnostic, failureDiagnosticFromError, processFailureDiagnostic } from '../../src/telemetry/diagnostic.js';
import { KrillinCliError } from '../../src/creator/krillin/cli-runner.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import type { OpenCreatorIssue, PublicErrorFacts } from '@opencreator/protocol';

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

  it('drops events outside the server acceptance window before reporting', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-expired-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const outbox = createCreatorTelemetryOutbox(db);
    outbox.enqueue({ ...event(), occurred_at: '2026-01-01T00:00:00.000Z' }, 'old');
    const app = Fastify();
    await registerTelemetryRoutes(app, outbox);
    const response = await app.inject('/telemetry/events');
    expect(response.json()).toEqual({ events: [] });
    expect(outbox.count()).toBe(0);
    await app.close();
    db.close();
  });

  it('validates the telemetry setting and clears pending events when disabled', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-setting-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const outbox = createCreatorTelemetryOutbox(db);
    const sink = createCreatorTelemetrySink({ outbox, readAccount: () => account });
    const app = Fastify();
    await registerTelemetryRoutes(app, outbox, sink);
    outbox.enqueue(event(), 'first');

    const invalid = await app.inject({ method: 'POST', url: '/telemetry/enabled', payload: { enabled: 'false' } });
    expect(invalid.statusCode).toBe(400);
    expect(outbox.count()).toBe(1);

    const disabled = await app.inject({ method: 'POST', url: '/telemetry/enabled', payload: { enabled: false } });
    expect(disabled.json()).toEqual({ enabled: false });
    expect((await app.inject('/telemetry/events')).json()).toEqual({ events: [] });
    sink.stageStarted({ id: 'job_1' } as CreatorJob, { id: 'stage_1' } as CreatorStageRun, 'test');
    expect(outbox.count()).toBe(0);

    const enabled = await app.inject({ method: 'POST', url: '/telemetry/enabled', payload: { enabled: true } });
    expect(enabled.json()).toEqual({ enabled: true });
    outbox.enqueue(event(), 'second');
    expect(outbox.count()).toBe(1);
    await app.close();
    db.close();
  });
});

describe('creator telemetry event safety', () => {
  it('keeps actionable process evidence without source URLs, credentials or paths', () => {
    const output = 'ERROR: [youtube] Unable to download API page: [Errno 61] Connection refused after 3 attempts https://youtube.com/watch?v=private Authorization: Bearer secret';
    const diagnostic = processFailureDiagnostic({
      operation: 'yt-dlp.probe', tool: 'yt-dlp', version: '2026.10.01', exitCode: 1,
      output, proxy: 'http://user:password@127.0.0.1:7890', sourceUrl: 'https://youtube.com/watch?v=private'
    });
    expect(diagnostic).toMatchObject({
      operation: 'yt-dlp.probe', process: { tool: 'yt-dlp', exit_code: 1 },
      network: { route: 'proxy', peer: 'unknown', platform: 'youtube', proxy_scope: 'loopback', proxy_port: 7890 },
      evidence: ['api_page_failed', 'connection_refused', 'internal_attempts_3']
    });
    const error = attachFailureDiagnostic(new CreatorExecutorError('network_unavailable', output), diagnostic);
    const fromError = failureDiagnosticFromError(error, 'download.probe');
    expect(fromError?.causes).toEqual([{ name: 'CreatorExecutorError', code: 'network_unavailable' }]);
    expect(JSON.stringify(fromError)).not.toMatch(/private|password|Bearer|youtube\.com/);
  });

  it('identifies an explicit local proxy refusal and direct platform refusal separately', () => {
    const proxy = processFailureDiagnostic({ operation: 'yt-dlp.download', tool: 'yt-dlp',
      output: 'ProxyError: proxy connection refused', proxy: 'http://localhost:7890' });
    const direct = processFailureDiagnostic({ operation: 'yt-dlp.download', tool: 'yt-dlp',
      output: 'ERROR: Connection refused', proxy: '', sourceUrl: 'https://www.bilibili.com/video/test' });
    expect(proxy.network).toMatchObject({ route: 'proxy', peer: 'proxy', proxy_scope: 'loopback' });
    expect(direct.network).toMatchObject({ route: 'direct', peer: 'platform', platform: 'bilibili' });
  });
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

  it('keeps only safe user and Gateway correlation IDs', () => {
    const requestId = `ocreq_${'a'.repeat(48)}`;
    const sanitized = sanitizeCreatorTelemetryEvent({
      ...event(), user_id: 'account-123',
      failure: { error_code: 'audio_transcription_api_failed', request_id: requestId }
    });
    expect(sanitized.user_id).toBe('account-123');
    expect(sanitized.failure?.request_id).toBe(requestId);
    expect(sanitizeCreatorTelemetryEvent({
      ...event(), user_id: 'secret\nvalue', failure: { request_id: 'foreign-request-id' }
    }).failure?.request_id).toBeUndefined();
    expect(sanitizeCreatorTelemetryEvent({ ...event(), user_id: 'secret\nvalue' }).user_id).toBeUndefined();
  });

  it('uses the current failure request ID even when an older issue has a different ID', () => {
    const current = `ocreq_${'c'.repeat(48)}`;
    const stale = `ocreq_${'d'.repeat(48)}`;
    const result = createCreatorTelemetryEvent({
      eventType: 'task_finished', occurredAt: '2026-10-26T00:00:01.000Z',
      job: { id: 'job_1' } as CreatorJob,
      stage: { id: 'attempt_1', stageId: 'tts', executor: 'krillinai', attempt: 1,
        startedAt: null, finishedAt: null, errorCode: 'provider_failed', progress: {} } as CreatorStageRun,
      feature: 'smart-dubbing', outcome: 'failed', account,
      issue: { code: 'provider_failed', publicFacts: { kind: 'unavailable', requestId: stale } } as OpenCreatorIssue,
      failureFacts: { kind: 'unavailable', requestId: current, httpStatus: 502 }
    });
    expect(result.failure).toMatchObject({ request_id: current, http_status: 502 });
  });

  it('isolates account lookup and outbox failures from Creator execution', () => {
    const job = { id: 'creator_job_1' } as CreatorJob;
    const stage = { id: 'creator_stage_run_1' } as CreatorStageRun;
    const brokenAccount = createCreatorTelemetrySink({
      outbox: { enqueue: () => { throw new Error('disk full'); } } as unknown as ReturnType<typeof createCreatorTelemetryOutbox>,
      readAccount: () => { throw new Error('account unavailable'); }
    });
    expect(() => brokenAccount.stageStarted(job, stage, 'smart-dubbing')).not.toThrow();
    const brokenOutbox = createCreatorTelemetrySink({
      outbox: { enqueue: () => { throw new Error('disk full'); } } as unknown as ReturnType<typeof createCreatorTelemetryOutbox>,
      readAccount: () => account
    });
    expect(() => brokenOutbox.stageFinished(job, stage, 'smart-dubbing', 'failed')).not.toThrow();
  });

  it('stops collection and clears pending events when telemetry is disabled', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-disabled-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const outbox = createCreatorTelemetryOutbox(db);
    outbox.enqueue(event(), 'first');
    const sink = createCreatorTelemetrySink({ outbox, readAccount: () => account });
    sink.setEnabled(false);
    expect(outbox.count()).toBe(0);
    sink.stageStarted({ id: 'job_1' } as CreatorJob, { id: 'stage_1' } as CreatorStageRun, 'test');
    expect(outbox.count()).toBe(0);
    sink.setEnabled(true);
    db.close();
  });
});

describe('creator stage telemetry outcome mapping', () => {
  it('keeps the specific cause of local caption and preview connection failures', () => {
    const captionError = new KrillinCliError(
      'platform_caption_access_failed',
      'platform caption failed: downloadYouTubeSubtitle yt-dlp error after 3 attempts: exit status 1: ERROR: [youtube] Unable to download API page: [Errno 61] Connection refused for https://example.test/private'
    );
    const failure = (code: string, facts: PublicErrorFacts) => createCreatorTelemetryEvent({
      eventType: 'task_finished',
      occurredAt: '2026-10-26T00:00:01.000Z',
      job: { id: 'creator_job_1' } as CreatorJob,
      stage: {
        id: 'creator_stage_run_1', stageId: 'subtitle', executor: 'krillinai', attempt: 1,
        startedAt: null, finishedAt: null, errorCode: code, progress: {}
      } as CreatorStageRun,
      feature: 'video-translation',
      outcome: 'failed',
      account,
      issue: { code, publicFacts: facts } as OpenCreatorIssue
    }).failure;

    expect(captionError.publicFacts.upstreamCode).toBe('platform_caption_access_failed');
    expect(failure('platform_caption_access_failed', captionError.publicFacts)?.upstream_code)
      .toBe('connection_refused');
    expect(failure('network_unavailable', { kind: 'connection-refused', provider: 'yt-dlp' })?.upstream_code)
      .toBe('connection_refused');
    expect(failure('network_unavailable', {
      kind: 'connection-refused', provider: 'yt-dlp', upstreamCode: 'PROVIDER_SPECIFIC_CODE'
    })?.upstream_code).toBe('PROVIDER_SPECIFIC_CODE');
    expect(JSON.stringify(failure('platform_caption_access_failed', captionError.publicFacts)))
      .not.toContain('example.test');
  });

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
  it('reports the exact failed attempt diagnostic without changing the stage result', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-telemetry-failure-'));
    const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const repository = createCreatorRepository(db);
    const templates = createDefaultCreatorTemplateRegistry();
    const service = createCreatorService({ repository, templates });
    const outbox = createCreatorTelemetryOutbox(db);
    const telemetry = createCreatorTelemetrySink({ outbox, readAccount: () => account });
    const job = service.createJob({ projectId: 'project_1', templateId: 'smart-dubbing', state: {} });
    const runner = createCreatorStageRunner({
      repository, templates, telemetry, issueService: createCreatorIssueService(repository),
      executors: [{ id: 'smart-dubbing', run: async () => {
        throw attachFailureDiagnostic(new CreatorExecutorError('network_unavailable', 'Connection refused'),
          processFailureDiagnostic({ operation: 'yt-dlp.probe', tool: 'yt-dlp', output: 'ProxyError: proxy connection refused', proxy: 'http://127.0.0.1:7890' }));
      } }],
      workRoot: join(tempDir, 'jobs')
    });
    const result = await runner.run(job.id, 'tts');
    expect(result.status).toBe('failed');
    expect(outbox.list().find(item => item.event_type === 'task_finished')?.failure?.diagnostic)
      .toMatchObject({ operation: 'yt-dlp.probe', network: { route: 'proxy', peer: 'proxy', proxy_port: 7890 } });
    await runner.close();
    db.close();
  });

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
