import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSmartDubbingRoutes } from '../../src/api/routes.smart-dubbing.js';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { createSmartDubbingService } from '../../src/smart-dubbing/service.js';

describe('smart dubbing API', () => {
  let server: FastifyInstance;
  let dataDir: string;

  beforeEach(async () => {
    server = Fastify({ logger: false });
    dataDir = await mkdtemp(join(tmpdir(), 'opencreator-smart-dubbing-'));
  });

  afterEach(async () => {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('generates, stores, and serves OpenAI-compatible speech audio', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.tts.openai.apiKey = 'sk-test';
    config.tts.openai.baseUrl = 'https://speech.example.test/v1';
    const configStore = createConfigStore(config);
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(
      Buffer.from('test-audio'),
      { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }
    ));
    const service = createSmartDubbingService({
      dataDir,
      configStore,
      fetchImpl: fetchImpl as typeof fetch,
      createId: () => 'result_test_1234',
      now: () => new Date('2026-08-20T00:00:00.000Z')
    });
    await registerSmartDubbingRoutes(server, service);

    const generated = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: {
        text: 'A short script for dubbing.',
        voice: 'nova',
        style: 'warm',
        speed: 1.05,
        format: 'mp3'
      }
    });

    expect(generated.statusCode).toBe(201);
    expect(generated.json().result).toMatchObject({
      id: 'result_test_1234',
      mime: 'audio/mpeg',
      provider: 'openai',
      voice: 'nova',
      style: 'warm',
      speed: 1.05,
      format: 'mp3'
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://speech.example.test/v1/audio/speech');
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: 'gpt-4o-mini-tts',
      input: 'A short script for dubbing.',
      voice: 'nova',
      instructions: expect.stringContaining('warm'),
      response_format: 'mp3',
      speed: 1.05
    });
    await expect(readFile(join(dataDir, 'smart-dubbing', 'result_test_1234.mp3'), 'utf8'))
      .resolves.toBe('test-audio');

    const content = await server.inject({
      method: 'GET',
      url: '/smart-dubbing/results/result_test_1234/content'
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toContain('audio/mpeg');
    expect(content.rawPayload.toString()).toBe('test-audio');
  });

  it('previews speech audio without storing a result', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.tts.openai.apiKey = 'sk-test';
    config.tts.openai.baseUrl = 'https://speech.example.test/v1';
    const fetchImpl = vi.fn(async () => new Response(
      Buffer.from('preview-audio'),
      { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }
    ));
    await registerSmartDubbingRoutes(server, createSmartDubbingService({
      dataDir,
      configStore: createConfigStore(config),
      fetchImpl: fetchImpl as typeof fetch
    }));

    const preview = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/preview',
      payload: {
        text: 'Preview this voice.',
        voice: 'echo',
        style: 'professional',
        speed: 1,
        format: 'mp3'
      }
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('audio/mpeg');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.rawPayload.toString()).toBe('preview-audio');
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('requires a configured supported provider and validates requests', async () => {
    const config = createDefaultCreatorServicesConfig();
    const configStore = createConfigStore(config);
    await registerSmartDubbingRoutes(server, createSmartDubbingService({
      dataDir,
      configStore,
      fetchImpl: vi.fn() as typeof fetch
    }));

    const invalid = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: { text: '', voice: 'unknown', style: 'natural', speed: 1, format: 'mp3' }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_FAILED');

    const missingConfig = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: { text: 'Ready to speak', voice: 'nova', style: 'natural', speed: 1, format: 'mp3' }
    });
    expect(missingConfig.statusCode).toBe(409);
    expect(missingConfig.json().error.code).toBe('SMART_DUBBING_CONFIG_REQUIRED');

    config.tts.provider = 'edge-tts';
    const unsupported = await server.inject({
      method: 'POST',
      url: '/smart-dubbing/results',
      payload: { text: 'Ready to speak', voice: 'nova', style: 'natural', speed: 1, format: 'mp3' }
    });
    expect(unsupported.statusCode).toBe(409);
    expect(unsupported.json().error.code).toBe('SMART_DUBBING_PROVIDER_UNSUPPORTED');
  });
});

function createConfigStore(config: ReturnType<typeof createDefaultCreatorServicesConfig>): CreatorServicesConfigStore {
  return {
    read: vi.fn(async () => config),
    write: vi.fn(async next => next),
    reset: vi.fn(async () => createDefaultCreatorServicesConfig())
  };
}
