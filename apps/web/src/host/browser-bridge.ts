import type { ConnectionConfig } from '../runtime/types.js';
import { readJsonFromStorage, writeJsonToStorage } from '../storage/browser-storage.js';
import type { HostBridge, HostBridgeResult, HostNotification } from './bridge.js';

const CONNECTION_KEY = 'clawee.web.connection.v1';

export const browserBridge: HostBridge = {
  kind: 'browser',
  async readConnectionConfig(): Promise<ConnectionConfig | null> {
    return readJsonFromStorage<ConnectionConfig>(CONNECTION_KEY);
  },
  async writeConnectionConfig(config: ConnectionConfig): Promise<void> {
    writeJsonToStorage(CONNECTION_KEY, config);
  },
  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  async revealPath(_path: string): Promise<HostBridgeResult> {
    return { ok: false, code: 'UNSUPPORTED', message: '浏览器版不支持在系统文件管理器中显示路径' };
  },
  async notify(_message: HostNotification): Promise<void> {
    return;
  }
};
