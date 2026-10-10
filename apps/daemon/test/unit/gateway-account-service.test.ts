import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as module from '../../src/gateway/account-service.js';
import { GatewayError, type GatewayBootstrap } from '../../src/gateway/client.js';
import { createGatewayConfigStore } from '../../src/gateway/config-store.js';
import Fastify from 'fastify';
import { registerGatewayAccountRoutes } from '../../src/api/routes.gateway-account.js';
import { createOfficialModelAccess, type OfficialModelAccess } from '../../src/gateway/model-access.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup(activate = vi.fn(async () => undefined), close = vi.fn(async () => undefined), hasPendingTasks = () => false, hasActiveTasks = () => false, modelAccess?: (root: string) => OfficialModelAccess) {
  expect(module).toHaveProperty('createGatewayAccountService', expect.any(Function));
  const root = await mkdtemp(join(tmpdir(), 'oc-gateway-account-')); roots.push(root);
  let attempt = 0;
  const client = {
    origin: 'https://gateway.example',
    async startDevice() { const id = String(++attempt); return { attemptId: id, deviceSecret: `private-${id}`, authorizationUrl: `https://gateway.example/device?attempt=${id}`, interval: 5, expiresIn: 600 }; },
    pollDevice: vi.fn(async (id: string) => ({ accessToken: `access-${id}`, refreshToken: `refresh-${id}`, expiresIn: 900 })),
    async cancelDevice() {},
    refresh: vi.fn(async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 })),
    async logout() {},
    avatar: vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]), contentType: 'image/png' })),
    bootstrap: vi.fn(async (access: string): Promise<GatewayBootstrap> => { const id = access.split('-').at(-1)!; return { schemaVersion: 1 as const, account: { id, email: `${id}@example.test`, verified: true }, modelKey: `cloud-${id}`, keyVersion: '1', bindingVersion: `${id}:1`, baseUrl: 'https://gateway.example/v1', models: [{ id: 'gateway-text', modality: 'text' as const, capabilities: ['responses'] }], defaults: { text: 'gateway-text' } }; }),
    async request() { return {}; }
  };
  const service = module.createGatewayAccountService({ dataDir: root, client, activateRuntime: activate, closeRuntime: close, hasActiveTasks, hasPendingTasks, automaticPolling: false, modelAccess: modelAccess?.(root) });
  return { service, root, client, activate, close };
}

it('silently filters official families without blocking model selection or changing the raw candidate catalog', async () => {
  let finishProbe!: () => void;
  const waiting = new Promise<void>(resolve => { finishProbe = resolve; });
  const requests: string[] = [];
  const f = await setup(undefined, undefined, undefined, undefined, root => createOfficialModelAccess({
    dataDir: root, readProxy: async () => '', fetcher: async (url, options) => {
      if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
      const model = JSON.parse(String(options?.body)).model; requests.push(model);
      await waiting;
      return model.startsWith('openai/') ? Response.json({ error: { message: 'The request is prohibited due to a violation of provider Terms Of Service.' } }, { status: 403 })
        : Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'oc_access_check', arguments: '{"ready":true}' }] });
    }
  }));
  const raw = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct' as const, baseUrl: 'https://openrouter.ai/api/v1', keyRotation: true,
    models: ['deepseek/deepseek-v3.2', 'deepseek/deepseek-r1', 'openai/gpt-4.1-mini', 'openai/gpt-6-sol', 'qwen/qwen3-coder', 'anthropic/claude-sonnet-4.6'].map(id => ({ id, modality: 'text' as const, capabilities: ['responses'] })), defaults: { text: 'deepseek/deepseek-v3.2' } };
  f.client.bootstrap.mockResolvedValue(raw);
  const usage: Array<{ busy: boolean }> = [];
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string, _access?: string, body?: unknown) => {
    if (path === '/api/v1/client/usage') { usage.push(body as { busy: boolean }); return { keyVersion: raw.keyVersion }; }
    return path === '/api/v1/client/models' ? { models: raw.models } : { account: raw.account };
  });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(f.service.peekState().activationState).toBe('ready');
  await f.service.selectModel('text', 'deepseek/deepseek-r1');
  finishProbe();
  await expect.poll(() => f.service.peekState().models.some(model => model.id === 'qwen/qwen3-coder')).toBe(true);
  expect(f.service.peekState().models.map(model => model.id)).toEqual(['deepseek/deepseek-v3.2', 'deepseek/deepseek-r1', 'qwen/qwen3-coder']);
  expect(f.service.peekState().selectedModels?.text).toBe('deepseek/deepseek-r1');
  await expect(f.service.selectModel('text', 'openai/gpt-6-sol')).rejects.toMatchObject({ code: 'invalid_model' });
  expect((await f.service.modelCredentials()).models).toEqual(f.service.peekState().models);
  expect((await createGatewayConfigStore(f.root).readCredentials())?.models).toHaveLength(6);
  expect(usage.some(value => value.busy)).toBe(true);
  await f.service.close();
  expect(usage.at(-1)?.busy).toBe(false);
});

