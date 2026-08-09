import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnterpriseHttpClient } from '../../src/enterprise/http-client-2026-07-30.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';
import {
  createEnterpriseMcpManager,
  ENTERPRISE_MCP_TOKEN_ENV
} from '../../src/enterprise/mcp-manager-2026-08-07.js';
import {
  createEnterpriseMcpPreferenceRepository
} from '../../src/enterprise/mcp-preferences-2026-08-07.js';
import type {
  EnterpriseMcpTokenCredential,
  EnterpriseMcpTokenStore
} from '../../src/enterprise/mcp-token-store-2026-08-07.js';
import {
  EnterpriseMcpTokenStoreError
} from '../../src/enterprise/mcp-token-store-2026-08-07.js';
import type {
  EnterpriseSessionManager
} from '../../src/enterprise/session-manager-2026-07-30.js';
import { migrate } from '../../src/storage/migrations.js';
import type { RuntimeThread } from '../../src/threads/types.js';

const agentId = 'clawee_550e8400-e29b-41d4-a716-446655440000';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe('enterprise MCP manager', () => {
  it('stores the Agent token securely and returns only catalog plus local preferences', async () => {
    const fixture = createFixture();
    const response = await fixture.manager.listConnections();

    expect(response).toMatchObject({
      agentId,
      tokenStatus: 'ready',
      upstreams: [{
        upstreamId: 'crm-main',
        installed: false,
        enabled: false
      }]
    });
    expect(JSON.stringify(response)).not.toContain('agent-mcp-secret');
    expect(fixture.readStoredToken()).toMatchObject({
      agentId,
      token: 'agent-mcp-secret'
    });
  });

  it('injects every Gateway tool for an enabled upstream without local authorization filtering', async () => {
    const fixture = createFixture({}, {
      isolationServerNames: ['claw-mcp']
    });
    await fixture.manager.listConnections();
    await fixture.manager.updatePreference('crm-main', {
      installed: true,
      enabled: false
    });
    await fixture.manager.updatePreference('crm-main', {
      enabled: true
    });

    const injection = await fixture.manager.prepareRuntime({
      runId: 'run_1',
      thread: conversationThread(),
      createdBy: 'api'
    });

    expect(injection?.mcpServers).toHaveLength(2);
    expect(injection?.mcpServers[0]).toEqual({
      name: 'claw-mcp',
      enabled: false
    });
    expect(injection?.mcpServers[1]).toMatchObject({
      url: 'https://enterprise.example/mcp/servers/crm-main',
      bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV,
      enabled: true,
      required: false
    });
    expect(injection?.mcpServers[1]).not.toHaveProperty('enabledTools');
    expect(injection?.env).toEqual({
      [ENTERPRISE_MCP_TOKEN_ENV]: 'agent-mcp-secret'
    });
    expect(await fixture.manager.prepareRuntime({
      runId: 'run_schedule',
      thread: conversationThread(),
      createdBy: 'schedule'
    })).toMatchObject({
      mcpServers: [{
        name: 'claw-mcp',
        enabled: false
      }],
      env: {}
    });
  });

  it('keeps same-Gateway legacy MCP servers disabled when no managed connection is enabled', async () => {
    const fixture = createFixture({}, {
      isolationServerNames: ['claw-mcp', 'claw-mcp']
    });

    expect(await fixture.manager.prepareRuntime({
      runId: 'run_1',
      thread: conversationThread(),
      createdBy: 'api'
    })).toMatchObject({
      mcpServers: [{
        name: 'claw-mcp',
        enabled: false
      }],
      env: {}
    });
  });

  it('keeps installation and enablement separate and closes runtime configuration on change', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();

    const installed = await fixture.manager.updatePreference('crm-main', {
      installed: true
    });
    expect(installed.upstreams[0]).toMatchObject({
      installed: true,
      enabled: false
    });
    await fixture.manager.updatePreference('crm-main', { enabled: true });
    const removed = await fixture.manager.updatePreference('crm-main', {
      installed: false
    });
    expect(removed.upstreams[0]).toMatchObject({
      installed: false,
      enabled: false
    });
    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledTimes(3);
  });

  it('rejects enabling during first-time installation and ignores no-op preferences', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();

    await expect(fixture.manager.updatePreference('crm-main', {
      installed: true,
      enabled: true
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_INVALID_REQUEST',
      statusCode: 400
    });
    await expect(fixture.manager.updatePreference('crm-main', {
      enabled: false
    })).resolves.toMatchObject({
      upstreams: [{
        installed: false,
        enabled: false
      }]
    });
    expect(fixture.onRuntimeConfigurationChanged).not.toHaveBeenCalled();
  });

  it('reports a missing MCP token without using the enterprise app JWT as a fallback', async () => {
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

  it('maps a malformed successful Gateway response to a local 502 error', async () => {
    const fixture = createFixture({
      getMcpCatalog: vi.fn(async () => {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          200
        );
      })
    });

    await expect(fixture.manager.listConnections()).rejects.toMatchObject({
      code: 'ENTERPRISE_PROTOCOL_ERROR',
      statusCode: 502
    });
  });

  it('invalidates the persistent runtime when a stored MCP token fingerprint changes', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();
    fixture.onRuntimeConfigurationChanged.mockClear();
    fixture.revealAgentMcpToken.mockResolvedValue({
      ...agentMcpToken(),
      tokenId: 'token_2',
      token: 'rotated-agent-mcp-secret',
      fingerprint: 'fingerprint-2',
      createdAt: '2026-08-07T09:00:00Z'
    });

    await fixture.manager.refreshConnections();

    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledOnce();
    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledWith(
      'enterprise_mcp_token_changed'
    );
  });

  it('invalidates the runtime before surfacing a token deletion failure', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();
    fixture.onRuntimeConfigurationChanged.mockClear();
    vi.mocked(fixture.tokenStore.delete).mockRejectedValue(
      new EnterpriseMcpTokenStoreError('delete')
    );

    await expect(fixture.manager.handleSessionSignedOut()).rejects.toMatchObject({
      code: 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
      statusCode: 503
    });

    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledWith(
      'enterprise_session_signed_out'
    );
  });

  it('invalidates an old runtime when a revoked token cannot be deleted locally', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();
    fixture.onRuntimeConfigurationChanged.mockClear();
    fixture.revealAgentMcpToken.mockRejectedValue(
      new EnterpriseHttpError(
        'ENTERPRISE_MCP_TOKEN_NOT_FOUND',
        'response',
        404,
        'not_found'
      )
    );
    vi.mocked(fixture.tokenStore.delete).mockRejectedValue(
      new EnterpriseMcpTokenStoreError('delete')
    );

    await expect(fixture.manager.refreshConnections()).rejects.toMatchObject({
      code: 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
      statusCode: 503
    });

    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledWith(
      'enterprise_mcp_token_changed'
    );
  });

  it('invalidates only when the MCP catalog runtime topology changes', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();
    fixture.onRuntimeConfigurationChanged.mockClear();
    fixture.getMcpCatalog.mockResolvedValue({
      ...mcpCatalog(),
      upstreams: [{
        ...mcpCatalog().upstreams[0]!,
        endpoint: 'https://enterprise.example/mcp/servers/crm-main-v2'
      }]
    });

    await fixture.manager.refreshConnections();

    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledOnce();
    expect(fixture.onRuntimeConfigurationChanged).toHaveBeenCalledWith(
      'enterprise_mcp_catalog_changed'
    );
  });

  it('does not restart the runtime when only Gateway authorization display data changes', async () => {
    const fixture = createFixture();
    await fixture.manager.listConnections();
    fixture.onRuntimeConfigurationChanged.mockClear();
    fixture.getMcpCatalog.mockResolvedValue({
      ...mcpCatalog(),
      upstreams: [{
        ...mcpCatalog().upstreams[0]!,
        tools: mcpCatalog().upstreams[0]!.tools.map(tool => ({
          ...tool,
          authorized: !tool.authorized
        }))
      }]
    });

    await fixture.manager.refreshConnections();

    expect(fixture.onRuntimeConfigurationChanged).not.toHaveBeenCalled();
  });
});

