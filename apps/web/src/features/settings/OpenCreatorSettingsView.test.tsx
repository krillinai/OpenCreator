import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/dialogs/ConfirmDialogProvider.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { languagePreferenceStorageKey } from '../../i18n/language.js';
import { OpenCreatorSettingsView } from './OpenCreatorSettingsView.js';

const runtimeStatus = {
  connected: true,
  runtimeVersion: '0.9.1',
  codexVersion: 'codex-cli 1.2.3',
  codexPath: '/opt/homebrew/bin/codex',
  codexHome: '/Users/wulien/.codex',
  lastCheckedAt: '2026-07-07 10:00'
};

describe('OpenCreatorSettingsView', () => {
  it('renders default navigation and general settings without old work mode copy', () => {
    render(<OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    expect(screen.getByRole('button', { name: '返回应用' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索暂不可用')).toBeDisabled();
    expect(screen.getByText('搜索暂不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '常规' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'AI 服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '插件' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'MCP 服务' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '诊断' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关于 OpenCreator' })).toBeInTheDocument();

    expect(screen.getByText('默认权限')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '默认权限' })).toHaveValue('follow-project');
    expect(screen.getByText('默认文件打开方式')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '显示语言' })).toHaveValue('system');
    expect(screen.getByRole('option', { name: '跟随系统（简体中文）' })).toBeInTheDocument();
    expect(screen.getByText('菜单栏显示')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: '动态背景' })).not.toBeInTheDocument();
    expect(screen.queryByText('工作模式')).not.toBeInTheDocument();
    expect(screen.queryByText('适用于编程')).not.toBeInTheDocument();
  });

  it('switches the display language immediately and persists the choice', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />
      </LanguageProvider>
    );

    fireEvent.change(screen.getByRole('combobox', { name: '显示语言' }), {
      target: { value: 'en-US' }
    });

    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Display language' })).toHaveValue('en-US');
    expect(screen.getByRole('button', { name: 'Back to app' })).toBeInTheDocument();
    expect(window.localStorage.getItem(languagePreferenceStorageKey)).toBe('en-US');
    expect(document.documentElement).toHaveAttribute('lang', 'en-US');

    window.localStorage.removeItem(languagePreferenceStorageKey);
  });

  it('notifies when the global default permission changes', async () => {
    const user = userEvent.setup();
    const onDefaultPermissionChange = vi.fn();
    render(
      <ConfirmDialogProvider>
        <OpenCreatorSettingsView
          runtimeStatus={runtimeStatus}
          defaultPermission="workspace-write"
          onDefaultPermissionChange={onDefaultPermissionChange}
          onBack={vi.fn()}
        />
      </ConfirmDialogProvider>
    );

    const permission = screen.getByRole('combobox', { name: '默认权限' });
    expect(permission).toHaveValue('workspace-write');

    fireEvent.change(permission, { target: { value: 'danger-full-access' } });
    await user.click(await screen.findByRole('button', { name: '开启' }));

    await waitFor(() => {
      expect(onDefaultPermissionChange).toHaveBeenCalledWith('danger-full-access');
    });
  });

  it('keeps the existing permission when full access confirmation is canceled', async () => {
    const user = userEvent.setup();
    const onDefaultPermissionChange = vi.fn();
    render(
      <ConfirmDialogProvider>
        <OpenCreatorSettingsView
          runtimeStatus={runtimeStatus}
          defaultPermission="workspace-write"
          onDefaultPermissionChange={onDefaultPermissionChange}
          onBack={vi.fn()}
        />
      </ConfirmDialogProvider>
    );

    const permission = screen.getByRole('combobox', { name: '默认权限' });
    expect(within(permission).getAllByRole('option').map(option => option.textContent))
      .toEqual(['跟随项目设置', '请求批准', '完全访问权限']);

    fireEvent.change(permission, { target: { value: 'danger-full-access' } });
    await user.click(await screen.findByRole('button', { name: '取消' }));

    expect(onDefaultPermissionChange).not.toHaveBeenCalled();
  });

  it('renders a two-option color mode control and notifies when it changes', () => {
    const onColorModeChange = vi.fn();
    render(
      <OpenCreatorSettingsView
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

  it('renders seven accent color swatches and notifies when the selection changes', () => {
    const onAccentColorChange = vi.fn();
    render(
      <OpenCreatorSettingsView
        runtimeStatus={runtimeStatus}
        accentColor="neutral"
        onAccentColorChange={onAccentColorChange}
        onBack={vi.fn()}
      />
    );

    const accentControl = screen.getByRole('radiogroup', { name: '重点色' });
    expect(within(accentControl).getAllByRole('radio')).toHaveLength(7);
    expect(within(accentControl).getByRole('radio', { name: '默认灰' }))
      .toHaveAttribute('aria-checked', 'true');
    const customAccent = within(accentControl).getByRole('radio', { name: '自定义' });
    expect(customAccent).toHaveTextContent('自定义');
    expect(customAccent.querySelector('.settings-accent-swatch')).toBeInTheDocument();
    expect(customAccent.firstElementChild).toHaveClass('settings-accent-swatch');
    expect(customAccent.lastElementChild).toHaveClass('settings-custom-accent-text');
    expect(customAccent.querySelector('svg')).not.toBeInTheDocument();
    expect(customAccent).toHaveStyle({ '--settings-accent-swatch': '#3b82f6' });
    expect(screen.getByText('｜')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '自定义重点色色值' })).toHaveValue('#3b82f6');

    fireEvent.click(within(accentControl).getByRole('radio', { name: '橙色' }));
    expect(onAccentColorChange).toHaveBeenCalledWith('orange');
  });

  it('validates and applies a custom accent color without blocking draft input', () => {
    const onCustomAccentColorChange = vi.fn();
    render(
      <OpenCreatorSettingsView
        runtimeStatus={runtimeStatus}
        accentColor="custom"
        customAccentColor="#3b82f6"
        onCustomAccentColorChange={onCustomAccentColorChange}
        onBack={vi.fn()}
      />
    );

    const input = screen.getByRole('textbox', { name: '自定义重点色色值' });
    expect(input).toHaveValue('#3b82f6');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '#0af' } });
    expect(onCustomAccentColorChange).toHaveBeenLastCalledWith('#00aaff');
    expect(input).toHaveValue('#0af');

    fireEvent.change(input, { target: { value: '#12' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('请输入 3 位或 6 位十六进制色值');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('#3b82f6');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('updates the desktop close behavior when Desktop preferences are available', () => {
    const onDesktopCloseBehaviorChange = vi.fn();
    render(
      <OpenCreatorSettingsView
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
    render(<OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    expect(screen.queryByText('Codex CLI 版本')).not.toBeInTheDocument();
    expect(screen.queryByText(runtimeStatus.codexVersion)).not.toBeInTheDocument();
  });

  it('shows local skills and MCP status on the plugins tab', () => {
    render(<OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '插件' }));

    expect(screen.getByRole('button', { name: '插件' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Skills 状态')).toBeInTheDocument();
    expect(screen.getByText('MCP 服务状态')).toBeInTheDocument();
    expect(screen.getByText('最近检测时间')).toBeInTheDocument();
    expect(screen.getByText(runtimeStatus.lastCheckedAt)).toBeInTheDocument();
    expect(screen.getByText('本地能力已就绪')).toBeInTheDocument();
  });

  it('shows Codex CLI details only in the about advanced information section', () => {
    render(<OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '关于 OpenCreator' }));

    expect(screen.getByText('OpenCreator 版本')).toBeInTheDocument();
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

  it('keeps MCP management out of settings and opens Profiles', () => {
    render(<OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'MCP 服务' }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Profiles' }));
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.getByText('本地服务连接后可以管理 Profile。')).toBeInTheDocument();
  });

  it('opens Cleanup and Diagnostics pages from settings navigation', () => {
    render(
      <OpenCreatorSettingsView
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
    render(<OpenCreatorSettingsView runtimeStatus={{ ...runtimeStatus, connected: false }} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '关于 OpenCreator' }));

    const advanced = screen.getByRole('region', { name: '高级信息' });
    expect(within(advanced).getByText('本地运行内核状态')).toBeInTheDocument();
    expect(within(advanced).getByText('未连接')).toBeInTheDocument();
  });

  it('calls onBack when returning to the app', () => {
    const onBack = vi.fn();
    render(<OpenCreatorSettingsView runtimeStatus={runtimeStatus} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: '返回应用' }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
