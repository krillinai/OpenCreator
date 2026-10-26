import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as module from '../../src/gateway/account-service.js';
import { GatewayError, type GatewayBootstrap } from '../../src/gateway/client.js';
import { ModelProbeError, createModelSelectionProbe } from '../../src/gateway/model-selection-probe.js';
import { createGatewayConfigStore } from '../../src/gateway/config-store.js';
import Fastify from 'fastify';
import { registerGatewayAccountRoutes } from '../../src/api/routes.gateway-account.js';
import { createOfficialModelAccess, type OfficialModelAccess } from '../../src/gateway/model-access.js';
import { createGatewayCreatorSource } from '../../src/gateway/creator-service-source.js';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { createRuntimeSource } from '../../src/gateway/runtime-source.js';
import type { AppServerRuntimeManager } from '../../src/codex/app-server-runtime-manager.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup(activate = vi.fn(async () => undefined), close = vi.fn(async () => undefined), hasPendingTasks = () => false, hasActiveTasks = () => false, modelAccess?: (root: string) => OfficialModelAccess, deferStartupActivation = false, automaticPolling = false) {
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
    async request(_path?: string) { return {}; },
    cancelPendingRequests: vi.fn()
  };
  const probe = vi.fn<NonNullable<Parameters<typeof module.createGatewayAccountService>[0]['probeModel']>>(async () => undefined);
  const service: module.GatewayAccountService = module.createGatewayAccountService({
    dataDir: root, client, activateRuntime: activate, closeRuntime: close, hasActiveTasks, hasPendingTasks, automaticPolling, deferStartupActivation,
    probeModel: probe,
    modelAccess: modelAccess?.(root)
  });
  return { service, root, client, activate, close, probe };
}

it('caches only coarse recharge state and its observation time from order responses', async () => {
  const f = await setup();
  await seedSavedAccount(f);
  const request = vi.spyOn(f.client, 'request').mockResolvedValue({
    order: {
      id: 'order-secret', amountUnits: '1000', status: 'completed',
      paymentStatus: 'paid', creditStatus: 'ready'
    }
  });
  try {
    await f.service.billing('/api/v1/billing/orders/order-secret');
    const snapshot = f.service.peekTelemetryRechargeState();
    expect(snapshot.state).toBe('recharged');
    expect(Number.isNaN(Date.parse(snapshot.observedAt))).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('order-secret');
    expect(JSON.stringify(snapshot)).not.toContain('1000');
    expect(request).toHaveBeenCalledOnce();
    request.mockResolvedValue({ order: { status: 'failed' } });
    await f.service.billing('/api/v1/billing/orders/order-secret');
    expect(f.service.peekTelemetryRechargeState().state).toBe('recharged');
  } finally { await f.service.close(); }
});

it('reports an authoritative empty order list as not recharged', async () => {
  const f = await setup();
  await seedSavedAccount(f);
  vi.spyOn(f.client, 'request').mockResolvedValue({ items: [] });
  try {
    await f.service.billing('/api/v1/billing/orders');
    expect(f.service.peekTelemetryRechargeState().state).toBe('not_recharged');
  } finally { await f.service.close(); }
});

it('saves a compatible model choice without invoking the paid probe', async () => {
  const f = await setupCachedAccount({ models: [{ id: 'first', modality: 'text', capabilities: ['responses'] }, { id: 'second', modality: 'text', capabilities: ['responses'] }], defaults: { text: 'first' } });
  try {
    f.activate.mockClear(); f.probe.mockRejectedValue(new ModelProbeError('model_probe_failed'));
    await expect(f.service.selectModel('text', 'second')).resolves.toMatchObject({ selectedModels: { text: 'second' } });
    expect((await createGatewayConfigStore(f.root).readCredentials())?.defaults?.text).toBe('second');
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.activate).toHaveBeenCalledOnce();
    await expect(f.service.selectModel('text', 'missing')).rejects.toMatchObject({ code: 'invalid_model' });
    expect(f.service.peekState().selectedModels?.text).toBe('second');
  } finally { await f.service.close(); }
});

it('checks a task model without changing account defaults', async () => {
  const f = await setupCachedAccount({ models: [{ id: 'first', modality: 'text', capabilities: ['responses'] }, { id: 'second', modality: 'text', capabilities: ['responses'] }], defaults: { text: 'first' } });
  try {
    await expect(f.service.probeModel('text', 'second')).resolves.toMatchObject({ model: 'second', costBearer: 'customer' });
    expect(f.probe).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }), expect.objectContaining({ modelKey: f.bootstrap.modelKey }), true, undefined);
    expect(f.service.peekState().selectedModels?.text).toBe('first');
  } finally { await f.service.close(); }
});

it.each([true, false])('retries an explicit 401 probe only when the model key is replaced (%s)', async replaced => {
  const f = await setupCachedAccount();
  const error = new ModelProbeError('model_probe_auth_required');
  f.probe.mockRejectedValueOnce(error);
  f.client.bootstrap.mockClear().mockResolvedValue(replaced
    ? { ...f.bootstrap, modelKey: 'replacement-model-key', keyVersion: '2', bindingVersion: '1:2' }
    : f.bootstrap);
  try {
    const result = f.service.probeModel('text', 'gateway-text', { textApi: 'chat/completions' });
    if (replaced) {
      await expect(result).resolves.toMatchObject({ model: 'gateway-text', operation: 'chat/completions' });
      expect(f.probe).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'gateway-text' }),
        expect.objectContaining({ modelKey: 'replacement-model-key', keyVersion: '2' }), true, { textApi: 'chat/completions' });
    } else await expect(result).rejects.toBe(error);
    expect(f.probe).toHaveBeenCalledTimes(replaced ? 2 : 1);
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    expect(f.service.peekState().selectedModels?.text).toBe('gateway-text');
  } finally { await f.service.close(); }
});

it.each(['model_probe_credits_insufficient', 'model_probe_inconclusive'])('does not retry or refresh model credentials for %s', async code => {
  const f = await setupCachedAccount();
  const error = new ModelProbeError(code);
  f.probe.mockRejectedValueOnce(error);
  f.client.bootstrap.mockClear();
  try {
    await expect(f.service.probeModel('text', 'gateway-text')).rejects.toBe(error);
    expect(f.probe).toHaveBeenCalledOnce();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.service.peekState().selectedModels?.text).toBe('gateway-text');
  } finally { await f.service.close(); }
});

async function seedSavedAccount(f: Awaited<ReturnType<typeof setup>>) {
  const bootstrap = await f.client.bootstrap('access-1');
  const store = createGatewayConfigStore(f.root);
  await store.writeConfiguration({ source: 'gateway', bindingVersion: bootstrap.bindingVersion, selectedModels: bootstrap.defaults });
  await store.writeCredentials({ ...bootstrap, accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900, accessExpiresAt: new Date(Date.now() + 900_000).toISOString() });
  f.client.bootstrap.mockClear();
  return bootstrap;
}

async function setupActivationRetry() {
  const f = await setup();
  await seedSavedAccount(f); await f.service.close();
  f.activate.mockClear(); f.close.mockClear();
  let busy = false; let pending = false;
  const service = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close,
    hasActiveTasks: () => busy, hasPendingTasks: () => pending, deferStartupActivation: true, probeModel: f.probe });
  f.client.bootstrap.mockRejectedValueOnce(new GatewayError('gateway_unavailable', 503, { path: '/api/v1/client/bootstrap', reason: 'timeout' }));
  await service.startBackgroundRestore();
  return { ...f, service, setBusy(value: boolean) { busy = value; }, setPending(value: boolean) { pending = value; } };
}

