import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { registerCreatorServicesRoutes } from '../../src/api/routes.creator-services.js';
import { createKrillinCreatorServicesCapabilities } from '../../src/creator/krillin/capabilities.js';

describe('creator services API', () => {
  let server: FastifyInstance;
  let store: CreatorServicesConfigStore;

  beforeEach(async () => {
    const initial = createDefaultCreatorServicesConfig();
    initial.llm.apiKey = 'initial-secret';
    initial.llm.source = 'custom';
    store = {
      read: vi.fn(async () => initial),
      write: vi.fn(async config => config),
      reset: vi.fn(async () => createDefaultCreatorServicesConfig())
    };
    server = Fastify({ logger: false });
    await registerCreatorServicesRoutes(
      server,
      store,
      () => createKrillinCreatorServicesCapabilities('darwin', 'arm64')
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it('reads, validates, saves, and resets the independent text model', async () => {
    const read = await server.inject({ method: 'GET', url: '/creator-services/config' });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain('initial-secret');
    const config = read.json().config;
    expect(config.llm.apiKey).toBe('');
    expect(read.json().configuredCredentials).toContain('llm.apiKey');
    config.llm.apiKey = 'sk-local';

    const saved = await server.inject({
      method: 'PATCH',
      url: '/creator-services/config',
      payload: config
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('sk-local');
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({
        apiKey: 'sk-local',
        source: 'custom'
      })
    }));

    const reset = await server.inject({ method: 'DELETE', url: '/creator-services/config' });
    expect(reset.statusCode).toBe(200);
    expect(store.reset).toHaveBeenCalledTimes(1);
    expect(reset.json().config.llm.source).toBe('codex');
  });

  it('retains configured credentials when a settings form submits blank secret fields', async () => {
    const read = await server.inject({ method: 'GET', url: '/creator-services/config' });
    const config = read.json().config;
    config.proxy = 'http://127.0.0.1:7897';

    const saved = await server.inject({
      method: 'PATCH',
      url: '/creator-services/config',
      payload: config
    });

    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('initial-secret');
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({
      proxy: 'http://127.0.0.1:7897',
      llm: expect.objectContaining({ apiKey: 'initial-secret' })
    }));
  });

  it('accepts the default OpenAI provider with an empty API key', async () => {
    vi.mocked(store.read).mockResolvedValue(createDefaultCreatorServicesConfig());
    const config = createDefaultCreatorServicesConfig();

    const response = await server.inject({
      method: 'PATCH',
      url: '/creator-services/config',
      payload: config
    });

    expect(response.statusCode).toBe(200);
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({
      transcription: expect.objectContaining({
        provider: 'openai',
        openai: expect.objectContaining({ apiKey: '' })
      })
    }));
  });

  it('rejects unsupported providers without persisting the request', async () => {
    const config = createDefaultCreatorServicesConfig() as unknown as Record<string, any>;
    config.transcription.provider = 'unknown';

    const response = await server.inject({
      method: 'PATCH',
      url: '/creator-services/config',
      payload: config
    });

    expect(response.statusCode).toBe(400);
    expect(store.write).not.toHaveBeenCalled();
  });

  it('reports Runtime transcription capabilities', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/creator-services/capabilities'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      platform: 'darwin',
      arch: 'arm64',
      transcription: {
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'openai', available: true }),
          expect.objectContaining({ provider: 'whisperkit', available: true }),
          expect.objectContaining({ provider: 'faster-whisper', available: false }),
          expect.objectContaining({ provider: 'whisper.cpp', available: false })
        ])
      }
    });
  });

  it('rejects a local provider without a controlled Runtime installer', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'faster-whisper';

    const response = await server.inject({
      method: 'PATCH',
      url: '/creator-services/config',
      payload: config
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'unsupported_capability' }
    });
    expect(store.write).not.toHaveBeenCalled();
  });
});
