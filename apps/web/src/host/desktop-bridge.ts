import type { ConnectionConfig } from '../runtime/types.js';
import type {
  DirectorySelectionPurpose,
  HostBridge,
  HostBridgeResult,
  HostNotification
} from './bridge.js';

type DesktopApi = {
  kind: 'desktop';
  windowChrome?: {
    integratedTitleBar: boolean;
    titleBarHeight?: number;
    trafficLightInset?: number;
  };
  readAppVersion(): Promise<string>;
  readConnectionConfig(): Promise<ConnectionConfig | null>;
  subscribeConnectionConfig(
    listener: (connection: ConnectionConfig | null) => void
  ): () => void;
  restartRuntime(): Promise<HostBridgeResult>;
  selectCodexPath(): Promise<HostBridgeResult>;
  reloadWorkspace(): Promise<HostBridgeResult>;
  workspaceReady(): void;
  readDesktopPreferences(): Promise<{
    closeBehavior: 'hide' | 'quit';
    telemetryEnabled: boolean;
  }>;
  updateDesktopPreferences(preferences: {
    closeBehavior?: 'hide' | 'quit';
    telemetryEnabled?: boolean;
  }): Promise<{
    closeBehavior: 'hide' | 'quit';
    telemetryEnabled: boolean;
  }>;
  setWindowColorMode?(mode: 'light' | 'dark'): Promise<void>;
  controlWindow?(action: 'close' | 'minimize' | 'zoom'): Promise<void>;
  selectProjectDirectory(purpose?: DirectorySelectionPurpose): Promise<string | null>;
  resolveDroppedFilePath(file: File): string | null;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<HostBridgeResult>;
  notify(message: HostNotification): Promise<void>;
  configureBackgroundNotifications(
    configuration: { enabled: boolean }
  ): Promise<HostBridgeResult>;
  subscribeNavigation(listener: (route: string) => void): () => void;
};

declare global {
  interface Window {
    opencreatorDesktop?: DesktopApi;
  }
}

export type DesktopHostBridge = HostBridge & {
  kind: 'desktop';
  subscribeConnectionConfig(
    listener: (connection: ConnectionConfig | null) => void
  ): () => void;
  restartRuntime(): Promise<HostBridgeResult>;
};

export function readDesktopHostBridge(): DesktopHostBridge | undefined {
  const api = window.opencreatorDesktop;
  if (api?.kind !== 'desktop') return undefined;
  const windowChrome = api.windowChrome?.integratedTitleBar === true
    && typeof api.windowChrome.titleBarHeight === 'number'
    && typeof api.windowChrome.trafficLightInset === 'number'
    ? {
        integratedTitleBar: true as const,
        titleBarHeight: api.windowChrome.titleBarHeight,
        trafficLightInset: api.windowChrome.trafficLightInset
      }
    : undefined;
  return {
    kind: 'desktop',
    ...(windowChrome === undefined ? {} : { windowChrome }),
    readAppVersion: () => api.readAppVersion(),
    readConnectionConfig: () => api.readConnectionConfig(),
    subscribeConnectionConfig: listener => api.subscribeConnectionConfig(listener),
    restartRuntime: () => api.restartRuntime(),
    selectCodexPath: () => api.selectCodexPath(),
    readDesktopPreferences: () => api.readDesktopPreferences(),
    updateDesktopPreferences: preferences =>
      api.updateDesktopPreferences(preferences),
    ...(windowChrome !== undefined && api.setWindowColorMode !== undefined
      ? { setWindowColorMode: (mode: 'light' | 'dark') => api.setWindowColorMode!(mode) }
      : {}),
    ...(windowChrome !== undefined && api.controlWindow !== undefined
      ? { controlWindow: (action: 'close' | 'minimize' | 'zoom') => api.controlWindow!(action) }
      : {}),
    selectProjectDirectory: purpose => api.selectProjectDirectory(purpose),
    resolveDroppedFilePath: file => api.resolveDroppedFilePath(file),
    openExternal: url => api.openExternal(url),
    revealPath: path => api.revealPath(path),
    notify: message => api.notify(message),
    configureBackgroundNotifications: configuration =>
      api.configureBackgroundNotifications(configuration)
  };
}

export function subscribeDesktopNavigation(listener: (route: string) => void): () => void {
  return window.opencreatorDesktop?.subscribeNavigation(listener) ?? (() => undefined);
}

export function signalDesktopWorkspaceReady(): void {
  window.opencreatorDesktop?.workspaceReady();
}