it('recovers a transient activation failure on account polling with throttling and no paid probe or key rotation', async () => {
  const f = await setupActivationRetry();
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'blocked', activationError: {
      code: 'gateway_unavailable', stage: 'bootstrap', request: { path: '/api/v1/client/bootstrap', reason: 'timeout' } } });
    await Promise.all([f.service.readState(), f.service.readState()]);
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    clock.mockReturnValue(now + 31_000);
    await Promise.all([f.service.readState(), f.service.readState()]);
    await vi.waitFor(() => expect(f.service.peekState().activationState).toBe('ready'));
    expect(f.client.bootstrap).toHaveBeenCalledTimes(2);
    expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false, modelUsePolicy: 'cached-key-v1' });
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.client.pollDevice).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('defers automatic recovery while active or remote pending tasks exist', async () => {
  const f = await setupActivationRetry();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
  try {
    f.setBusy(true); await f.service.readState();
    await vi.waitFor(() => expect(f.service.peekState().activationState).toBe('blocked'));
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    f.setBusy(false); f.setPending(true); await f.service.readState();
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    f.setPending(false); await f.service.readState();
    await vi.waitFor(() => expect(f.service.peekState().activationState).toBe('ready'));
    expect(f.client.bootstrap).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('continues throttling repeated connection failures and stops retries after sign-out', async () => {
  const f = await setupActivationRetry();
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 31_000);
  try {
    f.client.bootstrap.mockRejectedValue(new GatewayError('gateway_unavailable'));
    await f.service.readState();
    await vi.waitFor(() => expect(f.client.bootstrap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(f.service.peekState().activationState).toBe('blocked'));
    await f.service.readState();
    expect(f.client.bootstrap).toHaveBeenCalledTimes(2);
    await f.service.logout(); clock.mockReturnValue(now + 120_000);
    expect(await f.service.readState()).toMatchObject({ authState: 'signed_out', activationState: 'inactive' });
    expect(f.client.bootstrap).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); await f.service.close(); }
});

async function setupCachedAccount(overrides: Partial<GatewayBootstrap> = {}) {
  const f = await setup();
  const bootstrap: GatewayBootstrap = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct', baseUrl: 'https://openrouter.ai/api/v1', keyRotation: false, modelUsePolicy: 'cached-key-v1', ...overrides };
  f.client.bootstrap.mockResolvedValue(bootstrap);
  const grant = await f.service.startAuthorization();
  await f.service.pollAuthorization(grant.attemptId);
  return { ...f, bootstrap };
}

it('persists the ChatAnywhere route and rejects changes during active use', async () => {
  const f = await setupCachedAccount({ schemaVersion: 2, supplier: 'chatanywhere', transport: 'supplier-direct', baseUrl: 'https://api.chatanywhere.tech/v1' });
  try {
    f.client.bootstrap.mockResolvedValue({ ...f.bootstrap, baseUrl: 'https://api.chatanywhere.org/v1' });
    expect(await f.service.setRegion('overseas')).toMatchObject({ supplier: 'chatanywhere', supplierRegion: 'overseas', activationState: 'ready' });
    expect((await f.service.modelCredentials()).baseUrl).toBe('https://api.chatanywhere.org/v1');
    expect((await createGatewayConfigStore(f.root).readConfiguration()).region).toBe('overseas');
    expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false, region: 'overseas' });
    const use = await f.service.beginModelUse();
    await expect(f.service.setRegion('domestic')).rejects.toMatchObject({ code: 'active_tasks' });
    await use.release(); await f.service.logout();
    expect(f.service.peekState().supplier).toBeUndefined();
  } finally { await f.service.close(); }
});

it('pauses cached requests during migration and resumes with the new supplier', async () => {
  const f = await setupCachedAccount();
  try {
    f.client.bootstrap.mockRejectedValueOnce(new GatewayError('supplier_migrating', 409));
    await expect(f.service.recoverModelCredentials('1')).rejects.toMatchObject({ code: 'supplier_migrating' });
    await expect(f.service.beginModelUse({ recovery: true })).rejects.toMatchObject({ code: 'supplier_migrating' });
    expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'blocked', activationError: { code: 'supplier_migrating' } });
    f.client.bootstrap.mockResolvedValue({ ...f.bootstrap, schemaVersion: 2, supplier: 'chatanywhere', transport: 'supplier-direct', modelKey: 'new-ca-key', keyVersion: 'ca-key-version', baseUrl: 'https://api.chatanywhere.tech/v1' });
    await f.service.activate();
    expect(f.service.peekState()).toMatchObject({ supplier: 'chatanywhere', activationState: 'ready' });
    expect((await f.service.modelCredentials()).modelKey).toBe('new-ca-key');
  } finally { await f.service.close(); }
});

it('never repeats a paid model probe on a different supplier after credential recovery', async () => {
  const f = await setupCachedAccount();
  try {
    f.probe.mockRejectedValueOnce(new ModelProbeError('model_probe_auth_required'));
    f.client.bootstrap.mockResolvedValue({ ...f.bootstrap, schemaVersion: 2, supplier: 'chatanywhere', transport: 'supplier-direct', modelKey: 'new-ca-key', keyVersion: 'ca-key-version', baseUrl: 'https://api.chatanywhere.tech/v1' });
    await expect(f.service.probeModel('text', 'gateway-text')).rejects.toMatchObject({ code: 'supplier_binding_changed' });
    expect(f.probe).toHaveBeenCalledOnce();
  } finally { await f.service.close(); }
});

it('automatically finishes first-login activation after a supplier migration', async () => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, false, true);
  const bootstrap = { ...await f.client.bootstrap('access-1'), schemaVersion: 2 as const, supplier: 'chatanywhere' as const, transport: 'supplier-direct' as const, keyRotation: false, modelUsePolicy: 'cached-key-v1' as const, baseUrl: 'https://api.chatanywhere.tech/v1' };
  f.client.bootstrap.mockRejectedValueOnce(new GatewayError('supplier_migrating', 409)).mockResolvedValue(bootstrap);
  vi.useFakeTimers();
  try {
    const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
    expect(f.service.peekState().activationError?.code).toBe('supplier_migrating');
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(f.service.peekState()).toMatchObject({ activationState: 'ready', supplier: 'chatanywhere', account: { id: '1' } }));
    expect(f.activate).toHaveBeenCalledOnce();
  } finally { await f.service.close(); vi.useRealTimers(); }
});

