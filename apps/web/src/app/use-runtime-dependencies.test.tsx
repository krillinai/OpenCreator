import type { CreatorYtDlpStatus } from '@opencreator/protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
