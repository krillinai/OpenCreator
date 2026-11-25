import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultCreatorServicesConfig,
  stickmanCanvasForRatio,
  type SocialPublishResult
} from '@opencreator/protocol';
import { createCreatorPreflight } from '../../src/creator/preflight.js';
import { CreatorProviderRequestLedger } from '../../src/creator/provider-requests.js';
import {
  createUploadPostClient,
  normalizeUploadPostResults,
  UploadPostApiError,
  type UploadPostClient,
  type UploadPostStatus,
  type UploadPostTransportRequest
} from '../../src/creator/publishing/upload-post-client.js';
import { createUploadPostProviderCapabilities } from '../../src/creator/publishing/upload-post-provider-lookup.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createUploadPostPublishExecutor } from '../../src/creator/stickman/social-publish-executor.js';
import { socialPublishRequestKey } from '../../src/creator/stickman/social-publish.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { createStickmanVideoTemplate } from '../../src/creator/templates/stickman-video.js';
import { createKrillinCreatorServicesCapabilities } from '../../src/creator/krillin/capabilities.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Upload-Post client', () => {
  it('streams one multipart upload with the request id as Idempotency-Key', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'upload-post-client-'));
    const videoPath = join(tempDir, 'short.mp4');
    writeFileSync(videoPath, Buffer.from('fake-mp4-bytes'));
    const requests: Array<UploadPostTransportRequest & { text: string }> = [];
    const client = createUploadPostClient({
      apiKey: 'key-123',
      transport: async request => {
        requests.push({ ...request, text: request.body === undefined ? '' : await readAll(request.body) });
        return { status: 200, body: JSON.stringify({ success: true, request_id: 'req-1' }) };
      }
    });

    await client.submitVideo({
      requestId: 'req-1',
      profile: 'creator',
      platforms: ['tiktok', 'youtube'],
      videoPath,
      title: '火柴人讲解 #Shorts',
      description: 'Longer text',
      youtubePrivacy: 'private',
      tiktokPrivacy: 'account-default',
      aiGenerated: true,
      signal: new AbortController().signal
    });

    const [request] = requests;
    expect(request!.url.toString()).toBe('https://api.upload-post.com/api/upload');
    expect(request!.headers.Authorization).toBe('Apikey key-123');
    expect(request!.headers['Idempotency-Key']).toBe('req-1');
    expect(Number(request!.headers['Content-Length'])).toBe(Buffer.byteLength(request!.text));
    const fields = multipartFields(request!.text);
    expect(fields).toEqual(expect.arrayContaining([
      ['user', 'creator'],
      ['title', '火柴人讲解 #Shorts'],
      ['request_id', 'req-1'],
      ['async_upload', 'true'],
      ['platform[]', 'tiktok'],
      ['platform[]', 'youtube'],
      ['description', 'Longer text'],
      ['is_ai_generated', 'true'],
      ['privacyStatus', 'private']
    ]));
    expect(fields.some(([name]) => name === 'privacy_level')).toBe(false);
    expect(request!.text).toContain('fake-mp4-bytes');
  });

  it('maps HTTP errors to typed errors and 404 status lookups to not_found', async () => {
    const client = createUploadPostClient({
      apiKey: 'bad',
      transport: async request => request.method === 'GET'
        ? { status: 404, body: JSON.stringify({ status: 'not_found' }) }
        : { status: 401, body: JSON.stringify({ message: 'Invalid API key' }) }
    });
    await expect(client.getStatus('missing', new AbortController().signal))
      .resolves.toMatchObject({ status: 'not_found' });
    tempDir = mkdtempSync(join(tmpdir(), 'upload-post-client-'));
    const videoPath = join(tempDir, 'short.mp4');
    writeFileSync(videoPath, 'x');
    await expect(client.submitVideo({
      requestId: 'r', profile: 'p', platforms: ['x'], videoPath, title: 't', description: '',
      youtubePrivacy: 'private', tiktokPrivacy: 'SELF_ONLY', aiGenerated: false,
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: 'upload_post_auth_failed', status: 401 });
  });

  it('normalizes private, skipped, inbox and failed platform results', () => {
    expect(normalizeUploadPostResults([
      { platform: 'youtube', success: true, platform_post_id: 'abc', post_url: 'Post uploaded as Private. No public URL available.' },
      { platform: 'tiktok', success: true, post_url: 'Video sent to Inbox (No Public URL)', fallback_to_inbox: true },
      { platform: 'linkedin', success: false, skipped: true },
      { platform: 'x', success: false, error_message: 'Duplicate content' },
      { platform: 'instagram', success: true, post_url: 'https://instagram.com/reel/1' }
    ])).toEqual([
      { platform: 'youtube', status: 'completed', url: 'https://www.youtube.com/watch?v=abc', postId: 'abc', note: null, error: null, inbox: false },
      { platform: 'tiktok', status: 'completed', url: null, postId: null, note: 'Video sent to Inbox (No Public URL)', error: null, inbox: true },
      { platform: 'linkedin', status: 'skipped', url: null, postId: null, note: null, error: null, inbox: false },
      { platform: 'x', status: 'failed', url: null, postId: null, note: null, error: 'Duplicate content', inbox: false },
      { platform: 'instagram', status: 'completed', url: 'https://instagram.com/reel/1', postId: null, note: null, error: null, inbox: false }
    ]);
  });
});

