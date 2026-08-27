import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerImageGenerationRoutes } from '../../src/api/routes.image-generation.js';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { createImageGenerationService } from '../../src/image-generation/service.js';

describe('image generation API', () => {
  let server: FastifyInstance;
  let dataDir: string;

  beforeEach(async () => {
    server = Fastify({ logger: false });
    dataDir = await mkdtemp(join(tmpdir(), 'opencreator-image-generation-'));
  });

  afterEach(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('generates, stores, and serves OpenAI-compatible images', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.image.openai.apiKey = 'sk-image-test';
    config.image.openai.baseUrl = 'https://images.example.test/v1';
    const image = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('test-image')
    ]);
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ b64_json: image.toString('base64') }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await registerImageGenerationRoutes(server, createImageGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'image_result_1234',
      now: () => new Date('2026-08-20T00:00:00.000Z')
    }));

    const generated = await server.inject({
      method: 'POST',
      url: '/image-generation/results',
      payload: { prompt: 'A quiet studio portrait', provider: 'openai', size: '1024x1024', quality: 'high', count: 1 }
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().result).toMatchObject({
      id: 'image_result_1234',
      model: 'gpt-image-1',
      imageSize: '1024x1024',
      quality: 'high',
      count: 1,
      images: [{ index: 0, mime: 'image/png', size: image.length }]
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://images.example.test/v1/images/generations');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'gpt-image-1',
      prompt: 'A quiet studio portrait',
      size: '1024x1024',
      quality: 'high',
      n: 1
    });

    const content = await server.inject({
      method: 'GET',
      url: '/image-generation/results/image_result_1234/content/0'
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('image/png');
    expect(content.rawPayload).toEqual(image);
    expect(await readdir(join(dataDir, 'image-generation', 'image_result_1234')))
      .toEqual(['0.png', 'result.json']);
  });

  it('uses the configured Jimeng Ark image model', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.image.jimeng.apiKey = 'ark-test';
    config.image.jimeng.baseUrl = 'https://ark.example.test/api/v3';
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('jimeng')]);
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }), { status: 200 }));
    await registerImageGenerationRoutes(server, createImageGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'jimeng_result_1234'
    }));

    const generated = await server.inject({
      method: 'POST',
      url: '/image-generation/results',
      payload: { prompt: 'Chinese editorial illustration', provider: 'jimeng', size: '1536x1024', quality: 'medium', count: 1 }
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().result).toMatchObject({ provider: 'jimeng', model: 'doubao-seedream-4-0-250828' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://ark.example.test/api/v3/images/generations');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).not.toHaveProperty('quality');
  });

  it('extracts inline image data from Gemini', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.image.gemini.apiKey = 'gemini-test';
    config.image.gemini.baseUrl = 'https://gemini.example.test/v1beta';
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('gemini')]);
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }] } }]
    }), { status: 200 }));
    await registerImageGenerationRoutes(server, createImageGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'gemini_result_1234'
    }));

    const generated = await server.inject({
      method: 'POST',
      url: '/image-generation/results',
      payload: { prompt: 'A clean product image', provider: 'gemini', size: '1024x1536', quality: 'high', count: 1 }
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().result).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash-image' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://gemini.example.test/v1beta/models/gemini-2.5-flash-image:generateContent');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '2:3' } }
    });
  });

  it('authenticates and downloads a completed Kling image task', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.image.kling.accessKey = 'kling-access';
    config.image.kling.secretKey = 'kling-secret';
    config.image.kling.baseUrl = 'https://kling.example.test';
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('kling')]);
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => String(url) === 'https://cdn.example.test/kling.png'
      ? new Response(image, { status: 200, headers: { 'Content-Type': 'image/png' } })
      : new Response(JSON.stringify({
        data: {
          task_id: 'kling_image_task',
          task_status: 'succeed',
          task_result: { images: [{ url: 'https://cdn.example.test/kling.png' }] }
        }
      }), { status: 200 }));
    await registerImageGenerationRoutes(server, createImageGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'kling_result_1234'
    }));

    const generated = await server.inject({
      method: 'POST',
      url: '/image-generation/results',
      payload: { prompt: 'A cinematic character', provider: 'kling', size: '1024x1024', quality: 'medium', count: 1 }
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().result).toMatchObject({ provider: 'kling', model: 'kling-v2-1' });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://kling.example.test/v1/images/generations');
    expect((fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('validates requests and requires image service configuration', async () => {
    const config = createDefaultCreatorServicesConfig();
    await registerImageGenerationRoutes(server, createImageGenerationService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: vi.fn() as typeof fetch
    }));

    const invalid = await server.inject({
      method: 'POST',
      url: '/image-generation/results',
      payload: { prompt: '', provider: 'unknown', size: 'tiny', quality: 'high', count: 0 }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');

    const missingConfig = await server.inject({
      method: 'POST',
      url: '/image-generation/results',
      payload: { prompt: 'A real prompt', provider: 'openai', size: '1024x1024', quality: 'medium', count: 1 }
    });
    expect(missingConfig.statusCode).toBe(409);
    expect(missingConfig.json().error.code).toBe('IMAGE_GENERATION_CONFIG_REQUIRED');
  });
});

function createConfigStore(config: ReturnType<typeof createDefaultCreatorServicesConfig>): CreatorServicesConfigStore {
  return {
    read: vi.fn(async () => config),
    write: vi.fn(async next => next),
    reset: vi.fn(async () => createDefaultCreatorServicesConfig())
  };
}
