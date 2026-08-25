import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCodexRoutes } from '../../src/api/routes.codex.js';
import { createUnknownCapabilityMatrix } from '../../src/codex/capabilities.js';
import type { CodexModelCatalog } from '../../src/codex/model-catalog-2026-08-05.js';
import type { CodexRuntimeReadinessService } from '../../src/codex/runtime-readiness.js';
import type { CodexProviderConfigService } from '../../src/codex/provider-config.js';

const servers: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe('Codex Runtime routes', () => {
  it('exposes structured readiness and account state', async () => {
    const readiness = createReadinessFixture();
    const server = await createServer(readiness);

    const runtime = await server.inject({ method: 'GET', url: '/codex/readiness' });
    const account = await server.inject({ method: 'GET', url: '/codex/account' });

    expect(runtime.statusCode).toBe(200);
    expect(runtime.json()).toMatchObject({
      state: 'degraded',
      account: { accountStatus: 'signed_out' }
    });
    expect(account.statusCode).toBe(200);
    expect(account.json()).toMatchObject({ account: { accountStatus: 'signed_out' } });
  });

  it('forwards login, cancel and logout without exposing app-server DTOs', async () => {
    const readiness = createReadinessFixture();
    const server = await createServer(readiness);

    const login = await server.inject({
      method: 'POST',
      url: '/codex/account/login/start',
      payload: { loginType: 'chatgpt' }
    });
    const cancel = await server.inject({
      method: 'POST',
      url: '/codex/account/login/cancel',
      payload: { loginId: 'login-1' }
    });
    const logout = await server.inject({ method: 'POST', url: '/codex/account/logout' });

    expect(login.json()).toEqual({
      loginId: 'login-1',
      status: 'pending',
      authUrl: 'https://auth.example.test'
    });
    expect(cancel.json()).toEqual({ loginId: 'login-1', canceled: true });
    expect(logout.json()).toEqual({ signedOut: true });
  });

  it('reads and updates the Codex provider without returning the API key', async () => {
    const readiness = createReadinessFixture();
    const providerConfig = createProviderConfigFixture();
    const server = await createServer(readiness, providerConfig);

    const read = await server.inject({ method: 'GET', url: '/codex/provider' });
    const update = await server.inject({
      method: 'PATCH',
      url: '/codex/provider',
      payload: {
        baseUrl: 'https://gateway.example.test/v1',
        apiKey: 'sk-secret',
        model: 'gpt-custom'
      }
    });

    expect(read.json()).toEqual({
      baseUrl: '',
      model: 'gpt-default',
      apiKeyConfigured: false,
      authentication: 'none'
    });
    expect(providerConfig.update).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'sk-secret',
      model: 'gpt-custom'
    });
    expect(update.json()).toEqual({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-custom',
      apiKeyConfigured: true,
      authentication: 'api_key'
    });
    expect(JSON.stringify(update.json())).not.toContain('sk-secret');
  });
});

async function createServer(
  readiness: CodexRuntimeReadinessService,
  providerConfig = createProviderConfigFixture()
) {
  const server = Fastify();
  servers.push(server);
  await registerCodexRoutes(server, {
    codexBin: 'codex',
    codexHome: {
      path: 'D:/codex-home',
      mode: 'isolated',
      source: 'isolated',
      writable: true
    },
    capabilities: createUnknownCapabilityMatrix('2026-08-21T00:00:00.000Z'),
    modelCatalog: {
      listModels: async () => ({ models: [] }),
      close: async () => undefined
    } as CodexModelCatalog,
    readiness,
    providerConfig
  });
  return server;
}

function createProviderConfigFixture(): CodexProviderConfigService {
  return {
    read: vi.fn(async () => ({
      baseUrl: '',
      model: 'gpt-default',
      apiKeyConfigured: false,
      authentication: 'none' as const
    })),
    update: vi.fn(async request => ({
      baseUrl: request.baseUrl,
      model: request.model,
      apiKeyConfigured: request.apiKey !== undefined,
      authentication: request.apiKey === undefined ? 'chatgpt' as const : 'api_key' as const
    }))
  };
}

function createReadinessFixture(): CodexRuntimeReadinessService {
  const snapshot = {
    state: 'degraded' as const,
    mode: 'bundled' as const,
    version: '0.149.0',
    commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
    binaryPath: 'D:/codex.exe',
    codexHome: 'D:/codex-home',
    checkedAt: '2026-08-21T00:00:00.000Z',
    binary: { status: 'ready' as const },
    protocol: { status: 'ready' as const },
    account: { status: 'not_authenticated' as const, accountStatus: 'signed_out' as const },
    models: { status: 'ready' as const },
    skills: { status: 'ready' as const },
    toolServer: { status: 'ready' as const },
    diagnostics: []
  };
  return {
    refresh: vi.fn(async () => snapshot),
    readAccount: vi.fn(async () => ({ account: snapshot.account })),
    startLogin: vi.fn(async () => ({
      loginId: 'login-1',
      status: 'pending' as const,
      authUrl: 'https://auth.example.test'
    })),
    cancelLogin: vi.fn(async request => ({ loginId: request.loginId, canceled: true })),
    logout: vi.fn(async () => ({ signedOut: true })),
    getSnapshot: vi.fn(() => snapshot)
  };
}
