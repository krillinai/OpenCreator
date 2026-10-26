import { gatewayModelIdMatches } from '@opencreator/protocol';
import { isDirectTransport, type SupplierRegion } from './supplier.js';
import { createHash } from 'node:crypto';
import type { GatewayAccountState, GatewayActivationStage, GatewayBalanceSnapshot, GatewayBalanceState, GatewayModel, GatewayModelOperation, GatewayModelProbeOptions, PublicErrorFacts, ServiceSource } from '@opencreator/protocol';
import { z } from 'zod/v3';
import { createGatewayConfigStore, type GatewayCredentials } from './config-store.js';
import { accountSchema, bootstrapSchema, cachedModelUsePolicy, catalogSchema, GatewayError, type GatewayBootstrap, type GatewayClient, type GatewayDeviceGrant } from './client.js';
import { officialModelPolicy, withModelCatalog, type OfficialModelAccess } from './model-access.js';
import { ModelProbeError, type ModelProbeScope } from './model-selection-probe.js';
import { gatewayModelSupports, gatewayModelReady, gatewayRecommendedModelId, type GatewayModelPurpose } from '@opencreator/protocol';
import { migrateModelPreferences, resolveModelPreferences } from './model-preferences.js';

export function createGatewayAccountService(input: {
  dataDir: string; client: GatewayClient;
  activateRuntime(bootstrap: GatewayBootstrap): Promise<void>;
  closeRuntime(): Promise<void>;
  hasActiveTasks(): boolean;
  hasPendingTasks?(): boolean;
  automaticPolling?: boolean;
  modelAccess?: OfficialModelAccess;
  probeModel?(model: GatewayModel, scope: ModelProbeScope, force: boolean, options?: GatewayModelProbeOptions): Promise<void>;
  deferStartupActivation?: boolean;
}) {
  const store = createGatewayConfigStore(input.dataDir);
  let state: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
  let credentials: GatewayCredentials | undefined;
  let attempt: (GatewayDeviceGrant & { generation: number; expiresAt: number; nextPollAt: number; previousAuthState: GatewayAccountState['authState'] }) | undefined;
  let generation = 0;
  let pollTimer: NodeJS.Timeout | undefined;
  let pollWork: { attempt: NonNullable<typeof attempt>; work: Promise<void> } | undefined;
  let initialization: Promise<void> | undefined;
  let startupRestoreWork: Promise<void> | undefined;
  let startupRestoreFinished = false;
  let stateRefreshWork: Promise<void> | undefined;
  let refreshWork: Promise<void> | undefined;
  let profileWork: Promise<void> | undefined;
  let profileUpdatedAt = 0;
  let catalogWork: Promise<void> | undefined;
  let catalogUpdatedAt = 0;
  let balance: GatewayBalanceSnapshot | null = null;
  let rechargeSnapshot: {
    state: 'recharged' | 'not_recharged' | 'pending' | 'unknown';
    observedAt: string;
  } = { state: 'unknown', observedAt: new Date().toISOString() };
  let mutation = Promise.resolve();
  let selectedModels: Record<string, string> = {};
  let manualModels: Record<string, string> = {};
  let preferencesInitialized = false;
  let pendingGatewayCatalog: GatewayBootstrap | undefined;
  let region: SupplierRegion = 'auto';
  let supplierMigrating = false;
  let localUses = 0;
  let accessWork: Promise<void> | undefined;
  let accessController: AbortController | undefined;
  let accessUpdatedAt = 0;
  let modelAuthRecoveryAt = 0;
  let accessBlocked = false;
  let runtimeTextModel: string | undefined;
  let accessPaused = false;
  let closing = false;
  let usageMutation = Promise.resolve();
  let usageTimer: NodeJS.Timeout | undefined;
  let bindingSyncWork: Promise<void> | undefined;
  let maintenanceWork: Promise<void> | undefined;
  let maintenanceFailures = 0;
  let runtimeCloseWork: Promise<void> | undefined;
  let activationRetryAt = 0;
  const saveConfiguration = () => store.writeConfiguration({ source: state.source, bindingVersion: state.bindingVersion, selectedModels, region,
    ...(preferencesInitialized ? { modelPreferencesVersion: 1 as const, manualModels } : {}) });
  function resolveGatewayBootstrap(bootstrap: GatewayBootstrap): GatewayBootstrap {
    if (bootstrap.transport !== 'gateway') return bootstrap;
    if (!preferencesInitialized) {
      manualModels = migrateModelPreferences(selectedModels, bootstrap.defaults);
      preferencesInitialized = true;
    }
    const resolved = resolveModelPreferences(bootstrap.models, bootstrap.defaults, manualModels);
    manualModels = resolved.manual;
    state.recommendedModels = resolved.recommended;
    state.modelSelectionModes = resolved.modes;
    if (resolved.changed) state.modelSelectionNotice = 'selection_updated';
    return { ...bootstrap, models: resolved.models, defaults: resolved.selected };
  }
  function serialize<T>(work: () => Promise<T>): Promise<T> { const result = mutation.then(work); mutation = result.then(() => undefined, () => undefined); return result; }
  function fail(error: unknown, stage?: GatewayActivationStage) {
    const code = error instanceof GatewayError ? error.code : 'services_not_ready';
    state.activationState = 'blocked';
    state.activationError = { code, message: code === 'model_catalog_unavailable' ? 'The model list is temporarily unavailable. Try again.'
      : code === 'supplier_migrating' ? 'Your model supplier is being switched. Services will resume automatically.'
      : code === 'no_available_models' ? 'No compatible text models are available.' : 'The official service is not ready. Try again.',
      ...(stage ? { stage } : {}), ...(error instanceof GatewayError && error.diagnostics ? { request: error.diagnostics } : {}) };
    activationRetryAt = Date.now() + 30_000;
  }
  function missingTextModel() {
    return new GatewayError(input.modelAccess ? input.modelAccess.catalogAvailable() ? 'no_available_models' : 'model_catalog_unavailable' : 'services_not_ready');
  }
  function assertIdle() { if (localUses > 0 || input.hasActiveTasks()) throw new GatewayError('active_tasks', 409); }
  function assertSignedIn() { if (!credentials || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401); return credentials; }
  function usesCachedModelKey() { return credentials?.modelUsePolicy === cachedModelUsePolicy && isDirectTransport(credentials.transport) && credentials.keyRotation === false; }
  function restoreModelAccessError(code: NonNullable<GatewayCredentials['modelAccessError']>) {
    if (code === 'auth_required') state = { ...state, authState: 'expired', activationState: 'inactive', bindingVersion: null, activationError: null };
    else fail(new GatewayError(code, 403));
  }
  async function blockConfirmedModelAccess(error: unknown, expected: number, accountId: string | undefined) {
    if (!(error instanceof GatewayError) || !usesCachedModelKey() || closing || accessPaused || generation !== expected
      || state.authState !== 'signed_in' || credentials?.account?.id !== accountId) return false;
    const code = error.status === 401 ? 'auth_required' : error.status === 403 && ['account_disabled', 'payment_review_required'].includes(error.code) ? error.code as NonNullable<GatewayCredentials['modelAccessError']> : undefined;
    if (!code) return false;
    generation++;
    credentials = { ...credentials!, modelAccessError: code };
    restoreModelAccessError(code);
    runtimeTextModel = undefined; accessController?.abort(); input.modelAccess?.reset();
    clearInterval(usageTimer); usageTimer = undefined;
    // An async image worker may itself be waiting for this recovery to return.
    runtimeCloseWork ??= input.closeRuntime().catch(() => undefined).finally(() => { runtimeCloseWork = undefined; });
    await store.writeCredentials(credentials);
    return true;
  }
  async function withAccountAccess<T>(work: () => Promise<T>): Promise<T> {
    const expected = generation; const accountId = credentials?.account?.id;
    try { return await work(); }
    catch (error) { await blockConfirmedModelAccess(error, expected, accountId); throw error; }
  }
  async function visibleBootstrap(bootstrap: GatewayBootstrap) {
    const eligible = withModelCatalog(resolveGatewayBootstrap(bootstrap), officialModelPolicy(bootstrap.models));
    return input.modelAccess && isDirectTransport(eligible.transport) ? input.modelAccess.prepare(eligible) : eligible;
  }
  async function applyVisibleCatalog(next: GatewayBootstrap) {
    if (!credentials) return;
    if (JSON.stringify(state.models) !== JSON.stringify(next.models) || JSON.stringify(state.selectedModels) !== JSON.stringify(next.defaults)) {
      credentials = { ...credentials, defaults: next.defaults };
      selectedModels = { ...next.defaults }; state.selectedModels = { ...selectedModels }; state.models = next.models;
      await store.writeCredentials(credentials); await saveConfiguration();
    }
  }
  async function refreshVisibleCatalog() {
    if (!input.modelAccess || closing || accessPaused || credentials?.modelAccessError || !isDirectTransport(credentials?.transport) || state.authState !== 'signed_in') return;
    const original = bootstrapSchema.parse(credentials); const expected = generation;
    await visibleBootstrap(original);
    if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') return;
    if (input.modelAccess.needsKeyRefresh() && Date.now() - modelAuthRecoveryAt >= 30_000) {
      modelAuthRecoveryAt = Date.now();
      try { await synchronizeBinding(); } catch { /* Keep sign-in and allow a later catalog retry. */ }
    }
    await serialize(async () => {
      if (generation === expected && state.authState === 'signed_in' && credentials?.account?.id === original.account.id && credentials.keyVersion === original.keyVersion) await applyVisibleCatalog(input.modelAccess!.filter(bootstrapSchema.parse(credentials)));
    });
  }
  type ModelResultScope = { accountId: string; keyVersion: string; accessContext?: string; models?: GatewayModel[] };
  async function recordModelResult(scope: ModelResultScope, id: string, modality: GatewayModel['modality'], facts?: PublicErrorFacts, operation?: GatewayModelOperation) {
    if (closing || accessPaused || state.authState !== 'signed_in') return;
    await serialize(async () => {
      if (!input.modelAccess || !credentials || state.authState !== 'signed_in' || !isDirectTransport(credentials.transport)
        || credentials.account?.id !== scope.accountId || credentials.keyVersion !== scope.keyVersion) return;
      const bootstrap = bootstrapSchema.parse(credentials);
      const model = input.modelAccess.findModel(bootstrap, id, modality);
      const submitted = scope.models?.find(candidate => gatewayModelIdMatches(candidate.id, id) && candidate.modality === modality);
      if (scope.models && JSON.stringify(submitted) !== JSON.stringify(model)) return;
      if (!model) return;
      if (facts && await input.modelAccess.recordFailure(scope.accessContext ?? '', model, facts)) await applyVisibleCatalog(input.modelAccess.filter(bootstrap));
      else if (operation) await input.modelAccess.recordSuccess(scope.accessContext ?? '', model, operation);
    });
  }
  const reportModelFailure = (scope: ModelResultScope, id: string, modality: GatewayModel['modality'], facts: PublicErrorFacts) => recordModelResult(scope, id, modality, facts);
  const reportModelSuccess = (scope: ModelResultScope, id: string, modality: GatewayModel['modality'], operation: GatewayModelOperation) => recordModelResult(scope, id, modality, undefined, operation);
  function snapshotState(): GatewayAccountState {
    const snapshot = structuredClone(state);
    if (input.modelAccess && credentials && isDirectTransport(credentials.transport) && state.authState === 'signed_in' && credentials.account) {
      snapshot.modelAvailability = input.modelAccess.availability(bootstrapSchema.parse(credentials));
    }
    return snapshot;
  }
  function needsAccessibleRuntime() {
    return !!credentials && isDirectTransport(credentials.transport) && !credentials.modelAccessError && state.authState === 'signed_in'
      && state.source === 'gateway' && !closing && !accessPaused && !supplierMigrating && (state.activationState === 'ready' || accessBlocked)
      && (!credentials.defaults?.text || accessBlocked || runtimeTextModel !== credentials.defaults.text);
  }
  async function synchronizeAccessibleRuntime() {
    if (!needsAccessibleRuntime() || !credentials) return;
    if (!credentials.defaults?.text) { accessBlocked = true; fail(missingTextModel()); return; }
    if ((!accessBlocked && runtimeTextModel === credentials.defaults.text) || localUses > 0 || input.hasActiveTasks() || input.hasPendingTasks?.()) return;
    const next = { ...bootstrapSchema.parse(credentials), models: state.models };
    try {
      await input.activateRuntime(next);
      runtimeTextModel = next.defaults.text; accessBlocked = false;
      state.bindingVersion = next.bindingVersion; state.activationState = 'ready'; state.activationError = null;
      await saveConfiguration();
    } catch (error) { accessBlocked = true; runtimeTextModel = undefined; fail(error, 'runtime'); await input.closeRuntime(); }
  }
  function scheduleModelAccess() {
    if (!input.modelAccess || closing || accessPaused || accessWork || credentials?.modelAccessError || !isDirectTransport(credentials?.transport) || state.authState !== 'signed_in'
      || (state.activationState !== 'ready' && !accessBlocked) || Date.now() - accessUpdatedAt < 30_000) return;
    accessUpdatedAt = Date.now();
    const controller = new AbortController(); accessController = controller;
    accessWork = (async () => {
      const original = bootstrapSchema.parse(assertSignedIn()); const expected = generation;
      await input.modelAccess!.refresh(original, controller.signal, async () => {
        await serialize(async () => {
          if (controller.signal.aborted || closing || generation !== expected || state.authState !== 'signed_in'
            || credentials?.account?.id !== original.account.id || credentials.keyVersion !== original.keyVersion) return;
          const next = input.modelAccess!.filter(withModelCatalog(bootstrapSchema.parse(credentials), officialModelPolicy(credentials.models ?? [])));
          await applyVisibleCatalog(next);
          await synchronizeAccessibleRuntime();
        });
      });
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
      preferencesInitialized = config.modelPreferencesVersion === 1;
      manualModels = config.manualModels ?? {};
      region = config.region ?? 'auto'; state.supplierRegion = region;
      state.selectedModels = { ...selectedModels };
      credentials = await store.readCredentials();
      state.source = credentials ? 'gateway' : 'manual';
      await saveConfiguration();
      if (!credentials) return;
      state.supplier = credentials.supplier;
      state.transport = credentials.transport;
      state.account = credentials.account ?? null; state.authState = 'signed_in'; state.models = credentials.models ?? [];
      if (credentials.modelAccessError) { restoreModelAccessError(credentials.modelAccessError); return; }
      if (input.deferStartupActivation) {
        const cached = bootstrapSchema.safeParse(credentials);
        // Catalog preparation may access the network; only restore the local snapshot before listen.
        if (cached.success) state.models = withModelCatalog(cached.data, officialModelPolicy(cached.data.models)).models;
        state.activationState = 'loading';
        return;
      }
      if (!usesCachedModelKey()) await refresh();
      await activateCurrent();
    } catch (error) { fail(error); }
  }
  function startBackgroundRestore(): Promise<void> {
    if (!input.deferStartupActivation || closing) return Promise.resolve();
    startupRestoreWork ??= (async () => {
      await initialize();
      if (!credentials || state.authState !== 'signed_in') return;
      await serialize(async () => {
        if (!closing && !accessPaused && state.authState === 'signed_in' && state.activationState === 'loading') {
          await activateCurrent();
        }
      });
    })().catch(error => { if (!closing) fail(error); }).finally(() => { startupRestoreFinished = true; });
    return startupRestoreWork;
  }
  async function refresh() {
    if (refreshWork) return refreshWork;
    refreshWork = (async () => {
      const original = assertSignedIn(); const expected = generation;
      if (Date.parse(original.accessExpiresAt) > Date.now() + 60_000) return;
      try {
        const tokens = await input.client.refresh(original.refreshToken);
        if (closing || accessPaused || generation !== expected || credentials?.refreshToken !== original.refreshToken || state.authState !== 'signed_in') return;
        // 同一登录会话内只更新令牌，保留并发同步的模型凭据。
        credentials = { ...assertSignedIn(), ...tokens, accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString() };
        await store.writeCredentials(credentials);
      } catch (error) {
        if (await blockConfirmedModelAccess(error, expected, original.account?.id)) throw error;
        if (!closing && !accessPaused && error instanceof GatewayError && error.status === 401 && generation === expected && credentials?.refreshToken === original.refreshToken && state.authState === 'signed_in') {
          state = { ...state, authState: 'expired', activationState: 'inactive', bindingVersion: null, activationError: null };
          runtimeTextModel = undefined; accessController?.abort();
          clearInterval(usageTimer); usageTimer = undefined;
          await input.closeRuntime();
        }
        throw error;
      }
    })();
    try { await refreshWork; } finally { refreshWork = undefined; }
  }
  async function activateCurrent(rotate = true) {
    await runtimeCloseWork;
    // Connecting a new session must not wait for unrelated or persisted jobs.
    if (state.activationState === 'ready') assertIdle();
    const cached = usesCachedModelKey() && !supplierMigrating && !credentials?.modelAccessError && !input.modelAccess?.needsKeyRefresh() ? bootstrapSchema.safeParse(credentials) : undefined;
    if (closing || accessPaused) return;
    let original = assertSignedIn(); const expected = generation;
    let stage: GatewayActivationStage = 'credentials';
    state.activationState = 'loading'; state.activationError = null;
    try {
      if (!cached?.success) await refresh();
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') return;
      original = assertSignedIn();
      state.source = 'gateway'; state.bindingVersion = null;
      stage = 'configuration';
      await saveConfiguration();
      stage = 'usage';
      let migration: GatewayError | undefined;
      try { await reportUsage(); }
      catch (error) {
        if (!(error instanceof GatewayError) || error.status !== 409 || error.code !== 'gateway_migrated') throw error;
        migration = error;
      }
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') return;
      stage = 'bootstrap';
      const bootstrap = cached?.success ? cached.data : await input.client.bootstrap(original.accessToken, { rotate: !migration && rotate && !usesCachedModelKey() && !input.hasPendingTasks?.(), modelUsePolicy: cachedModelUsePolicy, ...(region === 'auto' ? {} : { region }) });
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') return;
      if (original.account && bootstrap.account.id !== original.account.id) throw new GatewayError('account_mismatch');
      // Only a confirmed gateway binding can replace obsolete direct-key coordination.
      if (migration && (bootstrap.transport !== 'gateway' || bootstrap.keyRotation !== false)) { stage = 'usage'; throw migration; }
      state.account = bootstrap.account;
      state.supplier = bootstrap.supplier ?? 'openrouter'; supplierMigrating = false;
      state.transport = bootstrap.transport;
      state.catalogVersion=bootstrap.catalogVersion; state.catalogUpdatedAt=bootstrap.catalogUpdatedAt; state.catalogRefreshState=bootstrap.catalogRefreshState;
      for (const [modality, model] of Object.entries(selectedModels)) {
        if (bootstrap.transport !== 'gateway' && bootstrap.models.some(candidate => gatewayModelSupports(candidate,modality as GatewayModelPurpose) && gatewayModelIdMatches(candidate.id, model))) bootstrap.defaults[modality] = model;
      }
      stage = 'catalog';
      const visible = await visibleBootstrap(bootstrap);
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') return;
      selectedModels = { ...visible.defaults }; state.selectedModels = { ...selectedModels };
      credentials = { ...original, ...bootstrap, ...(bootstrap.transport === 'gateway' ? { modelKey: undefined, models: visible.models } : {}), defaults: visible.defaults, modelAccessError: undefined };
      await store.writeCredentials(credentials);
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') return;
      state.account = bootstrap.account; state.models = visible.models;
      accessBlocked = bootstrap.transport !== 'gateway' && !visible.defaults.text;
      if (accessBlocked) throw missingTextModel();
      stage = 'runtime';
      if (bootstrap.transport !== 'gateway' || visible.models.some(model => model.id === visible.defaults.text && gatewayModelSupports(model, 'text') && gatewayModelReady(model))) {
        await input.activateRuntime(visible);
        runtimeTextModel = visible.defaults.text;
      }
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') { await input.closeRuntime(); return; }
      state.bindingVersion = bootstrap.bindingVersion;
      catalogUpdatedAt = Date.now();
      stage = 'configuration';
      await saveConfiguration();
      if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') { await input.closeRuntime(); return; }
      state = { ...state, source: 'gateway', activationState: 'ready', account: bootstrap.account, models: visible.models, bindingVersion: bootstrap.bindingVersion, activationError: null };
      stage = 'usage';
      await reportUsage();
      activationRetryAt = 0;
      startUsageHeartbeat();
    } catch (error) {
      runtimeTextModel = undefined;
      if (error instanceof GatewayError && error.code === 'supplier_migrating') { supplierMigrating = true; scheduleMaintenance(60_000); }
      if (await blockConfirmedModelAccess(error, expected, original.account?.id)) return;
      if (!closing && !accessPaused && generation === expected && state.authState === 'signed_in') fail(error, stage);
      await input.closeRuntime();
    }
    scheduleModelAccess();
  }
  async function readProfile() {
    if (closing || accessPaused || !credentials || state.authState !== 'signed_in') return;
    if (profileWork) return profileWork;
    if (Date.now() - profileUpdatedAt < 30_000) return;
    profileUpdatedAt = Date.now();
    profileWork = (async () => {
      await refresh();
      if (closing || accessPaused) return;
      const original = assertSignedIn(); const expected = generation;
      const profile = z.object({ account: accountSchema }).parse(await withAccountAccess(() => input.client.request('/api/v1/me', original.accessToken)));
      await serialize(async () => {
        if (closing || accessPaused || expected !== generation || credentials !== original || state.authState !== 'signed_in') return;
        if (original.account && profile.account.id !== original.account.id) throw new GatewayError('account_mismatch');
        const next = { ...original, account: profile.account };
        await store.writeCredentials(next);
        if (closing || accessPaused || expected !== generation || credentials !== original || state.authState !== 'signed_in') return;
        credentials = next; state.account = profile.account;
      });
    })().catch(() => undefined);
    try { await profileWork; }
    finally { profileWork = undefined; }
  }
  async function applyGatewayCatalog(bootstrap: GatewayBootstrap) {
    const resolved = resolveModelPreferences(bootstrap.models, bootstrap.defaults, manualModels);
    if (resolved.selected.text !== runtimeTextModel && (localUses > 0 || input.hasActiveTasks())) {
      pendingGatewayCatalog = bootstrap;
      state.catalogError = undefined;
      return;
    }
    const next = resolveGatewayBootstrap(bootstrap);
    if (next.defaults.text !== runtimeTextModel) {
      if (next.defaults.text) await input.activateRuntime(next);
      else await input.closeRuntime();
      runtimeTextModel = next.defaults.text;
    }
    credentials = { ...assertSignedIn(), models: next.models, defaults: next.defaults,
      catalogVersion: next.catalogVersion, catalogUpdatedAt: next.catalogUpdatedAt, catalogRefreshState: next.catalogRefreshState };
    state.models = next.models; selectedModels = { ...next.defaults }; state.selectedModels = { ...selectedModels };
    state.catalogVersion = next.catalogVersion; state.catalogUpdatedAt = next.catalogUpdatedAt; state.catalogRefreshState = next.catalogRefreshState; state.catalogError = undefined;
    pendingGatewayCatalog = undefined;
    await store.writeCredentials(credentials); await saveConfiguration();
  }
  async function readCatalog(force = false) {
    if (closing || accessPaused || !credentials || state.authState !== 'signed_in' || state.source !== 'gateway' || state.activationState !== 'ready') return;
    if (catalogWork) return catalogWork;
    if (pendingGatewayCatalog && localUses === 0 && !input.hasActiveTasks()) {
      const pending = pendingGatewayCatalog;
      await serialize(async () => { if (credentials?.transport === 'gateway' && !closing && !accessPaused) await applyGatewayCatalog(pending); });
    }
    if ((!force && Date.now() - catalogUpdatedAt < 30_000) || (credentials.transport !== 'gateway' && (input.hasActiveTasks() || input.hasPendingTasks?.()))) return;
    catalogUpdatedAt = Date.now();
    const catalogGeneration = generation;
    catalogWork = (async () => {
      await refresh();
      if (closing || accessPaused) return;
      const original = assertSignedIn(); const expected = generation;
      const catalog = catalogSchema.parse(await withAccountAccess(() => input.client.request('/api/v1/client/models' + (original.transport === 'gateway' ? '?catalogSchema=2&publicMetadata=1' : ''), original.accessToken)));
      if (original.transport === 'gateway') {
        await serialize(async()=>{
          if (closing || accessPaused || generation!==expected || credentials?.account?.id!==original.account?.id || state.authState!=='signed_in') return;
          await applyGatewayCatalog({ ...bootstrapSchema.parse(assertSignedIn()), ...catalog, defaults: catalog.defaults ?? {}, models: catalog.models });
          state.modelAvailability=catalog.modelAvailability?.flatMap(item=>{const model=catalog.models.find(m=>m.id===item.model);return model?[{...item,modality:model.modality}]:[];});
        });
        return;
      }
      await serialize(async () => {
        if (closing || accessPaused || generation !== expected || credentials !== original || state.source !== 'gateway' || state.authState !== 'signed_in' || input.hasActiveTasks() || input.hasPendingTasks?.()) return;
        if (original.rotationPending || JSON.stringify(catalog.models) !== JSON.stringify(original.models)) {
          if (usesCachedModelKey()) { await synchronizeBinding(); await synchronizeAccessibleRuntime(); }
          else await activateCurrent();
        }
      });
    })().catch(error => { if (generation===catalogGeneration && state.authState==='signed_in') state.catalogError='model_catalog_unavailable'; if(force) throw error; });
    try { await catalogWork; } finally { catalogWork = undefined; }
  }
  function refreshState(): Promise<void> {
    stateRefreshWork ??= (async () => {
      await readProfile();
      if (canRetryActivation()) {
        const expected = generation;
        await serialize(async () => {
          if (expected === generation && canRetryActivation()) {
            activationRetryAt = Date.now() + 30_000;
            await activateCurrent(false);
          }
        });
      }
      await readCatalog();
      await refreshVisibleCatalog();
      if (needsAccessibleRuntime()) await serialize(synchronizeAccessibleRuntime);
      scheduleModelAccess();
    })().finally(() => { stateRefreshWork = undefined; });
    return stateRefreshWork;
  }
  function canRetryActivation() {
    return input.automaticPolling !== false && !closing && !accessPaused && state.source === 'gateway'
      && state.authState === 'signed_in' && state.activationState === 'blocked' && !credentials?.modelAccessError
      && ['gateway_unavailable', 'services_not_ready', 'invalid_gateway_response', 'model_catalog_unavailable', 'supplier_migrating', 'supplier_binding_changed'].includes(state.activationError?.code ?? '')
      && Date.now() >= activationRetryAt && localUses === 0 && !input.hasActiveTasks() && !input.hasPendingTasks?.();
  }
  function schedulePoll(id: string, seconds: number) {
    if (attempt?.attemptId !== id) return;
    attempt.nextPollAt = Date.now() + Math.max(5, seconds) * 1000;
    if (input.automaticPolling === false) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => { void pollAuthorization(id).catch(() => undefined); }, Math.max(0, attempt.nextPollAt - Date.now())); pollTimer.unref();
  }
  function checkAuthorization() {
    if (attempt && Date.now() >= attempt.nextPollAt) void pollAuthorization(attempt.attemptId).catch(() => undefined);
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
    await initialize();
    if (credentials && state.authState === 'expired') {
      if (!input.hasPendingTasks?.()) await logout();
    }
    else if (credentials) throw new GatewayError('already_signed_in', 409);
    await cancelAuthorization();
    const expected = generation;
    const grant = await input.client.startDevice();
    const url = new URL(grant.authorizationUrl);
    if (url.origin !== input.client.origin || url.pathname !== '/device') throw new GatewayError('invalid_authorization_url');
    if (generation !== expected) { await input.client.cancelDevice(grant.attemptId, grant.deviceSecret); throw new GatewayError('authorization_canceled'); }
    attempt = { ...grant, generation: expected, expiresAt: Date.now() + grant.expiresIn * 1000, nextPollAt: Date.now(), previousAuthState: state.authState };
    state.source = 'gateway'; state.authState = 'authorizing'; state.activationState = 'loading'; state.activationError = null;
    await saveConfiguration();
    schedulePoll(grant.attemptId, grant.interval);
    return { attemptId: grant.attemptId, authorizationUrl: grant.authorizationUrl, expiresAt: new Date(attempt.expiresAt).toISOString() };
  }
  async function pollAuthorization(id: string) {
    const current = attempt; if (!current || current.attemptId !== id) return;
    if (pollWork?.attempt === current) return pollWork.work;
    clearTimeout(pollTimer);
    current.nextPollAt = Date.now() + Math.max(5, current.interval) * 1000;
    const work = performAuthorizationPoll(current);
    const pending = { attempt: current, work }; pollWork = pending;
    try { await work; } finally { if (pollWork === pending) pollWork = undefined; }
  }
  async function performAuthorizationPoll(current: NonNullable<typeof attempt>) {
    const id = current.attemptId;
    if (current.expiresAt <= Date.now()) { await cancelAuthorization(); state.activationError = { code: 'device_expired', message: 'Sign-in authorization expired. Sign in again.' }; return; }
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
        input.modelAccess?.reset();
        await store.writeCredentials(credentials);
        if (generation !== current.generation || attempt !== current) return;
        state.source = 'gateway'; state.authState = 'signed_in'; attempt = undefined;
        await saveConfiguration();
        await activateCurrent();
      });
    } catch (error) {
      if (generation !== current.generation) return;
      if (error instanceof GatewayError && ['authorization_pending', 'slow_down', 'gateway_unavailable'].includes(error.code)) {
        if (error.code === 'slow_down') current.interval += 5;
        schedulePoll(id, current.interval); return;
      }
      fail(error); await cancelAuthorization();
    }
  }
  async function readModelCredentials(recovery = false): Promise<{ accountId: string; modelKey: string; keyVersion: string; bindingVersion: string; baseUrl: string; transport?: GatewayBootstrap['transport']; models: GatewayBootstrap['models']; defaults: Record<string, string>; accessContext?: string }> {
    await initialize();
    if (!usesCachedModelKey()) await refresh();
    await refreshVisibleCatalog();
    return currentModelCredentials(recovery);
  }
  function currentModelCredentials(recovery = false): Awaited<ReturnType<typeof readModelCredentials>> {
    if (closing || accessPaused) throw new GatewayError('auth_required', 401);
    if (supplierMigrating) throw new GatewayError('supplier_migrating', 409);
    const value = assertSignedIn();
    if (value.modelAccessError) throw new GatewayError(value.modelAccessError, value.modelAccessError === 'auth_required' ? 401 : 403);
    const modelKey = value.transport === 'gateway' ? value.accessToken : value.modelKey;
    const keyVersion = value.transport === 'gateway' ? 'device:' + createHash('sha256').update(value.accessToken).digest('hex') : value.keyVersion;
    if (state.source !== 'gateway' || (!recovery && state.activationState !== 'ready') || !value.account || !modelKey || !keyVersion || !value.bindingVersion || !value.baseUrl || !value.models || !value.defaults) throw new GatewayError('services_not_ready');
    return { accountId: value.account.id, modelKey, keyVersion, bindingVersion: value.bindingVersion, baseUrl: value.baseUrl, transport: value.transport, models: structuredClone(state.models), defaults: { ...value.defaults }, accessContext: input.modelAccess?.context() };
  }
  const modelCredentials = () => readModelCredentials();
  async function validateModel(modality: GatewayModel['modality'], id: string) {
    const scope = await readModelCredentials();
    const model = scope.models.find(candidate => candidate.modality === modality && gatewayModelIdMatches(candidate.id, id)
      && gatewayModelReady(candidate) && (modality !== 'text' || candidate.capabilities.includes('responses') || candidate.capabilities.includes('chat')));
    if (!model) throw new GatewayError('invalid_model', 400);
    return model;
  }
  async function probeModel(modality: GatewayModel['modality'], id: string, options?: GatewayModelProbeOptions) {
    await initialize();
    const expected = generation;
    const use = await beginModelUse();
    try {
      let scope = use.credentials;
      let model = scope.models.find(candidate => candidate.modality === modality && gatewayModelIdMatches(candidate.id, id)
      && gatewayModelReady(candidate) && (modality !== 'text' || scope.transport !== 'gateway' || candidate.capabilities.includes(options?.textApi==='chat/completions'?'chat':'responses')));
      if (!model) throw new GatewayError('invalid_model', 400);
      if (!input.probeModel) throw new ModelProbeError('model_probe_unavailable');
      try {
        try { await input.probeModel(model, scope, true, options); }
        catch (error) {
          if (!(error instanceof ModelProbeError) || error.code !== 'model_probe_auth_required') throw error;
          const updated = await recoverModelCredentials(scope.keyVersion);
          if (updated.baseUrl !== scope.baseUrl) throw new GatewayError('supplier_binding_changed', 409);
          if (updated.modelKey === scope.modelKey) throw error;
          scope = updated;
          model = scope.models.find(candidate => candidate.modality === modality && gatewayModelIdMatches(candidate.id, id)
            && gatewayModelReady(candidate) && (modality !== 'text' || scope.transport !== 'gateway' || candidate.capabilities.includes(options?.textApi==='chat/completions'?'chat':'responses')));
          if (!model) throw new GatewayError('invalid_model', 400);
          await input.probeModel(model, scope, true, options);
        }
      }
      catch (error) {
        if (error instanceof ModelProbeError && error.publicFacts) await reportModelFailure(scope, id, modality, error.publicFacts);
        throw error;
      }
      if (closing || accessPaused || generation !== expected || currentModelCredentials().keyVersion !== scope.keyVersion
        || credentials?.account?.id !== scope.accountId || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
      const operation: GatewayModelOperation = modality === 'text' ? options?.textApi ?? 'responses'
        : modality === 'image' ? 'images/generations' : modality === 'video' ? 'video/jobs'
          : modality === 'speech' ? 'audio/speech' : 'audio/transcriptions';
      await reportModelSuccess(scope, id, modality, operation);
      return { model: id, modality, costBearer: 'customer' as const, operation };
    } finally { await use.release(); }
  }
  function reportUsage(allowClosing = false) {
    const result = usageMutation.then(async () => {
      if ((closing && !allowClosing) || usesCachedModelKey() || !credentials?.keyRotation || !credentials.keyVersion || state.authState !== 'signed_in') return undefined;
      await refresh();
      if (closing && !allowClosing) return undefined;
      const current = assertSignedIn(); const expected = generation;
      const installationId = await store.readDeviceID();
      if (closing && !allowClosing) return undefined;
      const value = z.object({ keyVersion: z.string().min(1) }).parse(await input.client.request('/api/v1/client/usage', current.accessToken, {
        keyVersion: current.keyVersion, installationId, busy: localUses > 0 || input.hasActiveTasks(), pending: input.hasPendingTasks?.() === true
      }));
      if (generation !== expected || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
      return value.keyVersion;
    });
    usageMutation = result.then(() => undefined, () => undefined);
    return result;
  }
  function startUsageHeartbeat() {
    if (closing || accessPaused || usageTimer || input.automaticPolling === false) return;
    if (usesCachedModelKey()) { scheduleMaintenance(60_000); return; }
    if (!credentials?.keyRotation) return;
    usageTimer = setInterval(() => { void reportUsage().catch(() => undefined); }, 10_000);
    usageTimer.unref();
  }
  function scheduleMaintenance(milliseconds: number) {
    if (closing || accessPaused || state.authState !== 'signed_in' || (state.activationState !== 'ready' && !supplierMigrating && !accessBlocked) || (!usesCachedModelKey() && !supplierMigrating) || input.automaticPolling === false) return;
    usageTimer = setTimeout(() => {
      usageTimer = undefined;
      maintenanceWork = (async () => { await refresh(); await synchronizeBinding(); await serialize(synchronizeAccessibleRuntime); maintenanceFailures = 0; })()
        .catch(() => { maintenanceFailures++; })
        .finally(() => {
          maintenanceWork = undefined;
          const delay = Math.min(300_000, 60_000 * 2 ** Math.min(maintenanceFailures, 3));
          scheduleMaintenance(Math.round(delay * (0.9 + Math.random() * 0.2)));
        });
    }, milliseconds);
    usageTimer.unref();
  }
  function synchronizeBinding(): Promise<void> {
    bindingSyncWork ??= performBindingSync().finally(() => { bindingSyncWork = undefined; });
    return bindingSyncWork;
  }
  async function performBindingSync() {
    const current = assertSignedIn(); const expected = generation;
    let bootstrap: GatewayBootstrap;
    try { bootstrap = await input.client.bootstrap(current.accessToken, { rotate: false, ...(region === 'auto' ? {} : { region }) }); }
    catch (error) {
      if (error instanceof GatewayError && error.code === 'supplier_migrating') { supplierMigrating = true; fail(error, 'bootstrap'); }
      await blockConfirmedModelAccess(error, expected, current.account?.id); throw error;
    }
    if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    if (current.account && bootstrap.account.id !== current.account.id) throw new GatewayError('account_mismatch');
    for (const [modality, model] of Object.entries(selectedModels)) {
      if (bootstrap.transport !== 'gateway' && bootstrap.models.some(candidate => gatewayModelSupports(candidate,modality as GatewayModelPurpose) && gatewayModelIdMatches(candidate.id, model))) bootstrap.defaults[modality] = model;
    }
    const visible = await visibleBootstrap(bootstrap);
    if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    const bindingChanged = current.baseUrl !== bootstrap.baseUrl || current.supplier !== bootstrap.supplier;
    const resumeRuntime = supplierMigrating || bindingChanged;
    const deferCatalog = !resumeRuntime && usesCachedModelKey() && (localUses > 0 || input.hasActiveTasks() || input.hasPendingTasks?.());
    const latest = assertSignedIn();
    credentials = { ...latest, ...bootstrap, ...(bootstrap.transport === 'gateway' ? { modelKey: undefined } : {}), defaults: deferCatalog ? latest.defaults : visible.defaults, models: deferCatalog ? latest.models : bootstrap.transport === 'gateway' ? visible.models : bootstrap.models };
    await store.writeCredentials(credentials);
    if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in') throw new GatewayError('auth_required', 401);
    state.bindingVersion = bootstrap.bindingVersion;
    state.account = bootstrap.account;
    state.supplier = bootstrap.supplier ?? 'openrouter'; supplierMigrating = false;
    state.transport = bootstrap.transport;
    if (resumeRuntime) { accessBlocked = true; runtimeTextModel = undefined; fail(new GatewayError('services_not_ready'), 'runtime'); }
    if (!deferCatalog) {
      state.models = visible.models; catalogUpdatedAt = Date.now();
      selectedModels = { ...visible.defaults }; state.selectedModels = { ...selectedModels };
    }
    await saveConfiguration();
  }
  async function acquireModelUse(recovery = false) {
    const snapshot = await readModelCredentials(recovery);
    const cached = usesCachedModelKey();
    localUses++;
    let released = false;
    const release = async () => {
      if (released) return;
      released = true; localUses--;
      if (!cached) await reportUsage().catch(() => undefined);
    };
    if (cached) return { credentials: snapshot, release };
    try {
      let version: string | undefined;
      try { version = await reportUsage(); }
      catch (error) {
        if (!(error instanceof GatewayError) || error.code !== 'binding_rotation_pending') throw error;
        await synchronizeBinding();
        version = await reportUsage();
      }
      if (version && version !== credentials?.keyVersion) await synchronizeBinding();
      return { credentials: await readModelCredentials(recovery), release };
    } catch (error) { await release(); throw error; }
  }
  const beginModelUse = (options?: { recovery: boolean }) => acquireModelUse(options?.recovery);
  async function recoverModelCredentials(keyVersion: string) {
    await initialize();
    if (credentials?.transport === 'gateway') {
      if (currentModelCredentials(true).keyVersion !== keyVersion) return currentModelCredentials(true);
      credentials.accessExpiresAt = new Date(0).toISOString();
      await refresh();
      return currentModelCredentials(true);
    }
    if (!usesCachedModelKey()) throw new GatewayError('model_auth_required', 401);
    if (currentModelCredentials(true).keyVersion !== keyVersion) return currentModelCredentials(true);
    await refresh();
    await synchronizeBinding();
    return currentModelCredentials(true);
  }
  async function logout() {
    await initialize();
    accessPaused = true;
    input.client.cancelPendingRequests?.();
    accessController?.abort(); input.modelAccess?.reset(); await accessWork;
    await serialize(async () => {
      await reportUsage().catch(() => undefined);
      state.authState = 'signing_out'; state.activationState = 'inactive';
      clearInterval(usageTimer); usageTimer = undefined;
      await cancelAuthorization();
      await refreshWork?.catch(() => undefined);
      await runtimeCloseWork;
      await input.closeRuntime();
      runtimeTextModel = undefined;
      if (credentials) await input.client.logout(credentials.accessToken).catch(() => undefined);
      await store.deleteCredentials(); state.source = 'manual'; state.bindingVersion = null; await saveConfiguration();
      credentials = undefined; pendingGatewayCatalog = undefined; balance = null; profileUpdatedAt = 0; catalogUpdatedAt = 0; accessUpdatedAt = 0; modelAuthRecoveryAt = 0; accessBlocked = false; supplierMigrating = false;
      rechargeSnapshot = { state: 'unknown', observedAt: new Date().toISOString() };
      state = { ...state, authState: 'signed_out', activationState: 'inactive', account: null, models: [], bindingVersion: null, activationError: null, supplier: undefined };
    }).finally(() => { accessPaused = false; });
  }
  async function billing(path: string, body?: unknown) {
    await initialize();
    await refresh();
    const current = assertSignedIn();
    const response = await withAccountAccess(() => input.client.request(path, current.accessToken, body));
    const rechargeState = rechargeStateFromOrderResponse(response);
    if (rechargeState !== undefined
      && (rechargeSnapshot.state !== 'recharged' || rechargeState === 'recharged')) {
      rechargeSnapshot = { state: rechargeState, observedAt: new Date().toISOString() };
    }
    return response;
  }
  async function readBalance(): Promise<GatewayBalanceState> {
    try {
      const value = z.object({ balance: z.object({ availableUnits: z.string().regex(/^\d+$/), reservedUnits: z.string().regex(/^\d+$/), periodEnd: z.string().nullable(), asOf: z.string() }) }).parse(await billing('/api/v1/billing/summary'));
      balance = value.balance; return { status: 'ready', value: balance };
    } catch (error) { return { status: 'unavailable', lastKnown: balance, code: error instanceof GatewayError ? error.code : 'gateway_unavailable' }; }
  }
  return {
    initialize, startBackgroundRestore,
    peekState: snapshotState,
    peekTelemetryRechargeState: () => rechargeSnapshot,
    startAuthorization, cancelAuthorization, pollAuthorization, checkAuthorization, refresh, logout, modelCredentials, beginModelUse, recoverModelCredentials, validateModel, probeModel, readBalance, billing, reportModelFailure, reportModelSuccess,
    async setRegion(next: SupplierRegion) {
      await initialize();
      return serialize(async () => {
        assertIdle(); if (input.hasPendingTasks?.()) throw new GatewayError('active_tasks', 409);
        if (assertSignedIn().supplier !== 'chatanywhere' || !['auto', 'domestic', 'overseas'].includes(next)) throw new GatewayError('invalid_parameters', 400);
        region = next; state.supplierRegion = next;
        await saveConfiguration(); await synchronizeBinding(); await input.closeRuntime(); runtimeTextModel = undefined;
        await activateCurrent(false); return snapshotState();
      });
    },
    readPlans() { return input.client.request('/api/v1/plans', ''); },
    async readAvatar(accountId: string) {
      await initialize(); await refresh();
      const current = assertSignedIn(); const expected = generation;
      if (!current.account?.avatarUrl || current.account.id !== accountId) throw new GatewayError('avatar_unavailable', 404);
      const image = await withAccountAccess(() => input.client.avatar(current.accessToken, accountId));
      if (expected !== generation || state.authState !== 'signed_in' || credentials?.account?.id !== accountId) throw new GatewayError('avatar_unavailable', 404);
      return image;
    },
    async activate() { await initialize(); const expected = generation; await serialize(async () => { if (expected === generation) { input.modelAccess?.invalidateCatalog(); await activateCurrent(false); } }); },
    async readState(options?: { refreshModels?: boolean }) {
      await initialize();
      // Login is visible while model preparation still owns the mutation queue.
      if (closing || state.activationState === 'loading' || state.authState === 'signing_out') return snapshotState();
      if (options?.refreshModels) input.modelAccess?.invalidateCatalog();
      if (options?.refreshModels && credentials?.transport==='gateway') { await readCatalog(true); return snapshotState(); }
      const work = refreshState();
      if (input.deferStartupActivation && !options?.refreshModels) void work.catch(() => undefined);
      else await work;
      return snapshotState();
    },
    async setSource(source: ServiceSource) {
      await initialize(); await serialize(async () => {
        if (source === 'manual' && (credentials || state.authState !== 'signed_out')) throw new GatewayError('logout_required', 409);
        if (source === 'gateway') { assertSignedIn(); assertIdle(); await activateCurrent(); return; }
        state.source = 'manual'; await saveConfiguration();
      });
    },
    async selectModel(modality: GatewayModelPurpose, model: string) {
      await initialize();
      const selectionGeneration = generation;
      if (model !== gatewayRecommendedModelId) await validateModel(modality, model);
      await serialize(async () => {
        if (generation !== selectionGeneration) throw new GatewayError('auth_required', 401);
        const current = assertSignedIn(); const expected = generation;
        const automatic = model === gatewayRecommendedModelId;
        if (automatic) {
          model = state.recommendedModels?.[modality] ?? '';
          if (current.transport !== 'gateway' || !model) throw new GatewayError('invalid_model', 400);
        }
        if (state.source !== 'gateway' || state.activationState !== 'ready' || !current.defaults || !state.models.some(candidate => gatewayModelSupports(candidate,modality) && gatewayModelReady(candidate) && gatewayModelIdMatches(candidate.id, model))) throw new GatewayError('invalid_model', 400);
        const next = { ...current, defaults: { ...current.defaults, [modality]: model } };
        if (modality === 'text' && current.transport === 'gateway') assertIdle();
        if (modality === 'text') { await input.activateRuntime(bootstrapSchema.parse(next)); runtimeTextModel = model; }
        if (closing || accessPaused || generation !== expected || state.authState !== 'signed_in' || credentials?.modelAccessError) {
          runtimeTextModel = undefined; await input.closeRuntime(); throw new GatewayError('auth_required', 401);
        }
        // Runtime 激活期间可能更新凭据，只合并本次模型选择。
        const latest = assertSignedIn();
        credentials = { ...latest, defaults: { ...latest.defaults, [modality]: model } };
        selectedModels = { ...credentials.defaults }; state.selectedModels = { ...selectedModels };
        if (current.transport === 'gateway') {
          if (automatic) delete manualModels[modality]; else manualModels[modality] = model;
          state.modelSelectionModes = { ...state.modelSelectionModes, [modality]: automatic ? 'recommended' : 'manual' };
          state.modelSelectionNotice = undefined;
        }
        await store.writeCredentials(credentials); await saveConfiguration();
      });
      return snapshotState();
    },
    async close() {
      const restoring = startupRestoreWork !== undefined && !startupRestoreFinished;
      closing = true; input.client.cancelPendingRequests?.(); accessController?.abort(); input.modelAccess?.reset();
      clearTimeout(pollTimer); clearInterval(usageTimer); usageTimer = undefined;
      await initialization; await startupRestoreWork; await stateRefreshWork?.catch(() => undefined);
      await maintenanceWork; await bindingSyncWork?.catch(() => undefined);
      await accessWork; await profileWork; await catalogWork; await mutation; await refreshWork?.catch(() => undefined);
      await runtimeCloseWork;
      await input.closeRuntime();
      if (!restoring && state.activationState === 'ready') await reportUsage(true).catch(() => undefined);
      await usageMutation; generation++;
    }
  };
}

function rechargeStateFromOrderResponse(value: unknown): 'recharged' | 'not_recharged' | 'pending' | 'unknown' | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const orders = Array.isArray(record.items)
    ? record.items
    : record.order !== null && typeof record.order === 'object' && !Array.isArray(record.order)
      ? [record.order]
      : undefined;
  if (orders === undefined) return undefined;
  const states = orders.flatMap(order => {
    if (order === null || typeof order !== 'object' || Array.isArray(order)) return [];
    const candidate = order as Record<string, unknown>;
    const status = typeof candidate.status === 'string' ? candidate.status : '';
    const paymentStatus = typeof candidate.paymentStatus === 'string' ? candidate.paymentStatus : '';
    const creditStatus = typeof candidate.creditStatus === 'string' ? candidate.creditStatus : '';
    if (status === 'completed' || creditStatus === 'ready' || creditStatus === 'completed') return ['recharged' as const];
    if (status === 'pending' || status === 'processing' || paymentStatus === 'pending' || creditStatus === 'pending') return ['pending' as const];
    if (['failed', 'canceled', 'cancelled', 'expired', 'refunded'].includes(status)) return ['not_recharged' as const];
    return ['unknown' as const];
  });
  if (states.includes('recharged')) return 'recharged';
  if (states.includes('pending')) return 'pending';
  if (states.includes('unknown')) return 'unknown';
  if (orders.length === 0) return 'not_recharged';
  return states.length === 0 ? 'unknown' : 'not_recharged';
}

export type GatewayAccountService = ReturnType<typeof createGatewayAccountService>;
