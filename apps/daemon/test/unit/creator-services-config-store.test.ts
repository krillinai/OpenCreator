import { describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import {
  createCreatorServicesConfigStoreWithTextModelFallback,
  createCreatorServicesConfigStore,
  CreatorServicesConfigStoreError,
  presentCreatorServicesConfig,
  retainCreatorServicesCredentials,
  type CreatorServicesConfigStore
} from '../../src/creator-services/config-store.js';

describe('CreatorServicesConfigStore', () => {
  it('returns KrillinAI-compatible defaults when no credential is saved', async () => {
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => null),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => undefined)
    });

    await expect(store.read()).resolves.toEqual(createDefaultCreatorServicesConfig());
  });

  it('writes and reads the full configuration through secure storage', async () => {
    let saved: string | null = null;
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => saved),
      setPassword: vi.fn(async value => {
        saved = value;
      }),
      deletePassword: vi.fn(async () => {
        saved = null;
      })
    });
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'sk-private';
    config.tts.provider = 'minimax';

    await expect(store.write(config)).resolves.toEqual(config);
    await expect(store.read()).resolves.toEqual(config);
    expect(saved).toContain('sk-private');
    await expect(store.reset()).resolves.toEqual(createDefaultCreatorServicesConfig());
    expect(saved).toBeNull();
  });

  it('redacts and retains credentials for every image and video provider', () => {
    const current = createDefaultCreatorServicesConfig();
    current.image.openai.apiKey = 'image-openai';
    current.image.jimeng.apiKey = 'image-jimeng';
    current.image.kling.accessKey = 'image-kling-access';
    current.image.kling.secretKey = 'image-kling-secret';
    current.image.gemini.apiKey = 'image-gemini';
    current.video.seedance.apiKey = 'video-seedance';
    current.video.kling.accessKey = 'video-kling-access';
    current.video.kling.secretKey = 'video-kling-secret';
    current.video.veo.apiKey = 'video-veo';

    const presented = presentCreatorServicesConfig(current);
    expect(presented.configuredCredentials).toEqual(expect.arrayContaining([
      'image.openai.apiKey',
      'image.jimeng.apiKey',
      'image.kling.accessKey',
      'image.kling.secretKey',
      'image.gemini.apiKey',
      'video.seedance.apiKey',
      'video.kling.accessKey',
      'video.kling.secretKey',
      'video.veo.apiKey'
    ]));
    expect(presented.config.image.openai.apiKey).toBe('');
    expect(presented.config.image.jimeng.apiKey).toBe('');
    expect(presented.config.image.kling.accessKey).toBe('');
    expect(presented.config.image.kling.secretKey).toBe('');
    expect(presented.config.image.gemini.apiKey).toBe('');
    expect(presented.config.video.seedance.apiKey).toBe('');
    expect(presented.config.video.kling.accessKey).toBe('');
    expect(presented.config.video.kling.secretKey).toBe('');
    expect(presented.config.video.veo.apiKey).toBe('');

    const retained = retainCreatorServicesCredentials(presented.config, current);
    expect(retained.image).toEqual(current.image);
    expect(retained.video).toEqual(current.video);
  });

  it('uses Codex as fallback until a custom text model is configured', async () => {
    let persisted = createDefaultCreatorServicesConfig();
    const rawStore: CreatorServicesConfigStore = {
      read: vi.fn(async () => structuredClone(persisted)),
      write: vi.fn(async config => {
        persisted = structuredClone(config);
        return structuredClone(config);
      }),
      reset: vi.fn(async () => {
        persisted = createDefaultCreatorServicesConfig();
        return structuredClone(persisted);
      })
    };
    const fallback = {
      read: vi.fn(async () => ({
        baseUrl: 'https://codex.example.test/v1',
        apiKey: 'sk-codex',
        model: 'gpt-codex'
      }))
    };
    const store = createCreatorServicesConfigStoreWithTextModelFallback(rawStore, fallback);

    await expect(store.read()).resolves.toMatchObject({
      llm: {
        baseUrl: 'https://codex.example.test/v1',
        apiKey: 'sk-codex',
        model: 'gpt-codex',
        source: 'codex'
      }
    });

    const codexConfig = await store.read();
    codexConfig.proxy = 'http://127.0.0.1:7897';
    await store.write(codexConfig);
    expect(persisted.llm.apiKey).toBe('');
    expect(persisted.llm.source).toBe('codex');

    const custom = await store.read();
    custom.llm = {
      baseUrl: 'https://custom.example.test/v1',
      apiKey: 'sk-custom',
      model: 'gpt-custom',
      jsonMode: true,
      source: 'custom'
    };
    await expect(store.write(custom)).resolves.toMatchObject({
      llm: {
        baseUrl: 'https://custom.example.test/v1',
        apiKey: 'sk-custom',
        model: 'gpt-custom',
        source: 'custom'
      }
    });

    await expect(store.reset()).resolves.toMatchObject({
      llm: {
        baseUrl: 'https://codex.example.test/v1',
        apiKey: 'sk-codex',
        model: 'gpt-codex',
        source: 'codex'
      }
    });
  });

  it('adds video generation defaults when reading an older saved configuration', async () => {
    const legacy = createDefaultCreatorServicesConfig() as Partial<ReturnType<
      typeof createDefaultCreatorServicesConfig
    >>;
    delete legacy.video;
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => JSON.stringify(legacy)),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => undefined)
    });

    await expect(store.read()).resolves.toMatchObject({
      video: createDefaultCreatorServicesConfig().video
    });
  });

  it('preserves older explicitly configured text models as custom', async () => {
    const legacy = createDefaultCreatorServicesConfig() as unknown as {
      llm: Record<string, unknown>;
    };
    delete legacy.llm.source;
    legacy.llm.baseUrl = 'https://legacy.example.test/v1';
    legacy.llm.apiKey = 'sk-legacy';
    legacy.llm.model = 'gpt-legacy';
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => JSON.stringify(legacy)),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => undefined)
    });

    await expect(store.read()).resolves.toMatchObject({
      llm: { source: 'custom' }
    });
  });

  it('migrates the previous single image and video provider settings', async () => {
    const legacy = structuredClone(createDefaultCreatorServicesConfig()) as unknown as Record<string, unknown>;
    legacy.image = {
      provider: 'openai-compatible',
      openai: { baseUrl: 'https://images.example.test/v1', apiKey: 'old-image-key', model: 'gpt-image-1' }
    };
    legacy.video = {
      provider: 'openai-compatible',
      openai: { baseUrl: 'https://video.example.test/v1', apiKey: 'old-video-key', model: 'sora-2' }
    };
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => JSON.stringify(legacy)),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => undefined)
    });

    await expect(store.read()).resolves.toMatchObject({
      image: {
        provider: 'openai',
        openai: { baseUrl: 'https://images.example.test/v1', apiKey: 'old-image-key', model: 'gpt-image-1' }
      },
      video: {
        provider: 'seedance',
        seedance: { apiKey: '', model: 'doubao-seedance-1-0-pro-250528' }
      }
    });
  });

  it('does not expose malformed secure-storage values', async () => {
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => '{"llm":true}'),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => undefined)
    });

    await expect(store.read()).rejects.toBeInstanceOf(CreatorServicesConfigStoreError);
  });
});
