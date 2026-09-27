import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveOpenCreatorPaths } from '@opencreator/config';
import {
  app,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron';
import { BootstrapController } from './bootstrap-controller.js';
import { DaemonManager } from './daemon-manager.js';
import {
  startLoginShellEnvironmentRead,
  type LoginShellEnvironmentTask
} from './codex-resolver.js';
import {
  deepLinkToRoute,
  findDeepLink
} from './deep-link-manager.js';
import { exportDesktopDiagnostics } from './diagnostics.js';
import { createDesktopLogger } from './logger.js';
import {
  openExternal,
  revealPath
} from './native-actions.js';
import { NotificationManager } from './notification-manager.js';
import { resolveDesktopUserDataPath } from './runtime-profile.js';
import {
  installProtocolHandler,
  registerPrivilegedSchemes
} from './protocol-handler.js';
import { createSettingsStore } from './settings-store.js';
import {
  startDesktopTelemetry,
  type DesktopTelemetryController
} from './telemetry.js';
import { TrayManager } from './tray-manager.js';
import { startUpdater } from './updater.js';
import { WindowManager } from './window-manager.js';
import { desktopIpc } from '../shared/ipc.js';
import type {
  DesktopHostNotification,
  DesktopHostResult
} from '../shared/types.js';

registerPrivilegedSchemes();
app.setName('OpenCreator');
app.commandLine.appendSwitch('lang', 'zh-CN');
const APP_ENTRY_AT = Date.now();
const DEVELOPMENT =
  process.env.OPENCREATOR_DESKTOP_DEV === '1' || !app.isPackaged;
if (DEVELOPMENT) {
  app.setPath(
    'userData',
    resolveDesktopUserDataPath(app.getPath('userData'), true)
  );
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  void launchDesktop().catch(error => {
    console.error(
      `OpenCreator Desktop failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
    );
    app.exit(1);
  });
}

async function launchDesktop(): Promise<void> {
  const pendingRoutes: string[] = [];
  let windowManager: WindowManager | undefined;
  let bootstrap: BootstrapController | undefined;
  let workspaceLoaded = false;
  let workspaceLoadWork: Promise<void> | undefined;
  let bootstrapSurfaceReady: Promise<void> = Promise.resolve();
  let shutdownStarted = false;
  let allowQuit = false;
  let loginShellTask: LoginShellEnvironmentTask | undefined;

  const queueDeepLink = (value: string | undefined) => {
    if (value === undefined) return;
    const route = deepLinkToRoute(value);
    if (route === undefined) return;
    if (!workspaceLoaded || windowManager === undefined) {
      pendingRoutes.push(route);
      return;
    }
    windowManager.show();
    windowManager.send(desktopIpc.navigate, route);
  };

  app.on('open-url', (event, url) => {
    event.preventDefault();
    queueDeepLink(url);
  });
  app.on('second-instance', (_event, argv) => {
    queueDeepLink(findDeepLink(argv));
    windowManager?.show();
  });

  await app.whenReady();
  const appReadyAt = Date.now();
  const development = DEVELOPMENT;
  const appRoot = app.getAppPath();
  const paths = resolveOpenCreatorPaths({
    homeDir: app.getPath('home'),
    runtimeChannel: development ? 'development' : 'production'
  });
  const dataDir = paths.dataDir;
  const defaultProjectRoot = process.env.OPENCREATOR_DEFAULT_PROJECT_ROOT
    ?? app.getPath('documents');
  const logDir = paths.logsDir;
  const logger = createDesktopLogger(join(logDir, 'desktop-main.log'));
  const settings = createSettingsStore(paths.configFile);
  const daemon = new DaemonManager(logger);
  const tray = new TrayManager();
  const daemonEntryPath = development
    ? resolve(appRoot, '../daemon/dist/main.js')
    : join(process.resourcesPath, 'daemon', 'dist', 'main.js');
  const webRoot = development
    ? resolve(appRoot, '../web/dist')
    : join(process.resourcesPath, 'web');
  const bootstrapRoot = join(appRoot, 'dist', 'bootstrap');
  const preloadPath = join(appRoot, 'dist', 'preload', 'index.cjs');
  const resourceRoot = development
    ? join(appRoot, 'resources')
    : join(process.resourcesPath, 'desktop-resources');
  const creatorRuntimeRoot = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT
    ?? (development
      ? join(appRoot, '.pack', 'creator-runtime', 'krillinai')
      : join(process.resourcesPath, 'creator-runtime', 'krillinai'));
  const codexRuntimeRoot = process.env.OPENCREATOR_CODEX_RUNTIME_ROOT
    ?? (development
      ? join(appRoot, '.pack', 'codex-runtime')
      : join(process.resourcesPath, 'codex-runtime'));
  const stickmanRuntimeRoot = process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT
    ?? (development
      ? join(appRoot, '.pack', 'stickman-runtime')
      : join(process.resourcesPath, 'stickman-runtime'));

  logger.info('OpenCreator Desktop starting', {
    development,
    appRoot,
    dataDir,
    daemonEntryPath
  });

  bootstrap = new BootstrapController({
    daemon,
    settings,
    logger,
    daemonEntryPath,
    appHome: paths.root,
    dataDir,
    codexRuntimeRoot,
    creatorRuntimeRoot,
    stickmanRuntimeRoot,
    defaultProjectRoot,
    development
  });
  windowManager = new WindowManager({
    preloadPath,
    settings,
    development,
    appEntryAt: APP_ENTRY_AT,
    workspaceReadyTimeoutMs: parsePositiveInteger(
      process.env.OPENCREATOR_E2E_WORKSPACE_READY_TIMEOUT_MS
    ),
    requestQuit: () => app.quit()
  });
  const telemetry = startDesktopTelemetry({
    path: join(dataDir, 'desktop-telemetry.json'),
    settings,
    logger,
    appVersion: app.getVersion(),
    isOfficialBuild: app.isPackaged && readOfficialBuildMarker(process.resourcesPath),
    isWindowActive: () => windowManager?.isActive() === true,
    endpointOverride: process.env.OPENCREATOR_TELEMETRY_URL
  });
  const navigate = (route: string) => {
    if (!workspaceLoaded) {
      pendingRoutes.push(route);
      return;
    }
    windowManager?.show();
    windowManager?.send(desktopIpc.navigate, route);
  };
  const notifications = new NotificationManager({
    getConnection: () => daemon.currentConnection,
    settings,
    logger,
    navigate
  });
  const loadWorkspace = (): Promise<void> => {
    if (workspaceLoadWork !== undefined) return workspaceLoadWork;
    workspaceLoadWork = (async () => {
      workspaceLoaded = false;
      try {
        await bootstrapSurfaceReady;
        await windowManager?.loadWorkspace();
        workspaceLoaded = true;
        bootstrap?.markWorkspaceReady();
        logger.info('OpenCreator workspace ready', {
          durationMs: Date.now() - APP_ENTRY_AT
        });
        windowManager?.show();
        for (const route of pendingRoutes.splice(0)) {
          windowManager?.send(desktopIpc.navigate, route);
        }
        notifications.start();
      } catch (error) {
        logger.error('Failed to load the OpenCreator workspace', {
          message: error instanceof Error ? error.message : String(error)
        });
        bootstrap?.markWorkspaceFailed(error);
        await windowManager?.loadBootstrap();
      }
    })().finally(() => {
      workspaceLoadWork = undefined;
    });
    return workspaceLoadWork;
  };

  await installProtocolHandler({
    webRoot,
    bootstrapRoot,
    getConnection: () => daemon.currentConnection,
    logger
  });
  registerIpcHandlers({
    development,
    bootstrap,
    daemon,
    notifications,
    windowManager,
    settings,
    telemetry,
    dataDir,
    logDir,
    quit: () => app.quit(),
    reloadWorkspace: loadWorkspace
  });
  registerWorkspaceReadyListener({
    development,
    windowManager,
    ignoreFirstReady:
      process.env.OPENCREATOR_E2E_IGNORE_FIRST_WORKSPACE_READY === '1'
  });

  bootstrap.on('state', state => {
    windowManager?.send(desktopIpc.bootstrapChanged, state);
  });
  bootstrap.on('connection', connection => {
    windowManager?.send(desktopIpc.connectionChanged, connection);
  });
  bootstrap.on('ready', () => {
    void loadWorkspace();
  });

  bootstrapSurfaceReady = windowManager.loadBootstrap();
  loginShellTask = startLoginShellEnvironmentRead({
    timeoutMs: 5_000
  });
  void bootstrap.start(undefined, loginShellTask);
  await bootstrapSurfaceReady;
  bootstrap.setStartupMetrics({
    ...windowManager.metrics,
    appReadyAt
  });
  const trayIconName = process.platform === 'darwin'
    ? 'tray.png'
    : process.platform === 'win32'
      ? 'icon-win.png'
      : 'icon.png';
  tray.create({
    iconPath: join(resourceRoot, trayIconName),
    open: () => windowManager?.show(),
    navigate,
    quit: () => app.quit()
  });
  registerApplicationProtocol(development, appRoot, logger);
  const updater = startUpdater({
    logger,
    async prepareInstall() {
      notifications.stop();
      windowManager?.flushState();
      settings.flush();
      await telemetry.reportNow();
      await logger.flush();
      await bootstrap?.stop();
    },
    async recoverAfterInstallFailure() {
      await bootstrap?.restartRuntime();
      notifications.start();
    },
    setAllowQuit(value) {
      allowQuit = value;
    }
  });
  queueDeepLink(findDeepLink(process.argv));
  app.on('activate', () => windowManager?.show());
  app.on('window-all-closed', () => {
    // The tray and Runtime intentionally remain active.
  });
  app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    windowManager?.beginQuit();
    notifications.stop();
    updater.dispose();
    tray.destroy();
    void Promise.all([
      telemetry.stop(),
      bootstrap?.stop() ?? Promise.resolve(),
      loginShellTask?.cancel() ?? Promise.resolve()
    ])
      .catch(error => {
        logger.error('Desktop shutdown failed', {
          message: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        void logger.flush().finally(() => {
          allowQuit = true;
          app.quit();
        });
      });
  });
}

function readOfficialBuildMarker(resourcesPath: string): boolean {
  try {
    const profile = JSON.parse(
      readFileSync(join(resourcesPath, 'desktop-build-profile.json'), 'utf8')
    ) as unknown;
    return isRecord(profile) && profile.officialBuild === true;
  } catch {
    return false;
  }
}

function registerIpcHandlers(input: {
  development: boolean;
  bootstrap: BootstrapController;
  daemon: DaemonManager;
  notifications: NotificationManager;
  windowManager: WindowManager;
  settings: ReturnType<typeof createSettingsStore>;
  telemetry: DesktopTelemetryController;
  dataDir: string;
  logDir: string;
  quit(): void;
  reloadWorkspace(): Promise<void>;
}): void {
  handle(desktopIpc.readAppVersion, input.development, () => app.getVersion());
  handle(desktopIpc.readConnection, input.development, () =>
    input.bootstrap.rendererConnection());
  handle(desktopIpc.readBootstrap, input.development, () =>
    input.bootstrap.currentState);
  handle(desktopIpc.bootstrapRetry, input.development, async () => {
    await input.daemon.stop();
    await input.bootstrap.start();
    return ok();
  });
  handle(desktopIpc.selectCodex, input.development, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Codex 或 ChatGPT',
      message: '可直接选择 ChatGPT.app、Codex.app，或 codex 可执行文件',
      buttonLabel: '使用所选项目',
      properties: ['openFile']
    });
    const path = result.filePaths[0];
    if (result.canceled || path === undefined) {
      return failed('已取消选择');
    }
    await input.bootstrap.selectCodexPath(path);
    return input.bootstrap.currentState.phase === 'ready'
      ? ok()
      : failed(input.bootstrap.currentState.error?.message ?? 'Codex 检测失败');
  });
  handle(desktopIpc.selectProjectDirectory, input.development, async (_event, purpose: unknown) => {
    const labels = purpose === 'default-project-root'
      ? { title: '选择默认项目位置', buttonLabel: '使用此位置' }
      : purpose === 'output-root'
        ? { title: '选择完成产物位置', buttonLabel: '使用此位置' }
        : { title: '添加项目文件夹', buttonLabel: '添加项目' };
    const result = await dialog.showOpenDialog({
      ...labels,
      properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
  handle(desktopIpc.restartRuntime, input.development, async () => {
    await input.bootstrap.restartRuntime();
    return ok();
  });
  handle(desktopIpc.reloadWorkspace, input.development, async () => {
    await input.reloadWorkspace();
    return input.bootstrap.currentState.phase === 'ready'
      ? ok()
      : failed(input.bootstrap.currentState.error?.message ?? 'Dashboard 加载失败');
  });
  handle(desktopIpc.readPreferences, input.development, () => ({
    closeBehavior: input.settings.read().closeBehavior,
    telemetryEnabled: input.settings.read().telemetryEnabled
  }));
  handle(desktopIpc.updatePreferences, input.development, (_event, value: unknown) => {
    if (
      !isRecord(value)
      || (
        value.closeBehavior !== undefined
        && value.closeBehavior !== 'hide'
        && value.closeBehavior !== 'quit'
      )
      || (
        value.telemetryEnabled !== undefined
        && typeof value.telemetryEnabled !== 'boolean'
      )
    ) {
      throw new Error('Desktop preferences are invalid');
    }
    const updated = input.settings.update({
      ...(value.closeBehavior === undefined
        ? {}
        : { closeBehavior: value.closeBehavior }),
      ...(value.telemetryEnabled === undefined
        ? {}
        : { telemetryEnabled: value.telemetryEnabled })
    });
    if (value.telemetryEnabled === true) void input.telemetry.enable();
    return {
      closeBehavior: updated.closeBehavior,
      telemetryEnabled: updated.telemetryEnabled
    };
  });
  handle(desktopIpc.setWindowColorMode, input.development, (_event, mode: unknown) => {
    if (process.platform !== 'darwin' || (mode !== 'light' && mode !== 'dark')) {
      throw new Error('Invalid macOS window color mode');
    }
    input.windowManager.setColorMode(mode);
  });
  handle(desktopIpc.controlWindow, input.development, (_event, action: unknown) => {
    if (process.platform !== 'darwin' || (action !== 'close' && action !== 'minimize' && action !== 'zoom')) {
      throw new Error('Invalid macOS window action');
    }
    input.windowManager.controlWindow(action as 'close' | 'minimize' | 'zoom');
  });
  handle(desktopIpc.openExternal, input.development, async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('URL must be a string');
    await openExternal(url);
  });
  handle(desktopIpc.revealPath, input.development, async (_event, path: unknown) => {
    if (typeof path !== 'string') return failed('路径必须是字符串');
    return await revealPath(path);
  });
  handle(desktopIpc.notify, input.development, (_event, message: unknown) => {
    const parsed = parseNotification(message);
    if (parsed === undefined) throw new Error('Invalid notification payload');
    input.notifications.show(parsed);
  });
  handle(desktopIpc.configureNotifications, input.development, (_event, configuration: unknown) => {
    if (!isRecord(configuration) || typeof configuration.enabled !== 'boolean') {
      return failed('通知配置无效');
    }
    input.notifications.configure(configuration.enabled);
    return ok();
  });
  handle(desktopIpc.exportDiagnostics, input.development, () =>
    exportDesktopDiagnostics({
      state: input.bootstrap.currentState,
      dataDir: input.dataDir,
      logDir: input.logDir,
      daemonPid: input.daemon.pid
    }));
  handle(desktopIpc.quit, input.development, () => input.quit());
}

function registerWorkspaceReadyListener(input: {
  development: boolean;
  windowManager: WindowManager;
  ignoreFirstReady: boolean;
}): void {
  let ignoreNext = input.ignoreFirstReady;
  ipcMain.removeAllListeners(desktopIpc.workspaceReady);
  ipcMain.on(desktopIpc.workspaceReady, (event: IpcMainEvent) => {
    assertTrustedWorkspaceSender(event, input.development);
    if (ignoreNext) {
      ignoreNext = false;
      return;
    }
    input.windowManager.confirmWorkspaceReady(
      event.sender.id,
      event.senderFrame?.url ?? ''
    );
  });
}

function handle(
  channel: string,
  development: boolean,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, development);
    return handler(event, ...args);
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent, development: boolean): void {
  const value = event.senderFrame?.url ?? '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('IPC sender URL is invalid');
  }
  if (
    url.protocol === 'opencreator-app:'
    && (url.hostname === 'app' || url.hostname === 'bootstrap')
  ) {
    return;
  }
  if (
    development
    && url.protocol === 'http:'
    && url.hostname === '127.0.0.1'
    && url.port === '19861'
  ) {
    return;
  }
  throw new Error(`IPC sender is not trusted: ${value}`);
}

function assertTrustedWorkspaceSender(
  event: IpcMainEvent,
  development: boolean
): void {
  const value = event.senderFrame?.url ?? '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Workspace IPC sender URL is invalid');
  }
  if (url.protocol === 'opencreator-app:' && url.hostname === 'app') return;
  if (
    development
    && url.protocol === 'http:'
    && url.hostname === '127.0.0.1'
    && url.port === '19861'
  ) {
    return;
  }
  throw new Error(`Workspace IPC sender is not trusted: ${value}`);
}

function parseNotification(value: unknown): DesktopHostNotification | undefined {
  if (
    !isRecord(value)
    || typeof value.title !== 'string'
    || typeof value.body !== 'string'
  ) {
    return undefined;
  }
  return {
    title: value.title,
    body: value.body,
    ...(typeof value.threadId === 'string' ? { threadId: value.threadId } : {}),
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value.approvalId === 'string' ? { approvalId: value.approvalId } : {})
  };
}

function registerApplicationProtocol(
  development: boolean,
  appRoot: string,
  logger: ReturnType<typeof createDesktopLogger>
): void {
  const result = development
    ? app.setAsDefaultProtocolClient('opencreator', process.execPath, [appRoot])
    : app.setAsDefaultProtocolClient('opencreator');
  if (!result) logger.warn('Failed to register opencreator:// protocol');
}

function ok(): DesktopHostResult {
  return { ok: true };
}

function failed(message: string): DesktopHostResult {
  return { ok: false, code: 'FAILED', message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
