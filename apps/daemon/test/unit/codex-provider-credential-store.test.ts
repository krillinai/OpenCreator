import { describe, expect, it, vi } from 'vitest';
import {
  createCodexProviderCredentialStore,
  readCodexProviderApiKey
} from '../../src/codex/provider-credential-store.js';

describe('CodexProviderCredentialStore', () => {
  it('stores the fallback API key without exposing another configuration', async () => {
    let saved: string | undefined;
    const store = createCodexProviderCredentialStore({
      getPassword: vi.fn(async () => saved),
      setPassword: vi.fn(async value => {
        saved = value;
      })
    });

    await expect(store.readApiKey()).resolves.toBeUndefined();
    await store.writeApiKey('sk-codex');
    await expect(store.readApiKey()).resolves.toBe('sk-codex');
  });

  it('migrates a matching legacy text model key', async () => {
    const store = {
      readApiKey: vi.fn(async () => undefined),
      writeApiKey: vi.fn(async () => undefined)
    };

    await expect(readCodexProviderApiKey({
      store,
      provider: {
        baseUrl: 'https://gateway.example.test/v1',
        model: 'gpt-codex'
      },
      readLegacy: async () => ({
        baseUrl: 'https://gateway.example.test/v1',
        apiKey: 'sk-legacy',
        model: 'gpt-codex'
      })
    })).resolves.toBe('sk-legacy');
    expect(store.writeApiKey).toHaveBeenCalledWith('sk-legacy');
  });
});
