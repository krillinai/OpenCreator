import { formatRoute } from '../app/routes.js';
import type { ConnectionConfig } from '../runtime/types.js';
import { readJsonFromStorage } from '../storage/browser-storage.js';
import type { HostBridge, HostBridgeResult, HostNotification } from './bridge.js';

const CONNECTION_KEY = 'opencreator.web.connection.v1';
const DEV_RUNTIME_CONFIG_PATH = '/.opencreator/runtime-config';

export const browserBridge: HostBridge = {
  kind: 'browser',
  async readConnectionConfig(): Promise<ConnectionConfig | null> {
    const sameOriginConfig = await readSameOriginRuntimeConfig();
    return sameOriginConfig ?? parseStoredConnectionConfig(
      readJsonFromStorage<unknown>(CONNECTION_KEY)
    );
  },
  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  async revealPath(_path: string): Promise<HostBridgeResult> {
    return { ok: false, code: 'UNSUPPORTED', message: '浏览器版不支持在系统文件管理器中显示路径' };
  },
  async notify(message: HostNotification): Promise<void> {
    if (
      typeof Notification === 'undefined'
      || Notification.permission !== 'granted'
    ) {
      return;
    }
    const notification = new Notification(message.title, { body: message.body });
    notification.onclick = () => {
      window.focus();
      if (message.threadId !== undefined) {
        window.location.hash = formatRoute({
          view: 'thread',
          threadId: message.threadId,
          ...(message.runId === undefined ? {} : { runId: message.runId }),
          ...(message.approvalId === undefined ? {} : { approvalId: message.approvalId })
        });
      }
      notification.close();
    };
  }
};

async function readSameOriginRuntimeConfig(): Promise<ConnectionConfig | null> {
  try {
    const response = await fetch(DEV_RUNTIME_CONFIG_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return parseSameOriginConnectionConfig(await response.json());
  } catch {
    return null;
  }
}

function parseSameOriginConnectionConfig(value: unknown): ConnectionConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.baseUrl !== '/.opencreator/runtime') return null;
  return { baseUrl: record.baseUrl };
}

function parseStoredConnectionConfig(value: unknown): ConnectionConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.baseUrl !== 'string' || record.baseUrl.length === 0) return null;
  if (typeof record.token !== 'string' || record.token.length === 0) return null;
  return { baseUrl: record.baseUrl, token: record.token };
}
