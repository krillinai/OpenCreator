import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDesktopRequest } from '../src/main/desktop-network.js';
import { installProtocolHandler } from '../src/main/protocol-handler.js';
import type { DesktopLogger } from '../src/main/logger.js';

const network = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  handle: vi.fn()
}));

vi.mock('electron', () => ({
  net: { fetch: network.fetch },
  protocol: { handle: network.handle }
}));

describe('Desktop protocol network lifecycle', () => {
  beforeEach(() => {
    network.fetch.mockReset();
    network.handle.mockReset();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Desktop requests must not use the built-in Undici transport');
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('uses Chromium fetch for both URL and Request inputs without ambient cookies', async () => {
    network.fetch.mockImplementation(async () => new Response('ok'));
    const request = new Request('https://example.com/status');

    await fetchDesktopRequest(new URL('https://example.com/status'));
    await fetchDesktopRequest(request, { credentials: 'include' });

    expect(network.fetch).toHaveBeenNthCalledWith(1, 'https://example.com/status', {
      credentials: 'omit'
    });
    expect(network.fetch).toHaveBeenNthCalledWith(2, request, {
      credentials: 'omit'
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves Runtime authorization, JSON bodies and response headers', async () => {
    network.fetch.mockResolvedValue(new Response('{"ok":true}', {
      status: 201,
      headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' }
    }));
    const fixture = await setup();
    const response = await fixture.handle(new Request(runtimeUrl('/runs'), {
      method: 'POST',
      headers: { Authorization: 'Bearer untrusted', 'Content-Type': 'application/json' },
      body: '{"input":"hello"}'
    }));
    const [target, init] = network.fetch.mock.calls[0]!;

    expect(target).toBe('http://127.0.0.1:60764/runs');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer runtime-token');
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe('{"input":"hello"}');
    expect(init?.redirect).toBe('manual');
    expect(response.status).toBe(201);
    expect(response.headers.get('connection')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
    fixture.controller.suspendRuntime();
    expect(init?.signal?.aborted).toBe(false);
  });

  it('keeps Creator source uploads streaming', async () => {
    network.fetch.mockResolvedValue(new Response('{}'));
    const fixture = await setup();
    const request = new Request(runtimeUrl('/creator/jobs/creator_job_test/source-video'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.opencreator.creator-source' },
      body: new ReadableStream({ start: controller => controller.close() }),
      duplex: 'half'
    } as RequestInit);

    const response = await fixture.handle(request);
    const init = network.fetch.mock.calls[0]![1] as RequestInit & { duplex?: string };

    expect(init.body).toBe(request.body);
    expect(init.duplex).toBe('half');
    await response.text();
  });

  it('aborts pending requests and rejects new requests until Runtime resumes', async () => {
    network.fetch.mockImplementation(async (_url, init) => await new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason);
      }, { once: true })
    ));
    const fixture = await setup();
    const pending = fixture.handle(new Request(runtimeUrl('/healthz')));
    await vi.waitFor(() => expect(network.fetch).toHaveBeenCalledTimes(1));
    fixture.controller.suspendRuntime();

    expect((await pending).status).toBe(503);
    const blocked = await fixture.handle(new Request(runtimeUrl('/healthz')));
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: { code: 'RUNTIME_SHUTTING_DOWN' } });
    expect(network.fetch).toHaveBeenCalledTimes(1);
    expect(fixture.logger.warn).not.toHaveBeenCalled();
    expect(fixture.onTransportFailure).not.toHaveBeenCalled();

    network.fetch.mockImplementation(async () => new Response('ready'));
    fixture.controller.resumeRuntime();
    expect(await (await fixture.handle(new Request(runtimeUrl('/healthz')))).text()).toBe('ready');
  });

  it('also cancels active SSE streams after response headers arrive', async () => {
    network.fetch.mockImplementation(async (_url, init) => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: ready\n\n'));
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), {
            once: true
          });
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    ));
    const fixture = await setup();
    const response = await fixture.handle(new Request(runtimeUrl('/events')));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: ready\n\n');

    fixture.controller.suspendRuntime();

    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    expect(network.fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(fixture.logger.warn).not.toHaveBeenCalled();
  });

  it('forwards renderer cancellation without logging a transport failure', async () => {
    network.fetch.mockImplementation(async (_url, init) => await new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
        once: true
      })
    ));
    const fixture = await setup();
    const cancellation = new AbortController();
    const pending = fixture.handle(new Request(runtimeUrl('/healthz'), {
      signal: cancellation.signal
    }));
    await vi.waitFor(() => expect(network.fetch).toHaveBeenCalledTimes(1));
    cancellation.abort();

    expect((await pending).status).toBe(503);
    expect(fixture.logger.warn).not.toHaveBeenCalled();
  });

  it('releases requests when the renderer cancels a response stream', async () => {
    let abortedBeforeReaderCancel = false;
    const cancel = vi.fn(() => {
      abortedBeforeReaderCancel = network.fetch.mock.calls[0]![1]?.signal?.aborted === true;
    });
    network.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const fixture = await setup();
    const response = await fixture.handle(new Request(runtimeUrl('/events')));

    await response.body!.cancel('window closed');
    fixture.controller.suspendRuntime();

    expect(cancel).toHaveBeenCalledWith('window closed');
    expect(abortedBeforeReaderCancel).toBe(true);
    expect(network.fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(fixture.logger.warn).not.toHaveBeenCalled();
    expect(fixture.onTransportFailure).not.toHaveBeenCalled();
  });

  it('still reports genuine transport errors', async () => {
    network.fetch.mockRejectedValue(new Error('connection refused'));
    const fixture = await setup();
    const response = await fixture.handle(new Request(runtimeUrl('/healthz')));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'RUNTIME_PROXY_FAILED' } });
    expect(fixture.logger.warn).toHaveBeenCalledWith('Runtime proxy request failed', expect.objectContaining({
      path: '/.opencreator/runtime/healthz',
      method: 'GET',
      phase: 'fetch',
      errors: [{ name: 'Error' }]
    }));
    expect(fixture.onTransportFailure).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe Runtime paths before opening a network connection', async () => {
    const fixture = await setup();
    const response = await fixture.handle(new Request(runtimeUrl('/%2f%2fattacker.example')));

    expect(response.status).toBe(400);
    expect(network.fetch).not.toHaveBeenCalled();
  });
});

function runtimeUrl(path: string): string {
  return `opencreator-app://app/.opencreator/runtime${path}`;
}

async function setup() {
  const onTransportFailure = vi.fn();
  const logger: DesktopLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    warnRateLimited: vi.fn(),
    flush: vi.fn(async () => undefined)
  };
  const controller = await installProtocolHandler({
    webRoot: '/unused/web',
    bootstrapRoot: '/unused/bootstrap',
    getConnection: () => ({ address: 'http://127.0.0.1:60764', token: 'runtime-token' }),
    onTransportFailure,
    logger
  });
  const handle = network.handle.mock.calls[0]![1] as (request: Request) => Promise<Response>;
  return { controller, handle, logger, onTransportFailure };
}
