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
});
