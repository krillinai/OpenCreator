import type { ConnectionConfig } from '../runtime/types.js';
import type { ColorMode } from '../styles/color-mode.js';

export type HostBridgeResult = { ok: true } | { ok: false; code: 'UNSUPPORTED' | 'FAILED'; message: string };

export type HostNotification = {
  title: string;
  body: string;
  threadId?: string;
  runId?: string;
  approvalId?: string;
};

export type BackgroundNotificationConfiguration =
  | { enabled: false }
  | { enabled: true };

export type DesktopPreferences = {
  closeBehavior: 'hide' | 'quit';
  telemetryEnabled: boolean;
};

export type DirectorySelectionPurpose = 'project' | 'default-project-root' | 'output-root';

export type HostWindowChrome = {
  integratedTitleBar: true;
  titleBarHeight: number;
  trafficLightInset: number;
};

export type HostBridge = {
  kind: 'browser' | 'desktop';
  windowChrome?: HostWindowChrome;
  readAppVersion?(): Promise<string>;
  readConnectionConfig(): Promise<ConnectionConfig | null>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<HostBridgeResult>;
  notify(message: HostNotification): Promise<void>;
  configureBackgroundNotifications?(
    configuration: BackgroundNotificationConfiguration
  ): Promise<HostBridgeResult>;
  subscribeConnectionConfig?(
    listener: (connection: ConnectionConfig | null) => void
  ): () => void;
  restartRuntime?(): Promise<HostBridgeResult>;
  selectCodexPath?(): Promise<HostBridgeResult>;
  readDesktopPreferences?(): Promise<DesktopPreferences>;
  updateDesktopPreferences?(
    preferences: Partial<DesktopPreferences>
  ): Promise<DesktopPreferences>;
  setWindowColorMode?(mode: ColorMode): Promise<void>;
  controlWindow?(action: 'close' | 'minimize' | 'zoom'): Promise<void>;
  selectProjectDirectory?(purpose?: DirectorySelectionPurpose): Promise<string | null>;
  resolveDroppedFilePath?(file: File): string | null;
};
