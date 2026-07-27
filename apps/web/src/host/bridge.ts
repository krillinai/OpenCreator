import type { ConnectionConfig } from '../runtime/types.js';

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
};

export type HostBridge = {
  kind: 'browser' | 'desktop';
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
  readDesktopPreferences?(): Promise<DesktopPreferences>;
  updateDesktopPreferences?(
    preferences: Partial<DesktopPreferences>
  ): Promise<DesktopPreferences>;
  selectProjectDirectory?(): Promise<string | null>;
  resolveDroppedFilePath?(file: File): string | null;
};
