import type {
  AddCodexMcpRequest,
  CodexMcpAddResponse,
  CodexMcpAuthResponse,
  CodexMcpListResponse,
  CodexMcpRemoveResponse,
  CodexMcpServerDetailResponse
} from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { McpSettingsView, type McpSettingsService } from './McpSettingsView.js';

describe('McpSettingsView', () => {
  it('lists servers without rendering secret values and adds a stdio server', async () => {
    const user = userEvent.setup();
    const addServer = vi.fn(async (_input: AddCodexMcpRequest): Promise<CodexMcpAddResponse> => ({
      server: {
        name: 'linear',
        enabled: true,
        transport: 'stdio',
        status: 'configured',
        command: 'node',
        args: ['server.js'],
        envKeys: ['LINEAR_TOKEN'],
        hasSecrets: true,
        codexHome: '/tmp/codex',
        codexHomeMode: 'isolated',
        diagnostics: []
      },
      operation: operation('add')
    }));
    render(
      <McpSettingsView
        connected
        service={createService({ addServer })}
        data={mcpData()}
        capabilities={allCapabilities()}
      />
    );

    expect(screen.getByRole('heading', { name: 'github' })).toBeInTheDocument();
    expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
    expect(screen.queryByText('super-secret-value')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '新增 MCP' }));
    await user.type(screen.getByLabelText('名称'), 'linear');
    await user.type(screen.getByLabelText('命令'), 'node');
    await user.type(screen.getByLabelText('参数'), 'server.js');
    await user.type(screen.getByLabelText('环境变量名'), 'LINEAR_TOKEN');
    await user.type(screen.getByLabelText('环境变量值'), 'super-secret-value');
    await user.click(screen.getByRole('button', { name: '保存 MCP' }));

    expect(addServer).toHaveBeenCalledWith({
      name: 'linear',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { LINEAR_TOKEN: 'super-secret-value' }
    });
    expect(await screen.findByRole('heading', { name: 'linear' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('super-secret-value')).not.toBeInTheDocument();
  });

  it('disables unsupported operations from the capability matrix', () => {
    render(
      <McpSettingsView
        connected
        service={createService()}
        data={mcpData()}
        capabilities={{
          mcpAdd: false,
          mcpRemove: false,
          mcpLogin: false,
          mcpLogout: false
        }}
      />
    );

    expect(screen.getByRole('button', { name: '新增 MCP' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '登录 github' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '退出 github' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除 github' })).toBeDisabled();
    expect(screen.getByText('当前 Codex 版本不支持新增 MCP')).toBeInTheDocument();
  });

  it('confirms global writes and performs login, logout, and remove', async () => {
    const user = userEvent.setup();
    const loginServer = vi.fn(async () => ({ operation: operation('login') }));
    const logoutServer = vi.fn(async () => ({ operation: operation('logout') }));
    const removeServer = vi.fn(async () => ({ removed: true as const }));
    render(
      <McpSettingsView
        connected
        service={createService({ loginServer, logoutServer, removeServer })}
        data={mcpData({ requiresWriteConfirmation: true })}
        capabilities={allCapabilities()}
        confirmWrite={() => true}
        confirmRemove={() => true}
      />
    );

    await user.click(screen.getByRole('button', { name: '登录 github' }));
    await user.click(screen.getByRole('button', { name: '退出 github' }));
    await user.click(screen.getByRole('button', { name: '删除 github' }));

    expect(loginServer).toHaveBeenCalledWith('github', true);
    expect(logoutServer).toHaveBeenCalledWith('github', true);
    expect(removeServer).toHaveBeenCalledWith('github', true);
    expect(screen.queryByRole('heading', { name: 'github' })).not.toBeInTheDocument();
  });
});

function createService(overrides: Partial<McpSettingsService> = {}): McpSettingsService {
  return {
    listServers: async () => mcpData(),
    getServer: async (): Promise<CodexMcpServerDetailResponse> => ({ server: mcpData().servers[0]! }),
    addServer: async () => ({ operation: operation('add') }),
    setServerEnabled: async (_name, enabled) => ({
      server: { ...mcpData().servers[0]!, enabled },
      operation: operation(enabled ? 'enable' : 'disable')
    }),
    removeServer: async (): Promise<CodexMcpRemoveResponse> => ({ removed: true }),
    loginServer: async (): Promise<CodexMcpAuthResponse> => ({ operation: operation('login') }),
    logoutServer: async (): Promise<CodexMcpAuthResponse> => ({ operation: operation('logout') }),
    ...overrides
  };
}

function mcpData(overrides: Partial<CodexMcpListResponse> = {}): CodexMcpListResponse {
  return {
    codexHome: '/tmp/codex',
    codexHomeMode: 'isolated',
    requiresWriteConfirmation: false,
    servers: [
      {
        name: 'github',
        enabled: true,
        transport: 'http',
        status: 'configured',
        url: 'https://example.com/mcp',
        envKeys: ['GITHUB_TOKEN'],
        hasSecrets: true,
        codexHome: '/tmp/codex',
        codexHomeMode: 'isolated',
        diagnostics: []
      }
    ],
    diagnostics: [],
    ...overrides
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
  operationType: 'add' | 'enable' | 'disable' | 'login' | 'logout'
) {
  return {
    id: `operation-${operationType}`,
    operation: operationType,
    codexHome: '/tmp/codex',
    command: ['mcp', operationType],
    status: 'succeeded' as const,
    timedOut: false,
    createdAt: '2026-07-12T00:00:00.000Z'
  };
}
