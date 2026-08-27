import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { startUpdater } from '../src/main/updater.js';
import type { DesktopLogger } from '../src/main/logger.js';

describe('Desktop updater', () => {
  it('uses a separate update channel for Intel macOS releases', () => {
    const updater = new FakeUpdater();
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater,
      platform: 'darwin',
      arch: 'x64'
    });

    expect(updater.channel).toBe('latest-x64');
    expect(updater.allowDowngrade).toBe(false);
    controller.dispose();
  });

  it('captures download failures without an unhandled rejection', async () => {
    const updater = new FakeUpdater();
    updater.downloadUpdate = vi.fn(async () => {
      throw new Error('download failed');
    });
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater,
      showMessageBox: vi.fn(async () => ({
        response: 0,
        checkboxChecked: false
      }))
    });

    updater.emit('update-available', { version: '1.2.3' });
    await vi.waitFor(() => expect(controller.getState()).toBe('error'));
    controller.dispose();
  });

  it('stops runtime state before invoking the installer', async () => {
    const steps: string[] = [];
    const updater = new FakeUpdater();
    updater.quitAndInstall = vi.fn(() => {
      steps.push('install');
    });
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater,
      showMessageBox: vi.fn(async () => ({
        response: 0,
        checkboxChecked: false
      })),
      async prepareInstall() {
        steps.push('prepare');
      },
      setAllowQuit(value) {
        if (value) steps.push('allow-quit');
      }
    });

    updater.emit('update-downloaded', { version: '1.2.3' });
    await vi.waitFor(() => expect(controller.getState()).toBe('installing'));

    expect(steps).toEqual(['prepare', 'allow-quit', 'install']);
    controller.dispose();
  });

  it('recovers the current version when installation preparation fails', async () => {
    const recover = vi.fn(async () => undefined);
    const allowQuit: boolean[] = [];
    const updater = new FakeUpdater();
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater,
      showMessageBox: vi.fn(async () => ({
        response: 0,
        checkboxChecked: false
      })),
      async prepareInstall() {
        throw new Error('flush failed');
      },
      recoverAfterInstallFailure: recover,
      setAllowQuit: value => allowQuit.push(value)
    });

    updater.emit('update-downloaded', { version: '1.2.3' });
    await vi.waitFor(() => expect(recover).toHaveBeenCalledTimes(1));

    expect(controller.getState()).toBe('error');
    expect(allowQuit.at(-1)).toBe(false);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('keeps the current runtime running when the user postpones installation', async () => {
    const prepareInstall = vi.fn(async () => undefined);
    const recover = vi.fn(async () => undefined);
    const updater = new FakeUpdater();
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater,
      showMessageBox: vi.fn(async () => ({
        response: 1,
        checkboxChecked: false
      })),
      prepareInstall,
      recoverAfterInstallFailure: recover
    });

    updater.emit('update-downloaded', { version: '1.2.3' });
    await vi.waitFor(() => expect(controller.getState()).toBe('downloaded'));

    expect(prepareInstall).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('does not restart the runtime when checking for updates fails', async () => {
    const recover = vi.fn(async () => undefined);
    const updater = new FakeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('network unavailable');
    });
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater,
      recoverAfterInstallFailure: recover
    });

    await vi.waitFor(() => expect(controller.getState()).toBe('error'));

    expect(recover).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('removes updater listeners when disposed', () => {
    const updater = new FakeUpdater();
    const controller = startUpdater({
      logger: fakeLogger(),
      isPackaged: true,
      updater
    });

    controller.dispose();

    expect(updater.eventNames()).toEqual([]);
  });
});

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  channel: string | null = null;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

function fakeLogger(): DesktopLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    warnRateLimited: vi.fn(),
    flush: vi.fn(async () => undefined)
  };
}