async function setupCatalogAccount(hasActiveTasks = () => false, deferStartupActivation = false) {
  let raw!: GatewayBootstrap; let ids: string[] | undefined; let failure: number | undefined;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    expect(options?.method ?? 'GET').toBe('GET'); expect(options?.body).toBeUndefined();
    if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
    expect(String(url)).toContain('/models/user?output_modalities=all');
    expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${raw.modelKey}`);
    return failure ? Response.json({}, { status: failure }) : Response.json({ data: (ids ?? raw.models.map(model => model.id)).map(id => ({ id })) });
  });
  const f = await setup(undefined, undefined, undefined, hasActiveTasks, root => createOfficialModelAccess({
    dataDir: root, fetcher, readProxy: async () => ''
  }), deferStartupActivation);
  raw = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct', baseUrl: 'https://openrouter.ai/api/v1',
    models: ['deepseek/deepseek-v3.2', 'deepseek/deepseek-r1', 'openai/gpt-4.1-mini', 'openai/gpt-6-sol', 'qwen/qwen3-coder', 'anthropic/claude-sonnet-4.6']
      .map(id => ({ id, modality: 'text', capabilities: ['responses'] })), defaults: { text: 'deepseek/deepseek-v3.2' } };
  f.client.bootstrap.mockResolvedValue(raw);
  const request = vi.spyOn(f.client, 'request').mockImplementation(async (path?: string) => {
    if (path === '/api/v1/client/probe-credentials') throw new Error('Automatic probing must not request credentials');
    return path?.startsWith('/api/v1/client/models') ? { models: raw.models } : { account: raw.account };
  });
  return { ...f, raw, fetcher, request,
    setCatalogIDs(value: string[]) { ids = value; failure = undefined; }, setFailure(status: number) { failure = status; },
    async login() { const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId); } };
}

it.each(['openrouter', '88api'] as const)('有效模型凭据下连续一百次调用不访问账号网关，账户令牌过期也不阻塞 (%s)', async supplier => {
  const f = await setupCachedAccount(supplier === '88api' ? { schemaVersion: 2, supplier: '88api', transport: 'supplier-direct', baseUrl: 'https://api.88api.ai/v1' } : {});
  const request = vi.spyOn(f.client, 'request').mockRejectedValue(new GatewayError('gateway_unavailable'));
  f.client.bootstrap.mockClear().mockRejectedValue(new GatewayError('gateway_unavailable'));
  f.client.refresh.mockRejectedValue(new GatewayError('gateway_unavailable'));
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  try {
    for (let index = 0; index < 100; index++) {
      const use = await f.service.beginModelUse();
      expect(use.credentials.modelKey).toBe(f.bootstrap.modelKey);
      await use.release(); await use.release();
    }
    expect(request).not.toHaveBeenCalled();
    expect(f.client.refresh).not.toHaveBeenCalled();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'ready' });
    expect((await createGatewayConfigStore(f.root).readCredentials())?.modelUsePolicy).toBe('cached-key-v1');
  } finally { clock.mockRestore(); await f.service.close(); }
});

it.each(['openrouter', '88api'] as const)('稳定密钥账号重启时从本地激活，账号网关离线不影响恢复 (%s)', async supplier => {
  const f = await setupCachedAccount(supplier === '88api' ? { schemaVersion: 2, supplier: '88api', transport: 'supplier-direct', baseUrl: 'https://api.88api.ai/v1' } : {});
  await f.service.close();
  f.client.bootstrap.mockClear().mockRejectedValue(new GatewayError('gateway_unavailable'));
  f.client.refresh.mockRejectedValue(new GatewayError('gateway_unavailable'));
  const activate = vi.fn(async () => undefined);
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: activate, closeRuntime: async () => undefined, hasActiveTasks: () => false, automaticPolling: false, deferStartupActivation: true });
  try {
    await restored.initialize(); await restored.startBackgroundRestore();
    const use = await restored.beginModelUse(); await use.release();
    expect(activate).toHaveBeenCalledOnce();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.client.refresh).not.toHaveBeenCalled();
  } finally { await restored.close(); }
});

it('并发认证恢复只获取一次新密钥，旧调用保持凭据快照', async () => {
  const f = await setupCachedAccount();
  const first = await f.service.beginModelUse();
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  f.client.bootstrap.mockClear().mockImplementation(async () => {
    await waiting;
    return { ...f.bootstrap, modelKey: 'replacement-model-key', keyVersion: '2' };
  });
  try {
    const pending = Promise.all([f.service.recoverModelCredentials('1'), f.service.recoverModelCredentials('1')]);
    await expect.poll(() => f.client.bootstrap.mock.calls.length).toBe(1);
    resume();
    const results = await pending;
    expect(results.map(value => value.modelKey)).toEqual(['replacement-model-key', 'replacement-model-key']);
    expect(first.credentials.modelKey).toBe(f.bootstrap.modelKey);
    const next = await f.service.beginModelUse();
    expect(next.credentials.modelKey).toBe('replacement-model-key');
    await next.release(); await first.release();
    await f.service.recoverModelCredentials('1');
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
  } finally { resume(); await first.release(); await f.service.close(); }
});

it('活跃任务恢复密钥时保留模型目录，空闲后再应用新默认模型', async () => {
  const f = await setupCachedAccount();
  const use = await f.service.beginModelUse();
  const next = { ...f.bootstrap, modelKey: 'new-key', keyVersion: '2', models: [{ id: 'new-text', modality: 'text' as const, capabilities: ['responses'] }], defaults: { text: 'new-text' } };
  f.client.bootstrap.mockResolvedValue(next);
  const request = vi.spyOn(f.client, 'request').mockImplementation(async path => path === '/api/v1/me' ? { account: f.bootstrap.account } : { models: next.models });
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const updated = await f.service.recoverModelCredentials('1');
    expect(updated).toMatchObject({ modelKey: 'new-key', defaults: f.bootstrap.defaults, models: f.bootstrap.models });
    expect(f.activate).toHaveBeenCalledOnce();
    await use.release();
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    await f.service.readState();
    expect((await f.service.modelCredentials()).defaults.text).toBe('new-text');
    expect(f.activate).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('/api/v1/client/models', 'access-1');
  } finally { clock?.mockRestore(); await use.release(); await f.service.close(); }
});

it.each(['binding-first', 'refresh-first'] as const)('绑定同步与令牌刷新并发时保留新密钥和新令牌（%s）', async order => {
  const f = await setupCachedAccount();
  let resumeBinding!: () => void;
  let resumeRefresh!: () => void;
  const bindingWaiting = new Promise<void>(resolve => { resumeBinding = resolve; });
  const refreshWaiting = new Promise<void>(resolve => { resumeRefresh = resolve; });
  f.client.bootstrap.mockClear().mockImplementation(async () => {
    await bindingWaiting;
    return { ...f.bootstrap, modelKey: 'replacement-model-key', keyVersion: '2', bindingVersion: '1:2' };
  });
  f.client.refresh.mockImplementation(async () => {
    await refreshWaiting;
    return { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 };
  });
  const request = vi.spyOn(f.client, 'request').mockImplementation(async (_path?: string, access?: string) => {
    if (access !== 'new-access') throw new GatewayError('auth_required', 401);
    return { available: true };
  });
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  let recovery: ReturnType<typeof f.service.recoverModelCredentials> | undefined;
  let billing: Promise<unknown> | undefined;
  try {
    recovery = f.service.recoverModelCredentials('1');
    await expect.poll(() => f.client.bootstrap.mock.calls.length).toBe(1);
    clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    billing = f.service.billing('/api/v1/billing/summary').then(value => ({ value }), error => ({ error }));
    await expect.poll(() => f.client.refresh.mock.calls.length).toBe(1);
    if (order === 'binding-first') { resumeBinding(); await recovery; resumeRefresh(); }
    else { resumeRefresh(); await billing; resumeBinding(); }
    await recovery;
    expect(await billing).toEqual({ value: { available: true } });
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/billing/summary', 'new-access', undefined);
    expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'ready' });
    expect(await f.service.modelCredentials()).toMatchObject({ modelKey: 'replacement-model-key', keyVersion: '2', bindingVersion: '1:2' });
    const persisted = await createGatewayConfigStore(f.root).readCredentials();
    expect(persisted).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', modelKey: 'replacement-model-key', keyVersion: '2' });
    expect(persisted?.modelAccessError).toBeUndefined();
  } finally {
    resumeBinding(); resumeRefresh();
    await Promise.allSettled([recovery, billing]);
    clock?.mockRestore(); await f.service.close();
  }
});

it.each(['binding', 'refresh'] as const)('文本模型激活期间的凭据更新不会被旧快照覆盖（%s）', async update => {
  const f = await setupCachedAccount({
    models: [
      { id: 'gateway-text', modality: 'text', capabilities: ['responses'] },
      { id: 'second-text', modality: 'text', capabilities: ['responses'] },
      { id: 'first-image', modality: 'image', capabilities: [] }
    ], defaults: { text: 'gateway-text', image: 'first-image' }
  });
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  f.activate.mockImplementationOnce(async () => { await waiting; });
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  let selection: ReturnType<typeof f.service.selectModel> | undefined;
  try {
    selection = f.service.selectModel('text', 'second-text');
    await expect.poll(() => f.activate.mock.calls.length).toBe(2);
    if (update === 'binding') {
      f.client.bootstrap.mockResolvedValue({
        ...f.bootstrap, modelKey: 'replacement-model-key', keyVersion: '2', bindingVersion: '1:2',
        models: [...f.bootstrap.models.filter(model => model.modality !== 'image'), { id: 'second-image', modality: 'image', capabilities: [] }],
        defaults: { text: 'gateway-text', image: 'second-image' }
      });
      await f.service.recoverModelCredentials('1');
    } else {
      clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
      await f.service.refresh();
    }
    resume(); await selection;
    const credentials = await f.service.modelCredentials();
    expect(credentials.defaults.text).toBe('second-text');
    const store = createGatewayConfigStore(f.root);
    const persisted = await store.readCredentials();
    expect(persisted?.defaults).toEqual(credentials.defaults);
    expect(f.service.peekState().selectedModels).toEqual(credentials.defaults);
    expect((await store.readConfiguration()).selectedModels).toEqual(credentials.defaults);
    if (update === 'binding') {
      expect(credentials).toMatchObject({ modelKey: 'replacement-model-key', keyVersion: '2', bindingVersion: '1:2', defaults: { image: 'second-image' } });
      expect(persisted).toMatchObject({ modelKey: 'replacement-model-key', keyVersion: '2', bindingVersion: '1:2', defaults: { image: 'second-image' } });
      expect(persisted?.models).toEqual(credentials.models);
    } else expect(persisted).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  } finally {
    resume(); await Promise.allSettled([selection]);
    clock?.mockRestore(); await f.service.close();
  }
});

it('后台账号同步挂起时仍可并发调用模型，且不会堆积后台请求', async () => {
  const f = await setupCachedAccount();
  await f.service.close();
  vi.useFakeTimers();
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  f.client.bootstrap.mockClear().mockImplementation(async () => { await waiting; return f.bootstrap; });
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: async () => undefined, closeRuntime: async () => undefined, hasActiveTasks: () => false });
  try {
    await restored.initialize();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    const uses = await Promise.all(Array.from({ length: 20 }, () => restored.beginModelUse()));
    await Promise.all(uses.map(use => use.release()));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    resume();
  } finally { resume(); await restored.close(); vi.useRealTimers(); }
});

it('稳定密钥模式退出后拒绝新调用，迟到的密钥恢复不会重新登录', async () => {
  const f = await setupCachedAccount();
  let resume!: () => void;
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  f.client.bootstrap.mockClear().mockImplementation(async () => { await waiting; return { ...f.bootstrap, modelKey: 'late-model-key', keyVersion: '2' }; });
  const recovery = f.service.recoverModelCredentials('1');
  const rejected = expect(recovery).rejects.toMatchObject({ code: 'auth_required' });
  try {
    await expect.poll(() => f.client.bootstrap.mock.calls.length).toBe(1);
    await f.service.logout(); resume(); await rejected;
    await expect(f.service.beginModelUse()).rejects.toMatchObject({ code: 'auth_required' });
    expect(await createGatewayConfigStore(f.root).readCredentials()).toBeUndefined();
  } finally { resume(); await rejected; await f.service.close(); }
});

it.each([
  ['account_disabled', 403], ['payment_review_required', 403], ['auth_required', 401], ['gateway_unavailable', 503]
] as const)('后台确认 %s 时正确处理缓存，重启也保留已确认的失效状态', async (code, status) => {
  const f = await setupCachedAccount(); await f.service.close();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  f.client.bootstrap.mockClear().mockRejectedValue(new GatewayError(code, status));
  const close = vi.fn(async () => undefined);
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: async () => undefined, closeRuntime: close, hasActiveTasks: () => false });
  try {
    await restored.initialize(); await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    if (status === 503) {
      const use = await restored.beginModelUse(); await use.release();
      expect(restored.peekState().activationState).toBe('ready');
      expect(close).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(async () => expect((await createGatewayConfigStore(f.root).readCredentials())?.modelAccessError).toBe(code));
      await expect(restored.beginModelUse()).rejects.toMatchObject({ code });
      expect(close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(f.client.bootstrap).toHaveBeenCalledOnce();
    }
  } finally { await restored.close(); vi.useRealTimers(); }
  if (status !== 503) {
    const activate = vi.fn(async () => undefined);
    const restarted = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: activate, closeRuntime: async () => undefined, hasActiveTasks: () => false, automaticPolling: false, deferStartupActivation: true });
    try {
      await restarted.initialize(); await restarted.startBackgroundRestore();
      await expect(restarted.beginModelUse()).rejects.toMatchObject({ code });
      expect(activate).not.toHaveBeenCalled();
    } finally { await restarted.close(); }
  }
});

it.each(['refresh', 'bootstrap'] as const)('异步任务从 %s 确认撤销时不等待自己的 Runtime 关闭', async source => {
  const f = await setupCachedAccount(); await f.service.close();
  let finishWorker!: () => void;
  const worker = new Promise<void>(resolve => { finishWorker = resolve; });
  const close = vi.fn(async () => { await worker; });
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: async () => undefined, closeRuntime: close, hasActiveTasks: () => false, automaticPolling: false });
  await restored.initialize();
  const clock = source === 'refresh' ? vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000) : undefined;
  if (source === 'refresh') f.client.refresh.mockRejectedValue(new GatewayError('auth_required', 401));
  else f.client.bootstrap.mockRejectedValue(new GatewayError('account_disabled', 403));
  try {
    await expect(restored.recoverModelCredentials('1')).rejects.toMatchObject({ code: source === 'refresh' ? 'auth_required' : 'account_disabled' });
    expect(close).toHaveBeenCalledOnce();
    await expect(restored.beginModelUse()).rejects.toBeInstanceOf(GatewayError);
  } finally { finishWorker(); clock?.mockRestore(); await restored.close(); }
});

it.each(['profile', 'catalog', 'billing', 'avatar'] as const)('按需 %s 接口确认撤销后立即拒绝本地模型请求', async surface => {
  const f = await setupCachedAccount();
  const error = new GatewayError('auth_required', 401);
  const request = vi.spyOn(f.client, 'request').mockImplementation(async path => {
    if (surface === 'catalog' && path === '/api/v1/me') return { account: f.bootstrap.account };
    throw error;
  });
  f.client.avatar.mockRejectedValue(error);
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    if (surface === 'avatar') {
      const store = createGatewayConfigStore(f.root);
      await store.writeCredentials({ ...(await store.readCredentials())!, account: { ...f.bootstrap.account, avatarUrl: 'https://example.test/avatar.png' } });
      await f.service.close();
      const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: async () => undefined, closeRuntime: async () => undefined, hasActiveTasks: () => false, automaticPolling: false });
      try {
        await restored.initialize(); await expect(restored.readAvatar('1')).rejects.toMatchObject({ code: 'auth_required' });
        await expect(restored.beginModelUse()).rejects.toMatchObject({ code: 'auth_required' });
      } finally { await restored.close(); }
    } else {
      if (surface === 'profile' || surface === 'catalog') {
        clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
        await f.service.readState();
      } else if (surface === 'billing') await expect(f.service.billing('/api/v1/billing/summary')).rejects.toMatchObject({ code: 'auth_required' });
      await expect(f.service.beginModelUse()).rejects.toMatchObject({ code: 'auth_required' });
    }
    expect(request.mock.calls.length || f.client.avatar.mock.calls.length).toBeGreaterThan(0);
    expect((await createGatewayConfigStore(f.root).readCredentials())?.modelAccessError).toBe('auth_required');
  } finally { clock?.mockRestore(); await f.service.close(); }
});

it('本地账号初始化不联网，恢复期间状态可读且任务不会回退到个人模型', async () => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, true);
  const bootstrap = await seedSavedAccount(f);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.client.bootstrap.mockImplementation(async () => { await waiting; return bootstrap; });
  try {
    await f.service.initialize();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.client.refresh).not.toHaveBeenCalled();
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'loading', account: bootstrap.account, selectedModels: bootstrap.defaults });
    f.service.startBackgroundRestore();
    f.service.startBackgroundRestore();
    await expect.poll(() => f.client.bootstrap.mock.calls.length).toBe(1);
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', activationState: 'loading' });
    const manual = { startTurn: vi.fn() } as unknown as AppServerRuntimeManager;
    const runtime = createRuntimeSource(manual, f.service.peekState, () => undefined);
    expect(() => runtime.startTurn({} as Parameters<AppServerRuntimeManager['startTurn']>[0])).toThrow(GatewayError);
    expect(manual.startTurn).not.toHaveBeenCalled();
    release();
    await expect.poll(() => f.service.peekState().activationState).toBe('ready');
    expect(f.activate).toHaveBeenCalledOnce();
  } finally { release(); await f.service.close(); }
});

it.each(['openrouter', '88api', 'chatanywhere'] as const)('直连账号初始化只读缓存，慢模型目录在后台恢复（%s）', async supplier => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
    await waiting;
    options?.signal?.throwIfAborted();
    return Response.json({ data: [{ id: 'gateway-text' }] });
  });
  const f = await setup(undefined, undefined, undefined, undefined, root => createOfficialModelAccess({ dataDir: root, fetcher, readProxy: async () => '' }), true);
  const bootstrap: GatewayBootstrap = { ...await f.client.bootstrap('access-1'), schemaVersion: 2, supplier,
    transport: supplier === 'openrouter' ? 'openrouter-direct' : 'supplier-direct',
    baseUrl: supplier === 'openrouter' ? 'https://openrouter.ai/api/v1' : supplier === '88api' ? 'https://api.88api.ai/v1' : 'https://api.chatanywhere.tech/v1' };
  f.client.bootstrap.mockResolvedValue(bootstrap);
  await seedSavedAccount(f);
  try {
    // A pending fetch must not hold either initialization or account reads open.
    await f.service.initialize();
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'loading', models: bootstrap.models });
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.client.refresh).not.toHaveBeenCalled();
    const restoring = f.service.startBackgroundRestore();
    void f.service.startBackgroundRestore();
    await expect.poll(() => fetcher.mock.calls.some(([url]) => String(url).includes('/models'))).toBe(true);
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', activationState: 'loading' });
    const manual = { startTurn: vi.fn() } as unknown as AppServerRuntimeManager;
    const runtime = createRuntimeSource(manual, f.service.peekState, () => undefined);
    expect(() => runtime.startTurn({} as Parameters<AppServerRuntimeManager['startTurn']>[0])).toThrow(GatewayError);
    expect(manual.startTurn).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
    release(); await restoring;
    expect(f.service.peekState().activationState).toBe('ready');
    expect(f.activate).toHaveBeenCalledOnce();
    expect(f.probe).not.toHaveBeenCalled();
  } finally { release(); await f.service.close(); }
});

it.each(['close', 'logout'] as const)('直连模型目录挂起时可以%s，不会激活迟到的恢复结果', async action => {
  let catalogSignal: AbortSignal | undefined;
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
    catalogSignal = options!.signal!;
    return new Promise<Response>((_resolve, reject) => {
      catalogSignal!.addEventListener('abort', () => reject(catalogSignal!.reason), { once: true });
    });
  });
  const f = await setup(undefined, undefined, undefined, undefined, root => createOfficialModelAccess({ dataDir: root, fetcher, readProxy: async () => '' }), true);
  const bootstrap: GatewayBootstrap = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct', baseUrl: 'https://openrouter.ai/api/v1' };
  f.client.bootstrap.mockResolvedValue(bootstrap);
  await seedSavedAccount(f);
  try {
    await f.service.initialize();
    const restoring = f.service.startBackgroundRestore();
    await expect.poll(() => !!catalogSignal).toBe(true);
    await f.service[action](); await restoring;
    expect(catalogSignal!.aborted).toBe(true);
    expect(f.activate).not.toHaveBeenCalled();
    if (action === 'logout') expect(f.service.peekState()).toMatchObject({ source: 'manual', authState: 'signed_out', activationState: 'inactive' });
  } finally { await f.service.close(); }
});

it('后台恢复失败时保留登录态并允许重试', async () => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, true);
  await seedSavedAccount(f);
  f.client.bootstrap.mockRejectedValueOnce(new GatewayError('gateway_unavailable'));
  try {
    await f.service.initialize();
    f.service.startBackgroundRestore();
    await expect.poll(() => f.service.peekState().activationState).toBe('blocked');
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', account: { id: '1' } });
    await f.service.activate();
    expect(f.service.peekState().activationState).toBe('ready');
  } finally { await f.service.close(); }
});

it('账号资料刷新不阻塞缓存状态读取，连续读取只发送一个请求', async () => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, true);
  const bootstrap = await seedSavedAccount(f);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const request = vi.spyOn(f.client, 'request').mockImplementation(async () => {
    await waiting; return { account: { ...bootstrap.account, email: 'updated@example.test' } };
  });
  try {
    await f.service.initialize(); f.service.startBackgroundRestore();
    await expect.poll(() => f.service.peekState().activationState).toBe('ready');
    const first = await f.service.readState();
    await f.service.readState();
    expect(first.account).toEqual(bootstrap.account);
    expect(request).toHaveBeenCalledOnce();
    release();
    await expect.poll(() => f.service.peekState().account?.email).toBe('updated@example.test');
  } finally { release(); await f.service.close(); }
});

it.each(['close', 'logout'] as const)('后台恢复等待网络时可以%s，迟到结果不会激活模型', async action => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, true);
  await seedSavedAccount(f);
  let rejectBootstrap!: (error: Error) => void;
  f.client.bootstrap.mockImplementation(() => new Promise((_resolve, reject) => { rejectBootstrap = reject; }));
  f.client.cancelPendingRequests.mockImplementation(() => rejectBootstrap?.(new GatewayError('gateway_unavailable')));
  try {
    await f.service.initialize(); f.service.startBackgroundRestore();
    await expect.poll(() => f.client.bootstrap.mock.calls.length).toBe(1);
    await f.service[action]();
    expect(f.client.cancelPendingRequests).toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
    if (action === 'logout') expect(f.service.peekState()).toMatchObject({ source: 'manual', authState: 'signed_out', activationState: 'inactive' });
  } finally { await f.service.close(); }
});

it('启动用量上报挂起时关闭会取消请求，不会继续启动或发送结束上报', async () => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, true);
  await seedSavedAccount(f);
  const store = createGatewayConfigStore(f.root);
  await store.writeCredentials({ ...(await store.readCredentials())!, keyRotation: true });
  let rejectUsage!: (error: Error) => void;
  const request = vi.spyOn(f.client, 'request').mockImplementation(() => new Promise((_resolve, reject) => { rejectUsage = reject; }));
  f.client.cancelPendingRequests.mockImplementation(() => rejectUsage?.(new GatewayError('gateway_unavailable')));
  try {
    await f.service.initialize(); f.service.startBackgroundRestore();
    await expect.poll(() => request.mock.calls.length).toBe(1);
    await f.service.close();
    expect(request).toHaveBeenCalledOnce();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
  } finally { await f.service.close(); }
});

it('returns signed-in state immediately while bootstrap is still preparing model services', async () => {
  const f = await setup();
  const bootstrap = await f.client.bootstrap('access-1');
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.client.bootstrap.mockImplementationOnce(async () => { await waiting; return bootstrap; });
  const grant = await f.service.startAuthorization();
  const work = f.service.pollAuthorization(grant.attemptId);
  try {
    await expect.poll(() => f.service.peekState().authState).toBe('signed_in');
    const server = Fastify();
    try {
      await registerGatewayAccountRoutes(server, f.service);
      const response = await server.inject({ method: 'GET', url: '/gateway/account' });
      expect(response.json()).toMatchObject({ authState: 'signed_in', activationState: 'loading' });
      expect(JSON.stringify(response.json())).not.toMatch(/access-1|refresh-1|private-1/);
      const returned = await server.inject({ method: 'POST', url: '/gateway/auth/check', payload: {} });
      expect(returned.json()).toMatchObject({ authState: 'signed_in', activationState: 'loading' });
    } finally { await server.close(); }
  } finally { release(); await work; await f.service.close(); }
});

it('selects without inference and explicitly tests OpenRouter while the account gateway is offline', async () => {
  const f = await setupCachedAccount();
  const request = vi.spyOn(f.client, 'request').mockRejectedValue(new GatewayError('gateway_unavailable'));
  f.client.bootstrap.mockClear().mockRejectedValue(new GatewayError('gateway_unavailable'));
  f.client.refresh.mockRejectedValue(new GatewayError('gateway_unavailable'));
  const fetcher = vi.fn<typeof fetch>(async url => String(url).endsWith('/responses')
    ? Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'model_probe', arguments: '{"ok":true}' }] })
    : Response.json({ choices: [{ message: { content: 'OK' } }] }));
  const probe = createModelSelectionProbe({ dataDir: f.root, fetcher, readProxy: async () => '' });
  f.probe.mockImplementation(probe.probe);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  try {
    await f.service.selectModel('text', 'gateway-text');
    expect(fetcher).not.toHaveBeenCalled();
    await f.service.probeModel('text', 'gateway-text');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/responses'
    ]);
    const task = await f.service.beginModelUse();
    for (const [, options] of fetcher.mock.calls) {
      expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${task.credentials.modelKey}`);
    }
    await task.release();
    expect(request).not.toHaveBeenCalled();
    expect(f.client.bootstrap).not.toHaveBeenCalled();
    expect(f.client.refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(f.service.peekState())).not.toContain(f.bootstrap.modelKey);
    await f.service.logout();
    await expect(f.service.probeModel('text', 'gateway-text')).rejects.toMatchObject({ code: 'auth_required' });
    expect(fetcher).toHaveBeenCalledOnce();
  } finally { clock.mockRestore(); await probe.close(); await f.service.close(); }
});

