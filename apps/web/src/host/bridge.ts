import type { ConnectionConfig } from '../runtime/types.js';

export type HostBridgeResult = { ok: true } | { ok: false; code: 'UNSUPPORTED' | 'FAILED'; message: string };

export type HostNotification = {
  title: string;
  body: string;
  target?: 'schedules';
  threadId?: string;
  runId?: string;
};

export type HostBridge = {
  kind: 'browser' | 'desktop';
  readConnectionConfig(): Promise<ConnectionConfig | null>;
  openExternal(url: string): Promise<void>;
  revealPath(path: string): Promise<HostBridgeResult>;
  notify(message: HostNotification): Promise<void>;
};