describe('confirm-social-publish', () => {
  it('only lets the user confirm, and only for the latest delivery', () => {
    const { db, service, jobId, manifestId } = setupDeliveredJob();
    const job = service.getJob(jobId)!;
    const input = confirmationInput(manifestId);

    expect(() => service.applyAction(jobId, {
      actor: 'agent',
      action: 'confirm-social-publish',
      expectedRevision: job.revision,
      input
    })).toThrow(/Only the user/);
    expect(() => service.applyAction(jobId, {
      actor: 'user',
      action: 'confirm-social-publish',
      expectedRevision: job.revision,
      input: { ...input, deliveryManifestArtifactId: 'older-manifest' }
    })).toThrow(/latest finished delivery/);

    const confirmed = service.applyAction(jobId, {
      actor: 'user',
      action: 'confirm-social-publish',
      expectedRevision: job.revision,
      input
    }).job;
    expect(confirmed.state.socialPublish).toMatchObject({
      platforms: ['tiktok', 'youtube'],
      youtubePrivacy: 'private',
      deliveryManifestArtifactId: manifestId,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/)
    });
    db.close();
  });

  it('refuses to forge a confirmation through settings patches', () => {
    const { db, service, jobId, manifestId } = setupDeliveredJob();
    const job = service.getJob(jobId)!;
    for (const action of ['update-settings', 'undo-action']) {
      expect(() => service.applyAction(jobId, {
        actor: 'agent',
        action,
        expectedRevision: job.revision,
        input: { patch: { socialPublish: { ...confirmationInput(manifestId), id: crypto.randomUUID(), confirmedAt: 'now' } } }
      })).toThrow(/confirm-social-publish/);
    }
    db.close();
  });
});