it('coalesces simultaneous authorization polls so a grant is consumed only once', async () => {
  const f = await setup();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.client.pollDevice.mockImplementationOnce(async () => { await waiting; return { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 }; });
  const grant = await f.service.startAuthorization();
  const first = f.service.pollAuthorization(grant.attemptId);
  const second = f.service.pollAuthorization(grant.attemptId);
  release(); await Promise.all([first, second]);
  expect(f.client.pollDevice).toHaveBeenCalledOnce();
  expect(f.service.peekState().authState).toBe('signed_in');
  await f.service.close();
});

it('checks on foreground return without bypassing polling intervals or slow-down responses', async () => {
  const f = await setup();
  const clock = vi.spyOn(Date, 'now');
  let now = Date.now(); clock.mockImplementation(() => now);
  try {
    f.client.pollDevice.mockRejectedValue(new GatewayError('authorization_pending', 428));
    await f.service.startAuthorization();
    f.service.checkAuthorization();
    expect(f.client.pollDevice).not.toHaveBeenCalled();
    now += 5000;
    f.service.checkAuthorization();
    await f.service.pollAuthorization('1');
    expect(f.client.pollDevice).toHaveBeenCalledTimes(1);
    f.service.checkAuthorization();
    expect(f.client.pollDevice).toHaveBeenCalledTimes(1);
    f.client.pollDevice.mockRejectedValueOnce(new GatewayError('slow_down', 429));
    now += 5000; f.service.checkAuthorization(); await f.service.pollAuthorization('1');
    expect(f.client.pollDevice).toHaveBeenCalledTimes(2);
    now += 5000; f.service.checkAuthorization();
    expect(f.client.pollDevice).toHaveBeenCalledTimes(2);
    now += 5000; f.service.checkAuthorization(); await f.service.pollAuthorization('1');
    expect(f.client.pollDevice).toHaveBeenCalledTimes(3);
    now += 5000; f.service.checkAuthorization();
    expect(f.client.pollDevice).toHaveBeenCalledTimes(3);
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('activates from the customer catalog without inference and preserves the raw candidate catalog', async () => {
  const f = await setupCatalogAccount();
  f.setCatalogIDs(f.raw.models.filter(model => !model.id.startsWith('openai/')).map(model => model.id));
  await f.login();
  expect(f.service.peekState().activationState).toBe('ready');
  await f.service.selectModel('text', 'deepseek/deepseek-r1');
  expect(f.service.peekState().models.map(model => model.id)).toEqual(['deepseek/deepseek-v3.2', 'deepseek/deepseek-r1', 'qwen/qwen3-coder']);
  expect(f.service.peekState().selectedModels?.text).toBe('deepseek/deepseek-r1');
  await expect(f.service.selectModel('text', 'openai/gpt-6-sol')).rejects.toMatchObject({ code: 'invalid_model' });
  await expect(f.service.selectModel('text', 'anthropic/claude-sonnet-4.6')).rejects.toMatchObject({ code: 'invalid_model' });
  expect((await f.service.modelCredentials()).models).toEqual(f.service.peekState().models);
  const scope = await f.service.modelCredentials();
  const facts = { kind: 'http-rejected' as const, httpStatus: 403, upstreamMessage: 'Model unavailable in this country' };
  await f.service.reportModelFailure({ ...scope, accountId: 'stale-account' }, 'qwen/qwen3-coder', 'text', facts);
  expect(f.service.peekState().models).toHaveLength(3);
  await f.service.reportModelFailure(scope, 'deepseek/deepseek-r1', 'text', facts);
  expect(f.service.peekState().models.map(model => model.id)).toEqual(['deepseek/deepseek-v3.2', 'qwen/qwen3-coder']);
  expect((await f.service.readState()).selectedModels?.text).toBe('deepseek/deepseek-v3.2');
  await expect(f.service.selectModel('text', 'deepseek/deepseek-r1')).rejects.toMatchObject({ code: 'invalid_model' });
  expect((await createGatewayConfigStore(f.root).readCredentials())?.models).toHaveLength(6);
  expect(f.request.mock.calls.some(([path]) => path === '/api/v1/client/probe-credentials')).toBe(false);
  await f.service.close();
});

it('defers runtime replacement until idle and recovers expired exact-model rejections without probes', async () => {
  let active = false;
  const f = await setupCatalogAccount(() => active); await f.login();
  const use = await f.service.beginModelUse(); active = true;
  const scope = use.credentials;
  const facts = { kind: 'http-rejected' as const, httpStatus: 403, upstreamMessage: 'Model unavailable in this country' };
  await f.service.reportModelFailure(scope, 'deepseek/deepseek-v3.2', 'text', facts);
  await f.service.readState();
  expect(f.service.peekState().selectedModels?.text).toBe('deepseek/deepseek-r1');
  expect(use.credentials.defaults.text).toBe('deepseek/deepseek-v3.2');
  expect(f.activate).toHaveBeenCalledTimes(1);
  await use.release();
  active = false;
  expect(await f.service.readState()).toMatchObject({ activationState: 'ready', selectedModels: { text: 'deepseek/deepseek-r1' } });
  expect(f.activate).toHaveBeenLastCalledWith(expect.objectContaining({ defaults: { text: 'deepseek/deepseek-r1' } }));
  for (const model of scope.models.slice(1)) await f.service.reportModelFailure(scope, model.id, model.modality, facts);
  await f.service.readState();
  expect(f.service.peekState().activationState).toBe('blocked');
  await expect(f.service.modelCredentials()).rejects.toMatchObject({ code: 'services_not_ready' });
  const recoveryUse = await f.service.beginModelUse({ recovery: true });
  expect(recoveryUse.credentials.models).toEqual([]); await recoveryUse.release();
  const start = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(start + 60 * 60_000 + 1);
  try {
    await f.service.readState();
    expect(f.service.peekState().activationState).toBe('ready');
    expect(f.service.peekState().bindingVersion).toBe(f.raw.bindingVersion);
    expect((await f.service.modelCredentials()).defaults.text).toBeTruthy();
    expect(f.activate).toHaveBeenCalledTimes(3);
  } finally { clock.mockRestore(); await f.service.close(); }
});

it('hides an exact denied media model after enriching its official voice catalog', async () => {
  const f = await setupCatalogAccount();
  f.raw.models.push({ id: 'vendor/speech', modality: 'speech', capabilities: [], voices: ['old'] });
  f.fetcher.mockImplementation(async url => String(url).endsWith('/cdn-cgi/trace')
    ? new Response('ip=203.0.113.1\nloc=JP\n')
    : Response.json({ data: f.raw.models.map(model => ({ id: model.id, ...(model.modality === 'speech' ? { supported_voices: ['native'] } : {}) })) }));
  try {
    await f.login();
    const scope = await f.service.modelCredentials();
    expect(scope.models.find(model => model.modality === 'speech')).toMatchObject({ voices: ['native'] });
    await f.service.reportModelFailure(scope, 'vendor/speech', 'speech', { kind: 'http-rejected', httpStatus: 403, upstreamMessage: 'Model unavailable in this country' });
    expect(f.service.peekState().models.some(model => model.modality === 'speech')).toBe(false);
    expect(f.service.peekState().activationState).toBe('ready');
  } finally { await f.service.close(); }
});

it('keeps sign-in independent of catalog failures and supports a forced refresh after an empty catalog', async () => {
  const f = await setupCatalogAccount(undefined, true);
  f.setFailure(503); await f.login();
  expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'blocked', activationError: { code: 'model_catalog_unavailable' } });
  f.setCatalogIDs([]);
  expect(await f.service.readState({ refreshModels: true })).toMatchObject({ authState: 'signed_in', activationState: 'blocked', activationError: { code: 'no_available_models' } });
  f.setCatalogIDs(f.raw.models.map(model => model.id));
  expect(await f.service.readState({ refreshModels: true })).toMatchObject({ activationState: 'ready' });
  expect(f.activate).toHaveBeenCalledOnce();
  await f.service.close();
});

it('recovers a rejected cached model key through binding sync without inference or reauthorization', async () => {
  let raw!: GatewayBootstrap;
  const f = await setup(undefined, undefined, undefined, undefined, root => createOfficialModelAccess({
    dataDir: root, readProxy: async () => '', fetcher: async (url, options) => {
      expect(options?.method ?? 'GET').toBe('GET');
      if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
      return new Headers(options?.headers).get('authorization') === 'Bearer rejected-key'
        ? Response.json({}, { status: 401 }) : Response.json({ data: raw.models });
    }
  }));
  raw = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct', baseUrl: 'https://openrouter.ai/api/v1',
    modelKey: 'rejected-key', keyRotation: false, modelUsePolicy: 'cached-key-v1' };
  f.client.bootstrap.mockResolvedValue(raw);
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string) => path?.startsWith('/api/v1/client/models') ? { models: raw.models } : { account: raw.account });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'blocked' });
  raw = { ...raw, modelKey: 'replacement-key', keyVersion: '2' }; f.client.bootstrap.mockResolvedValue(raw);
  expect(await f.service.readState({ refreshModels: true })).toMatchObject({ authState: 'signed_in', activationState: 'ready' });
  expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false });
  expect((await f.service.modelCredentials()).modelKey).toBe('replacement-key');
  expect(f.client.pollDevice).toHaveBeenCalledOnce();
  await f.service.close();
});

