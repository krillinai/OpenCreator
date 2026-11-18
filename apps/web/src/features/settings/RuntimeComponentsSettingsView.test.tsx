import type { CreatorYtDlpStatus } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { normalizePageIssue } from '../issues/page-issue-state.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { RuntimeComponentsSettingsView } from './RuntimeComponentsSettingsView.js';

describe('RuntimeComponentsSettingsView', () => {
  it.each([
    ['zh-CN', '已就绪', '上次检查版本', '检查更新'],
    ['en-US', 'Ready', 'Last checked version', 'Check for updates']
  ] as const)('keeps the usable version visible without a startup check or warning in %s', (language, ready, cachedVersion, check) => {
    const checkYtDlpUpdate = vi.fn(async () => status());
    renderView({ ytDlpStatus: status({ latestVersion: '2026.08.28.000000',
      lastCheckedAt: '2026-08-29T00:00:00Z', lastCheckAttemptAt: '2026-08-30T00:00:00Z' }), checkYtDlpUpdate }, language);

    expect(checkYtDlpUpdate).not.toHaveBeenCalled();
    expect(screen.getByText(ready)).toHaveAttribute('data-status', 'current');
    expect(screen.getByText(cachedVersion)).toBeVisible();
    expect(screen.getByRole('button', { name: check })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('keeps yt-dlp visible with a retry action when its status cannot be loaded', async () => {
    const checkYtDlpUpdate = vi.fn(async () => status());
    renderView({
      ytDlpStatus: undefined,
      checkYtDlpUpdate,
      issues: [normalizePageIssue('settings-runtime-components', 'runtime.load-yt-dlp',
        new Error('Runtime unavailable'), '无法读取视频下载组件状态。')]
    });

    expect(screen.getByRole('heading', { name: 'yt-dlp nightly' })).toBeVisible();
    expect(screen.getByText('状态读取失败')).toHaveAttribute('data-status', 'failed');
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(checkYtDlpUpdate).toHaveBeenCalledWith(true));
  });

  it('shows current, latest, and updated versions, and installs an available update', async () => {
    const updateYtDlp = vi.fn(async () => status({
      source: 'managed',
      currentVersion: '2026.08.31.120000'
    }));
    renderView({
      ytDlpStatus: status({
        latestVersion: '2026.08.31.120000',
        updateAvailable: true,
        lastCheckedAt: '2026-08-31T00:00:00.000Z'
      }),
      updateYtDlp
    });

    expect(screen.getByRole('heading', { name: '第三方组件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'yt-dlp nightly' })).toBeInTheDocument();
    expect(screen.getAllByText('2026.08.29.232711')).toHaveLength(1);
    expect(screen.getByText('更新时间')).toBeInTheDocument();
    expect(screen.getByText('尚未检查')).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', {
      name: '更新到 2026.08.31.120000'
    }));

    expect(screen.getByText('有可用更新')).toHaveAttribute('data-status', 'update');
    expect(screen.getByRole('button', { name: '更新到 2026.08.31.120000' })).toHaveAttribute('data-status', 'update');
    await waitFor(() => expect(updateYtDlp).toHaveBeenCalledOnce());
  });

  it('keeps the current version active when update verification fails', async () => {
    renderView({
      ytDlpStatus: status({
        latestVersion: '2026.08.31.120000',
        updateAvailable: true
      }),
      issues: [normalizePageIssue(
        'settings-runtime-components',
        'runtime.update-yt-dlp',
        new Error('verification failed'),
        'yt-dlp 更新校验失败，当前版本仍可继续使用。'
      )]
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'yt-dlp 更新校验失败，当前版本仍可继续使用。'
    );
    expect(screen.queryByText('更新失败时，OpenCreator 会继续使用当前可用版本。'))
      .not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('有可用更新')).toBeInTheDocument());
  });

  it('marks a version as current only after a successful manual check', async () => {
    let resolveCheck!: (value: CreatorYtDlpStatus) => void;
    const checkYtDlpUpdate = vi.fn(() => new Promise<CreatorYtDlpStatus>(resolve => {
      resolveCheck = resolve;
    }));
    renderView({
      ytDlpStatus: status({
        latestVersion: '2026.08.29.232711',
        lastCheckedAt: '2026-08-31T00:00:00.000Z'
      }),
      checkYtDlpUpdate
    });

    expect(screen.queryByText('已是最新')).not.toBeInTheDocument();
    expect(screen.getByText('上次检查版本')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    expect(screen.getAllByText('正在检查')).not.toHaveLength(0);
    expect(checkYtDlpUpdate).toHaveBeenCalledWith(true);

    resolveCheck(status({
      latestVersion: '2026.09.16.232951',
      updateAvailable: true
    }));
    await waitFor(() => expect(screen.queryByText('正在检查')).not.toBeInTheDocument());
  });

  it('marks cached release information as stale when a manual check fails', async () => {
    const checkYtDlpUpdate = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    renderView({
      ytDlpStatus: status({ latestVersion: '2026.08.29.232711' }),
      checkYtDlpUpdate
    });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText('失败')).toHaveAttribute('data-status', 'failed'));
    expect(screen.getByText('检查失败').closest('.runtime-component-details')).not.toBeNull();
    expect(screen.getByText('上次检查版本')).toBeInTheDocument();
    expect(screen.queryByText('已是最新')).not.toBeInTheDocument();
  });

  it('shows a notice when a manual check finds no update', async () => {
    const checkYtDlpUpdate = vi.fn(async () => status());
    renderView({ checkYtDlpUpdate });

    await waitFor(() => expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已经是最新版本'));
    expect(checkYtDlpUpdate).toHaveBeenCalledWith(true);
  });

  it('recovers the failed status after a successful manual retry', async () => {
    const checkYtDlpUpdate = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValue(status());
    renderView({ checkYtDlpUpdate });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText('失败')).toHaveAttribute('data-status', 'failed'));
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(screen.getByText('已就绪')).toHaveAttribute('data-status', 'current'));
    expect(screen.queryByText('检查失败')).not.toBeInTheDocument();
    expect(checkYtDlpUpdate).toHaveBeenCalledTimes(2);
  });

  it('shows readiness in the main badge and the latest status next to the version', async () => {
    renderView({ ytDlpStatus: status({ latestVersion: '2026.08.29.232711' }) });

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await screen.findByText('已是最新');
    await waitFor(() => expect(screen.getByText('已就绪')).toHaveAttribute('data-status', 'current'));
    expect(screen.getByText('已是最新').closest('.runtime-component-details')).not.toBeNull();
    expect(screen.getByText('已是最新').closest('.runtime-component-title')).toBeNull();
  });
});

function renderView(patch: Partial<RuntimeDependenciesController>, language: 'zh-CN' | 'en-US' = 'zh-CN') {
  const controller = {
    ytDlpStatus: status(),
    phase: 'idle',
    checkYtDlpUpdate: vi.fn(async () => status()),
    updateYtDlp: vi.fn(async () => status()),
    ...patch
  } as RuntimeDependenciesController;
  return render(
    <LanguageProvider initialPreference={language}>
      <RuntimeComponentsSettingsView connected controller={controller} />
    </LanguageProvider>
  );
}

function status(patch: Partial<CreatorYtDlpStatus> = {}): CreatorYtDlpStatus {
  return {
    channel: 'nightly',
    source: 'bundled',
    currentVersion: '2026.08.29.232711',
    bundledVersion: '2026.08.29.232711',
    latestVersion: null,
    updateAvailable: false,
    checkDue: false,
    lastCheckedAt: null,
    lastCheckAttemptAt: null,
    installedAt: null,
    ...patch
  };
}
