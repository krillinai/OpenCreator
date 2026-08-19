import type {
  CodexMcpListResponse,
  EnterpriseMcpCatalogResponse
} from '@opencreator/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ConnectionsPage,
  type EnterpriseMcpConnectionService
} from './ConnectionsPage.js';
import type { McpSettingsService } from '../settings/McpSettingsView.js';

describe('ConnectionsPage', () => {
  it('loads and toggles native MCP without an account gate', async () => {
    const user = userEvent.setup();
    let native = nativeData();
    const mcpService = createMcpService({
      listServers: vi.fn(async () => native),
      setServerEnabled: vi.fn(async (name, enabled) => {
        native = {
          ...native,
          servers: native.servers.map(server =>
            server.name === name ? { ...server, enabled } : server
          )
        };
        return {
          server: native.servers[0]!,
          operation: operation(enabled ? 'enable' : 'disable')
        };
      })
    });
    render(
      <ConnectionsPage
        connected
        service={null}
        mcpService={mcpService}
        mcpCapabilities={allCapabilities()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'github' }))
      .toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'github MCP' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
    expect(mcpService.setServerEnabled).toHaveBeenCalledWith(
      'github',
      false,
      false
    );
  });

  it('merges an enterprise catalog entry with a native server by endpoint', async () => {
    const enterpriseService = createEnterpriseService();

    render(
      <ConnectionsPage
        connected
        service={enterpriseService}
        mcpService={createMcpService()}
        mcpCapabilities={allCapabilities()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'CRM' }))
      .toBeInTheDocument();
    expect(screen.getAllByTestId('mcp-card')).toHaveLength(1);
    expect(screen.getByText(/github/)).toBeInTheDocument();
    expect(screen.getByText('按条件查询客户资料')).toBeInTheDocument();
    expect(screen.queryByText('企业授权：1/2 项工具'))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '安装' }))
      .not.toBeInTheDocument();
  });

  it('installs an enterprise-only catalog entry through the enterprise adapter', async () => {
    const user = userEvent.setup();
    let catalog = enterpriseCatalog({
      endpoint: 'https://enterprise.example/mcp/servers/other'
    });
    const enterpriseService = createEnterpriseService({
      listMcpConnections: vi.fn(async () => catalog),
      updateMcpPreference: vi.fn(async (_upstreamId, update) => {
        catalog = {
          ...catalog,
          upstreams: catalog.upstreams.map(upstream => ({
            ...upstream,
            installed: update.installed ?? upstream.installed,
            enabled: update.enabled ?? upstream.enabled
          }))
        };
        return catalog;
      })
    });

    render(
      <ConnectionsPage
        connected
        service={enterpriseService}
        mcpService={createMcpService()}
        mcpCapabilities={allCapabilities()}
      />
    );

    await user.click(await screen.findByRole('button', { name: '安装' }));

    expect(enterpriseService.updateMcpPreference).toHaveBeenCalledWith(
      'crm-main',
      { installed: true, enabled: false }
    );
  });

  it('disables unsupported native MCP operations by capability', async () => {
    render(
      <ConnectionsPage
        connected
        service={null}
        mcpService={createMcpService()}
        mcpCapabilities={{
          ...allCapabilities(),
          mcpLogin: false,
          mcpLogout: false,
          mcpRemove: false
        }}
      />
    );

    expect(await screen.findByRole('button', { name: '登录 github' }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: '退出 github' }))
      .toBeDisabled();
    expect(screen.getByRole('button', { name: '删除 github' }))
      .toBeDisabled();
    expect(screen.getByRole('switch', { name: 'github MCP' }))
      .toBeEnabled();
  });
});

function createMcpService(
  overrides: Partial<McpSettingsService> = {}
): McpSettingsService {
  return {
    listServers: vi.fn(async () => nativeData()),
    getServer: vi.fn(async () => ({ server: nativeData().servers[0]! })),
    addServer: vi.fn(async () => ({ operation: operation('add') })),
    setServerEnabled: vi.fn(async (_name, enabled) => ({
      server: { ...nativeData().servers[0]!, enabled },
      operation: operation(enabled ? 'enable' : 'disable')
    })),
    removeServer: vi.fn(async () => ({ removed: true as const })),
    loginServer: vi.fn(async () => ({ operation: operation('login') })),
    logoutServer: vi.fn(async () => ({ operation: operation('logout') })),
    ...overrides
  };
}

function createEnterpriseService(
  overrides: Partial<EnterpriseMcpConnectionService> = {}
): EnterpriseMcpConnectionService {
  return {
    listMcpConnections: vi.fn(async () => enterpriseCatalog()),
    refreshMcpConnections: vi.fn(async () => enterpriseCatalog()),
    updateMcpPreference: vi.fn(async () => enterpriseCatalog()),
    ...overrides
  };
}

function nativeData(): CodexMcpListResponse {
  return {
    codexHome: '/tmp/codex',
    codexHomeMode: 'isolated',
    requiresWriteConfirmation: false,
    servers: [{
      name: 'github',
      enabled: true,
      transport: 'http',
      status: 'configured',
      url: 'https://enterprise.example/mcp/servers/crm-main',
      envKeys: ['GITHUB_TOKEN'],
      hasSecrets: true,
      codexHome: '/tmp/codex',
      codexHomeMode: 'isolated',
      diagnostics: []
    }],
    diagnostics: []
  };
}

function enterpriseCatalog(
  overrides: Partial<EnterpriseMcpCatalogResponse['upstreams'][number]> = {}
): EnterpriseMcpCatalogResponse {
  return {
    agentId: 'opencreator_550e8400-e29b-41d4-a716-446655440000',
    tokenStatus: 'ready',
    refreshedAt: '2026-08-12T10:00:00.000Z',
    upstreams: [{
      upstreamId: 'crm-main',
      name: 'CRM',
      domain: 'sales',
      endpoint: 'https://enterprise.example/mcp/servers/crm-main',
      upstreamTransport: 'streamable_http',
      namespace: 'crm',
      status: 'active',
      installed: false,
      enabled: false,
      tools: [{
        toolId: 'cap_customer_search',
        upstreamName: 'customer.search',
        name: 'customer.search',
        exposedName: 'crm.customer.search',
        title: '查询客户',
        description: '按条件查询客户资料',
        riskLevel: 'low',
        confirmRequired: false,
        status: 'active',
        authorized: true,
        authorizationExpiresAt: null
      }, {
        toolId: 'cap_customer_delete',
        upstreamName: 'customer.delete',
        name: 'customer.delete',
        exposedName: 'crm.customer.delete',
        title: '删除客户',
        description: '删除客户资料',
        riskLevel: 'high',
        confirmRequired: true,
        status: 'active',
        authorized: false,
        authorizationExpiresAt: null
      }],
      ...overrides
    }]
  };
}

function allCapabilities() {
  return {
    mcpAdd: true,
    mcpRemove: true,
    mcpLogin: true,
    mcpLogout: true,
    mcpAddEnv: true,
    mcpAddUrl: true,
    mcpAddBearerTokenEnvVar: true,
    mcpAddOAuth: true
  };
}

function operation(
  type: 'add' | 'enable' | 'disable' | 'login' | 'logout'
) {
  return {
    id: `operation-${type}`,
    operation: type,
    codexHome: '/tmp/codex',
    command: ['mcp', type],
    status: 'succeeded' as const,
    timedOut: false,
    createdAt: '2026-08-12T00:00:00.000Z'
  };
}