it('aborts an in-flight login catalog request on logout without applying a late result', async () => {
  let started = false; let aborted = false;
  const f = await setup(undefined, undefined, undefined, undefined, root => createOfficialModelAccess({
    dataDir: root, readProxy: async () => '', fetcher: async (url, options) => {
      if (String(url).endsWith('/cdn-cgi/trace')) return new Response('ip=203.0.113.1\nloc=JP\n');
      started = true;
      return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('Aborted'));
      }, { once: true }));
    }
  }));
  const raw = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct' as const,
    models: [{ id: 'deepseek/deepseek-v3.2', modality: 'text' as const, capabilities: ['responses'] }], defaults: { text: 'deepseek/deepseek-v3.2' } };
  f.client.bootstrap.mockResolvedValue(raw);
  const grant = await f.service.startAuthorization(); const login = f.service.pollAuthorization(grant.attemptId);
  await expect.poll(() => started).toBe(true);
  await f.service.logout();
  await login;
  expect(aborted).toBe(true);
  expect(f.service.peekState()).toMatchObject({ authState: 'signed_out', activationState: 'inactive', models: [] });
  expect(await createGatewayConfigStore(f.root).readCredentials()).toBeUndefined();
  expect(f.activate).not.toHaveBeenCalled();
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
    if (path?.startsWith('/api/v1/client/models')) return { models: binding.models };
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
    ? { keyVersion: original.keyVersion } : path?.startsWith('/api/v1/client/models') ? { models: original.models } : { account: original.account });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  await f.service.close();
  for (const pending of [true, false]) {
    const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => false, hasPendingTasks: () => pending, automaticPolling: false });
    expect(await restored.readState()).toMatchObject({ authState: 'signed_in', activationState: 'ready' });
    expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: !pending, modelUsePolicy: 'cached-key-v1' });
    await restored.close();
  }
});