describe('social-publish stage', () => {
  it('publishes the confirmed delivery once and records per-platform results', async () => {
    const { db, repository, service, templates, jobId, manifestId, videoPath } = setupDeliveredJob();
    const confirmationId = confirm(service, jobId, manifestId);
    const client = fakeClient([
      { status: 'processing', completed: 1, total: 2, results: [] },
      {
        status: 'completed',
        completed: 2,
        total: 2,
        results: normalizeUploadPostResults([
          { platform: 'tiktok', success: true, platform_post_id: 'v_pub_1' },
          { platform: 'youtube', success: true, platform_post_id: 'yt1', post_url: 'Post uploaded as Private. No public URL available.' }
        ])
      }
    ]);
    const runner = stageRunner(repository, templates, client);

    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('succeeded');

    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(client.submitVideo.mock.calls[0]![0]).toMatchObject({
      requestId: confirmationId,
      profile: 'creator',
      videoPath,
      platforms: ['tiktok', 'youtube']
    });
    const done = service.getJob(jobId)!;
    expect(done.status).toBe('completed');
    const artifact = done.artifacts.find(item => item.kind === 'social_publish_result')!;
    const result = JSON.parse(readFileSync(artifact.path!, 'utf8')) as SocialPublishResult;
    expect(result).toMatchObject({
      provider: 'upload-post',
      requestId: confirmationId,
      deliveryManifestArtifactId: manifestId,
      status: 'completed',
      results: [
        { platform: 'tiktok', status: 'completed', postId: 'v_pub_1' },
        { platform: 'youtube', status: 'completed', url: 'https://www.youtube.com/watch?v=yt1' }
      ]
    });
    expect(done.providerRequests).toEqual([
      expect.objectContaining({
        provider: 'upload-post',
        requestKey: socialPublishRequestKey(jobId, confirmationId),
        status: 'succeeded',
        remoteTaskId: confirmationId
      })
    ]);

    // Running the stage again without a new confirmation must not post again.
    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(latestStage(service, jobId).errorCode).toBe('creator_social_publish_already_submitted');
    await runner.close();
    db.close();
  });

  it('never re-sends the video after a dropped connection', async () => {
    const { db, repository, service, templates, jobId, manifestId } = setupDeliveredJob();
    confirm(service, jobId, manifestId);
    const client = fakeClient([
      { status: 'in_progress', completed: 0, total: 1, results: [] },
      { status: 'completed', completed: 1, total: 1, results: normalizeUploadPostResults([{ platform: 'tiktok', success: true }]) }
    ]);
    client.submitVideo.mockRejectedValueOnce(new Error('socket hang up'));
    const runner = stageRunner(repository, templates, client);

    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('succeeded');
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    await runner.close();
    db.close();
  });

  it('asks the user to resolve an upload whose outcome is unknown', async () => {
    const { db, repository, service, templates, jobId, manifestId } = setupDeliveredJob();
    confirm(service, jobId, manifestId);
    const client = fakeClient([{ status: 'not_found', completed: 0, total: null, results: [] }]);
    client.submitVideo.mockRejectedValueOnce(new Error('socket hang up'));
    const runner = stageRunner(repository, templates, client);

    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    const job = service.getJob(jobId)!;
    expect(job.providerRequests[0]!.status).toBe('unknown_remote_acceptance');
    expect(latestStage(service, jobId).errorCode).toBe('creator_provider_resolution_required');
    await runner.close();
    db.close();
  });

  it('lets the user retry the same confirmation after Upload-Post rejected it', async () => {
    const { db, repository, service, templates, jobId, manifestId } = setupDeliveredJob();
    confirm(service, jobId, manifestId);
    const client = fakeClient([
      { status: 'completed', completed: 1, total: 1, results: normalizeUploadPostResults([{ platform: 'tiktok', success: true }]) }
    ]);
    client.submitVideo.mockRejectedValueOnce(new UploadPostApiError('upload_post_auth_failed', 'Upload-Post: Invalid API key', 401));
    const runner = stageRunner(repository, templates, client);

    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    expect(latestStage(service, jobId).errorCode).toBe('creator_publishing_auth_failed');
    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('succeeded');
    expect(client.submitVideo).toHaveBeenCalledTimes(2);
    await runner.close();
    db.close();
  });

  it('never submits the same confirmation twice after an ambiguous 5xx, even after a restart', async () => {
    const { db, repository, service, templates, jobId, manifestId } = setupDeliveredJob();
    confirm(service, jobId, manifestId);
    const client = fakeClient([{ status: 'not_found', completed: 0, total: null, results: [] }]);
    client.submitVideo.mockRejectedValueOnce(new UploadPostApiError('upload_post_http_error', 'Upload-Post: HTTP 503', 503));
    const runner = stageRunner(repository, templates, client);

    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    expect(latestStage(service, jobId).errorCode).toBe('creator_provider_resolution_required');
    expect(service.getJob(jobId)!.providerRequests[0]!.status).toBe('unknown_remote_acceptance');
    expect(client.getStatus).toHaveBeenCalledWith(expect.any(String), expect.any(AbortSignal));

    // Retrying the stage with the same confirmation is refused.
    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    expect(latestStage(service, jobId).errorCode).toBe('creator_social_publish_already_submitted');
    await runner.close();

    // A restarted daemon (new ledger, runner and executor on the same database) recovers
    // the request by id and still refuses to send the file again.
    const ledger = new CreatorProviderRequestLedger(repository);
    const request = service.getJob(jobId)!.providerRequests[0]!;
    const recovered = await ledger.recover(request.id, createUploadPostProviderCapabilities({
      configStore: { read: async () => configured() },
      createClient: () => fakeClient([{ status: 'in_progress', completed: 0, total: 2, results: [] }]) as unknown as UploadPostClient
    }));
    expect(recovered.status).toBe('waiting_remote');
    const restarted = stageRunner(repository, templates, client);
    expect((await restarted.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    expect(latestStage(service, jobId).errorCode).toBe('creator_social_publish_already_submitted');
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    await restarted.close();
    db.close();
  });

  it('keeps tracking a request that Upload-Post accepted despite a 5xx answer', async () => {
    const { db, repository, service, templates, jobId, manifestId } = setupDeliveredJob();
    confirm(service, jobId, manifestId);
    const client = fakeClient([
      { status: 'processing', completed: 0, total: 1, results: [] },
      { status: 'completed', completed: 1, total: 1, results: normalizeUploadPostResults([{ platform: 'tiktok', success: true }]) }
    ]);
    client.submitVideo.mockRejectedValueOnce(new UploadPostApiError('upload_post_http_error', 'Upload-Post: HTTP 502', 502));
    const runner = stageRunner(repository, templates, client);

    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('succeeded');
    expect(client.submitVideo).toHaveBeenCalledTimes(1);
    expect(service.getJob(jobId)!.providerRequests[0]!.status).toBe('succeeded');
    await runner.close();
    db.close();
  });

  it('refuses to publish a technical draft with placeholders and unresolved checks', async () => {
    const { db, repository, service, templates, jobId, manifestId } = setupDeliveredJob({
      delivery: {
        packageStatus: 'technical-draft',
        placeholderAssets: ['shot-02'],
        blockingChecks: ['visual_ocr_unverified']
      }
    });
    const job = service.getJob(jobId)!;
    expect(() => service.applyAction(jobId, {
      actor: 'user',
      action: 'confirm-social-publish',
      expectedRevision: job.revision,
      input: confirmationInput(manifestId)
    })).toThrow(/technical draft.*shot-02.*visual_ocr_unverified/);
    expect(service.getJob(jobId)!.state.socialPublish).toBeUndefined();

    // Even a confirmation that is already in the state cannot publish the draft.
    repository.updateJob({
      id: jobId,
      status: job.status,
      revision: job.revision,
      state: {
        ...job.state,
        socialPublish: {
          ...confirmationInput(manifestId),
          id: '0b37296f-03c0-416e-9515-8aac6038e2d8',
          confirmedAt: '2026-09-30T00:00:00.000Z'
        }
      }
    });
    const client = fakeClient([{ status: 'completed', completed: 0, total: 0, results: [] }]);
    const runner = stageRunner(repository, templates, client);
    expect((await runner.runStageRun(queuePublish(repository, jobId).id)).status).toBe('failed');
    expect(latestStage(service, jobId).errorCode).toBe('creator_social_publish_delivery_not_publishable');
    expect(client.submitVideo).not.toHaveBeenCalled();
    expect(service.getJob(jobId)!.providerRequests).toHaveLength(0);
    await runner.close();
    db.close();
  });

  it('is blocked by preflight until Upload-Post is configured', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'social-publish-preflight-'));
    const stage = createStickmanVideoTemplate().stages.find(item => item.id === 'social-publish')!;
    const preflight = (config: ReturnType<typeof createDefaultCreatorServicesConfig>) => createCreatorPreflight({
      configStore: { read: async () => config },
      readCapabilities: () => createKrillinCreatorServicesCapabilities('win32', 'x64'),
      resourceRoot: join(tempDir, 'runtime'),
      jobsRoot: join(tempDir, 'jobs'),
      executorIds: ['upload-post-publish']
    });
    const { db, service, jobId } = setupDeliveredJob({ keepTempDir: true });
    const job = service.getJob(jobId)!;

    const missing = await preflight(createDefaultCreatorServicesConfig()).check(job, stage);
    expect(missing.canStart).toBe(false);
    expect(missing.blocked).toEqual(expect.arrayContaining([expect.objectContaining({
      id: 'publishing',
      repair: expect.objectContaining({ deepLink: '#/settings?tab=ai-services&section=publishing' })
    })]));

    const ready = await preflight(configured()).check(job, stage);
    expect(ready.blocked.map(item => item.id)).not.toContain('publishing');
    db.close();
  });

  it('lets provider recovery look an interrupted upload up by its request id', async () => {
    const getStatus = vi.fn(async (): Promise<UploadPostStatus> => ({
      status: 'in_progress', completed: 0, total: 1, results: []
    }));
    const capabilities = createUploadPostProviderCapabilities({
      configStore: { read: async () => configured() },
      createClient: () => ({ submitVideo: vi.fn(), getStatus }) as unknown as UploadPostClient
    });
    const id = '0b37296f-03c0-416e-9515-8aac6038e2d8';
    await expect(capabilities.lookup({
      provider: 'upload-post',
      requestKey: socialPublishRequestKey('job-1', id),
      remoteTaskId: null
    })).resolves.toEqual({ status: 'waiting_remote', remoteTaskId: id });
    expect(getStatus).toHaveBeenCalledWith(id, expect.any(AbortSignal));
    await expect(capabilities.lookup({ provider: 'openai', requestKey: 'k', remoteTaskId: null }))
      .resolves.toEqual({ status: 'not_found' });
  });
});

