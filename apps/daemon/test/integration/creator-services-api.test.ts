import Fastify, { type FastifyInstance } from 'fastify';
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
