import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import type { DesktopLogger } from './logger.js';

export type DesktopUpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'preparing_install'
  | 'installing'
  | 'error';

type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade?: boolean;
  channel?: string | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
};

export type DesktopUpdaterController = {
  dispose(): void;
  checkNow(): Promise<void>;
  getState(): DesktopUpdaterState;
};

export function startUpdater(input: {
  logger: DesktopLogger;
  isPackaged?: boolean;
  updater?: UpdaterLike;
  showMessageBox?: typeof dialog.showMessageBox;
  prepareInstall?(): Promise<void>;
  recoverAfterInstallFailure?(): Promise<void>;
  setAllowQuit?(allowed: boolean): void;
  platform?: NodeJS.Platform;
  arch?: string;
}): DesktopUpdaterController {
  const updater = input.updater ?? electronUpdater.autoUpdater;
  const isPackaged = input.isPackaged ?? app.isPackaged;
  let state: DesktopUpdaterState = 'idle';
  let disposed = false;
  let activeOperation: Promise<void> | undefined;
  let recoveryWork: Promise<void> | undefined;
  const showMessageBox = input.showMessageBox
    ?? ((options: Electron.MessageBoxOptions) => dialog.showMessageBox(options));

  if (!isPackaged) {
    return {
      dispose() {},
      checkNow: async () => undefined,
      getState: () => state
    };
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  if (
    (input.platform ?? process.platform) === 'darwin'
    && (input.arch ?? process.arch) === 'x64'
  ) {
    updater.channel = 'latest-x64';
    updater.allowDowngrade = false;
  }

  const fail = async (
    context: string,
    error: unknown,
    recoverRuntime = false
  ) => {
    state = 'error';
    input.logger.warn(context, {
      message: error instanceof Error ? error.message : String(error)
    });
    input.setAllowQuit?.(false);
    if (recoverRuntime && input.recoverAfterInstallFailure !== undefined) {
      recoveryWork ??= input.recoverAfterInstallFailure()
        .catch(recoveryError => {
          input.logger.error('Desktop update recovery failed', {
            message: recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError)
          });
        })
        .finally(() => {
          recoveryWork = undefined;
        });
      await recoveryWork;
    }
  };

  const onError = (error: Error) => {
    const needsRecovery = state === 'preparing_install' || state === 'installing';
    if (needsRecovery) {
      void fail('Desktop updater emitted an install error', error, true);
    } else {
      state = 'error';
      input.logger.warn('Desktop update operation failed', {
        message: error.message
      });
    }
  };
  const onNotAvailable = () => {
    if (state === 'checking') state = 'idle';
  };
  const onAvailable = (info: { version: string }) => {
    if (disposed || state === 'downloading' || state === 'installing') return;
    state = 'available';
    activeOperation = (async () => {
      try {
        const choice = await showMessageBox({
          type: 'info',
          title: 'OpenCreator 更新',
          message: `发现 OpenCreator ${info.version}`,
          detail: '可以在后台下载更新，当前任务不会被中断。',
          buttons: ['下载更新', '稍后'],
          defaultId: 0,
          cancelId: 1
        });
        if (choice.response !== 0 || disposed) return;
        state = 'downloading';
        await updater.downloadUpdate();
      } catch (error) {
        await fail('Desktop update download failed', error);
      }
    })().finally(() => {
      activeOperation = undefined;
    });
  };
  const onDownloaded = (info: { version: string }) => {
    if (disposed) return;
    state = 'downloaded';
    activeOperation = (async () => {
      try {
        const choice = await showMessageBox({
          type: 'info',
          title: '更新已下载',
          message: `OpenCreator ${info.version} 已准备好`,
          detail: '退出并安装会关闭当前本地运行服务，请确认没有需要继续运行的任务。',
          buttons: ['退出并安装', '稍后'],
          defaultId: 1,
          cancelId: 1
        });
        if (choice.response !== 0 || disposed) return;
        state = 'preparing_install';
        await input.prepareInstall?.();
        input.setAllowQuit?.(true);
        state = 'installing';
        updater.quitAndInstall(false, true);
      } catch (error) {
        await fail('Desktop update install preparation failed', error, true);
      }
    })().finally(() => {
      activeOperation = undefined;
    });
  };

  updater.on('error', onError);
  updater.on('update-not-available', onNotAvailable);
  updater.on('update-available', onAvailable);
  updater.on('update-downloaded', onDownloaded);

  const checkNow = async () => {
    if (
      disposed
      || activeOperation !== undefined
      || !['idle', 'error'].includes(state)
      || state === 'installing'
      || state === 'preparing_install'
    ) {
      return;
    }
    state = 'checking';
    try {
      await updater.checkForUpdates();
    } catch (error) {
      await fail('Desktop update request failed', error);
    }
  };
  void checkNow();
  const timer = setInterval(() => void checkNow(), 6 * 60 * 60 * 1_000);
  timer.unref();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      updater.removeListener('error', onError);
      updater.removeListener('update-not-available', onNotAvailable);
      updater.removeListener('update-available', onAvailable);
      updater.removeListener('update-downloaded', onDownloaded);
    },
    checkNow,
    getState: () => state
  };
}