type DeliveryVerdict = {
  packageStatus?: 'publishable' | 'technical-draft';
  placeholderAssets?: string[];
  blockingChecks?: string[];
};

function setupDeliveredJob(options: { keepTempDir?: boolean; delivery?: DeliveryVerdict } = {}) {
  if (!options.keepTempDir || !tempDir) tempDir = mkdtempSync(join(tmpdir(), 'creator-social-publish-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const job = service.createJob({ projectId: 'p1', templateId: 'stickman-video', state: {} });
  const videoPath = join(tempDir, 'short.mp4');
  writeFileSync(videoPath, 'video');
  const video = repository.insertArtifact({
    jobId: job.id, kind: 'clean_video', status: 'completed', path: videoPath,
    sha256: sha256(videoPath), sourceArtifactIds: [], metadata: {}
  });
  const manifestPath = join(tempDir, 'delivery-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(deliveryManifest(video.id, options.delivery)));
  const manifest = repository.insertArtifact({
    jobId: job.id, kind: 'delivery_manifest', status: 'completed', path: manifestPath,
    sha256: sha256(manifestPath), sourceArtifactIds: [video.id], metadata: {}
  });
  const current = service.getJob(job.id)!;
  repository.updateJob({ id: job.id, status: 'completed', revision: current.revision, state: current.state });
  return { db, repository, service, templates, jobId: job.id, manifestId: manifest.id, videoPath };
}

function confirmationInput(manifestId: string) {
  return {
    platforms: ['tiktok', 'youtube'],
    title: 'Stick figures explain RAG #Shorts',
    description: 'A 30 second explainer.',
    youtubePrivacy: 'private',
    tiktokPrivacy: 'SELF_ONLY',
    aiGenerated: true,
    deliveryManifestArtifactId: manifestId
  };
}

function confirm(service: ReturnType<typeof createCreatorService>, jobId: string, manifestId: string): string {
  const job = service.getJob(jobId)!;
  const confirmed = service.applyAction(jobId, {
    actor: 'user',
    action: 'confirm-social-publish',
    expectedRevision: job.revision,
    input: confirmationInput(manifestId)
  }).job;
  return (confirmed.state.socialPublish as { id: string }).id;
}

function queuePublish(repository: ReturnType<typeof createCreatorRepository>, jobId: string) {
  return repository.createStageRun({
    jobId,
    stageId: 'social-publish',
    executor: 'upload-post-publish',
    status: 'queued'
  });
}

function latestStage(service: ReturnType<typeof createCreatorService>, jobId: string) {
  return service.getJob(jobId)!.stages.filter(stage => stage.stageId === 'social-publish').at(-1)!;
}

function stageRunner(
  repository: ReturnType<typeof createCreatorRepository>,
  templates: ReturnType<typeof createDefaultCreatorTemplateRegistry>,
  client: UploadPostClient
) {
  return createCreatorStageRunner({
    repository,
    templates,
    workRoot: join(tempDir, 'jobs'),
    executors: [createUploadPostPublishExecutor({
      configStore: { read: async () => configured() },
      ledger: new CreatorProviderRequestLedger(repository),
      createClient: () => client,
      pollIntervalMs: 0,
      sleep: async () => undefined
    })]
  });
}

function fakeClient(statuses: UploadPostStatus[]) {
  let index = 0;
  return {
    submitVideo: vi.fn(async (request: { requestId: string }) => ({ requestId: request.requestId })),
    getStatus: vi.fn(async () => statuses[Math.min(index++, statuses.length - 1)]!)
  };
}

function configured() {
  const config = createDefaultCreatorServicesConfig();
  config.publishing.uploadPost = { apiKey: 'key-123', profile: 'creator' };
  return config;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}

function multipartFields(body: string): Array<[string, string]> {
  return [...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)].map(match => [match[1]!, match[2]!]);
}

function deliveryManifest(videoArtifactId: string, verdict: DeliveryVerdict = {}) {
  const canvas = stickmanCanvasForRatio('9:16');
  const file = (name: string, mime: string) => ({
    name, relativePath: `delivery/${name}`, sha256: 'a'.repeat(64), bytes: 1, mime, sourceArtifactId: videoArtifactId
  });
  return {
    packageStatus: verdict.packageStatus ?? 'publishable',
    ratio: '9:16',
    width: canvas.width,
    height: canvas.height,
    duration: 6,
    providers: { image: 'codex-native', video: 'remotion', voice: 'edge-tts' },
    placeholderAssets: verdict.placeholderAssets ?? [],
    blockingChecks: verdict.blockingChecks ?? [],
    files: [
      file('short.mp4', 'video/mp4'),
      file('subtitles.srt', 'application/x-subrip'),
      file('thumbnail.png', 'image/png'),
      file('publish-copy.md', 'text/markdown')
    ]
  };
}
