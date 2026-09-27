import type { CreatorYtDlpStatus } from '@opencreator/protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../runtime/client.js';
import type { RuntimeDependencyService } from '../services/runtime-dependency-service.js';
import { useRuntimeDependencies } from './use-runtime-dependencies.js';

describe('useRuntimeDependencies', () => {
  it('checks yt-dlp once the Runtime connects and the saved interval is due', async () => {
    const getYtDlpStatus = vi.fn(async () => ({
      ytDlp: status({ checkDue: true })
    }));
    const checkYtDlpUpdate = vi.fn(async () => ({
      ytDlp: status({
        checkDue: false,
        latestVersion: '2026.08.31.120000',
        updateAvailable: true,
        lastCheckedAt: '2026-08-31T00:00:00.000Z'
      })
    }));
    const service = {
      getYtDlpStatus,
      checkYtDlpUpdate,
      updateYtDlp: vi.fn()
    } as RuntimeDependencyService;

    const { result } = renderHook(() => useRuntimeDependencies({
      connected: true,
      service
    }));

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(getYtDlpStatus).toHaveBeenCalledOnce();
    expect(checkYtDlpUpdate).toHaveBeenCalledWith(false);
    expect(result.current.ytDlpStatus?.updateAvailable).toBe(true);
  });

  it('shares the status returned by a manual update', async () => {
    const updateYtDlp = vi.fn(async () => ({
      ytDlp: status({
        source: 'managed',
        currentVersion: '2026.08.31.120000',
        latestVersion: '2026.08.31.120000'
      })
    }));
    const service = {
      getYtDlpStatus: vi.fn(async () => ({ ytDlp: status() })),
      checkYtDlpUpdate: vi.fn(),
      updateYtDlp
    } as RuntimeDependencyService;
    const { result } = renderHook(() => useRuntimeDependencies({
      connected: true,
      service
    }));
    await waitFor(() => expect(result.current.ytDlpStatus).toBeDefined());

    await act(async () => {
      await result.current.updateYtDlp();
    });

    expect(updateYtDlp).toHaveBeenCalledOnce();
    expect(result.current.ytDlpStatus?.source).toBe('managed');
    expect(result.current.ytDlpStatus?.currentVersion).toBe('2026.08.31.120000');
  });

  it('preserves the Runtime error code used for localized update feedback', async () => {
    const updateYtDlp = vi.fn(async () => {
      throw new ApiClientError({
        status: 502,
        code: 'creator_yt_dlp_update_download_failed',
        message: 'Unable to download the yt-dlp update'
      });
    });
    const service = {
      getYtDlpStatus: vi.fn(async () => ({ ytDlp: status() })),
      checkYtDlpUpdate: vi.fn(),
      updateYtDlp
    } as RuntimeDependencyService;
    const { result } = renderHook(() => useRuntimeDependencies({
      connected: true,
      service
    }));
    await waitFor(() => expect(result.current.ytDlpStatus).toBeDefined());

    await act(async () => {
      await result.current.updateYtDlp().catch(() => undefined);
    });

    expect(result.current.error).toBeUndefined();
    expect(result.current.issues).toHaveLength(1);
    expect(result.current.issues?.[0]).toMatchObject({
      code: 'creator_yt_dlp_update_download_failed',
      operation: 'runtime.update-yt-dlp',
      fallbackMessage: '运行组件更新失败，请检查网络和磁盘空间后重试。'
    });
    expect(result.current.issues?.[0]?.diagnosticId).toMatch(/^OC-/);
  });
});

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