it.each([false, true])('旧轮换凭据收到迁移提示后切换网关，无需重新登录（后台恢复=%s）', async deferred => {
  const network = vi.fn<typeof fetch>(async () => { throw new Error('Migrated accounts must not access the old supplier'); });
  const f = await setup(undefined, undefined, undefined, undefined,
    root => createOfficialModelAccess({ dataDir: root, fetcher: network, readProxy: async () => '' }), deferred);
  const legacy: GatewayBootstrap = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct',
    baseUrl: 'https://openrouter.ai/api/v1', keyRotation: true };
  f.client.bootstrap.mockResolvedValue(legacy);
  await seedSavedAccount(f);
  const gateway: GatewayBootstrap = { ...legacy, schemaVersion: 3, transport: 'gateway', supplier: 'chatanywhere',
    baseUrl: `${f.client.origin}/v1`, keyRotation: false, modelKey: undefined, keyVersion: 'gateway-3', bindingVersion: '1:gateway-3',
    models: legacy.models.map(model => ({ ...model, capabilities: ['responses', 'chat'] })) };
  f.client.bootstrap.mockResolvedValue(gateway);
  const request = vi.spyOn(f.client, 'request').mockImplementation(async path => {
    if (path === '/api/v1/client/usage') throw new GatewayError('gateway_migrated', 409, { path, reason: 'http', httpStatus: 409 });
    return path?.startsWith('/api/v1/client/models') ? { models: gateway.models } : { account: gateway.account };
  });
  try {
    await f.service.initialize();
    if (deferred) {
      expect(f.service.peekState().activationState).toBe('loading');
      expect(request).not.toHaveBeenCalled();
      await f.service.startBackgroundRestore();
    }
    expect(f.service.peekState()).toMatchObject({ authState: 'signed_in', activationState: 'ready', transport: 'gateway', activationError: null });
    expect(f.client.bootstrap).toHaveBeenCalledOnce();
    expect(f.client.bootstrap).toHaveBeenCalledWith('access-1', { rotate: false, modelUsePolicy: 'cached-key-v1' });
    expect(request.mock.calls.filter(([path]) => path === '/api/v1/client/usage')).toHaveLength(1);
    expect(f.activate).toHaveBeenCalledWith(expect.objectContaining({ transport: 'gateway', keyRotation: false }));
    expect(network).not.toHaveBeenCalled();
    expect(f.probe).not.toHaveBeenCalled();
    const saved = await createGatewayConfigStore(f.root).readCredentials();
    expect(saved).toMatchObject({ schemaVersion: 3, transport: 'gateway', keyRotation: false, accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(saved).not.toHaveProperty('modelKey');
  } finally { await f.service.close(); }
});

it.each([
  { code: 'gateway_unavailable', status: 503, migrated: false },
  { code: 'account_disabled', status: 403, migrated: false },
  { code: 'gateway_migrated', status: 403, migrated: false },
  { code: 'gateway_migrated', status: 409, migrated: true }
])('旧凭据同步失败时不能绕过直连协调（$code/$status）', async ({ code, status, migrated }) => {
  const f = await setup(undefined, undefined, undefined, undefined, undefined, true);
  const legacy: GatewayBootstrap = { ...await f.client.bootstrap('access-1'), transport: 'openrouter-direct',
    baseUrl: 'https://openrouter.ai/api/v1', keyRotation: true };
  f.client.bootstrap.mockResolvedValue(legacy);
  await seedSavedAccount(f);
  vi.spyOn(f.client, 'request').mockRejectedValue(new GatewayError(code, status));
  try {
    await f.service.startBackgroundRestore();
    expect(f.service.peekState()).toMatchObject({ activationState: 'blocked', activationError: { code, stage: 'usage' } });
    expect(f.activate).not.toHaveBeenCalled();
    expect(f.client.bootstrap).toHaveBeenCalledTimes(migrated ? 1 : 0);
    expect((await createGatewayConfigStore(f.root).readCredentials())?.transport).toBe('openrouter-direct');
  } finally { await f.service.close(); }
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

it.each(['text', 'image', 'video', 'speech', 'transcription'] as const)('switches %s despite active, pending and acquired uses while preserving old snapshots', async modality => {
  const f = await setup(undefined, undefined, () => true, () => true);
  const raw = await f.client.bootstrap('access-1');
  raw.models.push(...['first', 'second'].map(id => ({ id: `${modality}/${id}`, modality, capabilities: modality === 'text' ? ['responses'] : [] })));
  raw.defaults[modality] = `${modality}/first`;
  f.client.bootstrap.mockResolvedValue(raw);
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  const previous = await f.service.beginModelUse();
  const server = Fastify();
  try {
    await registerGatewayAccountRoutes(server, f.service);
    const response = await server.inject({ method: 'PATCH', url: '/gateway/model', payload: { modality, model: `${modality}/second` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().selectedModels[modality]).toBe(`${modality}/second`);
    expect(previous.credentials.defaults[modality]).toBe(`${modality}/first`);
    const next = await f.service.beginModelUse();
    expect(next.credentials.defaults[modality]).toBe(`${modality}/second`);
    expect((await createGatewayConfigStore(f.root).readCredentials())?.defaults?.[modality]).toBe(`${modality}/second`);
    expect(f.close).not.toHaveBeenCalled();
    await next.release();
  } finally { await previous.release(); await server.close(); await f.service.close(); }
});

it('keeps the submitted text turn model and uses the new OpenAI model for subsequent turns on the same Runtime', async () => {
  const first = 'openai/gpt-4.1-mini'; const second = 'openai/gpt-6-sol';
  const f = await setupCachedAccount({ models: [first, second].map(id => ({ id, modality: 'text', capabilities: ['responses'] })), defaults: { text: first } });
  const startTurn = vi.fn<AppServerRuntimeManager['startTurn']>();
  const official = { startTurn } as unknown as AppServerRuntimeManager;
  const manual = { startTurn: vi.fn() } as unknown as AppServerRuntimeManager;
  const runtime = createRuntimeSource(manual, f.service.peekState, () => official);
  const input = { scope: { kind: 'project', id: 'p' }, thread: { id: 'thread-a' } } as Parameters<AppServerRuntimeManager['startTurn']>[0];
  try {
    runtime.startTurn(input);
    const running = startTurn.mock.calls[0]![0];
    expect(running.model).toBe(first);
    await running.onThreadStarted?.('official-thread');
    await f.service.selectModel('text', second);
    runtime.startTurn(input);
    expect(running.model).toBe(first);
    expect(startTurn.mock.calls[1]![0]).toMatchObject({ model: second, codexThreadId: 'official-thread' });
    expect(manual.startTurn).not.toHaveBeenCalled();
  } finally { await f.service.close(); }
});

it('refreshes the official catalog when idle, preserving choices and deferring pending tasks', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const first = { id: 'first', modality: 'text' as const, capabilities: ['responses'] };
  const second = { ...first, id: 'second' };
  const image = { id: 'image', modality: 'image' as const, capabilities: ['edit'] };
  let catalog: GatewayBootstrap['models'] = [first, second];
  f.client.bootstrap.mockImplementation(async () => ({ schemaVersion: 1, account: { id: '1', email: '1@example.test', verified: true }, modelKey: 'private-key', keyVersion: '1', bindingVersion: 'catalog-version', baseUrl: 'https://gateway.example/v1', models: catalog, defaults: { text: 'first' } }));
  vi.spyOn(f.client, 'request').mockImplementation(async (path?: string) => path?.startsWith('/api/v1/client/models') ? { models: catalog } : { account: { id: '1', email: '1@example.test', verified: true } });
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

it('revokes model readiness when account polling detects an expired session', async () => {
  const f = await setup();
  const server = Fastify();
  const clock = vi.spyOn(Date, 'now');
  const startedAt = Date.now();
  try {
    const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
    const ready = await f.service.readState();
    expect(ready.activationState).toBe('ready');
    await registerGatewayAccountRoutes(server, f.service);
    clock.mockReturnValue(startedAt + 16 * 60_000);
    f.client.refresh.mockRejectedValueOnce(new GatewayError('auth_required', 401));
    const response = await server.inject({ method: 'GET', url: '/gateway/account' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: 'gateway', authState: 'expired', activationState: 'inactive', bindingVersion: null,
      models: ready.models, selectedModels: ready.selectedModels });
    expect(f.close).toHaveBeenCalledOnce();
    const selection = await server.inject({ method: 'PATCH', url: '/gateway/model', payload: { modality: 'text', model: 'gateway-text' } });
    expect(selection.statusCode).toBe(401);
    expect(selection.json().error.code).toBe('GATEWAY_AUTH_REQUIRED');
  } finally { clock.mockRestore(); await server.close(); await f.service.close(); }
});

it('clears an expired device session before starting reauthorization', async () => {
  const f = await setup();
  const first = await f.service.startAuthorization(); await f.service.pollAuthorization(first.attemptId);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
  try {
    f.client.refresh.mockRejectedValueOnce(new GatewayError('auth_required', 401));
    await expect(f.service.modelCredentials()).rejects.toMatchObject({ status: 401 });
    expect(await f.service.readState()).toMatchObject({ authState: 'expired', activationState: 'inactive' });
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

it('permits same-account reauthorization after expiry with pending requests', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const first = await f.service.startAuthorization(); await f.service.pollAuthorization(first.attemptId);
  pending = true;
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

it('allows the logout route with pending supplier requests and clears local credentials', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  const revoke = vi.spyOn(f.client, 'logout');
  pending = true;
  const server = Fastify();
  try {
    await registerGatewayAccountRoutes(server, f.service);
    const response = await server.inject({ method: 'POST', url: '/gateway/auth/logout' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, models: [] });
    expect(f.close).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('access-1');
    expect(await createGatewayConfigStore(f.root).readCredentials()).toBeUndefined();
    await expect(f.service.modelCredentials()).rejects.toMatchObject({ status: 401 });
  } finally { await server.close(); await f.service.close(); }
});

it('allows login with active and pending jobs without rotating their supplier key', async () => {
  const f = await setup(undefined, undefined, () => true, () => true);
  const server = Fastify();
  try {
    await registerGatewayAccountRoutes(server, f.service);
    const response = await server.inject({ method: 'POST', url: '/gateway/auth/start' });
    expect(response.statusCode).toBe(200);
    await f.service.pollAuthorization(response.json().attemptId);
    expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: '1' } });
    expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false, modelUsePolicy: 'cached-key-v1' });
    expect((await f.service.modelCredentials()).accountId).toBe('1');
  } finally { await server.close(); await f.service.close(); }
});

it('can sign out and sign back in with unfinished jobs, while keeping old jobs bound to their account', async () => {
  let busy = false;
  const f = await setup(undefined, undefined, () => busy, () => busy);
  const first = await f.service.startAuthorization(); await f.service.pollAuthorization(first.attemptId);
  const manual = createDefaultCreatorServicesConfig();
  let original: ReturnType<ReturnType<typeof createGatewayCreatorSource>['snapshot']>;
  const source = createGatewayCreatorSource({
    account: f.service, readJobBinding: () => original,
    manual: { read: async () => manual, write: async value => value, reset: async () => manual },
    getLocalOrigin: () => 'http://127.0.0.1:39999'
  });
  original = source.snapshot();
  busy = true;
  try {
    await f.service.logout();
    const same = await f.service.startAuthorization();
    f.client.pollDevice.mockResolvedValueOnce({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 });
    await f.service.pollAuthorization(same.attemptId);
    expect(await f.service.readState()).toMatchObject({ authState: 'signed_in', activationState: 'ready', account: { id: '1' } });
    expect(() => source.assertJob('original')).not.toThrow();
    await f.service.logout();
    const other = await f.service.startAuthorization(); await f.service.pollAuthorization(other.attemptId);
    expect(await f.service.readState()).toMatchObject({ authState: 'signed_in', activationState: 'ready', account: { id: '3' } });
    const execute = vi.fn();
    await expect(source.runForJob('original', 'stage', execute)).rejects.toMatchObject({ code: 'task_source_mismatch' });
    expect(execute).not.toHaveBeenCalled();
  } finally { await source.revoke(); await f.service.close(); }
});

it('signs out locally when usage reporting and remote logout are unavailable', async () => {
  const f = await setup();
  const binding = { ...await f.client.bootstrap('access-1'), keyRotation: true };
  f.client.bootstrap.mockResolvedValue(binding);
  const request = vi.spyOn(f.client, 'request').mockResolvedValue({ keyVersion: binding.keyVersion });
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  request.mockRejectedValue(new GatewayError('gateway_unavailable'));
  vi.spyOn(f.client, 'logout').mockRejectedValue(new GatewayError('gateway_unavailable'));
  await f.service.logout();
  expect(await f.service.readState()).toMatchObject({ source: 'manual', authState: 'signed_out', account: null });
  expect(f.close).toHaveBeenCalledOnce();
  expect(await createGatewayConfigStore(f.root).readCredentials()).toBeUndefined();
  await f.service.close();
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

it('completes official activation when pending tasks appear during initial authorization', async () => {
  let pending = false;
  const f = await setup(undefined, undefined, () => pending);
  const grant = await f.service.startAuthorization(); pending = true;
  await f.service.pollAuthorization(grant.attemptId);
  expect(await f.service.readState()).toMatchObject({ source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: '1' }, activationError: null });
  expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false, modelUsePolicy: 'cached-key-v1' });
  expect(f.activate).toHaveBeenCalledOnce();
  await f.service.close();
});

it('restores a signed-in session after restart even when unfinished jobs remain', async () => {
  const f = await setup();
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId); await f.service.close();
  const restored = module.createGatewayAccountService({ dataDir: f.root, client: f.client, activateRuntime: f.activate, closeRuntime: f.close, hasActiveTasks: () => true, hasPendingTasks: () => true, automaticPolling: false });
  try {
    expect(await restored.readState()).toMatchObject({ authState: 'signed_in', activationState: 'ready', account: { id: '1' } });
    expect(f.client.bootstrap).toHaveBeenLastCalledWith('access-1', { rotate: false, modelUsePolicy: 'cached-key-v1' });
  } finally { await restored.close(); }
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

it('allows logout while tasks and model uses are active, closing Runtime and rejecting new uses', async () => {
  let active = false;
  const f = await setup(undefined, undefined, undefined, () => active);
  const grant = await f.service.startAuthorization(); await f.service.pollAuthorization(grant.attemptId);
  const use = await f.service.beginModelUse();
  active = true;
  await f.service.logout();
  expect(await f.service.readState()).toMatchObject({ source: 'manual', authState: 'signed_out', account: null });
  expect(f.close).toHaveBeenCalledOnce();
  await expect(f.service.beginModelUse()).rejects.toMatchObject({ status: 401 });
  expect(await createGatewayConfigStore(f.root).readCredentials()).toBeUndefined();
  await use.release();
  await f.service.close();
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
