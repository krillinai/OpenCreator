import { expect, it, vi } from 'vitest';
import { accountSchema, catalogSchema, createGatewayClient, GatewayError } from '../../src/gateway/client.js';

it('retains optional voice profiles and accepts older catalogs containing only voice IDs', () => {
  const model = { id: 'speech', modality: 'speech', capabilities: [], voices: ['Kore'] };
  const voiceProfiles = { Kore: { gender: 'female', traits: { zh: ['坚定'], en: ['Firm'] }, useCases: { en: ['Narration'] }, sourceUrls: ['https://docs.example/voices'] } };
  expect(catalogSchema.parse({ models: [{ ...model, voiceProfiles }] }).models[0]?.voiceProfiles).toEqual(voiceProfiles);
  expect(catalogSchema.parse({ models: [model] }).models[0]?.voices).toEqual(['Kore']);
  expect(catalogSchema.parse({ models: [model] }).models[0]?.voiceProfiles).toBeUndefined();
});

it('retains fractional retail token prices and image/cache billing categories', () => {
  const price = { version: 'cost-50-v1', billing: 'usage', inputPerMillion: 5229.578, imageInputPerMillion: 10459.156, cachedInputPerMillion: 104.591, cacheWritePerMillion: 2614.789, outputPerMillion: 31377.469 };
  const catalog = catalogSchema.parse({ models: [{ id: 'gpt-image-2.5-flare', modality: 'image', capabilities: ['generate'], price }] });
  expect(catalog.models[0]?.price).toEqual(price);
});

it('preserves optional catalog output limits while accepting old catalogs', () => {
  const model = { id: 'text', modality: 'text', capabilities: ['chat'] };
  expect(catalogSchema.parse({ models: [model] }).models[0]).toEqual(model);
  expect(catalogSchema.parse({ models: [{ ...model, textOptions: { maxOutputTokens: 4096 } }] }).models[0]?.textOptions)
    .toEqual({ maxOutputTokens: 4096 });
});

it('协商稳定密钥策略并拒绝仍会自动轮换的响应', async () => {
  const value = { schemaVersion: 1, transport: 'openrouter-direct', account: { id: 'a', email: 'a@test', verified: true }, modelKey: 'private', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://openrouter.ai/api/v1', models: [], defaults: {}, modelUsePolicy: 'cached-key-v1', keyRotation: false };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect((await client.bootstrap('device-access', { rotate: false, modelUsePolicy: 'cached-key-v1' })).modelUsePolicy).toBe('cached-key-v1');
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://gateway.example/api/v1/client/bootstrap?protocolVersion=3&catalogSchema=2&publicMetadata=1&rotate=0&modelUsePolicy=cached-key-v1');
  value.keyRotation = true;
  await expect(client.bootstrap('device-access')).rejects.toThrow();
});

it('accepts only the explicit direct transport endpoint for official credentials', async () => {
  const value = { schemaVersion: 1, transport: 'openrouter-direct', account: { id: 'a', email: 'a@test', verified: true }, modelKey: 'private', keyVersion: '1', bindingVersion: 'a:1', baseUrl: 'https://openrouter.ai/api/v1', models: [], defaults: {} };
  const fetcher = vi.fn(async () => Response.json(value));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect((await client.bootstrap('device-access')).transport).toBe('openrouter-direct');
  value.baseUrl = 'https://other.test/v1';
  await expect(client.bootstrap('device-access')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
});

it('keeps optional profile pictures while accepting old accounts', () => {
  const account = { id: 'a', email: 'a@example.test', verified: true };
  expect(accountSchema.parse(account)).toEqual(account);
  const photo = { ...account, avatarUrl: 'https://lh3.googleusercontent.com/photo' };
  expect(accountSchema.parse(photo)).toEqual(photo);
});

it('retrieves bounded avatar bytes using the device session', async () => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect(await client.avatar('private-device-token', 'a')).toEqual({ data: Buffer.from([1, 2, 3]), contentType: 'image/png' });
  expect(fetcher).toHaveBeenCalledWith('https://gateway.example/api/v1/me/avatar?accountId=a', expect.objectContaining({ redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer private-device-token' }) }));
});

it('rejects oversized and non-image avatar responses and preserves account errors', async () => {
  for (const response of [new Response('<html>unavailable</html>', { headers: { 'Content-Type': 'text/html' } }), new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } })]) {
    const client = createGatewayClient('https://gateway.example', vi.fn(async () => response));
    await expect(client.avatar('private-device-token', 'a')).rejects.toMatchObject({ code: 'invalid_gateway_response' });
  }
  const client = createGatewayClient('https://gateway.example', vi.fn(async () => Response.json({ error: { code: 'auth_required' } }, { status: 401 })));
  await expect(client.avatar('private-device-token', 'a')).rejects.toMatchObject({ code: 'auth_required', status: 401 });
});

it('取消未完成的请求后仍能发起新的请求', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async (_url, options) => (
    new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    })
  )).mockResolvedValue(Response.json({ account: { id: 'a' } }));
  const client = createGatewayClient('https://gateway.example', fetcher);
  const pending = client.request('/api/v1/me', 'device-token');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'gateway_unavailable' });
  client.cancelPendingRequests!();
  await rejected;
  expect(await client.request('/api/v1/me', 'device-token')).toEqual({ account: { id: 'a' } });
});

