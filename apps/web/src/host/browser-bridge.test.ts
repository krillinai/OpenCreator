import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserBridge } from './browser-bridge.js';

describe('browserBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('loads the same-origin dev runtime config before local storage', async () => {
    window.localStorage.setItem(
      'clawee.web.connection.v1',
      JSON.stringify({ baseUrl: 'http://127.0.0.1:1', token: 'storage-token' })
    );
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ baseUrl: 'http://127.0.0.1:60764', token: 'runtime-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch);

    await expect(browserBridge.readConnectionConfig()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'runtime-token'
    });
    expect(fetch).toHaveBeenCalledWith('/.clawee/runtime-config', expect.objectContaining({ method: 'GET' }));
  });

  it('falls back to local storage when same-origin runtime config is unavailable', async () => {
    window.localStorage.setItem(
      'clawee.web.connection.v1',
      JSON.stringify({ baseUrl: 'http://127.0.0.1:60765', token: 'storage-token' })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    await expect(browserBridge.readConnectionConfig()).resolves.toEqual({
      baseUrl: 'http://127.0.0.1:60765',
      token: 'storage-token'
    });
  });

  it('accepts same-origin proxy runtime configs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ baseUrl: '/.clawee/runtime', token: 'runtime-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );

    await expect(browserBridge.readConnectionConfig()).resolves.toEqual({
      baseUrl: '/.clawee/runtime',
      token: 'runtime-token'
    });
  });

  it('ignores malformed same-origin runtime configs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ baseUrl: 123, token: null }), { status: 200 })));

    await expect(browserBridge.readConnectionConfig()).resolves.toBeNull();
  });

  it('opens the targeted task run when a scheduled-task notification is clicked', async () => {
    const close = vi.fn();
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    class NotificationMock {
      static permission = 'granted';
      static latest: NotificationMock | undefined;
      onclick: (() => void) | null = null;

      constructor() {
        NotificationMock.latest = this;
      }

      close() {
        close();
      }
    }
    vi.stubGlobal('Notification', NotificationMock);
    window.location.hash = '#/thread/previous';

    await browserBridge.notify({
      title: '喝水提醒',
      body: '该喝水了。',
      threadId: 'thread/task',
      runId: 'run 1',
      approvalId: 'approval 1'
    });
    NotificationMock.latest?.onclick?.();

    expect(window.location.hash).toBe(
      '#/thread/thread%2Ftask?runId=run+1&approvalId=approval+1'
    );
    expect(focus).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
