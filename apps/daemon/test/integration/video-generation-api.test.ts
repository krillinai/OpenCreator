import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVideoGenerationRoutes } from '../../src/api/routes.video-generation.js';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { createVideoGenerationService } from '../../src/video-generation/service.js';

describe('video generation API', () => {
  let server: FastifyInstance;
  let dataDir: string;

  beforeEach(async () => {
    server = Fastify({ logger: false });
    dataDir = await mkdtemp(join(tmpdir(), 'opencreator-video-generation-'));
  });

  afterEach(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns provider HTTP facts without exposing arbitrary response text', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.seedance.apiKey = 'sk-video-test';
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'quota_exceeded', message: 'token=private' }
    }), { status: 429 }));
    await registerVideoGenerationRoutes(server, createVideoGenerationService({
      dataDir, configStore: createConfigStore(config), fetchImpl: fetchImpl as typeof fetch
    }));

    const response = await server.inject({
      method: 'POST', url: '/video-generation/results',
      payload: { prompt: 'A portrait', provider: 'seedance', size: '1280x720', duration: 5 }
    });
    expect(response.json().error).toMatchObject({
      code: 'VIDEO_GENERATION_UPSTREAM_ERROR',
      publicFacts: { kind: 'rate-limited', provider: 'seedance', httpStatus: 429, upstreamCode: 'quota_exceeded' }
    });
    expect(response.body).not.toContain('private');
  });

  it('keeps only a safe upstream code from an asynchronous failed job', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.seedance.apiKey = 'sk-video-test';
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: 'remote_failed', status: 'failed',
      error: { code: 'CONTENT_REJECTED', message: 'api_key=private' }
    }), { status: 200 }));
    await registerVideoGenerationRoutes(server, createVideoGenerationService({
      dataDir, configStore: createConfigStore(config), fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'video_failed_1234'
    }));
    const response = await server.inject({
      method: 'POST', url: '/video-generation/results',
      payload: { prompt: 'A portrait', provider: 'seedance', size: '1280x720', duration: 5 }
    });
    expect(response.json().result.error).toContain('CONTENT_REJECTED');
    expect(response.body).not.toContain('private');
  });

  it('creates, refreshes, stores, and serves an asynchronous video job', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.seedance.apiKey = 'sk-video-test';
    config.video.seedance.baseUrl = 'https://video.example.test/api/v3';
    const video = Buffer.from('test-video-content');
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (value === 'https://video.example.test/api/v3/contents/generations/tasks' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'video_remote_123', status: 'queued', progress: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (value === 'https://video.example.test/api/v3/contents/generations/tasks/video_remote_123') {
        return new Response(JSON.stringify({
          id: 'video_remote_123',
          status: 'completed',
          progress: 100,
          content: { video_url: 'https://cdn.example.test/video.mp4' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (value === 'https://cdn.example.test/video.mp4') {
        return new Response(video, { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      }
      return new Response('not found', { status: 404 });
    });
    await registerVideoGenerationRoutes(server, createVideoGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'video_result_1234',
      now: () => new Date('2026-08-20T00:00:00.000Z')
    }));

    const created = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: {
        prompt: 'A cinematic city reveal',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        size: '1280x720',
        duration: 5
      }
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().result).toMatchObject({
      id: 'video_result_1234',
      provider: 'seedance',
      model: 'doubao-seedance-2-0-260128',
      status: 'queued',
      videoSize: '1280x720',
      duration: 5
    });
    const createRequest = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(createRequest?.body))).toMatchObject({
      model: 'doubao-seedance-2-0-260128',
      content: [{ type: 'text', text: 'A cinematic city reveal' }],
      ratio: '16:9',
      duration: 5
    });

    const refreshed = await server.inject({
      method: 'GET',
      url: '/video-generation/results/video_result_1234'
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().result).toMatchObject({
      status: 'completed',
      progress: 100,
      mime: 'video/mp4',
      size: video.length
    });

    const content = await server.inject({
      method: 'GET',
      url: '/video-generation/results/video_result_1234/content'
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('video/mp4');
    expect(content.rawPayload).toEqual(video);
  });

  it('creates and refreshes a Kling text-to-video task with JWT authentication', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.kling.accessKey = 'kling-access';
    config.video.kling.secretKey = 'kling-secret';
    config.video.kling.baseUrl = 'https://kling.example.test';
    const video = Buffer.from('kling-video');
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (value === 'https://kling.example.test/v1/videos/text2video' && init?.method === 'POST') {
        return new Response(JSON.stringify({ data: { task_id: 'kling_video_task', task_status: 'submitted' } }), { status: 200 });
      }
      if (value === 'https://kling.example.test/v1/videos/text2video/kling_video_task') {
        return new Response(JSON.stringify({
          data: {
            task_id: 'kling_video_task',
            task_status: 'succeed',
            task_result: { videos: [{ url: 'https://cdn.example.test/kling.mp4' }] }
          }
        }), { status: 200 });
      }
      if (value === 'https://cdn.example.test/kling.mp4') return new Response(video, { status: 200 });
      return new Response('not found', { status: 404 });
    });
    await registerVideoGenerationRoutes(server, createVideoGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'kling_video_result'
    }));

    const created = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: { prompt: 'A runner in the rain', provider: 'kling', size: '720x1280', duration: 10 }
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().result).toMatchObject({ provider: 'kling', status: 'queued', duration: 10 });
    expect((fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      model_name: 'kling-v2-1-master',
      aspect_ratio: '9:16',
      duration: '10'
    });

    const refreshed = await server.inject({ method: 'GET', url: '/video-generation/results/kling_video_result' });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().result).toMatchObject({ status: 'completed', size: video.length });
  });

  it('migrates an existing Google Veo configuration and draft to an Omni interaction', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.veo.apiKey = 'google-test';
    config.video.veo.baseUrl = 'https://gemini.example.test/v1beta';
    config.video.veo.model = 'veo-3.1-generate-preview';
    const video = Buffer.from('omni-video');
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (value === 'https://gemini.example.test/v1beta/interactions' && init?.method === 'POST') {
        return Response.json({ id: 'v1_omni-task', status: 'in_progress' });
      }
      if (value === 'https://gemini.example.test/v1beta/interactions/v1_omni-task' && init?.method === 'GET') {
        return Response.json({
          id: 'v1_omni-task', status: 'completed',
          steps: [
            { type: 'user_input', content: [{ type: 'video', mime_type: 'video/mp4', data: 'd3Jvbmc=' }] },
            { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: video.toString('base64') }] }
          ]
        });
      }
      return new Response('not found', { status: 404 });
    });
    const service = createVideoGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'veo_video_result_1'
    });
    await registerVideoGenerationRoutes(server, service);

    const created = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: { prompt: 'Clouds moving over mountains', provider: 'veo', model: 'veo-3.1-generate-preview', size: '1280x720', duration: 8 }
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().result).toMatchObject({ provider: 'veo', model: 'gemini-omni-1.2-flash', status: 'in_progress', duration: 8 });
    expect(created.json().result).toMatchObject({
      progress: 0,
      progressKnown: false
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'gemini-omni-1.2-flash', input: 'Clouds moving over mountains', background: true,
      response_format: { type: 'video', aspect_ratio: '16:9', resolution: '720p', duration: '8s' }
    });

    const refreshed = await server.inject({ method: 'GET', url: '/video-generation/results/veo_video_result_1' });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().result).toMatchObject({ status: 'completed', size: video.length });
    expect((await service.read('veo_video_result_1')).content).toEqual(video);
    expect(fetchImpl.mock.calls.map(([, options]) => options?.method)).toEqual(['POST', 'GET']);
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('x-goog-api-key')).toBe('google-test');
  });

  it('keeps completed direct Veo videos readable without polling retired Veo jobs', async () => {
    const config = createDefaultCreatorServicesConfig();
    const fetchImpl = vi.fn<typeof fetch>();
    const service = createVideoGenerationService({ dataDir, configStore: createConfigStore(config), fetchImpl });
    const video = Buffer.from('old-veo-video');
    const timestamp = '2026-10-20T12:00:00.000Z';
    for (const status of ['completed', 'in_progress'] as const) {
      const id = `legacy_veo_${status}`;
      const dir = join(dataDir, 'video-generation', id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'result.json'), JSON.stringify({ upstreamId: 'models/veo/operations/legacy', result: {
        id, prompt: 'Coast road', provider: 'veo', model: 'veo-3.1-generate-preview', videoSize: '1024x1024', duration: 8,
        status, progress: status === 'completed' ? 100 : 0, createdAt: timestamp, updatedAt: timestamp,
        ...(status === 'completed' ? { fileName: 'original.mp4', mime: 'video/mp4', size: video.length } : {})
      } }));
      if (status === 'completed') await writeFile(join(dir, 'video.mp4'), video);
    }
    await expect(service.refresh('legacy_veo_completed')).resolves.toMatchObject({ status: 'completed', model: 'veo-3.1-generate-preview' });
    expect((await service.read('legacy_veo_completed')).content).toEqual(video);
    await expect(service.refresh('legacy_veo_in_progress')).resolves.toMatchObject({ status: 'failed',
      publicFacts: { kind: 'provider-failed', provider: 'veo', upstreamCode: 'model_retired' } });
    expect((await service.get('legacy_veo_in_progress')).status).toBe('failed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a different interaction', () => Response.json({ id: 'v1_other_job', status: 'in_progress' })],
    ['invalid video Base64', () => Response.json({ id: 'v1_omni_job', status: 'completed', steps: [
      { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: '!!!!' }] }
    ] })],
    ['oversized JSON', () => new Response(new ReadableStream({ start(controller) {
      const chunk = new Uint8Array(1024 * 1024);
      for (let index = 0; index < 65; index++) controller.enqueue(chunk);
      controller.close();
    } }))]
  ] as const)('rejects an Omni polling response with %s', async (_name, response) => {
    const config = createDefaultCreatorServicesConfig();
    config.video.veo.apiKey = 'google-test';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: 'v1_omni_job', status: 'in_progress' })).mockImplementationOnce(async () => response());
    const service = createVideoGenerationService({ dataDir, configStore: createConfigStore(config), fetchImpl });
    const request = { prompt: 'Coast road', provider: 'veo', size: '1280x720', duration: 8 } as const;
    await expect(service.create({ ...request, size: '1024x1024' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const result = await service.create(request);
    await expect(service.refresh(result.id)).rejects.toMatchObject({ code: 'VIDEO_GENERATION_UPSTREAM_ERROR' });
    expect((await service.get(result.id)).status).toBe('in_progress');
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET']);
  });

  it('maps an optional reference image to Seedance, Kling, and Omni image-to-video requests', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.seedance.apiKey = 'seedance-test';
    config.video.seedance.baseUrl = 'https://seedance.example.test/api/v3';
    config.video.kling.accessKey = 'kling-access';
    config.video.kling.secretKey = 'kling-secret';
    config.video.kling.baseUrl = 'https://kling.example.test';
    config.video.veo.apiKey = 'veo-test';
    config.video.veo.baseUrl = 'https://veo.example.test/v1beta';
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      const value = String(url);
      if (value.includes('seedance.example.test')) {
        return new Response(JSON.stringify({ id: 'seedance-image-job', status: 'queued' }));
      }
      if (value.includes('kling.example.test')) {
        return new Response(JSON.stringify({
          data: { task_id: 'kling-image-job', task_status: 'submitted' }
        }));
      }
      return Response.json({ id: 'v1_omni-image-job', status: 'in_progress' });
    });
    const ids = ['seedance_image_result', 'kling_image_result', 'veo_image_result'];
    const service = createVideoGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => ids.shift()!
    });
    const referenceImage = {
      mime: 'image/png' as const,
      data: Buffer.from('reference-image').toString('base64')
    };

    await service.create({
      prompt: 'Coast road',
      provider: 'seedance',
      size: '1280x720',
      duration: 5,
      referenceImage
    });
    await service.create({
      prompt: 'Coast road',
      provider: 'kling',
      size: '1280x720',
      duration: 5,
      referenceImage
    });
    await service.create({
      prompt: 'Coast road',
      provider: 'veo',
      size: '1280x720',
      duration: 8,
      referenceImage
    });

    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain('/v1/videos/image2video');
    const seedanceBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(seedanceBody).not.toHaveProperty('ratio');
    expect(seedanceBody.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${referenceImage.data}` }
    });
    const klingBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(klingBody.image).toBe(referenceImage.data);
    const omniBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body));
    expect(omniBody.input).toEqual([
      { type: 'image', data: referenceImage.data, mime_type: 'image/png' },
      { type: 'text', text: 'Coast road' }
    ]);
  });

  it('validates requests and requires video service configuration', async () => {
    const config = createDefaultCreatorServicesConfig();
    await registerVideoGenerationRoutes(server, createVideoGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: vi.fn() as typeof fetch
    }));

    const invalid = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: { prompt: '', provider: 'unknown', size: 'unknown', duration: 3 }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');

    const invalidReference = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: {
        prompt: 'A real prompt',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImage: { mime: 'image/gif', data: 'R0lGODlh' }
      }
    });
    expect(invalidReference.statusCode).toBe(400);
    expect(invalidReference.json().error.code).toBe('VALIDATION_FAILED');

    const missingConfig = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: { prompt: 'A real prompt', provider: 'seedance', size: '1280x720', duration: 5 }
    });
    expect(missingConfig.statusCode).toBe(409);
    expect(missingConfig.json().error.code).toBe('VIDEO_GENERATION_CONFIG_REQUIRED');
  });
});

function createConfigStore(config: ReturnType<typeof createDefaultCreatorServicesConfig>): CreatorServicesConfigStore {
  return {
    read: vi.fn(async () => config),
    write: vi.fn(async next => next),
    reset: vi.fn(async () => createDefaultCreatorServicesConfig())
  };
}