it('uses one request for a prompt credit response and cancels its backup timer', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn(async () => Response.json({ balance: { availableUnits: '123' } }));
    const client = createGatewayClient('https://gateway.example', fetcher);
    await expect(client.request('/api/v1/billing/summary', 'device-token')).resolves.toEqual({ balance: { availableUnits: '123' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('starts a backup for a stalled credit read and cancels the slower connection', async () => {
  vi.useFakeTimers();
  try {
    let firstSignal!: AbortSignal;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      firstSignal = options!.signal!;
      firstSignal.addEventListener('abort', () => reject(firstSignal.reason), { once: true });
    })).mockResolvedValueOnce(Response.json({ balance: { availableUnits: '123' } }));
    const client = createGatewayClient('https://gateway.example', fetcher);
    const pending = client.request('/api/v1/billing/summary', 'device-token');
    await vi.advanceTimersByTimeAsync(799);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ balance: { availableUnits: '123' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(firstSignal.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
});

it('keeps the original credit read when a backup fails', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('backup unavailable'));
    const client = createGatewayClient('https://gateway.example', fetcher);
    const pending = client.request('/api/v1/billing/summary', 'device-token');
    await vi.advanceTimersByTimeAsync(800);
    finish(Response.json({ balance: { availableUnits: '123' } }));
    await expect(pending).resolves.toEqual({ balance: { availableUnits: '123' } });
  } finally { vi.useRealTimers(); }
});

it.each([undefined, {}])('cancels pending credit work without starting a backup or repeating a POST: %j', async body => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    }));
    const client = createGatewayClient('https://gateway.example', fetcher);
    const pending = client.request('/api/v1/billing/summary', 'device-token', body);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'gateway_unavailable' });
    if (body) await vi.advanceTimersByTimeAsync(1000);
    client.cancelPendingRequests!(); await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('收到响应头后仍可取消未完成的响应体读取', async () => {
  let bodyStarted!: () => void;
  const started = new Promise<void>(resolve => { bodyStarted = resolve; });
  const fetcher: typeof fetch = async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{'));
      options!.signal!.addEventListener('abort', () => controller.error(options!.signal!.reason), { once: true });
      bodyStarted();
    }
  }));
  const client = createGatewayClient('https://gateway.example', fetcher);
  const pending = client.request('/api/v1/me', 'device-token');
  const rejected = expect(pending).rejects.toMatchObject({ code: 'gateway_unavailable' });
  await started;
  client.cancelPendingRequests!();
  await rejected;
});

it.each([
  [Object.assign(new Error('private-device-token'), { cause: { code: 'ECONNREFUSED' } }), 'network', 'ECONNREFUSED'],
  [new DOMException('private-device-token', 'TimeoutError'), 'timeout', undefined]
])('keeps safe connection diagnostics without exposing raw exceptions or query strings', async (error, reason, networkCode) => {
  const client = createGatewayClient('https://gateway.example', vi.fn(async () => { throw error; }));
  const failure = await client.request('/api/v1/client/bootstrap?private=device-token', 'private-device-token').catch(error => error);
  expect(failure).toMatchObject({ code: 'gateway_unavailable', diagnostics: { path: '/api/v1/client/bootstrap', reason } });
  if (!(failure instanceof GatewayError)) throw new Error('Expected a gateway connection error');
  expect(failure.diagnostics?.networkCode).toBe(networkCode);
  expect(JSON.stringify(failure)).not.toMatch(/private|device-token/);
});

it('keeps the failing endpoint and HTTP status without upstream body secrets', async () => {
  const client = createGatewayClient('https://gateway.example', vi.fn(async () => Response.json({ error: { code: 'services_not_ready', message: 'private-device-token' } }, { status: 503 })));
  const failure = await client.request('/api/v1/client/bootstrap', 'private-device-token').catch(error => error);
  expect(failure).toMatchObject({ code: 'services_not_ready', status: 503, diagnostics: { path: '/api/v1/client/bootstrap', reason: 'http', httpStatus: 503 } });
  expect(JSON.stringify(failure)).not.toContain('private-device-token');
});

it('accepts public gateway metadata while retaining the legacy internal protocol marker', async () => {
  const value = { schemaVersion: 3, transport: 'gateway', keyRotation: false, account: { id: 'a', email: 'a@test', verified: true }, keyVersion: 'gateway-v1', bindingVersion: 'a:gateway:v1', baseUrl: 'https://gateway.example/v1', models: [], defaults: {} };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(value));
  const client = createGatewayClient('https://gateway.example', fetcher);
  expect(await client.bootstrap('device-access')).toMatchObject({ transport: 'gateway', supplier: 'chatanywhere' });
  expect(fetcher.mock.calls[0]?.[0]).toContain('publicMetadata=1');
});

it('accepts image resolution labels alongside pixel video sizes in gateway bootstrap', async () => {
  const models = [
    { id: 'deepseek-flash', modality: 'text', capabilities: ['chat', 'responses'] },
    { id: 'seedream', modality: 'image', capabilities: ['generate'], sizes: ['1K', '2K', '4K'] },
    { id: 'seedance', modality: 'video', capabilities: ['generate'], sizes: ['1280x720'] }
  ];
  const value = { schemaVersion: 3, transport: 'gateway', keyRotation: false, account: { id: 'a', email: 'a@test', verified: true }, keyVersion: 'gateway-v1', bindingVersion: 'a:gateway:v1', baseUrl: 'https://gateway.example/v1', models, defaults: { text: 'deepseek-flash' } };
  const client = createGatewayClient('https://gateway.example', vi.fn<typeof fetch>(async () => Response.json(value)));

  expect((await client.bootstrap('device-access')).models).toMatchObject(models);
  expect(catalogSchema.safeParse({ models: [{ ...models[1], sizes: ['4K?'] }] }).success).toBe(false);
});
