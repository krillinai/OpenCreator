import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClaweeSettingsView } from './ClaweeSettingsView.js';

const runtimeStatus = {
  connected: true,
  runtimeVersion: '0.9.1',
  codexVersion: 'codex-cli 1.2.3',
  codexPath: '/opt/homebrew/bin/codex',
  codexHome: '/Users/wulien/.codex',
  lastCheckedAt: '2026-07-07 10:00'
};

describe('ClaweeSettingsView', () => {
  it('renders default navigation and general settings without old work mode copy', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    expect(screen.getByRole('button', { name: '返回应用' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索暂不可用')).toBeDisabled();
    expect(screen.getByText('搜索暂不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '常规' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MCP 服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '诊断' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关于 Clawee' })).toBeInTheDocument();

    expect(screen.getByText('默认权限')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '默认权限' })).toHaveValue('follow-project');
    expect(screen.getByText('默认文件打开方式')).toBeInTheDocument();
    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(screen.getByText('中文')).toBeInTheDocument();
    expect(screen.getByText('菜单栏显示')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: '动态背景' })).not.toBeInTheDocument();
    expect(screen.queryByText('工作模式')).not.toBeInTheDocument();
    expect(screen.queryByText('适用于编程')).not.toBeInTheDocument();
  });

  it('notifies when the global default permission changes', () => {
    const onDefaultPermissionChange = vi.fn();
    render(
      <ClaweeSettingsView
        runtimeStatus={runtimeStatus}
        defaultPermission="workspace-write"
        onDefaultPermissionChange={onDefaultPermissionChange}
        onBack={vi.fn()}
      />
    );

    const permission = screen.getByRole('combobox', { name: '默认权限' });
    expect(permission).toHaveValue('workspace-write');

    fireEvent.change(permission, { target: { value: 'danger-full-access' } });

    expect(onDefaultPermissionChange).toHaveBeenCalledWith('danger-full-access');
  });

  it('keeps the existing permission when full access confirmation is canceled', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onDefaultPermissionChange = vi.fn();
    render(
      <ClaweeSettingsView
        runtimeStatus={runtimeStatus}
        defaultPermission="workspace-write"
        onDefaultPermissionChange={onDefaultPermissionChange}
        onBack={vi.fn()}
      />
    );

    const permission = screen.getByRole('combobox', { name: '默认权限' });
    expect(within(permission).getAllByRole('option').map(option => option.textContent))
      .toEqual(['跟随项目设置', '请求批准', '完全访问权限']);

    fireEvent.change(permission, { target: { value: 'danger-full-access' } });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onDefaultPermissionChange).not.toHaveBeenCalled();
  });

  it('renders a two-option color mode control and notifies when it changes', () => {
    const onColorModeChange = vi.fn();
    render(
      <ClaweeSettingsView
        runtimeStatus={runtimeStatus}
        colorMode="dark"
        onColorModeChange={onColorModeChange}
        onBack={vi.fn()}
      />
    );

    const modeControl = screen.getByRole('group', { name: '颜色模式' });
    expect(within(modeControl).getByRole('button', { name: '浅色' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(within(modeControl).getByRole('button', { name: '深色' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(within(modeControl).getByRole('button', { name: '浅色' }));
    expect(onColorModeChange).toHaveBeenCalledWith('light');
  });

  it('updates the desktop close behavior when Desktop preferences are available', () => {
    const onDesktopCloseBehaviorChange = vi.fn();
    render(
      <ClaweeSettingsView
        runtimeStatus={runtimeStatus}
        desktopCloseBehavior="hide"
        onDesktopCloseBehaviorChange={onDesktopCloseBehaviorChange}
        onBack={vi.fn()}
      />
    );

    const behavior = screen.getByRole('combobox', { name: '关闭窗口时' });
    expect(behavior).toHaveValue('hide');
    fireEvent.change(behavior, { target: { value: 'quit' } });
    expect(onDesktopCloseBehaviorChange).toHaveBeenCalledWith('quit');
  });

  it('does not show Codex CLI version on the initial general tab', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    expect(screen.queryByText('Codex CLI 版本')).not.toBeInTheDocument();
    expect(screen.queryByText(runtimeStatus.codexVersion)).not.toBeInTheDocument();
  });

  it('shows local skills and MCP status on the plugins tab', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '插件' }));

    expect(screen.getByRole('button', { name: '插件' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Skills 状态')).toBeInTheDocument();
    expect(screen.getByText('MCP 服务状态')).toBeInTheDocument();
    expect(screen.getByText('最近检测时间')).toBeInTheDocument();
    expect(screen.getByText(runtimeStatus.lastCheckedAt)).toBeInTheDocument();
    expect(screen.getByText('本地能力已就绪')).toBeInTheDocument();
  });

  it('shows Codex CLI details only in the about advanced information section', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '关于 Clawee' }));

    expect(screen.getByText('Clawee 版本')).toBeInTheDocument();
    expect(screen.getByText('Runtime 版本')).toBeInTheDocument();
    expect(screen.getByText('数据目录')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '检查更新' })).not.toBeInTheDocument();
    expect(screen.getByText('检查更新')).toBeInTheDocument();
    expect(screen.getByText('手动检查稍后支持')).toBeInTheDocument();

    const advanced = screen.getByRole('region', { name: '高级信息' });
    expect(within(advanced).getByText('Codex CLI 版本')).toBeInTheDocument();
    expect(within(advanced).getByText(runtimeStatus.codexVersion)).toBeInTheDocument();
    expect(within(advanced).getByText('Codex CLI 路径')).toBeInTheDocument();
    expect(within(advanced).getByText(runtimeStatus.codexPath)).toBeInTheDocument();
    expect(within(advanced).getByText('CODEX_HOME')).toBeInTheDocument();
    expect(within(advanced).getByText(runtimeStatus.codexHome)).toBeInTheDocument();
    expect(within(advanced).getByText('本地运行内核状态')).toBeInTheDocument();
    expect(within(advanced).getByText('正常')).toBeInTheDocument();
    expect(within(advanced).getByText('最近一次检测时间')).toBeInTheDocument();
    expect(within(advanced).getByText(runtimeStatus.lastCheckedAt)).toBeInTheDocument();
  });

  it('opens MCP and Profiles management pages from settings navigation', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'MCP 服务' }));
    expect(screen.getByRole('heading', { name: 'MCP 服务' })).toBeInTheDocument();
    expect(screen.getByText('本地服务连接后可以管理 MCP。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }));
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.getByText('本地服务连接后可以管理 Profile。')).toBeInTheDocument();
  });

  it('opens Cleanup and Diagnostics pages from settings navigation', () => {
    render(
      <ClaweeSettingsView
        runtimeStatus={runtimeStatus}
        codexStatus={{
          codexBin: runtimeStatus.codexPath,
          codexVersion: runtimeStatus.codexVersion,
          codexHome: runtimeStatus.codexHome,
          codexHomeMode: 'global',
          codexHomeSource: 'default',
          codexHomeWritable: true,
          capabilities: { cleanup: true },
          diagnostics: []
        }}
        onBack={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '清理' }));
    expect(screen.getByRole('heading', { name: '运行数据清理' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '诊断' }));
    expect(screen.getByRole('heading', { name: '诊断' })).toBeInTheDocument();
    expect(screen.getByText(runtimeStatus.codexPath)).toBeInTheDocument();
  });

  it('shows disconnected local runtime status in about advanced information', () => {
    render(<ClaweeSettingsView runtimeStatus={{ ...runtimeStatus, connected: false }} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '关于 Clawee' }));

    const advanced = screen.getByRole('region', { name: '高级信息' });
    expect(within(advanced).getByText('本地运行内核状态')).toBeInTheDocument();
    expect(within(advanced).getByText('未连接')).toBeInTheDocument();
  });

  it('calls onBack when returning to the app', () => {
    const onBack = vi.fn();
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: '返回应用' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
