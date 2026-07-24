import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { NotificationManager } from '../src/main/notification-manager.js';
import type { DesktopLogger } from '../src/main/logger.js';
import type { SettingsStore } from '../src/main/settings-store.js';

describe('NotificationManager', () => {
  it('acknowledges only notifications confirmed as shown and keeps scanning', async () => {
    const created: FakeNotification[] = [];
    const acknowledgements: string[][] = [];
    const manager = createManager({
      created,
      notificationResults: ['failed', 'shown'],
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('/acknowledge')) {
          const ids = JSON.parse(String(init?.body)).ids as string[];
          acknowledgements.push(ids);
          return jsonResponse({ acknowledged: ids.length });
        }
        return jsonResponse({
          notifications: [
            item('n1', '1'),
            item('n2', '2')
          ],
          nextCursor: '2'
        });
      }
    });

    await manager.consumeNow();

    expect(created).toHaveLength(2);
    expect(acknowledgements).toEqual([['n2']]);
  });

  it('retries ACK without redisplaying a notification in the same process', async () => {
    const created: FakeNotification[] = [];
    let ackAttempts = 0;
    let listCalls = 0;
    const manager = createManager({
      created,
      notificationResults: ['shown'],
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes('/acknowledge')) {
          ackAttempts += 1;
          if (ackAttempts === 1) return new Response('failed', { status: 500 });
          const ids = JSON.parse(String(init?.body)).ids as string[];
          return jsonResponse({ acknowledged: ids.length });
        }
        listCalls += 1;
        return jsonResponse({
          notifications: listCalls === 1 ? [item('n1', '1')] : [],
          nextCursor: listCalls === 1 ? '1' : '0'
        });
      }
    });

    await manager.consumeNow();
    await manager.consumeNow();

    expect(created).toHaveLength(1);
    expect(ackAttempts).toBe(2);
  });

  it('releases the consume lock after a request timeout', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const manager = createManager({
      requestTimeoutMs: 20,
      fetch: async (_input, init) => {
        calls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
    });

    const first = manager.consumeNow();
    await vi.advanceTimersByTimeAsync(25);
    await first;
    const second = manager.consumeNow();
    await vi.advanceTimersByTimeAsync(25);
    await second;

    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});

function createManager(input: {
  created?: FakeNotification[];
  notificationResults?: Array<'shown' | 'failed'>;
  fetch: typeof fetch;
  requestTimeoutMs?: number;
}): NotificationManager {
  const created = input.created ?? [];
  const results = [...(input.notificationResults ?? [])];
  const settings = {
    read: () => ({
      closeBehavior: 'hide',
      notificationsEnabled: true
    }),
    update: () => ({
      closeBehavior: 'hide',
      notificationsEnabled: true
    }),
    flush: () => undefined
  } as unknown as SettingsStore;
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as DesktopLogger;
  return new NotificationManager({
    getConnection: () => ({
      address: 'http://127.0.0.1:60764',
      token: 'secret'
    }),
    settings,
    logger,
    navigate: vi.fn(),
    fetch: input.fetch,
    requestTimeoutMs: input.requestTimeoutMs,
    showTimeoutMs: 50,
    notificationFactory: {
      isSupported: () => true,
      create(options) {
        const notification = new FakeNotification(
          options.id,
          results.shift() ?? 'shown'
        );
        created.push(notification);
        return notification;
      }
    }
  });
}

class FakeNotification extends EventEmitter {
  constructor(
    readonly id: string,
    private readonly result: 'shown' | 'failed'
  ) {
    super();
  }

  show(): void {
    queueMicrotask(() => this.emit(this.result === 'shown' ? 'show' : 'failed'));
  }

  close(): void {
    this.emit('close');
  }

  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

function item(id: string, cursor: string) {
  return {
    id,
    cursor,
    title: id,
    body: 'body',
    threadId: `thread-${id}`,
    runId: `run-${id}`
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