it('defers a blocked default replacement until idle and recovers after every family was denied', async () => {
  let active = true; let denyFallback = false; let recover = false;
  let finishProbe!: () => void;
  const waiting = new Promise<void>(resolve => { finishProbe = resolve; });
  const f = await setup(undefined, undefined, undefined, () => active, root => createOfficialModelAccess({
    dataDir: root, readProxy: async () => '', fetcher: async (url, options) => {
      if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
      await waiting;
      const model = JSON.parse(String(options?.body)).model;
      return !recover && (model.startsWith('openai/') || denyFallback)
        ? Response.json({ error: { message: 'Model unavailable in this country' } }, { status: 403 })
        : Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'oc_access_check', arguments: '{"ready":true}' }] });
    }
  }));
  active = false;
  const raw = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct' as const, baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4.1-mini', 'deepseek/deepseek-v3.2'].map(id => ({ id, modality: 'text' as const, capabilities: ['responses'] })), defaults: { text: 'openai/gpt-4.1-mini' } };
  f.client.bootstrap.mockResolvedValue(raw);
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string) => path === '/api/v1/client/models' ? { models: raw.models } : { account: raw.account });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  active = true; finishProbe();
  await expect.poll(() => f.service.peekState().selectedModels?.text).toBe('deepseek/deepseek-v3.2');
  expect(f.activate).toHaveBeenCalledOnce();
  active = false;
  expect(await f.service.readState()).toMatchObject({ activationState: 'ready', selectedModels: { text: 'deepseek/deepseek-v3.2' } });
  expect(f.activate).toHaveBeenLastCalledWith(expect.objectContaining({ defaults: { text: 'deepseek/deepseek-v3.2' } }));
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start + 24 * 60 * 60_000 + 1);
  try {
    denyFallback = true;
    await f.service.readState();
    await expect.poll(() => f.service.peekState().activationState).toBe('blocked');
    await expect(f.service.modelCredentials()).rejects.toMatchObject({ code: 'services_not_ready' });
    recover = true; clock.mockReturnValue(start + 25 * 60 * 60_000 + 2);
    await f.service.readState();
    await expect.poll(() => f.service.peekState().activationState).toBe('ready');
    expect(f.service.peekState().bindingVersion).toBe(raw.bindingVersion);
    expect((await f.service.modelCredentials()).defaults.text).toBeTruthy();
    expect(f.activate).toHaveBeenCalledTimes(3);
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('aborts an in-flight availability check on logout without applying a late result', async () => {
  let started = false; let aborted = false;
  const f = await setup(undefined, undefined, undefined, undefined, root => createOfficialModelAccess({
    dataDir: root, readProxy: async () => '', fetcher: async (url, options) => {
      if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
      started = true;
      return new Promise<Response>(resolve => options!.signal!.addEventListener('abort', () => {
        aborted = true;
        resolve(Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'oc_access_check', arguments: '{"ready":true}' }] }));
      }, { once: true }));
    }
  }));
  const raw = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct' as const,
    models: [{ id: 'deepseek/deepseek-v3.2', modality: 'text' as const, capabilities: ['responses'] }], defaults: { text: 'deepseek/deepseek-v3.2' } };
  f.client.bootstrap.mockResolvedValue(raw);
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  await expect.poll(() => started).toBe(true);
  await f.service.logout();
  expect(aborted).toBe(true);
  expect(f.service.peekState()).toMatchObject({ authState: 'signed_out', activationState: 'inactive', models: [] });
  expect(await createGatewayConfigStore(f.root).readCredentials()).toBeUndefined();
  expect(f.activate).toHaveBeenCalledOnce();
  await f.service.close();
});

