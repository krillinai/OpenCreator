import { describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import {
  createCreatorServicesConfigStore,
  CreatorServicesConfigStoreError,
  presentCreatorServicesConfig,
  retainCreatorServicesCredentials
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
