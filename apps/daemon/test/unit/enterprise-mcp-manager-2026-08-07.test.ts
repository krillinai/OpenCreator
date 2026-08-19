import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexMcpServerResponse } from '@opencreator/protocol';
import type { McpManager } from '../../src/codex/mcp/manager.js';
import type { EnterpriseHttpClient } from '../../src/enterprise/http-client-2026-07-30.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';
import {
  createEnterpriseMcpManager,
  ENTERPRISE_MCP_TOKEN_ENV
} from '../../src/enterprise/mcp-manager-2026-08-07.js';
import type {
  EnterpriseMcpPreference,
  EnterpriseMcpPreferenceRepository
} from '../../src/enterprise/mcp-preferences-2026-08-07.js';
import type {
  EnterpriseMcpTokenCredential,
  EnterpriseMcpTokenStore
} from '../../src/enterprise/mcp-token-store-2026-08-07.js';
import type {
  EnterpriseSessionManager
} from '../../src/enterprise/session-manager-2026-07-30.js';

const agentId = 'opencreator_550e8400-e29b-41d4-a716-446655440000';
const endpoint = 'https://enterprise.example/mcp/servers/crm-main';
const nativeName = 'enterprise_crm-main_9f9de575';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('enterprise MCP manager', () => {
  it('derives install and enable state from the Codex native server list', async () => {
    const fixture = createFixture({
      nativeServers: [nativeServer({
        name: 'installed-from-cli',
        enabled: true,
        url: endpoint
      })]
    });

    const response = await fixture.manager.listConnections();

    expect(response).toMatchObject({
      agentId,
      tokenStatus: 'ready',
      upstreams: [{
        upstreamId: 'crm-main',
        installedServerName: 'installed-from-cli',
        installed: true,
        enabled: true
      }]
    });
    expect(JSON.stringify(response)).not.toContain('agent-mcp-secret');
  });

  it('installs an enterprise catalog entry through Codex native MCP config', async () => {
    const fixture = createFixture();

    const response = await fixture.manager.updatePreference('crm-main', {
      installed: true,
      enabled: false
    });

    expect(fixture.mcpManager.addServer).toHaveBeenCalledWith({
      name: expect.stringMatching(/^enterprise_crm-main_[0-9a-f]{8}$/),
      transport: 'http',
      url: endpoint,
      bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV
    });
    expect(fixture.mcpManager.setServerEnabled).toHaveBeenCalledWith(
      expect.stringMatching(/^enterprise_crm-main_[0-9a-f]{8}$/),
      false,
      false
    );
    expect(response.upstreams[0]).toMatchObject({
      installed: true,
      enabled: false
    });
  });

  it('uses the matched native server name for enable and remove operations', async () => {
    const fixture = createFixture({
      nativeServers: [nativeServer({
        name: 'custom-cli-name',
        enabled: false,
        url: endpoint
      })]
    });

    await fixture.manager.updatePreference('crm-main', { enabled: true });
    await fixture.manager.updatePreference('crm-main', { installed: false });

    expect(fixture.mcpManager.setServerEnabled).toHaveBeenCalledWith(
      'custom-cli-name',
      true,
      false
    );
    expect(fixture.mcpManager.removeServer).toHaveBeenCalledWith(
      'custom-cli-name',
      false
    );
  });

  it('injects only the secure token while Codex owns the MCP definitions', async () => {
    const fixture = createFixture({
      nativeServers: [nativeServer({
        name: nativeName,
        enabled: true,
        url: endpoint,
        bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV
      })]
    });
    await fixture.manager.listConnections();

    const injection = await fixture.manager.prepareRuntime({
      runId: 'run_1',
      thread: {} as never,
      createdBy: 'api'
    });

    expect(injection).toMatchObject({
      mcpServers: [],
      env: {
        [ENTERPRISE_MCP_TOKEN_ENV]: 'agent-mcp-secret'
      }
    });
  });

  it('migrates legacy installed preferences once into Codex native config', async () => {
    const fixture = createFixture({
      legacyPreference: {
        enterpriseOrigin: 'https://enterprise.example',
        agentId,
        upstreamId: 'crm-main',
        installed: true,
        enabled: false,
        updatedAt: '2026-08-07T00:00:00Z'
      }
    });

    const first = await fixture.manager.listConnections();
    const second = await fixture.manager.listConnections();

    expect(fixture.mcpManager.addServer).toHaveBeenCalledTimes(1);
    expect(fixture.mcpManager.addServer).toHaveBeenCalledWith({
      name: expect.stringMatching(/^enterprise_crm-main_[0-9a-f]{8}$/),
      transport: 'http',
      url: endpoint,
      bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV,
      confirmWriteToCodexHome: true
    });
    expect(fixture.mcpManager.setServerEnabled).toHaveBeenCalledWith(
      expect.stringMatching(/^enterprise_crm-main_[0-9a-f]{8}$/),
      false,
      true
    );
    expect(fixture.legacyPreferences.delete).toHaveBeenCalledTimes(1);
    expect(first.upstreams[0]).toMatchObject({
      installed: true,
      enabled: false
    });
    expect(second.upstreams[0]).toMatchObject({
      installed: true,
      enabled: false
    });
  });

  it('does not migrate or install when the Codex native list is unavailable', async () => {
    const fixture = createFixture({
      listDiagnostics: ['codex mcp list failed'],
      legacyPreference: {
        enterpriseOrigin: 'https://enterprise.example',
        agentId,
        upstreamId: 'crm-main',
        installed: true,
        enabled: false,
        updatedAt: '2026-08-07T00:00:00Z'
      }
    });

    await expect(fixture.manager.listConnections()).rejects.toMatchObject({
      code: 'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE',
      statusCode: 503
    });
    expect(fixture.mcpManager.addServer).not.toHaveBeenCalled();
    expect(fixture.legacyPreferences.delete).not.toHaveBeenCalled();
  });

  it('does not fetch or inject a token when no enabled native server needs it', async () => {
    const fixture = createFixture();

    await expect(fixture.manager.prepareRuntime({
      runId: 'run_1',
      thread: {} as never,
      createdBy: 'api'
    })).resolves.toBeUndefined();
    expect(fixture.revealAgentMcpToken).not.toHaveBeenCalled();
  });

  it('reports a missing MCP token without using the enterprise session token', async () => {
    const fixture = createFixture({
      revealAgentMcpToken: vi.fn(async () => {
        throw new EnterpriseHttpError(
          'ENTERPRISE_MCP_TOKEN_NOT_FOUND',
          'response',
          404,
          'not_found'
        );
      })
    });

    await expect(fixture.manager.listConnections()).resolves.toMatchObject({
      tokenStatus: 'missing'
    });
    expect(fixture.readStoredToken()).toBeUndefined();
  });

  it('invalidates the runtime when the secure token fingerprint changes', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();
    fixture.onRuntimeConfigurationChanged.mockClear();
    fixture.revealAgentMcpToken.mockResolvedValue({
      ...agentMcpToken(),
      token: 'rotated-agent-mcp-secret',
      fingerprint: 'fingerprint-2'
    });

    await fixture.manager.refreshConnections();

    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledWith(
      'enterprise_mcp_token_changed'
    );
  });
});

