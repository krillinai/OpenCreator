import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeRecoveryContext, RuntimeRecoveryNotice } from './runtime-recovery.js';
import type { RuntimeRecovery } from './use-runtime-connection.js';
import { LanguageProvider } from '../i18n/LanguageProvider.js';
import { LanguageSwitchControls } from '../test/LanguageSwitchControls.js';

describe('Runtime recovery controls', () => {
  it('keeps a brief Creator session retry quiet but shows persistent connection problems', () => {
    const view = render(<RuntimeRecoveryNotice session={{ status: 'reconnecting', attempt: 3 }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    view.rerender(<RuntimeRecoveryNotice session={{ status: 'reconnecting', attempt: 4 }} />);
    expect(screen.getByText('正在恢复项目会话与任务状态…')).toBeVisible();
  });

  it('reports background Codex status errors only in diagnostics', () => {
    const recovery: RuntimeRecovery = {
      state: { status: 'connected', codexStatusError: 'status request failed' },
      phase: 'connected', attempt: 0, epoch: 1, message: 'status request failed', retry: vi.fn()
    };
    function notice(diagnostics: boolean) {
      return <RuntimeRecoveryContext.Provider value={recovery}>
        <RuntimeRecoveryNotice diagnostics={diagnostics} />
      </RuntimeRecoveryContext.Provider>;
    }
    const view = render(notice(false));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    view.rerender(notice(true));
    expect(screen.getByText('本地服务已连接，Codex 状态暂时不可用，正在重新检查。')).toBeVisible();
    expect(screen.getByText('status request failed')).toBeVisible();
  });

  it('updates recovery copy without reconnecting or restarting when the language changes', () => {
    const retry = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    const recovery: RuntimeRecovery = { state: { status: 'disconnected', message: '后台原文：服务断开' }, phase: 'reconnecting', attempt: 4, epoch: 1, retry, restart };
    render(<LanguageProvider initialPreference="zh-CN"><LanguageSwitchControls /><RuntimeRecoveryContext.Provider value={recovery}><RuntimeRecoveryNotice /></RuntimeRecoveryContext.Provider></LanguageProvider>);
    expect(screen.getByText(/正在自动重连/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    expect(screen.getByText(/Reconnecting automatically/)).toBeVisible();
    expect(screen.getByText(/does not restart tasks/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByText(/Ansluter automatiskt igen/)).toBeVisible();
    expect(screen.getByText(/startar inte om uppgifter/)).toBeVisible();
    expect(screen.queryByText('后台原文：服务断开')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Anslut igen' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('shows automatic recovery and invokes the real supported restart after confirmation', async () => {
    const retry = vi.fn(async () => undefined);
    const restart = vi.fn(async () => undefined);
    const recovery: RuntimeRecovery = {
      state: { status: 'disconnected', message: 'offline' }, phase: 'reconnecting', attempt: 4, epoch: 1, retry, restart
    };
    const view = render(<RuntimeRecoveryContext.Provider value={recovery}><RuntimeRecoveryNotice /></RuntimeRecoveryContext.Provider>);
    expect(screen.getByText(/正在自动重连/)).toBeVisible();
    expect(screen.getByText(/不会重复启动任务/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '重启本地服务' }));
    expect(restart).toHaveBeenCalledTimes(1);
    view.rerender(<RuntimeRecoveryContext.Provider value={{ ...recovery, restart: undefined }}><RuntimeRecoveryNotice /></RuntimeRecoveryContext.Provider>);
    expect(screen.queryByRole('button', { name: '重启本地服务' })).not.toBeInTheDocument();
  });

  it('distinguishes a failed session from a healthy Runtime', () => {
    render(<RuntimeRecoveryContext.Provider value={{ state: { status: 'connected' }, phase: 'connected', attempt: 0, epoch: 1, retry: vi.fn() }}>
      <RuntimeRecoveryNotice session={{ status: 'failed', attempt: 1 }} onRetrySession={vi.fn()} />
    </RuntimeRecoveryContext.Provider>);
    expect(screen.getByText('服务已连接，但项目会话恢复失败。')).toBeVisible();
    expect(screen.queryByText(/正在自动重连/)).not.toBeInTheDocument();
  });
});
