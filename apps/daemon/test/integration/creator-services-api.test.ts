import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { registerCreatorServicesRoutes } from '../../src/api/routes.creator-services.js';

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
    await registerCreatorServicesRoutes(server, store);
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
    config.transcription.provider = 'faster-whisper';

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
});