it('login overrides a saved manual mode and logout restores custom services', async () => {
  const f = await setup();
  await createGatewayConfigStore(f.root).writeConfiguration({ source: 'manual', bindingVersion: null, explicitlySelected: true });
  const authorization = await f.service.startAuthorization(); await f.service.pollAuthorization(authorization.attemptId);
  expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: '1' } });
  expect(f.activate).toHaveBeenCalledOnce();
  await expect(f.service.setSource('manual')).rejects.toMatchObject({ code: 'logout_required' });
  await f.service.logout();
  expect(await f.service.readState()).toMatchObject({ source: 'manual', authState: 'signed_out', activationState: 'inactive' });
  await expect(f.service.setSource('gateway')).rejects.toMatchObject({ status: 401 });
  await f.service.close();
});

it('coordinates concurrent direct uses and refreshes a replaced user key privately', async () => {
  const f = await setup();
  const original = await f.client.bootstrap('access-1');
  let binding = { ...original, keyRotation: true };
  let currentVersion = binding.keyVersion;
  const states: Array<{ busy: boolean; pending: boolean }> = [];
  f.client.bootstrap.mockImplementation(async () => binding);
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string, _access?: string, body?: unknown) => {
    if (path === '/api/v1/client/usage') { states.push(body as { busy: boolean; pending: boolean }); return { keyVersion: currentVersion }; }
    if (path === '/api/v1/client/models') return { models: binding.models };
    return { account: binding.account };
  });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  binding = { ...binding, modelKey: 'replacement-private-key', keyVersion: '2', bindingVersion: '1:2' }; currentVersion = '2';
  const first = await f.service.beginModelUse();
  const second = await f.service.beginModelUse();
  expect(first.credentials.modelKey).toBe('replacement-private-key');
  expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false });
  expect(states.at(-1)).toMatchObject({ busy: true });
  await first.release(); expect(states.at(-1)).toMatchObject({ busy: true });
  await second.release(); expect(states.at(-1)).toMatchObject({ busy: false });
  await second.release(); expect(states.at(-1)).toMatchObject({ busy: false });
  expect(f.activate).toHaveBeenCalledOnce();
  expect((await createGatewayConfigStore(f.root).readCredentials())?.modelKey).toBe('replacement-private-key');
  expect(JSON.stringify(await f.service.readState())).not.toContain('replacement-private-key');
  await f.service.close();
});

it('automatically requests migration on restart and defers it for pending supplier work', async () => {
  const f = await setup();
  const original = { ...await f.client.bootstrap('access-1'), keyRotation: true };
  f.client.bootstrap.mockResolvedValue(original);
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string) => path === '/api/v1/client/usage'
    ? { keyVersion: original.keyVersion } : path === '/api/v1/client/models' ? { models: original.models } : { account: original.account });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  await f.service.close();
  for (const pending of [true, false]) {
    const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => false, hasPendingTasks: () => pending, automaticPolling: false });
    expect(await restored.readState()).toMatchObject({ authState: 'signed_in', activationState: 'ready' });
    expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: !pending });
    await restored.close();
  }
});

it('does not admit direct use when control-plane coordination fails', async () => {
  const f = await setup();
  const binding = { ...await f.client.bootstrap('access-1'), keyRotation: true };
  f.client.bootstrap.mockResolvedValue(binding);
  const request = vi.spyOn(f.client, 'request').mockResolvedValue({ keyVersion: binding.keyVersion });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  request.mockRejectedValue(new GatewayError('gateway_unavailable'));
  await expect(f.service.beginModelUse()).rejects.toMatchObject({ code: 'gateway_unavailable' });
  request.mockResolvedValue({ keyVersion: binding.keyVersion });
  const use = await f.service.beginModelUse(); await use.release();
  await f.service.close();
});

it('persists official model choices and validates the catalog', async () => {
  const f = await setup();
  const original = f.client.bootstrap;
  original.mockImplementation(async () => ({ schemaVersion: 1 as const, account: { id: '1', email: '1@example.test', verified: true }, modelKey: 'cloud-1', keyVersion: '1', bindingVersion: '1:1', baseUrl: 'https://gateway.example/v1', models: [{ id: 'first', modality: 'text' as const, capabilities: ['responses'] }, { id: 'second', modality: 'text' as const, capabilities: ['responses'] }], defaults: { text: 'first' } }));
  const authorization = await f.service.startAuthorization(); await f.service.pollAuthorization(authorization.attemptId);
  await f.service.selectModel('text', 'second');
  expect((await f.service.modelCredentials()).defaults.text).toBe('second');
  expect(f.activate).toHaveBeenLastCalledWith(expect.objectContaining({ defaults: { text: 'second' } }));
  await expect(f.service.selectModel('text', 'unknown')).rejects.toMatchObject({ code: 'invalid_model' });
  await f.service.logout();
  const second = await f.service.startAuthorization(); await f.service.pollAuthorization(second.attemptId);
  expect((await f.service.readState()).selectedModels?.text).toBe('second');
  await f.service.close();
});

