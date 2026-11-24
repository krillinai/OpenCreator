import type { CreatorRuntimeComponentsResponse, CreatorYtDlpStatus } from '@opencreator/protocol';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../runtime/client.js';
import type { RuntimeDependencyService } from '../services/runtime-dependency-service.js';
import { useRuntimeDependencies } from './use-runtime-dependencies.js';

describe('useRuntimeDependencies', () => {
  it('forwards a component download independently of the selected transcription provider', async () => {
    const componentsStatus: CreatorRuntimeComponentsResponse = {
      platform: 'darwin', arch: 'arm64', selectedProvider: 'openai', selectedModel: null, components: []
    };
    const service: RuntimeDependencyService = {
      getOmniVoiceComponent: vi.fn(), downloadOmniVoiceComponent: vi.fn(),
      getComponentsStatus: vi.fn(async () => componentsStatus),
      downloadComponents: vi.fn(async () => componentsStatus),
      getYtDlpStatus: vi.fn(async () => ({ ytDlp: status() })),
      checkYtDlpUpdate: vi.fn(), updateYtDlp: vi.fn()
    };
    const { result } = renderHook(() => useRuntimeDependencies({ connected: true, service }));
    await waitFor(() => expect(result.current.componentsStatus).toEqual(componentsStatus));

    await act(async () => { await result.current.downloadComponents?.('whisperkit'); });

    expect(service.downloadComponents).toHaveBeenCalledWith('whisperkit');
    expect(result.current.componentsStatus?.selectedProvider).toBe('openai');
  });

  it('only reads the current status on connection even when a release check is due', async () => {
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
      getOmniVoiceComponent: vi.fn(), downloadOmniVoiceComponent: vi.fn(),
      getComponentsStatus: vi.fn(), downloadComponents: vi.fn(),
      getYtDlpStatus,
      checkYtDlpUpdate,
      updateYtDlp: vi.fn()
    } as RuntimeDependencyService;

    const { result } = renderHook(() => useRuntimeDependencies({
      connected: true,
      service
    }));

    await waitFor(() => expect(result.current.ytDlpStatus).toMatchObject({ checkDue: true }));
    expect(getYtDlpStatus).toHaveBeenCalledOnce();
    expect(checkYtDlpUpdate).not.toHaveBeenCalled();
    expect(service.updateYtDlp).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
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
      getOmniVoiceComponent: vi.fn(), downloadOmniVoiceComponent: vi.fn(),
      getComponentsStatus: vi.fn(), downloadComponents: vi.fn(),
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

  it('reflects an activated background update using only local status reads', async () => {
    vi.useFakeTimers();
    try {
      const latestVersion = '2026.08.31.120000';
      const getYtDlpStatus = vi.fn()
        .mockResolvedValueOnce({ ytDlp: status() })
        .mockResolvedValue({ ytDlp: status({ source: 'managed', currentVersion: latestVersion, latestVersion }) });
      const service: RuntimeDependencyService = {
        getOmniVoiceComponent: vi.fn(), downloadOmniVoiceComponent: vi.fn(),
        getComponentsStatus: vi.fn(async () => ({ platform: 'darwin', arch: 'arm64', selectedProvider: 'openai', selectedModel: null, components: [] })),
        downloadComponents: vi.fn(), getYtDlpStatus, checkYtDlpUpdate: vi.fn(), updateYtDlp: vi.fn()
      };
      const { result } = renderHook(() => useRuntimeDependencies({ connected: true, service }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.ytDlpStatus?.source).toBe('bundled');

      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      expect(result.current.ytDlpStatus).toMatchObject({ source: 'managed', currentVersion: latestVersion });
      expect(result.current.phase).toBe('idle');
      expect(result.current.issues).toHaveLength(0);
      expect(service.checkYtDlpUpdate).not.toHaveBeenCalled();
      expect(service.updateYtDlp).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
      getOmniVoiceComponent: vi.fn(), downloadOmniVoiceComponent: vi.fn(),
      getComponentsStatus: vi.fn(), downloadComponents: vi.fn(),
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
      fallbackMessage: 'Runtime component update failed. Check the network and disk space before retrying.'
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
