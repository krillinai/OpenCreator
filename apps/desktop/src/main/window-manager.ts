import { join } from 'node:path';
import {
  BrowserWindow,
  nativeTheme,
  screen,
  shell
} from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import type { SettingsStore } from './settings-store.js';
import {
  DESKTOP_TITLE_BAR_HEIGHT,
  type DesktopWindowAction,
  type DesktopWindowColorMode,
  type DesktopStartupMetrics
} from '../shared/types.js';

const WORKSPACE_READY_TIMEOUT_MS = 10_000;

export class WorkspaceLoadError extends Error {
  constructor(
    readonly code: 'WORKSPACE_LOAD_FAILED' | 'WORKSPACE_READY_TIMEOUT' | 'WORKSPACE_RENDERER_GONE',
    message: string
  ) {
    super(message);
    this.name = 'WorkspaceLoadError';
  }
}

export class DebouncedWindowStateWriter {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly write: () => void,
    private readonly delayMs = 300
  ) {}

  schedule(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.write();
    }, this.delayMs);
    this.timer.unref();
  }

  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.write();
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export class WindowManager {
  private window: BrowserWindow | undefined;
  private colorMode: DesktopWindowColorMode = 'dark';
  private quitting = false;
  private workspaceReady:
    | {
        resolve(): void;
        reject(error: Error): void;
        timeout: NodeJS.Timeout;
      }
    | undefined;
  private readonly startupMetrics: DesktopStartupMetrics;
  private windowStateWriter: DebouncedWindowStateWriter | undefined;

  constructor(private readonly input: {
    preloadPath: string;
    settings: SettingsStore;
    development: boolean;
    appEntryAt: number;
    workspaceReadyTimeoutMs?: number;
    requestQuit(): void;
  }) {
    this.startupMetrics = {
      appEntryAt: input.appEntryAt
    };
  }

  get metrics(): DesktopStartupMetrics {
    return { ...this.startupMetrics };
  }

  create(): BrowserWindow {
    if (this.window !== undefined && !this.window.isDestroyed()) return this.window;
    if (process.platform === 'darwin') nativeTheme.themeSource = this.colorMode;
    const settings = this.input.settings.read();
    const bounds = visibleBounds(settings.window);
    const window = new BrowserWindow({
      ...bounds,
      ...nativeWindowChromeOptions(process.platform),
      minWidth: 980,
      minHeight: 680,
      show: false,
      backgroundColor: nativeWindowBackgroundColor(this.colorMode),
      title: 'OpenCreator',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: this.input.preloadPath
      }
    });
    window.setContentSize(bounds.width, bounds.height);
    if (process.platform === 'darwin') window.setWindowButtonVisibility(false);
    this.startupMetrics.windowCreatedAt ??= Date.now();
    this.window = window;
    let normalBounds = contentWindowBounds(window);
    if (settings.window?.maximized === true) window.maximize();
    window.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['https://www.youtube-nocookie.com/embed/*'] },
      (details, callback) => {
        callback({ requestHeaders: details.webContentsId === window.webContents.id
          && window.webContents.getURL().startsWith('opencreator-app://app/')
          ? youtubeEmbedRequestHeaders(details)
          : details.requestHeaders });
      }
    );
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (isInternalWindowUrl(url, this.input.development)) return;
      event.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.on('close', event => {
      if (this.quitting) return;
      event.preventDefault();
      this.windowStateWriter?.flush();
      if (this.input.settings.read().closeBehavior === 'quit') {
        this.input.requestQuit();
        return;
      }
      window.hide();
    });
    window.on('closed', () => {
      this.windowStateWriter?.cancel();
      this.windowStateWriter = undefined;
      this.window = undefined;
    });
    const saveBounds = () => {
      if (window.isDestroyed() || window.isMinimized()) return;
      if (!window.isMaximized()) normalBounds = contentWindowBounds(window);
      this.input.settings.update({
        window: {
          ...normalBounds,
          maximized: window.isMaximized()
        }
      });
    };
    this.windowStateWriter = new DebouncedWindowStateWriter(saveBounds);
    const scheduleWindowStateWrite = () => {
      if (!window.isMaximized() && !window.isMinimized()) {
        normalBounds = contentWindowBounds(window);
      }
      this.windowStateWriter?.schedule();
    };
    window.on('resize', scheduleWindowStateWrite);
    window.on('move', scheduleWindowStateWrite);
    window.on('hide', () => this.windowStateWriter?.flush());
    return window;
  }

  async loadBootstrap(): Promise<void> {
    this.cancelWorkspaceLoad(new WorkspaceLoadError(
      'WORKSPACE_LOAD_FAILED',
      'Workspace load was replaced by the local bootstrap page'
    ));
    const window = this.create();
    const onDomReady = () => {
      this.startupMetrics.bootstrapDomReadyAt ??= Date.now();
      if (!window.isVisible()) window.show();
    };
    const onFinish = () => {
      this.startupMetrics.bootstrapDidFinishLoadAt ??= Date.now();
    };
    window.webContents.once('dom-ready', onDomReady);
    window.webContents.once('did-finish-load', onFinish);
    try {
      await window.loadURL('opencreator-app://bootstrap/index.html');
    } finally {
      window.webContents.removeListener('dom-ready', onDomReady);
      window.webContents.removeListener('did-finish-load', onFinish);
    }
    if (!window.isVisible()) window.show();
  }

  async loadWorkspace(
    timeoutMs = this.input.workspaceReadyTimeoutMs ?? WORKSPACE_READY_TIMEOUT_MS
  ): Promise<void> {
    const window = this.create();
    this.cancelWorkspaceLoad(new WorkspaceLoadError(
      'WORKSPACE_LOAD_FAILED',
      'Workspace load was superseded'
    ));
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new WorkspaceLoadError(
          'WORKSPACE_READY_TIMEOUT',
          `Workspace Renderer did not become ready within ${timeoutMs}ms`
        ));
      }, timeoutMs);
      this.workspaceReady = { resolve, reject, timeout };
    });
    const failLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean
    ) => {
      if (!isMainFrame) return;
      this.workspaceReady?.reject(new WorkspaceLoadError(
        'WORKSPACE_LOAD_FAILED',
        `Workspace main frame failed to load (${errorCode}): ${errorDescription}`
      ));
    };
    const rendererGone = (
      _event: Electron.Event,
      details: Electron.RenderProcessGoneDetails
    ) => {
      this.workspaceReady?.reject(new WorkspaceLoadError(
        'WORKSPACE_RENDERER_GONE',
        `Workspace Renderer exited: ${details.reason}`
      ));
    };
    window.webContents.on('did-fail-load', failLoad);
    window.webContents.on('render-process-gone', rendererGone);
    try {
      await Promise.all([
        window.loadURL(this.workspaceUrl()),
        ready
      ]);
    } catch (error) {
      this.cancelWorkspaceLoad(error instanceof Error
        ? error
        : new Error(String(error)));
      throw error;
    } finally {
      window.webContents.removeListener('did-fail-load', failLoad);
      window.webContents.removeListener('render-process-gone', rendererGone);
    }
  }

  confirmWorkspaceReady(senderId: number, senderUrl: string): boolean {
    const window = this.window;
    if (
      window === undefined
      || window.isDestroyed()
      || window.webContents.id !== senderId
      || !isWorkspaceUrl(senderUrl, this.input.development)
    ) {
      return false;
    }
    const pending = this.workspaceReady;
    if (pending === undefined) return true;
    clearTimeout(pending.timeout);
    this.workspaceReady = undefined;
    pending.resolve();
    return true;
  }

  show(): void {
    const window = this.create();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  setColorMode(mode: DesktopWindowColorMode): void {
    if (process.platform !== 'darwin') return;
    this.colorMode = mode;
    nativeTheme.themeSource = mode;
    if (this.window !== undefined && !this.window.isDestroyed()) {
      this.window.setBackgroundColor(nativeWindowBackgroundColor(mode));
    }
  }

  controlWindow(action: DesktopWindowAction): void {
    const window = this.window;
    if (window === undefined || window.isDestroyed()) return;
    applyWindowAction(window, action);
  }

  isActive(): boolean {
    return this.window !== undefined
      && !this.window.isDestroyed()
      && this.window.isVisible()
      && this.window.isFocused();
  }

  send(channel: string, payload: unknown): void {
    if (this.window === undefined || this.window.isDestroyed()) return;
    this.window.webContents.send(channel, payload);
  }

  beginQuit(): void {
    this.quitting = true;
    this.windowStateWriter?.flush();
    this.cancelWorkspaceLoad(new Error('Application is quitting'));
    closeWindowForQuit(this.window);
  }

  flushState(): void {
    this.windowStateWriter?.flush();
  }

  private workspaceUrl(): string {
    return this.input.development
      ? 'http://127.0.0.1:19861'
      : 'opencreator-app://app/index.html';
  }

  private cancelWorkspaceLoad(error: Error): void {
    const pending = this.workspaceReady;
    if (pending === undefined) return;
    clearTimeout(pending.timeout);
    this.workspaceReady = undefined;
    pending.reject(error);
  }
}