it('refreshes the official catalog when idle, preserving choices and deferring pending tasks', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const first = { id: 'first', modality: 'text' as const, capabilities: ['responses'] };
  const second = { ...first, id: 'second' };
  const image = { id: 'image', modality: 'image' as const, capabilities: ['edit'] };
  let catalog: GatewayBootstrap['models'] = [first, second];
  f.client.bootstrap.mockImplementation(async () => ({ schemaVersion: 1, account: { id: '1', email: '1@example.test', verified: true }, modelKey: 'private-key', keyVersion: '1', bindingVersion: 'catalog-version', baseUrl: 'https://gateway.example/v1', models: catalog, defaults: { text: 'first' } }));
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string) => path === '/api/v1/client/models' ? { models: catalog } : { account: { id: '1', email: '1@example.test', verified: true } });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  await f.service.selectModel('text', 'second');
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start + 31_000);
  try {
    catalog = [first, second, image];
    pending = true;
    expect((await f.service.readState()).models).toHaveLength(2);
    pending = false;
    expect(await f.service.readState()).toMatchObject({ models: catalog, selectedModels: { text: 'second' } });
    expect(f.activate).toHaveBeenLastCalledWith(expect.objectContaining({ models: catalog, defaults: { text: 'second', image: 'image' } }));
    const calls = f.client.bootstrap.mock.calls.length;
    clock.mockReturnValue(start + 62_000); await f.service.readState();
    expect(f.client.bootstrap.mock.calls).toHaveLength(calls);
    catalog = [first]; clock.mockReturnValue(start + 93_000);
    expect((await f.service.readState()).selectedModels?.text).toBe('first');
    await f.service.logout(); clock.mockReturnValue(start + 124_000);
    await f.service.readState(); expect((await f.service.readState()).source).toBe('manual');
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('clears an expired device session before starting reauthorization', async () => {
  const f = await setup();
  const first = await f.service.startAuthorization(); await f.service.pollAuthorization(first.attemptId);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  try {
    f.client.refresh.mockRejectedValueOnce(new GatewayError('auth_required', 401));
    await expect(f.service.modelCredentials()).rejects.toMatchObject({ status: 401 });
    expect((await f.service.readState()).authState).toBe('expired');
    const next = await f.service.startAuthorization();
    await f.service.pollAuthorization(next.attemptId);
    expect(await f.service.readState()).toMatchObject({ authState: 'signed_in', activationState: 'ready', account: { id: '2' } });
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('reads only the public plan catalog without signing in or changing account state', async () => {
  const f = await setup();
  const request = vi.spyOn(f.client, 'request').mockResolvedValue({ plans: [], billingAvailable: true });
  expect(await f.service.readPlans()).toEqual({ plans: [], billingAvailable: true });
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/plans', '');
  expect(await f.service.readState()).toMatchObject({ source: 'manual', authState: 'signed_out' });
  await expect(f.service.billing('/api/v1/billing/summary')).rejects.toMatchObject({ status: 401 });
  await f.service.close();
});

it('blocks logout with pending requests but permits same-account reauthorization after expiry', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const first = await f.service.startAuthorization(); await f.service.pollAuthorization(first.attemptId);
  pending = true;
  await expect(f.service.logout()).rejects.toMatchObject({ code: 'active_tasks' });
  expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready' });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  try {
    f.client.refresh.mockRejectedValueOnce(new GatewayError('auth_required', 401));
    await expect(f.service.modelCredentials()).rejects.toMatchObject({ status: 401 });
    vi.spyOn(f.client, 'request').mockResolvedValue({ account: { id: '1', email: '1@example.test', verified: true } });
    const next = await f.service.startAuthorization();
    f.client.pollDevice.mockResolvedValueOnce({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 });
    await f.service.pollAuthorization(next.attemptId);
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: '1' } });
    pending = false; await f.service.logout();
    expect((await f.service.readState()).source).toBe('manual');
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('rejects a different account during expired-session recovery and preserves original credentials', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const first = await f.service.startAuthorization(); await f.service.pollAuthorization(first.attemptId);
  pending = true;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  try {
    f.client.refresh.mockRejectedValueOnce(new GatewayError('auth_required', 401));
    await expect(f.service.modelCredentials()).rejects.toMatchObject({ status: 401 });
    vi.spyOn(f.client, 'request').mockResolvedValue({ account: { id: '2', email: '2@example.test', verified: true } });
    const revoke = vi.spyOn(f.client, 'logout');
    const next = await f.service.startAuthorization();
    await f.service.pollAuthorization(next.attemptId);
    expect(revoke).toHaveBeenCalledWith('access-2');
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'expired', account: { id: '1' }, activationState: 'blocked', activationError: { code: 'account_mismatch' } });
    expect((await createGatewayConfigStore(f.root).readCredentials())?.accessToken).toBe('access-1');
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('canceling guest authorization restores custom services', async () => {
  const f = await setup();
  await f.service.startAuthorization();
  expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'authorizing' });
  await f.service.cancelAuthorization();
  expect(await f.service.readState()).toMatchObject({ source: 'manual', authState: 'signed_out', activationState: 'inactive' });
  await f.service.close();
});

