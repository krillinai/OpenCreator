import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn(), execFile: vi.fn() }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

import { createOfficialFetch } from '../../src/gateway/official-fetch.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.request.mockReset(); mocks.execFile.mockReset(); });

function upstream(headers: Record<string, string> = {}) {
  const response = Object.assign(new PassThrough(), { statusCode: 200, headers });
  const end = vi.fn();
  const request = Object.assign(new EventEmitter(), { end });
  mocks.request.mockImplementation((_url, _options, callback) => {
    end.mockImplementation(() => callback(response));
    return request;
  });
  return { response, request, end };
}

it('uses the macOS HTTPS proxy and exposes response bytes before upstream closes', async () => {
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(null, '<dictionary> {\n  HTTPSEnable : 1\n  HTTPSProxy : 127.0.0.1\n  HTTPSPort : 7897\n}\n');
  });
  const remote = upstream({ 'content-type': 'application/json' });
  const fetcher = createOfficialFetch({ platform: 'darwin' });
  const result = await fetcher('https://openrouter.ai/api/v1/images', {
    method: 'POST', headers: { Authorization: 'Bearer test-key' }, body: '{"prompt":"test"}'
  });
  const options = mocks.request.mock.calls[0]![1];
  expect(options.agent.proxy.href).toBe('http://127.0.0.1:7897/');
  expect(options.headers['accept-encoding']).toBe('identity');
  expect(remote.end).toHaveBeenCalledWith(Buffer.from('{"prompt":"test"}'));
  remote.response.write('first');
  const reader = result.body!.getReader();
  expect(Buffer.from((await reader.read()).value!).toString()).toBe('first');
  await reader.cancel();
  expect(remote.response.destroyed).toBe(true);
});

it('prefers a configured proxy and decodes gzip if the upstream still compresses', async () => {
  const remote = upstream({ 'content-type': 'application/json', 'content-encoding': 'gzip' });
  const fetcher = createOfficialFetch({ readProxy: async () => 'http://127.0.0.1:8888', platform: 'darwin' });
  const result = await fetcher('https://openrouter.ai/api/v1/images');
  remote.response.end(gzipSync('{"data":[{"b64_json":"image"}]}'));
  expect(await result.json()).toEqual({ data: [{ b64_json: 'image' }] });
  expect(result.headers.has('content-encoding')).toBe(false);
  expect(mocks.request.mock.calls[0]![1].agent.proxy.port).toBe('8888');
  expect(mocks.execFile).not.toHaveBeenCalled();
});

it('uses the direct connection when no proxy is available', async () => {
  const direct = vi.fn(async () => Response.json({ data: [] }));
  vi.stubGlobal('fetch', direct);
  const result = await createOfficialFetch({ platform: 'linux' })('https://openrouter.ai/api/v1/images');
  expect(await result.json()).toEqual({ data: [] });
  expect(direct).toHaveBeenCalledOnce();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('reads shared proxy changes for each request without restarting the transport', async () => {
  let proxy = 'http://127.0.0.1:7897';
  const fetcher = createOfficialFetch({ readProxy: async () => proxy, platform: 'linux' });
  let remote = upstream();
  const first = await fetcher('https://www.open-creator.ai/api/v1/client/models');
  remote.response.end('{}'); await first.text();
  expect(mocks.request.mock.lastCall![1].agent.proxy.port).toBe('7897');
  proxy = 'http://127.0.0.1:8888'; remote = upstream();
  const second = await fetcher('https://openrouter.ai/api/v1/images');
  remote.response.end('{}'); await second.text();
  expect(mocks.request.mock.lastCall![1].agent.proxy.port).toBe('8888');
  proxy = ''; const direct = vi.fn(async () => Response.json({})); vi.stubGlobal('fetch', direct);
  await fetcher('https://openrouter.ai/api/v1/images'); expect(direct).toHaveBeenCalledOnce();
});

it('does not repeat a paid POST on another route when the proxy fails', async () => {
  const remote = upstream();
  remote.end.mockImplementation(() => queueMicrotask(() => remote.request.emit('error', new Error('lost after acceptance'))));
  mocks.request.mockImplementation(() => remote.request);
  const direct = vi.fn(); vi.stubGlobal('fetch', direct);
  const fetcher = createOfficialFetch({ readProxy: async () => 'http://127.0.0.1:7897' });
  await expect(fetcher('https://openrouter.ai/api/v1/images', { method: 'POST', body: '{}' })).rejects.toThrow('lost after acceptance');
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(direct).not.toHaveBeenCalled();
});
