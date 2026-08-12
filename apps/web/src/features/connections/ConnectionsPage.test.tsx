import type {
  EnterpriseMcpCatalogResponse,
  EnterpriseSessionResponse
} from '@clawee/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ConnectionsPage,
  type EnterpriseMcpConnectionService
} from './ConnectionsPage.js';

describe('ConnectionsPage', () => {
  it('separates installation from enablement and never exposes a grant action', async () => {
    const user = userEvent.setup();
    let catalog = createCatalog();
    const service: EnterpriseMcpConnectionService = {
      listMcpConnections: vi.fn(async () => catalog),
      refreshMcpConnections: vi.fn(async () => catalog),
      updateMcpPreference: vi.fn(async (upstreamId, update) => {
        catalog = {
          ...catalog,
          upstreams: catalog.upstreams.map(upstream => (
            upstream.upstreamId === upstreamId
              ? {
                  ...upstream,
                  installed: update.installed ?? upstream.installed,
                  enabled: update.installed === false
                    ? false
                    : update.enabled ?? upstream.enabled
                }
              : upstream
          ))
        };
        return catalog;
      })
    };

    render(
      <ConnectionsPage
        connected
        session={signedInSession()}
        service={service}
        onOpenAccount={vi.fn()}
        onRefreshSession={vi.fn(async () => signedInSession())}
        onSessionExpired={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'CRM' })).toBeInTheDocument();
    expect(screen.getByText('sales')).toBeInTheDocument();
    expect(screen.getByText('按条件查询客户资料')).toBeInTheDocument();
    expect(screen.queryByText('企业授权：1/2 项工具')).not.toBeInTheDocument();
    expect(screen.queryByText('查询客户')).not.toBeInTheDocument();
    expect(screen.queryByText('服务正常')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '申请权限' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'CRM MCP' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '安装' }));
    const toggle = await screen.findByRole('switch', { name: 'CRM MCP' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(service.updateMcpPreference).toHaveBeenNthCalledWith(
      1,
      'crm-main',
      { installed: true, enabled: false }
    );

    await user.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.getByRole('button', { name: '已安装 1' })).toBeInTheDocument();
    expect(service.updateMcpPreference).toHaveBeenNthCalledWith(
      2,
      'crm-main',
      { enabled: true }
    );
    expect(screen.queryByRole('button', { name: '卸载 CRM' })).not.toBeInTheDocument();
    const card = screen.getByTestId('enterprise-mcp-card');
    expect(card.querySelectorAll(':scope > *')).toHaveLength(2);
    expect(card.querySelector('.connection-card__head')).not.toBeNull();
    expect(card.querySelector('.connection-card__description')).not.toBeNull();
    expect(card.querySelector('footer')).toBeNull();
    expect(card.querySelector('.connection-card__head .connection-switch')).not.toBeNull();
  });

  it('shows the login action without loading the catalog when signed out', async () => {
    const user = userEvent.setup();
    const onOpenAccount = vi.fn();
    const service: EnterpriseMcpConnectionService = {
      listMcpConnections: vi.fn(),
      refreshMcpConnections: vi.fn(),
      updateMcpPreference: vi.fn()
    };
    render(
      <ConnectionsPage
        connected
        session={{
          status: 'signed_out',
          transportSecurity: 'secure_https'
        }}
        service={service}
        onOpenAccount={onOpenAccount}
        onRefreshSession={vi.fn(async () => signedInSession())}
        onSessionExpired={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '登录企业账户' }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
    expect(service.listMcpConnections).not.toHaveBeenCalled();
  });

  it('refreshes the enterprise session before retrying a service outage', async () => {
    const user = userEvent.setup();
    const onRefreshSession = vi.fn(async () => signedInSession());
    render(
      <ConnectionsPage
        connected
        session={{
          status: 'service_unavailable',
          reason: 'service_unavailable',
          transportSecurity: 'secure_https'
        }}
        service={null}
        onOpenAccount={vi.fn()}
        onRefreshSession={onRefreshSession}
        onSessionExpired={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '重新加载' }));

    expect(onRefreshSession).toHaveBeenCalledOnce();
  });
});

function signedInSession(): EnterpriseSessionResponse {
  return {
    status: 'signed_in',
    account: {
      email: 'member@example.com',
      name: 'Enterprise Member'
    },
    transportSecurity: 'secure_https'
  };
}

function createCatalog(): EnterpriseMcpCatalogResponse {
  return {
    agentId: 'clawee_550e8400-e29b-41d4-a716-446655440000',
    tokenStatus: 'ready',
    refreshedAt: '2026-08-07T10:00:00.000Z',
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
      }]
    }]
  };
}