it('late authorization cannot replace a newer account', async () => {
  const f = await setup();
  let release!: (value: { accessToken: string; refreshToken: string; expiresIn: number }) => void;
  f.client.pollDevice.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = await f.service.startAuthorization();
  const delayed = f.service.pollAuthorization(first.attemptId);
  const second = await f.service.startAuthorization();
  await f.service.pollAuthorization(second.attemptId);
  release({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 });
  await delayed;
  const state = await f.service.readState();
  expect(state.account?.id).toBe('2');
  expect(state.activationState).toBe('ready');
  expect(JSON.stringify(state)).not.toMatch(/cloud-|access-|refresh-|private-/);
  await f.service.close();
});

it('bootstrap or Runtime failure leaves a signed-in account unready', async () => {
  const f = await setup(vi.fn(async () => { throw new Error('test-cloud-secret'); }));
  const attempt = await f.service.startAuthorization();
  await f.service.pollAuthorization(attempt.attemptId);
  const state = await f.service.readState();
  expect(state.authState).toBe('signed_in');
  expect(state.source).toBe('gateway');
  expect(state.activationState).toBe('blocked');
  expect(JSON.stringify(state)).not.toContain('test-cloud-secret');
  const privateFile = await readFile(join(f.root, 'config/gateway-credentials.json'), 'utf8');
  expect(privateFile).toContain('cloud-1');
  const publicFile = await readFile(join(f.root, 'config/gateway.json'), 'utf8');
  expect(publicFile).not.toContain('cloud-1');
  expect(publicFile).not.toContain('access-1');
  expect(JSON.parse(publicFile)).toMatchObject({ source: 'gateway', bindingVersion: null });
  await f.service.close();
});

it('logout closes Runtime before clearing credentials or reporting completion', async () => {
  let exited!: () => void;
  const f = await setup(undefined, vi.fn(() => new Promise<void>(resolve => { exited = resolve; })));
  const attempt = await f.service.startAuthorization(); await f.service.pollAuthorization(attempt.attemptId);
  const logout = f.service.logout();
  await vi.waitFor(async () => expect((await f.service.readState()).authState).toBe('signing_out'));
  await expect(f.service.modelCredentials()).rejects.toThrow();
  expect((await readFile(join(f.root, 'config/gateway-credentials.json'), 'utf8'))).toContain('cloud-1');
  exited(); await logout;
  expect((await f.service.readState()).authState).toBe('signed_out');
  await expect(readFile(join(f.root, 'config/gateway-credentials.json'))).rejects.toThrow();
});

it('keeps the device session when bootstrap fails and can activate without another authorization', async () => {
  const f = await setup();
  f.client.bootstrap.mockRejectedValueOnce(new Error('bootstrap unavailable'));
  const attempt = await f.service.startAuthorization(); await f.service.pollAuthorization(attempt.attemptId);
  expect((await f.service.readState()).authState).toBe('signed_in');
  expect((await f.service.readState()).activationState).toBe('blocked');
  expect(await readFile(join(f.root, 'config/gateway-credentials.json'), 'utf8')).toContain('refresh-1');
  await f.service.activate();
  expect((await f.service.readState()).activationState).toBe('ready');
  await f.service.close();
});