function createFixture(
  clientOverrides: Partial<EnterpriseHttpClient> = {},
  options: {
    isolationServerNames?: string[];
  } = {}
) {
  db = new Database(':memory:');
  migrate(db);
  let storedToken: EnterpriseMcpTokenCredential | undefined;
  const tokenStore: EnterpriseMcpTokenStore = {
    read: vi.fn(async () => storedToken),
    write: vi.fn(async token => {
      storedToken = token;
    }),
    delete: vi.fn(async () => {
      storedToken = undefined;
    })
  };
  const onRuntimeConfigurationChanged = vi.fn();
  const sessionManager = {
    getSnapshot: vi.fn(() => ({
      status: 'signed_in' as const,
      account: {
        email: 'member@example.com',
        name: 'Member'
      },
      transportSecurity: 'secure_https' as const
    })),
    requireAccessToken: vi.fn(async () => 'enterprise-app-jwt'),
    invalidateUnauthorized: vi.fn(async () => undefined)
  } as unknown as EnterpriseSessionManager;
  const getMcpCatalog = vi.fn(async () => mcpCatalog());
  const revealAgentMcpToken = vi.fn(async () => agentMcpToken());
  const httpClient = {
    getMcpCatalog,
    revealAgentMcpToken,
    ...clientOverrides
  } as unknown as EnterpriseHttpClient;
  const manager = createEnterpriseMcpManager({
    enterpriseOrigin: 'https://enterprise.example',
    agentIdentityStore: {
      getOrCreate: vi.fn(async () => agentId)
    },
    sessionManager,
    httpClient,
    tokenStore,
    preferences: createEnterpriseMcpPreferenceRepository(db),
    listRuntimeIsolationServerNames: () => options.isolationServerNames ?? [],
    onRuntimeConfigurationChanged,
    now: () => new Date('2026-08-07T10:00:00Z')
  });
  return {
    manager,
    getMcpCatalog,
    onRuntimeConfigurationChanged,
    revealAgentMcpToken,
    tokenStore,
    readStoredToken: () => storedToken
  };
}

