import { formatRoute } from '../app/routes.js';
import type { ConnectionConfig } from '../runtime/types.js';
import { readJsonFromStorage } from '../storage/browser-storage.js';
import type { HostBridge, HostBridgeResult, HostNotification } from './bridge.js';

const CONNECTION_KEY = 'opencreator.web.connection.v1';
const DEV_RUNTIME_CONFIG_PATH = '/.opencreator/runtime-config';
let billingTabId: string | undefined;
let authorizationTabId: string | undefined;
function getAuthorizationTabId() {
  if (!authorizationTabId) {
    try { authorizationTabId = sessionStorage.getItem('opencreator:authorization-tab') ?? undefined; } catch { /* Tab memory is sufficient for the current return. */ }
    authorizationTabId ||= crypto.randomUUID();
    try { sessionStorage.setItem('opencreator:authorization-tab', authorizationTabId); } catch { /* Optional reload recovery. */ }
  }
  return authorizationTabId;
}
function getBillingTabId() {
  if (!billingTabId) {
    try { billingTabId = sessionStorage.getItem('opencreator:billing-tab') ?? undefined; } catch { /* Tab memory is sufficient for the current return. */ }
    billingTabId ||= crypto.randomUUID();
    try { sessionStorage.setItem('opencreator:billing-tab', billingTabId); } catch { /* Optional reload recovery. */ }
  }
  return billingTabId;
}

export const browserBridge: HostBridge = {
  kind: 'browser',
  get authorizationReturnUrl() { return new URL('/#/account?login=complete&tabId=' + getAuthorizationTabId(), window.location.href).href; },
  get billingReturnUrl() { return new URL('/#/account?billing=return&tabId=' + getBillingTabId(), window.location.href).href; },
  subscribeAuthorizationReturn(listener) {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    const channel = new BroadcastChannel('opencreator.authorization-return.v1');
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const returnTabId = params.get('tabId');
    const returning = window.location.hash.startsWith('#/account?') && params.get('login') === 'complete' && !!returnTabId;
    const tabId = getAuthorizationTabId();
    const nonce = crypto.randomUUID();
    channel.onmessage = event => {
      const value = event.data;
      if (returning) {
        if (value?.type === 'ack' && value.nonce === nonce) window.close();
      } else if (value?.type === 'return' && value.tabId === tabId && typeof value.nonce === 'string') {
        listener();
        channel.postMessage({ type: 'ack', nonce: value.nonce });
        window.focus();
      }
    };
    if (returning) channel.postMessage({ type: 'return', tabId: returnTabId, nonce });
    return () => channel.close();
  },
  prepareExternalNavigation() {
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('Browser blocked the new tab');
    tab.opener = null;
    tab.name = 'opencreator-billing';
    return {
      navigate(url: string) { if (tab.closed) throw new Error('The new tab was closed'); tab.location.replace(url); },
      close() { tab.close(); }
    };
  },
  subscribeBillingReturn(listener) {
    if (typeof BroadcastChannel === 'undefined') return () => {};
    const channel = new BroadcastChannel('opencreator.billing-return.v1');
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    const returnTabId = params.get('tabId');
    const returning = params.get('billing') === 'return' && !!returnTabId;
    const tabId = getBillingTabId();
    const nonce = crypto.randomUUID();
    channel.onmessage = event => {
      const value = event.data;
      if (returning) {
        if (value?.type === 'ack' && value.nonce === nonce) window.close();
      } else if (value?.type === 'return' && value.tabId === tabId && typeof value.nonce === 'string'
        && (value.orderId === undefined || (typeof value.orderId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.orderId)))) {
        listener(value.orderId);
        channel.postMessage({ type: 'ack', nonce: value.nonce });
        window.focus();
      }
    };
    // The return tab signals the original app; the app still verifies the order with the server.
    if (returning) {
      const orderId = params.get('orderId');
      if (!orderId || /^[A-Za-z0-9_-]{1,128}$/.test(orderId)) channel.postMessage({ type: 'return', tabId: returnTabId, nonce, ...(orderId ? { orderId } : {}) });
    }
    return () => channel.close();
  },
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
    return { ok: false, code: 'UNSUPPORTED', message: 'Revealing paths in the system file manager is unavailable in the browser' };
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