function createFixture(options: {
  nativeServers?: CodexMcpServerResponse[];
  listDiagnostics?: string[];
  revealAgentMcpToken?: EnterpriseHttpClient['revealAgentMcpToken'];
  legacyPreference?: EnterpriseMcpPreference;
} = {}) {
  let storedToken: EnterpriseMcpTokenCredential | undefined;
  let nativeServers = [...(options.nativeServers ?? [])];
  const tokenStore: EnterpriseMcpTokenStore = {
    read: vi.fn(async () => storedToken),
    write: vi.fn(async token => {
      storedToken = token;
    }),
    delete: vi.fn(async () => {
      storedToken = undefined;
    })
  };
  const sessionManager = {
    getSnapshot: vi.fn(() => ({
      status: 'signed_in' as const,
      account: { email: 'member@example.com', name: 'Member' },
      transportSecurity: 'secure_https' as const
    })),
    requireAccessToken: vi.fn(async () => 'enterprise-session-token'),
    invalidateUnauthorized: vi.fn(async () => undefined)
  } as unknown as EnterpriseSessionManager;
  const getMcpCatalog = vi.fn(async () => mcpCatalog());
  const revealAgentMcpToken = vi.fn(
    options.revealAgentMcpToken ?? (async () => agentMcpToken())
  );
  const mcpManager = {
    listServers: vi.fn(async () => ({
      codexHome: '/tmp/codex',
      codexHomeMode: 'isolated' as const,
      requiresWriteConfirmation: false,
      servers: nativeServers,
      diagnostics: options.listDiagnostics ?? []
    })),
    getServer: vi.fn(async (name: string) => {
      const server = nativeServers.find(item => item.name === name);
      if (server === undefined) throw new Error('MCP_SERVER_NOT_FOUND');
      return server;
    }),
    addServer: vi.fn(async input => {
      const server = nativeServer({
        name: input.name,
        enabled: true,
        url: 'url' in input ? input.url : undefined,
        bearerTokenEnvVar: 'bearerTokenEnvVar' in input
          ? input.bearerTokenEnvVar
          : undefined
      });
      nativeServers = [...nativeServers, server];
      return { server, operation: operation('add') };
    }),
    removeServer: vi.fn(async (name: string) => {
      nativeServers = nativeServers.filter(server => server.name !== name);
      return { removed: true as const, operation: operation('remove') };
    }),
    setServerEnabled: vi.fn(async (name: string, enabled: boolean) => {
      nativeServers = nativeServers.map(server =>
        server.name === name ? { ...server, enabled } : server
      );
      return {
        server: nativeServers.find(server => server.name === name)!,
        operation: operation(enabled ? 'enable' : 'disable')
      };
    })
  } as unknown as Pick<
    McpManager,
    | 'listServers'
    | 'getServer'
    | 'addServer'
    | 'removeServer'
    | 'setServerEnabled'
  >;
  const onRuntimeConfigurationChanged = vi.fn();
  let legacyPreference = options.legacyPreference;
  const legacyPreferences = {
    get: vi.fn(() => legacyPreference),
    list: vi.fn(() => (
      legacyPreference === undefined ? [] : [legacyPreference]
    )),
    upsert: vi.fn(),
    delete: vi.fn(() => {
      const existed = legacyPreference !== undefined;
      legacyPreference = undefined;
      return existed;
    })
  } as unknown as EnterpriseMcpPreferenceRepository;
  const manager = createEnterpriseMcpManager({
    enterpriseOrigin: 'https://enterprise.example',
    agentIdentityStore: {
      getOrCreate: vi.fn(async () => agentId)
    },
    sessionManager,
    httpClient: {
      getMcpCatalog,
      revealAgentMcpToken
    } as unknown as EnterpriseHttpClient,
    tokenStore,
    mcpManager,
    legacyPreferences,
    onRuntimeConfigurationChanged,
    now: () => new Date('2026-08-12T10:00:00Z')
  });
  return {
    manager,
    mcpManager,
    legacyPreferences,
    onRuntimeConfigurationChanged,
    revealAgentMcpToken,
    readStoredToken: () => storedToken
  };
}

