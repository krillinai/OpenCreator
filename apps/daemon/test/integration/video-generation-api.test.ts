import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
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
      payload: { prompt: 'A cinematic city reveal', provider: 'seedance', size: '1280x720', duration: 5 }
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().result).toMatchObject({
      id: 'video_result_1234',
      provider: 'seedance',
      status: 'queued',
      videoSize: '1280x720',
      duration: 5
    });
    const createRequest = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(createRequest?.body))).toMatchObject({
      model: 'doubao-seedance-1-0-pro-250528',
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

  it('creates and refreshes a Veo long-running generation operation', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.video.veo.apiKey = 'google-test';
    config.video.veo.baseUrl = 'https://gemini.example.test/v1beta';
    const video = Buffer.from('veo-video');
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith('/models/veo-3.1-generate-preview:predictLongRunning') && init?.method === 'POST') {
        return new Response(JSON.stringify({ name: 'operations/veo-task', done: false }), { status: 200 });
      }
      if (value === 'https://gemini.example.test/v1beta/operations/veo-task') {
        return new Response(JSON.stringify({
          name: 'operations/veo-task',
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { uri: 'https://gemini.example.test/v1beta/files/video:download' } }]
            }
          }
        }), { status: 200 });
      }
      if (value === 'https://gemini.example.test/v1beta/files/video:download') return new Response(video, { status: 200 });
      return new Response('not found', { status: 404 });
    });
    await registerVideoGenerationRoutes(server, createVideoGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'veo_video_result_1'
    }));

    const created = await server.inject({
      method: 'POST',
      url: '/video-generation/results',
      payload: { prompt: 'Clouds moving over mountains', provider: 'veo', size: '1280x720', duration: 8 }
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().result).toMatchObject({ provider: 'veo', status: 'in_progress', duration: 8 });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      parameters: { aspectRatio: '16:9', durationSeconds: 8, sampleCount: 1 }
    });

    const refreshed = await server.inject({ method: 'GET', url: '/video-generation/results/veo_video_result_1' });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().result).toMatchObject({ status: 'completed', size: video.length });
    expect((fetchImpl.mock.calls[2]?.[1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('google-test');
  });

  it('maps an optional reference image to Seedance, Kling, and Veo image-to-video requests', async () => {
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
      return new Response(JSON.stringify({ name: 'operations/veo-image-job', done: false }));
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
    expect(seedanceBody.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${referenceImage.data}` }
    });
    const klingBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(klingBody.image).toBe(referenceImage.data);
    const veoBody = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body));
    expect(veoBody.instances[0].image).toEqual({
      bytesBase64Encoded: referenceImage.data,
      mimeType: 'image/png'
    });
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
