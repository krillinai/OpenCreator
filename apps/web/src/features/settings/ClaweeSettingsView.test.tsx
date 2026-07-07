import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClaweeSettingsView } from './ClaweeSettingsView.js';

const runtimeStatus = {
  connected: true,
  runtimeVersion: '0.9.1',
  codexVersion: 'codex-cli 1.2.3',
  codexPath: '/opt/homebrew/bin/codex',
  codexHome: '/Users/wulien/.codex',
  lastCheckedAt: '2026-07-07 10:30'
};

describe('ClaweeSettingsView', () => {
  it('renders default navigation and general settings without old work mode copy', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    expect(screen.getByRole('button', { name: '返回应用' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索设置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '常规' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关于 Clawee' })).toBeInTheDocument();

    expect(screen.getByText('默认权限')).toBeInTheDocument();
    expect(screen.getByText('默认文件打开方式')).toBeInTheDocument();
    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(screen.getByText('中文')).toBeInTheDocument();
    expect(screen.getByText('菜单栏显示')).toBeInTheDocument();
    expect(screen.queryByText('工作模式')).not.toBeInTheDocument();
    expect(screen.queryByText('适用于编程')).not.toBeInTheDocument();
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
    expect(screen.getByText('本地能力已就绪')).toBeInTheDocument();
  });

  it('shows Codex CLI details only in the about advanced information section', () => {
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '关于 Clawee' }));

    expect(screen.getByText('Clawee 版本')).toBeInTheDocument();
    expect(screen.getByText('Runtime 版本')).toBeInTheDocument();
    expect(screen.getByText('数据目录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeInTheDocument();

    const advanced = screen.getByRole('region', { name: '高级信息' });
    expect(within(advanced).getByText('Codex CLI 版本')).toBeInTheDocument();
    expect(within(advanced).getByText(runtimeStatus.codexVersion)).toBeInTheDocument();
    expect(within(advanced).getByText('CODEX_HOME')).toBeInTheDocument();
    expect(within(advanced).getByText(runtimeStatus.codexHome)).toBeInTheDocument();
  });

  it('calls onBack when returning to the app', () => {
    const onBack = vi.fn();
    render(<ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: '返回应用' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
