import type { CreatorYtDlpStatus } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { RuntimeComponentsSettingsView } from './RuntimeComponentsSettingsView.js';

describe('RuntimeComponentsSettingsView', () => {
  it('shows yt-dlp versions, source, schedule, and installs an available update', async () => {
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

    expect(screen.getByRole('heading', { name: '本机组件' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'yt-dlp nightly' })).toBeInTheDocument();
    expect(screen.getAllByText('2026.08.29.232711')).toHaveLength(2);
    expect(screen.getByText('内置版本')).toBeInTheDocument();
    expect(screen.getByText('每 7 天自动检查更新，不会自动安装。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {
      name: '更新到 2026.08.31.120000'
    }));

    await waitFor(() => expect(updateYtDlp).toHaveBeenCalledOnce());
  });

  it('keeps the current version active when update verification fails', () => {
    renderView({
      ytDlpStatus: status({
        latestVersion: '2026.08.31.120000',
        updateAvailable: true
      }),
      error: 'creator_yt_dlp_update_verification_failed'
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'yt-dlp 更新校验失败，当前版本仍可继续使用。'
    );
    expect(screen.getByText('更新失败时，OpenCreator 会继续使用当前可用版本。'))
      .toBeInTheDocument();
  });
});

function renderView(patch: Partial<RuntimeDependenciesController>) {
  const controller = {
    ytDlpStatus: status(),
    phase: 'idle',
    checkYtDlpUpdate: vi.fn(async () => status()),
    updateYtDlp: vi.fn(async () => status()),
    ...patch
  } as RuntimeDependenciesController;
  return render(
    <LanguageProvider initialPreference="zh-CN">
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