it('concurrent reads wait for the same persisted account initialization', async () => {
  const f = await setup();
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  await f.service.close();
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => false, automaticPolling: false });
  const [first, second] = await Promise.all([restored.readState(), restored.readState()]);
  expect(second).toEqual(first);
  expect(second.account?.id).toBe('1');
  expect(second.activationState).toBe('ready');
  await restored.close();
});

it('restores a failed activation on restart from a fresh bootstrap without signing in again', async () => {
  const f = await setup();
  f.client.bootstrap.mockRejectedValueOnce(new GatewayError('services_not_ready'));
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'blocked' });
  await expect(f.service.modelCredentials()).rejects.toMatchObject({ code: 'services_not_ready' });
  await f.service.close();
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => false, automaticPolling: false });
  try {
    expect(await restored.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: '1' } });
    expect(f.client.pollDevice).toHaveBeenCalledOnce();
    expect(f.activate).toHaveBeenCalledOnce();
  } finally { await restored.close(); }
});

it('blocks official activation when pending tasks appear during initial authorization', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const grant = await f.service.startAuthorization(); pending = true;
  await f.service.pollAuthorization(grant.attemptId);
  expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'blocked', activationError: { code: 'active_tasks' } });
  expect(f.activate).not.toHaveBeenCalled();
  await f.service.close();
});

it('restores existing signed-in manual sessions as official and keeps guests manual', async () => {
  const f = await setup();
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId); await f.service.close();
  await createGatewayConfigStore(f.root).writeConfiguration({ source: 'manual', bindingVersion: null });
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => false, automaticPolling: false });
  expect(await restored.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready' });
  await restored.logout(); await restored.close();
  await createGatewayConfigStore(f.root).writeConfiguration({ source: 'gateway', bindingVersion: null });
  const guest = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => false, automaticPolling: false });
  expect(await guest.readState()).toMatchObject({ source: 'manual', authState: 'signed_out' });
  await guest.close();
});

it('blocks logout before changing account state while tasks are active', async () => {
  let active = false;
  const f = await setup(undefined, undefined, undefined, () => active);
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  active = true;
  await expect(f.service.logout()).rejects.toMatchObject({ code: 'active_tasks' });
  expect((await f.service.readState()).authState).toBe('signed_in');
  expect(f.close).not.toHaveBeenCalled();
  active = false; await f.service.logout(); await f.service.close();
});

it('syncs profile photos independently of unavailable model services and protects the avatar route', async () => {
  const f = await setup();
  f.client.bootstrap.mockRejectedValueOnce(new GatewayError('services_not_ready'));
  const request = vi.spyOn(f.client, 'request').mockResolvedValue({ account: { id: '1', email: '1@example.test', verified: true, avatarUrl: 'https://lh3.googleusercontent.com/photo' } });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  const [first, second] = await Promise.all([f.service.readState(), f.service.readState()]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({ authState: 'signed_in', activationState: 'blocked', account: { id: '1', avatarUrl: 'https://lh3.googleusercontent.com/photo' } });
  expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/me', 'access-1');
  expect(f.activate).not.toHaveBeenCalled();
  const server = Fastify();
  try {
    await registerGatewayAccountRoutes(server, f.service);
    const image = await server.inject({ method: 'GET', url: '/gateway/avatar?accountId=1' });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('no-store');
    expect(image.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    expect((await server.inject({ method: 'GET', url: '/gateway/avatar?accountId=2' })).statusCode).toBe(404);
    expect(f.client.avatar).toHaveBeenCalledExactlyOnceWith('access-1', '1');
    await f.service.logout();
    expect((await server.inject({ method: 'GET', url: '/gateway/avatar?accountId=1' })).statusCode).toBe(401);
  } finally { await server.close(); await f.service.close(); }
});

it('ignores a profile response that arrives after signing out', async () => {
  const f = await setup();
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  let resolve!: (value: object) => void;
  vi.spyOn(f.client, 'request').mockImplementation(() => new Promise<object>(complete => { resolve = complete; }));
  const pending = f.service.readState();
  await vi.waitFor(() => expect(resolve).toBeDefined());
  await f.service.logout();
  resolve({ account: { id: '1', email: '1@example.test', verified: true, avatarUrl: 'https://lh3.googleusercontent.com/photo' } });
  expect(await pending).toMatchObject({ authState: 'signed_out', account: null });
  await expect(readFile(join(f.root, 'config/gateway-credentials.json'))).rejects.toThrow();
  await f.service.close();
});
