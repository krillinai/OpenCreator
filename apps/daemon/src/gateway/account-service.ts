import type { GatewayAccountState, GatewayBalanceSnapshot, GatewayBalanceState, ServiceSource } from '@opencreator/protocol';
import { z } from 'zod';
import { createGatewayConfigStore, type GatewayCredentials } from './config-store.js';
import { accountSchema, bootstrapSchema, catalogSchema, GatewayError, type GatewayBootstrap, type GatewayClient, type GatewayDeviceGrant } from './client.js';
import { officialModelPolicy, withModelCatalog, type OfficialModelAccess } from './model-access.js';

export function createGatewayAccountService(input: {
  dataDir: string; client: GatewayClient;
  activateRuntime(bootstrap: GatewayBootstrap): Promise<void>;
  closeRuntime(): Promise<void>;
  hasActiveTasks(): boolean;
  hasPendingTasks?(): boolean;
  automaticPolling?: boolean;
  modelAccess?: OfficialModelAccess;
}) {
  const store = createGatewayConfigStore(input.dataDir);
  let state: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
  let credentials: GatewayCredentials | undefined;
  let attempt: (GatewayDeviceGrant & { generation: number; expiresAt: number; previousAuthState: GatewayAccountState['authState'] }) | undefined;
  let generation = 0;
  let pollTimer: NodeJS.Timeout | undefined;
  let initialization: Promise<void> | undefined;
  let refreshWork: Promise<void> | undefined;
  let profileWork: Promise<void> | undefined;
  let profileUpdatedAt = 0;
  let catalogWork: Promise<void> | undefined;
  let catalogUpdatedAt = 0;
  let balance: GatewayBalanceSnapshot | null = null;
  let mutation = Promise.resolve();
  let selectedModels: Record<string, string> = {};
  let localUses = 0;
  let probeUses = 0;
  let accessWork: Promise<void> | undefined;
  let accessController: AbortController | undefined;
  let accessUpdatedAt = 0;
  let accessBlocked = false;
  let runtimeTextModel: string | undefined;
  let accessPaused = false;
  let closing = false;
  let usageMutation = Promise.resolve();
  let usageTimer: NodeJS.Timeout | undefined;
  const saveConfiguration = () => store.writeConfiguration({ source: state.source, bindingVersion: state.bindingVersion, selectedModels });
  function serialize<T>(work: () => Promise<T>): Promise<T> { const result = mutation.then(work); mutation = result.then(() => undefined, () => undefined); return result; }
  function fail(error: unknown) { state.activationState = 'blocked'; state.activationError = { code: error instanceof GatewayError ? error.code : 'services_not_ready', message: '官方服务尚未就绪，请重试' }; }
  function assertIdle() { if (localUses > 0 || input.hasActiveTasks()) throw new GatewayError('active_tasks', 409); }
  function assertSignedIn() { if (!credentials || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401); return credentials; }
  async function visibleBootstrap(bootstrap: GatewayBootstrap) {
    const eligible = withModelCatalog(bootstrap, officialModelPolicy(bootstrap.models));
    return input.modelAccess && eligible.transport === 'openrouter-direct' ? input.modelAccess.prepare(eligible) : eligible;
  }
  function needsAccessibleRuntime() {
    return input.modelAccess && credentials?.transport === 'openrouter-direct' && state.authState === 'signed_in'
      && state.source === 'gateway' && !closing && !accessPaused && (state.activationState === 'ready' || accessBlocked)
      && (!credentials.defaults?.text || accessBlocked || runtimeTextModel !== credentials.defaults.text);
  }
  async function synchronizeAccessibleRuntime() {
    if (!needsAccessibleRuntime() || !credentials) return;
    if (!credentials.defaults?.text) { accessBlocked = true; fail(new GatewayError('services_not_ready')); return; }
    if ((!accessBlocked && runtimeTextModel === credentials.defaults.text) || localUses > 0 || input.hasActiveTasks() || input.hasPendingTasks?.()) return;
    const next = { ...bootstrapSchema.parse(credentials), models: state.models };
    try {
      await input.activateRuntime(next);
      runtimeTextModel = next.defaults.text; accessBlocked = false;
      state.bindingVersion = next.bindingVersion; state.activationState = 'ready'; state.activationError = null;
      await saveConfiguration();
    } catch (error) { accessBlocked = true; runtimeTextModel = undefined; fail(error); await input.closeRuntime(); }
  }
  function scheduleModelAccess() {
    if (!input.modelAccess || closing || accessPaused || accessWork || credentials?.transport !== 'openrouter-direct' || state.authState !== 'signed_in'
      || (state.activationState !== 'ready' && !accessBlocked) || Date.now() - accessUpdatedAt < 30_000) return;
    accessUpdatedAt = Date.now();
    const controller = new AbortController(); accessController = controller;
    accessWork = (async () => {
      const use = await acquireModelUse(true);
      try {
        const original = bootstrapSchema.parse(assertSignedIn()); const expected = generation;
        await input.modelAccess!.refresh(original, controller.signal, async () => {
          await serialize(async () => {
            if (controller.signal.aborted || closing || generation !== expected || state.authState !== 'signed_in'
              || credentials?.account?.id !== original.account.id || credentials.keyVersion !== original.keyVersion) return;
            const next = input.modelAccess!.filter(withModelCatalog(bootstrapSchema.parse(credentials), officialModelPolicy(credentials.models ?? [])));
            if (JSON.stringify(state.models) !== JSON.stringify(next.models) || JSON.stringify(state.selectedModels) !== JSON.stringify(next.defaults)) {
              credentials = { ...credentials, defaults: next.defaults };
              selectedModels = { ...next.defaults }; state.selectedModels = { ...selectedModels }; state.models = next.models;
              await store.writeCredentials(credentials); await saveConfiguration();
            }
            await synchronizeAccessibleRuntime();
          });
        });
      } finally { await use.release(); }
    })().catch(() => undefined).finally(() => { if (accessController === controller) accessController = undefined; accessWork = undefined; });
  }
  function initialize(): Promise<void> {
    initialization ??= load();
    return initialization;
  }
  async function load() {
    try {
      const config = await store.readConfiguration();
      selectedModels = config.selectedModels ?? {};
      state.selectedModels = { ...selectedModels };
      credentials = await store.readCredentials();
      state.source = credentials ? 'gateway' : 'manual';
      await saveConfiguration();
      if (!credentials) return;
      state.account = credentials.account ?? null; state.authState = 'signed_in'; state.models = credentials.models ?? [];
      await refresh();
      await activateCurrent();
    } catch (error) { fail(error); }
  }
  async function refresh() {
    if (refreshWork) return refreshWork;
    refreshWork = (async () => {
      const original = assertSignedIn(); const expected = generation;
      if (Date.parse(original.accessExpiresAt) > Date.now() + 60_000) return;
      try {
        const tokens = await input.client.refresh(original.refreshToken);
        if (generation !== expected || credentials !== original || state.authState !== 'signed_in') return;
        credentials = { ...original, ...tokens, accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString() };
        await store.writeCredentials(credentials);
      } catch (error) {
        if (error instanceof GatewayError && error.status === 401) { state.authState = 'expired'; await input.closeRuntime(); }
        throw error;
      }
    })();
    try { await refreshWork; } finally { refreshWork = undefined; }
  }
  async function activateCurrent() {
    assertIdle(); await refresh();
    const original = assertSignedIn(); const expected = generation;
    state.activationState = 'loading'; state.activationError = null;
    try {
      if (state.source !== 'gateway' && input.hasPendingTasks?.()) throw new GatewayError('active_tasks', 409);
      state.source = 'gateway'; state.bindingVersion = null;
      await saveConfiguration();
      await reportUsage();
      const bootstrap = await input.client.bootstrap(original.accessToken, { rotate: !input.hasPendingTasks?.() });
      if (generation !== expected || state.authState !== 'signed_in') return;
      if (original.account && bootstrap.account.id !== original.account.id) throw new GatewayError('account_mismatch');
      for (const [modality, model] of Object.entries(selectedModels)) {
        if (bootstrap.models.some(candidate => candidate.modality === modality && candidate.id === model)) bootstrap.defaults[modality] = model;
      }
      const visible = await visibleBootstrap(bootstrap);
      if (generation !== expected || state.authState !== 'signed_in') return;
      selectedModels = { ...visible.defaults }; state.selectedModels = { ...selectedModels };
      credentials = { ...original, ...bootstrap, defaults: visible.defaults };
      await store.writeCredentials(credentials);
      state.account = bootstrap.account; state.models = visible.models;
      accessBlocked = !visible.defaults.text;
      if (accessBlocked) throw new GatewayError('services_not_ready');
      await input.activateRuntime(visible);
      runtimeTextModel = visible.defaults.text;
      if (generation !== expected || state.authState !== 'signed_in') { await input.closeRuntime(); return; }
      state.bindingVersion = bootstrap.bindingVersion;
      catalogUpdatedAt = Date.now();
      await saveConfiguration();
      state = { ...state, source: 'gateway', activationState: 'ready', account: bootstrap.account, models: visible.models, bindingVersion: bootstrap.bindingVersion, activationError: null };
      await reportUsage();
      startUsageHeartbeat();
    } catch (error) { runtimeTextModel = undefined; fail(error); await input.closeRuntime(); }
    scheduleModelAccess();
  }
  async function readProfile() {
    if (!credentials || state.authState !== 'signed_in') return;
    if (profileWork) return profileWork;
    if (Date.now() - profileUpdatedAt < 30_000) return;
    profileUpdatedAt = Date.now();
    profileWork = (async () => {
      await refresh();
      const original = assertSignedIn(); const expected = generation;
      const profile = z.object({ account: accountSchema }).parse(await input.client.request('/api/v1/me', original.accessToken));
      await serialize(async () => {
        if (expected !== generation || credentials !== original || state.authState !== 'signed_in') return;
        if (original.account && profile.account.id !== original.account.id) throw new GatewayError('account_mismatch');
        const next = { ...original, account: profile.account };
        await store.writeCredentials(next);
        credentials = next; state.account = profile.account;
      });
    })().catch(() => undefined);
    try { await profileWork; }
    finally { profileWork = undefined; }
  }
  async function readCatalog() {
    if (!credentials || state.authState !== 'signed_in' || state.source !== 'gateway' || state.activationState !== 'ready') return;
    if (catalogWork) return catalogWork;
    if (input.hasActiveTasks() || input.hasPendingTasks?.() || Date.now() - catalogUpdatedAt < 30_000) return;
    catalogUpdatedAt = Date.now();
    catalogWork = (async () => {
      await refresh();
      const original = assertSignedIn(); const expected = generation;
      const catalog = catalogSchema.parse(await input.client.request('/api/v1/client/models', original.accessToken));
      await serialize(async () => {
        if (generation !== expected || credentials !== original || state.source !== 'gateway' || state.authState !== 'signed_in' || input.hasActiveTasks() || input.hasPendingTasks?.()) return;
        if (original.rotationPending || JSON.stringify(catalog.models) !== JSON.stringify(original.models)) await activateCurrent();
      });
    })().catch(() => undefined);
    try { await catalogWork; } finally { catalogWork = undefined; }
  }
  function schedulePoll(id: string, seconds: number) {
    if (input.automaticPolling === false) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { void pollAuthorization(id).catch(() => undefined); }, Math.max(5, seconds) * 1000); pollTimer.unref();
  }
  async function cancelAuthorization() {
    clearTimeout(pollTimer); const old = attempt; attempt = undefined; generation++;
    if (old) await input.client.cancelDevice(old.attemptId, old.deviceSecret).catch(() => undefined);
    if (state.authState === 'authorizing') {
      state.authState = old?.previousAuthState ?? (credentials ? 'expired' : 'signed_out');
      state.source = credentials ? 'gateway' : 'manual';
      state.activationState = credentials ? 'blocked' : 'inactive';
      await saveConfiguration();
    }
  }
  async function startAuthorization() {
    await initialize(); assertIdle();
    if (credentials && state.authState === 'expired') {
      if (!input.hasPendingTasks?.()) await logout();
    }
    else if (credentials) throw new GatewayError('already_signed_in', 409);
    else if (input.hasPendingTasks?.()) throw new GatewayError('active_tasks', 409);
    await cancelAuthorization();
    const expected = generation;
    const grant = await input.client.startDevice();
    const url = new URL(grant.authorizationUrl);
    if (url.origin !== input.client.origin || url.pathname !== '/device') throw new GatewayError('invalid_authorization_url');
    if (generation !== expected) { await input.client.cancelDevice(grant.attemptId, grant.deviceSecret); throw new GatewayError('authorization_canceled'); }
    attempt = { ...grant, generation: expected, expiresAt: Date.now() + grant.expiresIn * 1000, previousAuthState: state.authState };
    state.source = 'gateway'; state.authState = 'authorizing'; state.activationState = 'loading'; state.activationError = null;
    await saveConfiguration();
    schedulePoll(grant.attemptId, grant.interval);
    return { attemptId: grant.attemptId, authorizationUrl: grant.authorizationUrl, expiresAt: new Date(attempt.expiresAt).toISOString() };
  }
  async function pollAuthorization(id: string) {
    const current = attempt; if (!current || current.attemptId !== id) return;
    if (current.expiresAt <= Date.now()) { await cancelAuthorization(); state.activationError = { code: 'device_expired', message: '登录授权已过期，请重新登录' }; return; }
    try {
      const tokens = await input.client.pollDevice(id, current.deviceSecret);
      if (generation !== current.generation || attempt !== current) { await input.client.logout(tokens.accessToken).catch(() => undefined); return; }
      await serialize(async () => {
        if (generation !== current.generation || attempt !== current) return;
        if (credentials?.account && input.hasPendingTasks?.()) {
          const profile = z.object({ account: accountSchema }).parse(await input.client.request('/api/v1/me', tokens.accessToken));
          if (profile.account.id !== credentials.account.id) {
            await input.client.logout(tokens.accessToken).catch(() => undefined);
            throw new GatewayError('account_mismatch', 409);
          }
        }
        credentials = { ...tokens, accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString() };
        await store.writeCredentials(credentials);
        if (generation !== current.generation || attempt !== current) return;
        state.source = 'gateway'; state.authState = 'signed_in'; attempt = undefined;
        await saveConfiguration();
        if (input.hasPendingTasks?.() && current.previousAuthState !== 'expired') { fail(new GatewayError('active_tasks', 409)); return; }
        await activateCurrent();
      });
    } catch (error) {
      if (generation !== current.generation) return;
      if (error instanceof GatewayError && ['authorization_pending', 'slow_down', 'gateway_unavailable'].includes(error.code)) { schedulePoll(id, error.code === 'slow_down' ? current.interval + 5 : current.interval); return; }
      fail(error); await cancelAuthorization();
    }
  }
  async function readModelCredentials(probing = false): Promise<{ accountId: string; modelKey: string; keyVersion: string; bindingVersion: string; baseUrl: string; transport?: GatewayBootstrap['transport']; models: GatewayBootstrap['models']; defaults: Record<string, string> }> {
    await initialize(); await refresh();
    const value = assertSignedIn();
    if (state.source !== 'gateway' || (!probing && state.activationState !== 'ready') || !value.account || !value.modelKey || !value.keyVersion || !value.bindingVersion || !value.baseUrl || !value.models || !value.defaults) throw new GatewayError('services_not_ready');
    return { accountId: value.account.id, modelKey: value.modelKey, keyVersion: value.keyVersion, bindingVersion: value.bindingVersion, baseUrl: value.baseUrl, transport: value.transport, models: structuredClone(state.models), defaults: { ...value.defaults } };
  }
  const modelCredentials = () => readModelCredentials();
  function reportUsage() {
    const result = usageMutation.then(async () => {
      if (!credentials?.keyRotation || !credentials.keyVersion || state.authState !== 'signed_in') return undefined;
      await refresh();
      const current = assertSignedIn(); const expected = generation;
      const value = z.object({ keyVersion: z.string().min(1) }).parse(await input.client.request('/api/v1/client/usage', current.accessToken, {
        keyVersion: current.keyVersion, installationId: await store.readDeviceID(), busy: localUses > 0 || probeUses > 0 || input.hasActiveTasks(), pending: input.hasPendingTasks?.() === true
      }));
      if (generation !== expected || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
      return value.keyVersion;
    });
    usageMutation = result.then(() => undefined, () => undefined);
    return result;
  }
  function startUsageHeartbeat() {
    if (usageTimer || !credentials?.keyRotation || input.automaticPolling === false) return;
    usageTimer = setInterval(() => { void reportUsage().catch(() => undefined); }, 10_000);
    usageTimer.unref();
  }
  async function synchronizeBinding() {
    const current = assertSignedIn(); const expected = generation;
    const bootstrap = await input.client.bootstrap(current.accessToken, { rotate: false });
    if (generation !== expected || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    if (bootstrap.account.id !== current.account?.id) throw new GatewayError('account_mismatch');
    for (const [modality, model] of Object.entries(selectedModels)) {
      if (bootstrap.models.some(candidate => candidate.modality === modality && candidate.id === model)) bootstrap.defaults[modality] = model;
    }
    const visible = await visibleBootstrap(bootstrap);
    credentials = { ...assertSignedIn(), ...bootstrap, defaults: visible.defaults };
    await store.writeCredentials(credentials);
    state.bindingVersion = bootstrap.bindingVersion; state.models = visible.models;
    selectedModels = { ...visible.defaults }; state.selectedModels = { ...selectedModels };
    await saveConfiguration();
  }
  async function acquireModelUse(probing = false) {
    await readModelCredentials(probing);
    if (probing) probeUses++; else localUses++;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true; if (probing) probeUses--; else localUses--;
      await reportUsage().catch(() => undefined);
    };
    try {
      let version: string | undefined;
      try { version = await reportUsage(); }
      catch (error) {
        if (!(error instanceof GatewayError) || error.code !== 'binding_rotation_pending') throw error;
        await synchronizeBinding();
        version = await reportUsage();
      }
      if (version && version !== credentials?.keyVersion) await synchronizeBinding();
      return { credentials: await readModelCredentials(probing), release };
    } catch (error) { await release(); throw error; }
  }
  const beginModelUse = () => acquireModelUse();
  async function logout() {
    await initialize();
    accessPaused = true;
    accessController?.abort(); await accessWork;
    await serialize(async () => {
      assertIdle();
      if (input.hasPendingTasks?.()) throw new GatewayError('active_tasks', 409);
      await reportUsage();
      state.authState = 'signing_out'; state.activationState = 'inactive';
      clearInterval(usageTimer); usageTimer = undefined;
      await cancelAuthorization();
      await refreshWork?.catch(() => undefined);
      await input.closeRuntime();
      runtimeTextModel = undefined;
      if (credentials) await input.client.logout(credentials.accessToken).catch(() => undefined);
      await store.deleteCredentials(); state.source = 'manual'; state.bindingVersion = null; await saveConfiguration();
      credentials = undefined; balance = null; profileUpdatedAt = 0; catalogUpdatedAt = 0; accessUpdatedAt = 0; accessBlocked = false;
      state = { ...state, authState: 'signed_out', activationState: 'inactive', account: null, models: [], bindingVersion: null, activationError: null };
    }).finally(() => { accessPaused = false; });
  }
  async function billing(path: string, body?: unknown) { await initialize(); await refresh(); return input.client.request(path, assertSignedIn().accessToken, body); }
  async function readBalance(): Promise<GatewayBalanceState> {
    try {
      const value = z.object({ balance: z.object({ availableUnits: z.string().regex(/^\d+$/), reservedUnits: z.string().regex(/^\d+$/), periodEnd: z.string().nullable(), asOf: z.string() }) }).parse(await billing('/api/v1/billing/summary'));
      balance = value.balance; return { status: 'ready', value: balance };
    } catch (error) { return { status: 'unavailable', lastKnown: balance, code: error instanceof GatewayError ? error.code : 'gateway_unavailable' }; }
  }
  return {
    peekState() { return structuredClone(state); },
    startAuthorization, cancelAuthorization, pollAuthorization, refresh, logout, modelCredentials, beginModelUse, readBalance, billing,
    readPlans() { return input.client.request('/api/v1/plans', ''); },
    async readAvatar(accountId: string) {
      await initialize(); await refresh();
      const current = assertSignedIn(); const expected = generation;
      if (!current.account?.avatarUrl || current.account.id !== accountId) throw new GatewayError('avatar_unavailable', 404);
      const image = await input.client.avatar(current.accessToken, accountId);
      if (expected !== generation || state.authState !== 'signed_in' || credentials?.account?.id !== accountId) throw new GatewayError('avatar_unavailable', 404);
      return image;
    },
    async activate() { await initialize(); const expected = generation; await serialize(async () => { if (expected === generation) await activateCurrent(); }); },
    async readState() { await initialize(); await readProfile(); await readCatalog(); if (needsAccessibleRuntime()) await serialize(synchronizeAccessibleRuntime); scheduleModelAccess(); return structuredClone(state); },
    async setSource(source: ServiceSource) {
      await initialize(); await serialize(async () => {
        if (source === 'manual' && (credentials || state.authState !== 'signed_out')) throw new GatewayError('logout_required', 409);
        if (source === 'gateway') { assertSignedIn(); assertIdle(); await activateCurrent(); return; }
        state.source = 'manual'; await saveConfiguration();
      });
    },
    async selectModel(modality: import('@opencreator/protocol').GatewayModel['modality'], model: string) {
      await initialize(); await serialize(async () => {
        assertIdle(); const current = assertSignedIn();
        if (state.source !== 'gateway' || state.activationState !== 'ready' || !current.defaults || !state.models.some(candidate => candidate.modality === modality && candidate.id === model && (modality !== 'text' || candidate.capabilities.includes('responses')))) throw new GatewayError('invalid_model', 400);
        if (input.hasPendingTasks?.()) throw new GatewayError('active_tasks', 409);
        const next = { ...current, defaults: { ...current.defaults, [modality]: model } };
        if (modality === 'text') { await input.activateRuntime(bootstrapSchema.parse(next)); runtimeTextModel = model; }
        credentials = next; selectedModels = { ...next.defaults }; state.selectedModels = { ...selectedModels };
        await store.writeCredentials(next); await saveConfiguration();
      });
      return structuredClone(state);
    },
    async close() { closing = true; accessController?.abort(); await accessWork; clearTimeout(pollTimer); clearInterval(usageTimer); usageTimer = undefined; await profileWork; await catalogWork; await mutation; await refreshWork?.catch(() => undefined); await input.closeRuntime(); await reportUsage().catch(() => undefined); await usageMutation; generation++; }
  };
}
export type GatewayAccountService = ReturnType<typeof createGatewayAccountService>;