function mcpCatalog() {
  return {
    agentId,
    upstreams: [{
      upstreamId: 'crm-main',
      name: 'CRM',
      domain: 'sales',
      endpoint: 'https://enterprise.example/mcp/servers/crm-main',
      upstreamTransport: 'streamable_http',
      namespace: 'crm',
      status: 'active',
      tools: [{
        toolId: 'cap_search',
        upstreamName: 'customer.search',
        name: 'customer.search',
        exposedName: 'crm.customer.search',
        title: '查询客户',
        description: '查询客户',
        riskLevel: 'low',
        confirmRequired: false,
        status: 'active',
        authorized: true,
        authorizationExpiresAt: null
      }, {
        toolId: 'cap_delete',
        upstreamName: 'customer.delete',
        name: 'customer.delete',
        exposedName: 'crm.customer.delete',
        title: '删除客户',
        description: '删除客户',
        riskLevel: 'high',
        confirmRequired: true,
        status: 'active',
        authorized: false,
        authorizationExpiresAt: null
      }]
    }]
  };
}

function agentMcpToken() {
  return {
    tokenId: 'token_1',
    agentId,
    token: 'agent-mcp-secret',
    tokenType: 'Bearer' as const,
    fingerprint: 'fingerprint-1',
    expiresAt: null,
    scopes: ['mcp:call'],
    createdAt: '2026-08-07T00:00:00Z'
  };
}

function conversationThread(): RuntimeThread {
  return {
    id: 'thread_1',
    title: 'MCP 测试',
    projectId: 'project_1',
    origin: 'clawee_created',
    cwd: '/tmp/project',
    canonicalCwd: '/tmp/project',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-08-07T00:00:00Z',
    updatedAt: '2026-08-07T00:00:00Z'
  };
}
