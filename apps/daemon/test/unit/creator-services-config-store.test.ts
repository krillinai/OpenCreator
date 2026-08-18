import { describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@clawee/protocol';
import {
  createCreatorServicesConfigStore,
  CreatorServicesConfigStoreError
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

  it('does not expose malformed secure-storage values', async () => {
    const store = createCreatorServicesConfigStore({
      getPassword: vi.fn(async () => '{"llm":true}'),
      setPassword: vi.fn(async () => undefined),
      deletePassword: vi.fn(async () => undefined)
    });

    await expect(store.read()).rejects.toBeInstanceOf(CreatorServicesConfigStoreError);
  });
});
