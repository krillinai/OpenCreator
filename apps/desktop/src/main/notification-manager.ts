import {
  Notification
} from 'electron';
import type {
  DaemonConnection,
  DesktopHostNotification
} from '../shared/types.js';
import type { DesktopLogger } from './logger.js';
import type { SettingsStore } from './settings-store.js';

type NotificationOutboxItem = {
  id: string;
  cursor: string;
  title: string;
  body: string;
  threadId: string;
  runId: string;
  approvalId?: string;
};

type NativeNotification = {
  on(event: 'show' | 'close' | 'click', listener: () => void): NativeNotification;
  on(event: 'failed', listener: (_event: unknown, error?: string) => void): NativeNotification;
  show(): void;
  close(): void;
};

type NotificationFactory = {
  isSupported(): boolean;
  create(options: {
    id: string;
    title: string;
    body: string;
  }): NativeNotification;
};

export type NotificationShowResult = 'shown' | 'failed' | 'unsupported';

const PAGE_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 10_000;
const SHOW_TIMEOUT_MS = 3_000;
const MAX_SCAN_PAGES = 100;

export class NotificationManager {
  private timer: NodeJS.Timeout | undefined;
  private consuming = false;
  private scanCursor = '0';
  private readonly shownAwaitingAck = new Set<string>();
  private readonly retryState = new Map<string, {
    attempts: number;
    nextAt: number;
  }>();
  private readonly activeRequests = new Set<AbortController>();
  private readonly activeNotifications = new Map<string, NativeNotification>();
  private localNotificationSequence = 0;
  private readonly notificationFactory: NotificationFactory;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly input: {
    getConnection(): DaemonConnection | undefined;
    settings: SettingsStore;
    logger: DesktopLogger;
    navigate(route: string): void;
    notificationFactory?: NotificationFactory;
    fetch?: typeof fetch;
    now?: () => number;
    requestTimeoutMs?: number;
    showTimeoutMs?: number;
  }) {
    this.notificationFactory = input.notificationFactory ?? {
      isSupported: () => Notification.isSupported(),
      create: options => new Notification({
        title: options.title,
        body: options.body,
        ...({ id: options.id } as { id: string })
      }) as NativeNotification
    };
    this.fetchImplementation = input.fetch ?? fetch;
  }

  start(): void {
    if (this.timer !== undefined) return;
    void this.consume();
    this.timer = setInterval(() => void this.consume(), 5_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.activeRequests) controller.abort();
    this.activeRequests.clear();
    for (const notification of this.activeNotifications.values()) {
      notification.close();
    }
    this.activeNotifications.clear();
  }

  configure(enabled: boolean): void {
    this.input.settings.update({ notificationsEnabled: enabled });
    if (enabled) void this.consume();
  }

  async show(
    message: DesktopHostNotification,
    stableId = `local-${++this.localNotificationSequence}`
  ): Promise<NotificationShowResult> {
    if (
      !this.input.settings.read().notificationsEnabled
      || !this.notificationFactory.isSupported()
    ) {
      return 'unsupported';
    }

    let notification: NativeNotification;
    try {
      notification = this.notificationFactory.create({
        id: stableId,
        title: message.title.slice(0, 160),
        body: message.body.slice(0, 1_000)
      });
    } catch (error) {
      this.input.logger.warn('Native notification construction failed', {
        id: stableId,
        message: error instanceof Error ? error.message : String(error)
      });
      return 'failed';
    }

    this.activeNotifications.set(stableId, notification);
    return await new Promise<NotificationShowResult>(resolve => {
      let settled = false;
      const finish = (result: NotificationShowResult, retain = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!retain) this.activeNotifications.delete(stableId);
        resolve(result);
      };
      notification.on('click', () => {
        if (message.threadId !== undefined) {
          this.input.navigate(threadRoute({
            threadId: message.threadId,
            ...(message.runId === undefined ? {} : { runId: message.runId }),
            ...(message.approvalId === undefined ? {} : { approvalId: message.approvalId })
          }));
        }
      });
      notification.on('show', () => finish('shown', true));
      notification.on('failed', (_event, error) => {
        this.input.logger.warn('Native notification failed to show', {
          id: stableId,
          message: error ?? 'unknown failure'
        });
        finish('failed');
      });
      notification.on('close', () => {
        this.activeNotifications.delete(stableId);
        if (!settled) finish('failed');
      });
      const timeout = setTimeout(() => {
        notification.close();
        finish('failed');
      }, this.input.showTimeoutMs ?? SHOW_TIMEOUT_MS);
      timeout.unref();
      try {
        notification.show();
      } catch (error) {
        this.input.logger.warn('Native notification show threw', {
          id: stableId,
          message: error instanceof Error ? error.message : String(error)
        });
        finish('failed');
      }
    });
  }

  async consumeNow(): Promise<void> {
    await this.consume();
  }

  private async consume(): Promise<void> {
    if (
      this.consuming
      || !this.input.settings.read().notificationsEnabled
      || !this.notificationFactory.isSupported()
    ) {
      return;
    }
    const connection = this.input.getConnection();
    if (connection === undefined) return;
    this.consuming = true;
    try {
      await this.acknowledgeShown(connection);
      for (let pageIndex = 0; pageIndex < MAX_SCAN_PAGES; pageIndex += 1) {
        const pageStartCursor = this.scanCursor;
        const page = await this.runtimeJson<{
          notifications: NotificationOutboxItem[];
          nextCursor: string;
        }>(
          connection,
          `/notifications?after=${encodeURIComponent(this.scanCursor)}&limit=${PAGE_LIMIT}`
        );
        if (page.notifications.length === 0) {
          this.scanCursor = '0';
          break;
        }

        for (const item of page.notifications) {
          this.scanCursor = item.cursor;
          if (this.shownAwaitingAck.has(item.id)) continue;
          const retry = this.retryState.get(item.id);
          if (retry !== undefined && retry.nextAt > this.now()) continue;
          const result = await this.show(item, item.id);
          if (result === 'shown') {
            this.shownAwaitingAck.add(item.id);
          } else if (result === 'failed') {
            this.scheduleRetry(item.id);
          }
        }
        await this.acknowledgeShown(connection);
        if (
          page.notifications.length < PAGE_LIMIT
          || page.nextCursor === pageStartCursor
        ) {
          this.scanCursor = '0';
          break;
        }
        this.scanCursor = page.nextCursor;
      }
    } catch (error) {
      if (!isAbortError(error)) {
        this.input.logger.warn('Background notification consumption failed', {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } finally {
      this.consuming = false;
    }
  }

  private async acknowledgeShown(connection: DaemonConnection): Promise<void> {
    const ids = [...this.shownAwaitingAck];
    if (ids.length === 0) return;
    const result = await this.runtimeJson<{ acknowledged: number }>(
      connection,
      '/notifications/acknowledge',
      { method: 'POST', body: { ids } }
    );
    if (result.acknowledged !== ids.length) {
      throw new Error(
        `Runtime acknowledged ${result.acknowledged} of ${ids.length} notifications`
      );
    }
    for (const id of ids) {
      this.shownAwaitingAck.delete(id);
      this.retryState.delete(id);
    }
  }

  private scheduleRetry(id: string): void {
    const attempts = (this.retryState.get(id)?.attempts ?? 0) + 1;
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempts - 1, 6));
    this.retryState.set(id, {
      attempts,
      nextAt: this.now() + delayMs
    });
  }

  private now(): number {
    return this.input.now?.() ?? Date.now();
  }

  private async runtimeJson<T>(
    connection: DaemonConnection,
    path: string,
    input: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const controller = new AbortController();
    this.activeRequests.add(controller);
    const timeout = setTimeout(
      () => controller.abort(),
      this.input.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    );
    timeout.unref();
    try {
      const response = await this.fetchImplementation(`${connection.address}${path}`, {
        method: input.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `Runtime returned HTTP ${response.status}: ${text.slice(0, 512)}`
        );
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
      this.activeRequests.delete(controller);
    }
  }
}

function threadRoute(message: {
  threadId: string;
  runId?: string;
  approvalId?: string;
}): string {
  const query = new URLSearchParams();
  if (message.runId !== undefined) query.set('runId', message.runId);
  if (message.approvalId !== undefined) query.set('approvalId', message.approvalId);
  const suffix = query.toString();
  const route = `#/thread/${encodeURIComponent(message.threadId)}`;
  return suffix.length === 0 ? route : `${route}?${suffix}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
