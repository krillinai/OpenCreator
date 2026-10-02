import Fastify, { type FastifyInstance } from 'fastify';
import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultCreatorServicesConfig,
  type CreatorTtsProvider,
  type CreatorTtsVoicesResponse
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../src/creator-services/config-store.js';
import { registerCreatorServicesRoutes } from '../../src/api/routes.creator-services.js';
import { createKrillinCreatorServicesCapabilities } from '../../src/creator/krillin/capabilities.js';
import type { KrillinTtsService } from '../../src/creator/krillin/tts-service.js';

describe('creator services API', () => {
  let server: FastifyInstance;
  let store: CreatorServicesConfigStore;
  let ttsService: Pick<KrillinTtsService, 'listVoices' | 'preview'>;

  beforeEach(async () => {
    const initial = createDefaultCreatorServicesConfig();
    initial.llm.apiKey = 'initial-secret';
    initial.llm.source = 'custom';
    store = {
      read: vi.fn(async () => initial),
      write: vi.fn(async config => config),
      reset: vi.fn(async () => createDefaultCreatorServicesConfig())
    };
    ttsService = {
      listVoices: vi.fn(async (
        provider: CreatorTtsProvider
      ): Promise<CreatorTtsVoicesResponse> => ({
        provider,
        model: provider === 'aliyun' ? 'qwen3-tts-flash' : '',
        voices: provider === 'aliyun'
          ? [{ id: 'Cherry', name: '芊悦', provider: 'aliyun', kind: 'builtin' as const }]
          : []
      })),
      preview: vi.fn(async request => ({
        content: Buffer.from(`preview:${request.voiceId}`),
        mime: 'audio/mpeg' as const,
        provider: 'aliyun' as const,
        model: 'qwen3-tts-flash',
        voiceId: request.voiceId,
        format: 'mp3' as const
      }))
    };
    server = Fastify({ logger: false });
    await registerCreatorServicesRoutes(
      server,
      store,
      () => createKrillinCreatorServicesCapabilities('darwin', 'arm64'),
      ttsService
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it('tests a self-hosted model without persisting credentials', async () => {
    const endpoint = createServer((request, response) => {
      expect(request.url).toBe('/v1/models');
      expect(request.headers.authorization).toBeUndefined();
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'tencent/Hy-MT2-1.8B' }] }));
    });
    await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
    try {
      const address = endpoint.address();
      if (address === null || typeof address === 'string') throw new Error('Missing endpoint address');
      const result = await server.inject({
        method: 'POST', url: '/creator-services/llm/test',
        payload: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'tencent/Hy-MT2-1.8B', apiKey: '', timeoutSeconds: 2 }
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ connected: true, model: 'tencent/Hy-MT2-1.8B' });
      expect(store.write).not.toHaveBeenCalled();
    } finally {
      endpoint.close();
    }
  });

  it('accepts a Hy-MT2 configuration with no API key and retains provider identity', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.llm = { ...config.llm, source: 'custom', providerId: 'hy-mt2',
      baseUrl: 'http://127.0.0.1:8000/v1', model: 'local-translation-model', apiKey: '', timeoutSeconds: 30 };
    const result = await server.inject({ method: 'PATCH', url: '/creator-services/config', payload: config });
    expect(result.statusCode).toBe(200);
    expect(result.json().config.llm).toMatchObject({ providerId: 'hy-mt2', model: 'local-translation-model', timeoutSeconds: 30 });
    expect(result.json().configuredCredentials).not.toContain('llm.apiKey');
  });

  it('reports an unavailable model from a self-hosted endpoint', async () => {
    const endpoint = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'other-model' }] }));
    });
    await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
    try {
      const address = endpoint.address();
      if (address === null || typeof address === 'string') throw new Error('Missing endpoint address');
      const result = await server.inject({ method: 'POST', url: '/creator-services/llm/test',
        payload: { baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'tencent/Hy-MT2-1.8B', apiKey: '', timeoutSeconds: 2 } });
      expect(result.statusCode).toBe(502);
      expect(result.body).toContain('Model tencent/Hy-MT2-1.8B is not served');
    } finally { endpoint.close(); }
  });

  it('supports legacy independent text-model fields during migration', async () => {
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

  it('does not return the FunASR API key from settings reads or saves', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.funasr.apiKey = 'funasr-secret';
    vi.mocked(store.read).mockResolvedValue(config);

    const read = await server.inject({ method: 'GET', url: '/creator-services/config' });
    expect(read.statusCode).toBe(200);
    expect(read.body).not.toContain('funasr-secret');
    expect(read.json().configuredCredentials).toContain('transcription.funasr.apiKey');

    const saved = await server.inject({
      method: 'PATCH', url: '/creator-services/config', payload: read.json().config
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain('funasr-secret');
    expect(store.write).toHaveBeenCalledWith(expect.objectContaining({
      transcription: expect.objectContaining({
        funasr: expect.objectContaining({ apiKey: 'funasr-secret' })
      })
    }));
  });

  it('tests the configured FunASR model with the retained credential', async () => {
    let authorization: string | undefined;
    const endpoint = createServer((request, response) => {
      authorization = request.headers.authorization;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'sensevoice' }] }));
    });
    await new Promise<void>(resolve => endpoint.listen(0, '127.0.0.1', resolve));
    try {
      const address = endpoint.address();
      if (address === null || typeof address === 'string') throw new Error('Missing endpoint address');
      const baseUrl = `http://127.0.0.1:${address.port}/v1`;
      const config = createDefaultCreatorServicesConfig();
      config.transcription.funasr.baseUrl = baseUrl;
      config.transcription.funasr.apiKey = 'funasr-secret';
      vi.mocked(store.read).mockResolvedValue(config);

      const payload = { baseUrl, model: 'sensevoice', apiKey: '', timeoutMs: 1000 };
      const connected = await server.inject({ method: 'POST', url: '/creator-services/transcription/test', payload });
      expect(connected.statusCode).toBe(200);
      expect(connected.json().connected).toBe(true);
      expect(authorization).toBe('Bearer funasr-secret');

      const missing = await server.inject({ method: 'POST', url: '/creator-services/transcription/test',
        payload: { ...payload, model: 'unknown-model' } });
      expect(missing.statusCode).toBe(502);
      expect(missing.json().error.message).toContain('unknown-model');

      authorization = undefined;
      const otherEndpoint = await server.inject({ method: 'POST', url: '/creator-services/transcription/test',
        payload: { ...payload, baseUrl: `${baseUrl}/other` } });
      expect(otherEndpoint.statusCode).toBe(200);
      expect(authorization).toBeUndefined();
    } finally {
      endpoint.close();
    }
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
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.stringContaining('transcription.provider'),
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ field: 'transcription.provider' })
          ])
        }
      }
    });
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

  it('lists provider voices and streams a voice preview', async () => {
    const voices = await server.inject({
      method: 'GET',
      url: '/creator-services/tts/voices?provider=aliyun&model=qwen3-tts-flash'
    });

    expect(voices.statusCode).toBe(200);
    expect(voices.json()).toMatchObject({
      provider: 'aliyun',
      voices: [{ id: 'Cherry', name: '芊悦' }]
    });
    expect(ttsService.listVoices).toHaveBeenCalledWith('aliyun', 'qwen3-tts-flash');

    const preview = await server.inject({
      method: 'POST',
      url: '/creator-services/tts/preview',
      payload: {
        provider: 'aliyun',
        model: 'qwen3-tts-flash',
        voiceId: 'Cherry',
        text: '试听文本'
      }
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('audio/mpeg');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.rawPayload.toString()).toBe('preview:Cherry');
    expect(ttsService.preview).toHaveBeenCalledWith({
      provider: 'aliyun',
      model: 'qwen3-tts-flash',
      voiceId: 'Cherry',
      text: '试听文本'
    });
  });
});
