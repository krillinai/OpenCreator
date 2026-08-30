import { describe, expect, it, vi } from 'vitest';
import type { RestartableCodexAppServerRequestClient } from '../../src/codex/app-server-client.js';
import {
  CodexProviderConfigValidationError,
  createCodexProviderConfigService
} from '../../src/codex/provider-config.js';

describe('Codex provider configuration', () => {
  it('writes provider settings, stores the API key through account login and restarts consumers', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    let config = { model: 'gpt-old', openai_base_url: '' };
    let version = 'v1';
    let account: null | { type: 'apiKey' } = null;
    const restart = vi.fn(async () => undefined);
    const client: RestartableCodexAppServerRequestClient = {
      async request<Result>(method: string, params: unknown): Promise<Result> {
        calls.push({ method, params });
        if (method === 'config/read') {
          return {
            config,
            layers: [{
              name: { type: 'user', file: 'D:/codex/config.toml', profile: null },
              version,
              config,
              disabledReason: null
            }]
          } as Result;
        }
        if (method === 'account/read') {
          return { account, requiresOpenaiAuth: true } as Result;
        }
        if (method === 'config/batchWrite') {
          const body = params as { edits: Array<{ keyPath: string; value: unknown }> };
          config = {
            model: String(body.edits.find(edit => edit.keyPath === 'model')?.value),
            openai_base_url: String(
              body.edits.find(edit => edit.keyPath === 'openai_base_url')?.value ?? ''
            )
          };
          version = 'v2';
          return { status: 'ok', version, filePath: 'D:/codex/config.toml' } as Result;
        }
        if (method === 'account/login/start') {
          account = { type: 'apiKey' };
          return { type: 'apiKey' } as Result;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
      restart,
      close: async () => undefined
    };
    const refresh = vi.fn(async () => ({ state: 'ready' }));
    const onConfigurationChanged = vi.fn(async () => undefined);
    const onProviderUpdated = vi.fn(async () => undefined);
    const service = createCodexProviderConfigService({
      client,
      readiness: { refresh } as never,
      onConfigurationChanged,
      onProviderUpdated
    });

    const result = await service.update({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'sk-secret',
      model: 'gpt-custom'
    });

    expect(result).toEqual({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-custom',
      apiKeyConfigured: true,
      authentication: 'api_key',
      configVersion: 'v2'
    });
    expect(restart).toHaveBeenCalledTimes(1);
    expect(onProviderUpdated).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'sk-secret',
      model: 'gpt-custom'
    });
    expect(onConfigurationChanged).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls.find(call => call.method === 'config/batchWrite')?.params).toEqual({
      edits: [
        { keyPath: 'model', value: 'gpt-custom', mergeStrategy: 'replace' },
        {
          keyPath: 'openai_base_url',
          value: 'https://gateway.example.test/v1',
          mergeStrategy: 'replace'
        },
        {
          keyPath: 'cli_auth_credentials_store',
          value: 'file',
          mergeStrategy: 'replace'
        }
      ],
      filePath: null,
      expectedVersion: 'v1',
      reloadUserConfig: true
    });
    expect(calls.find(call => call.method === 'account/login/start')?.params).toEqual({
      type: 'apiKey',
      apiKey: 'sk-secret'
    });
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });

  it('rejects an unauthenticated configuration without an API key', async () => {
    const client: RestartableCodexAppServerRequestClient = {
      async request<Result>(method: string): Promise<Result> {
        if (method === 'config/read') {
          return {
            config: { model: 'gpt-old' },
            layers: [{ name: { type: 'user', profile: null }, version: 'v1' }]
          } as Result;
        }
        if (method === 'account/read') {
          return { account: null, requiresOpenaiAuth: true } as Result;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
      restart: async () => undefined,
      close: async () => undefined
    };
    const service = createCodexProviderConfigService({
      client,
      readiness: { refresh: vi.fn() } as never
    });

    await expect(service.update({ baseUrl: '', model: 'gpt-custom' }))
      .rejects.toBeInstanceOf(CodexProviderConfigValidationError);
  });

  it('reports and reuses the stored Codex API key', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const onProviderUpdated = vi.fn(async () => undefined);
    let account: null | { type: 'apiKey' } = null;
    const client: RestartableCodexAppServerRequestClient = {
      async request<Result>(method: string, params: unknown): Promise<Result> {
        calls.push({ method, params });
        if (method === 'config/read') {
          return {
            config: {
              model: 'gpt-shared',
              openai_base_url: 'https://gateway.example.test/v1'
            },
            layers: [{ name: { type: 'user', profile: null }, version: 'v1' }]
          } as Result;
        }
        if (method === 'account/read') {
          return { account, requiresOpenaiAuth: true } as Result;
        }
        if (method === 'config/batchWrite') {
          return { status: 'ok', version: 'v2' } as Result;
        }
        if (method === 'account/login/start') {
          account = { type: 'apiKey' };
          return { type: 'apiKey' } as Result;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
      restart: vi.fn(async () => undefined),
      close: async () => undefined
    };
    const service = createCodexProviderConfigService({
      client,
      readiness: { refresh: vi.fn() } as never,
      readStoredApiKey: async () => 'sk-shared',
      onProviderUpdated
    });

    expect(await service.read()).toMatchObject({
      apiKeyConfigured: true,
      authentication: 'none'
    });

    const result = await service.update({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-shared'
    });

    expect(result).toMatchObject({
      apiKeyConfigured: true,
      authentication: 'api_key'
    });
    expect(calls.find(call => call.method === 'account/login/start')?.params).toEqual({
      type: 'apiKey',
      apiKey: 'sk-shared'
    });
    expect(onProviderUpdated).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'sk-shared',
      model: 'gpt-shared'
    });
  });

  it('migrates a legacy key that matches the provider being selected', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    let config = { model: 'gpt-current', openai_base_url: '' };
    let account: null | { type: 'apiKey' } = null;
    const client: RestartableCodexAppServerRequestClient = {
      async request<Result>(method: string, params: unknown): Promise<Result> {
        calls.push({ method, params });
        if (method === 'config/read') {
          return {
            config,
            layers: [{ name: { type: 'user', profile: null }, version: 'v1' }]
          } as Result;
        }
        if (method === 'account/read') {
          return { account, requiresOpenaiAuth: true } as Result;
        }
        if (method === 'config/batchWrite') {
          const body = params as { edits: Array<{ keyPath: string; value: unknown }> };
          config = {
            model: String(body.edits.find(edit => edit.keyPath === 'model')?.value),
            openai_base_url: String(
              body.edits.find(edit => edit.keyPath === 'openai_base_url')?.value ?? ''
            )
          };
          return { status: 'ok', version: 'v2' } as Result;
        }
        if (method === 'account/login/start') {
          account = { type: 'apiKey' };
          return { type: 'apiKey' } as Result;
        }
        throw new Error(`Unexpected method: ${method}`);
      },
      restart: vi.fn(async () => undefined),
      close: async () => undefined
    };
    const readStoredApiKey = vi.fn(async (provider: { baseUrl: string; model: string }) => (
      provider.baseUrl === 'https://legacy.example.test/v1'
      && provider.model === 'gpt-legacy'
        ? 'sk-legacy'
        : undefined
    ));
    const service = createCodexProviderConfigService({
      client,
      readiness: { refresh: vi.fn() } as never,
      readStoredApiKey
    });

    await service.update({
      baseUrl: 'https://legacy.example.test/v1',
      model: 'gpt-legacy'
    });

    expect(readStoredApiKey).toHaveBeenCalledWith({
      baseUrl: 'https://legacy.example.test/v1',
      model: 'gpt-legacy'
    });
    expect(calls.find(call => call.method === 'account/login/start')?.params).toEqual({
      type: 'apiKey',
      apiKey: 'sk-legacy'
    });
  });
});
