import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserBridge } from './browser-bridge.js';

describe('browserBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.location.hash = '#/';
  });

  it('returns browser sign-in to the original creation tab', () => {
    window.location.hash = '#/workbench?tool=image-generation';
    const returnHash = new URL(browserBridge.authorizationReturnUrl!).hash;
    expect(returnHash).toMatch(/^#\/account\?login=complete&tabId=[^&]+$/);

    const channels: Channel[] = [];
    class Channel {
      onmessage?: (event: { data: unknown }) => void;
      close = vi.fn();
      constructor() { channels.push(this); }
      postMessage(value: unknown) {
        for (const channel of channels) if (channel !== this) channel.onmessage?.({ data: value });
      }
    }
    vi.stubGlobal('BroadcastChannel', Channel);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const received = vi.fn();
    const unsubscribeOriginal = browserBridge.subscribeAuthorizationReturn!(received);

    window.location.hash = returnHash;
    const unsubscribeCallback = browserBridge.subscribeAuthorizationReturn!(vi.fn());

    expect(received).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    unsubscribeOriginal();
    unsubscribeCallback();
    expect(channels.every(channel => channel.close.mock.calls.length === 1)).toBe(true);
    focus.mockRestore();
    close.mockRestore();
  });

  it('loads the same-origin dev runtime config before local storage', async () => {
    window.localStorage.setItem(
      'opencreator.web.connection.v1',
      JSON.stringify({ baseUrl: 'http://127.0.0.1:1', token: 'storage-token' })
    );
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ baseUrl: '/.opencreator/runtime' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetch);

    await expect(browserBridge.readConnectionConfig()).resolves.toEqual({
      baseUrl: '/.opencreator/runtime'
    });
    expect(fetch).toHaveBeenCalledWith('/.opencreator/runtime-config', expect.objectContaining({ method: 'GET' }));
  });
  it('opens a tab synchronously and removes its opener before an account request', () => {
    const replace = vi.fn(); const close = vi.fn();
    const tab = { opener: window, name: '', closed: false, location: { replace }, close };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const navigation = browserBridge.prepareExternalNavigation!();
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    navigation.navigate('https://www.open-creator.ai/pricing');
    expect(replace).toHaveBeenCalledWith('https://www.open-creator.ai/pricing');
    navigation.close(); expect(close).toHaveBeenCalledOnce();
    open.mockRestore();
  });

  it('signals an order return to the original tab without accepting a payment claim', () => {
    let latest: { onmessage?: (event: { data: unknown }) => void; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
    class Channel {
      onmessage?: (event: { data: unknown }) => void;
      postMessage = vi.fn(); close = vi.fn();
      constructor() { latest = this; }
    }
    vi.stubGlobal('BroadcastChannel', Channel);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const received = vi.fn();
    const unsubscribe = browserBridge.subscribeBillingReturn!(received);
    const tabId = new URL(browserBridge.billingReturnUrl!).hash.split('tabId=')[1];
    latest!.onmessage!({ data: { type: 'return', tabId, nonce: 'return-request', orderId: 'order-a' } });
    expect(received).toHaveBeenCalledWith('order-a');
    expect(latest!.postMessage).toHaveBeenCalledWith({ type: 'ack', nonce: 'return-request' });
    latest!.onmessage!({ data: { type: 'return', tabId, nonce: 'bad-request', orderId: '../other' } });
    latest!.onmessage!({ data: { type: 'return', tabId: 'other-tab', nonce: 'other-request', orderId: 'order-b' } });
    expect(received).toHaveBeenCalledOnce();
    unsubscribe(); expect(latest!.close).toHaveBeenCalledOnce(); focus.mockRestore();
  });

  it('falls back to local storage when same-origin runtime config is unavailable', async () => {
    window.localStorage.setItem(
      'opencreator.web.connection.v1',
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
        new Response(JSON.stringify({ baseUrl: '/.opencreator/runtime' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );

    await expect(browserBridge.readConnectionConfig()).resolves.toEqual({
      baseUrl: '/.opencreator/runtime'
    });
  });

  it('ignores malformed same-origin runtime configs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ baseUrl: 123, token: null }), { status: 200 })));

    await expect(browserBridge.readConnectionConfig()).resolves.toBeNull();
  });

  it('requires a token for direct daemon configs stored locally', async () => {
    window.localStorage.setItem(
      'opencreator.web.connection.v1',
      JSON.stringify({ baseUrl: 'http://127.0.0.1:60765' })
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

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