function nativeServer(
  overrides: Partial<CodexMcpServerResponse>
): CodexMcpServerResponse {
  return {
    name: 'enterprise_crm',
    enabled: true,
    transport: 'http',
    status: 'configured',
    url: endpoint,
    envKeys: [],
    hasSecrets: false,
    codexHome: '/tmp/codex',
    codexHomeMode: 'isolated',
    diagnostics: [],
    ...overrides
  };
}

function mcpCatalog() {
  return {
    agentId,
    upstreams: [{
      upstreamId: 'crm-main',
      name: 'CRM',
      domain: 'sales',
      endpoint,
      upstreamTransport: 'streamable_http',
      namespace: 'crm',
      status: 'active',
      tools: []
    }]
  };
}

function agentMcpToken(): EnterpriseMcpTokenCredential {
  return {
    tokenId: 'token_1',
    agentId,
    token: 'agent-mcp-secret',
    tokenType: 'Bearer',
    fingerprint: 'fingerprint-1',
    expiresAt: null,
    scopes: ['mcp:call'],
    createdAt: '2026-08-12T00:00:00Z'
  };
}

function operation(
  type: 'add' | 'remove' | 'enable' | 'disable'
) {
  return {
    id: `operation-${type}`,
    operation: type,
    codexHome: '/tmp/codex',
    command: ['mcp', type],
    status: 'succeeded' as const,
    timedOut: false,
    createdAt: '2026-08-12T00:00:00Z'
  };
}