export function youtubeEmbedRequestHeaders(details: {
  url: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
}): Record<string, string> {
  if (details.resourceType !== 'subFrame'
    || !/^https:\/\/www\.youtube-nocookie\.com\/embed\/[^/?#]+(?:[?#]|$)/.test(details.url)) {
    return details.requestHeaders;
  }
  // A custom-scheme document cannot supply the HTTP Referer required by YouTube embeds (error 153).
  return { ...details.requestHeaders, Referer: 'https://github.com/krillinai/OpenCreator/' };
}

export function applyWindowAction(
  window: Pick<BrowserWindow, 'close' | 'minimize' | 'isMaximized' | 'maximize' | 'unmaximize'>,
  action: DesktopWindowAction
): void {
  if (action === 'close') window.close();
  else if (action === 'minimize') window.minimize();
  else if (window.isMaximized()) window.unmaximize();
  else window.maximize();
}

export function nativeWindowChromeOptions(
  platform: NodeJS.Platform
): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition'
> {
  if (platform !== 'darwin') return {};
  return {
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {
      x: 12,
      y: Math.floor((DESKTOP_TITLE_BAR_HEIGHT - 14) / 2)
    }
  };
}

export function nativeWindowBackgroundColor(mode: DesktopWindowColorMode): string {
  return mode === 'dark' ? '#0a0a0a' : '#e5e5e5';
}

export function contentWindowBounds(
  window: Pick<BrowserWindow, 'getBounds' | 'getContentBounds'>
): { x: number; y: number; width: number; height: number } {
  const outer = window.getBounds();
  const content = window.getContentBounds();
  return {
    x: outer.x,
    y: outer.y,
    width: content.width,
    height: content.height
  };
}

export function closeWindowForQuit(
  window: Pick<BrowserWindow, 'destroy' | 'hide' | 'isDestroyed'> | undefined
): void {
  if (window === undefined || window.isDestroyed()) return;
  window.hide();
  window.destroy();
}

function visibleBounds(
  saved: ReturnType<SettingsStore['read']>['window']
): { x?: number; y?: number; width: number; height: number } {
  const fallback = { width: 1280, height: 820 };
  if (saved === undefined || saved.x === undefined || saved.y === undefined) {
    return {
      width: saved?.width ?? fallback.width,
      height: saved?.height ?? fallback.height
    };
  }
  const candidate = {
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height
  };
  const display = screen.getDisplayMatching(candidate);
  const area = display.workArea;
  const width = Math.min(Math.max(candidate.width, 980), area.width);
  const height = Math.min(Math.max(candidate.height, 680), area.height);
  return {
    width,
    height,
    x: Math.min(Math.max(candidate.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(candidate.y, area.y), area.y + area.height - height)
  };
}

function isInternalWindowUrl(value: string, development: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'opencreator-app:' && (url.hostname === 'app' || url.hostname === 'bootstrap')) {
      return true;
    }
    return development
      && url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && url.port === '19861';
  } catch {
    return false;
  }
}

export function isWorkspaceUrl(value: string, development: boolean): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'opencreator-app:' && url.hostname === 'app') return true;
    return development
      && url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && url.port === '19861';
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
