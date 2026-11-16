import type { GatewayAccountState, GatewayAuthorization, GatewayBalanceSnapshot, GatewayBalanceState, GatewayImageCatalog, GatewayVideoCatalog, GatewayModelCatalog, GatewayModelProbeOptions, ServiceSource } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';
export type GatewayPlan = { id: string; name: string; currency: string; amountUnits: string; creditUnits: string; wechatAmountUnits?: string };
export type GatewayBillingAvailability = {
  billingAvailable: boolean;
  billingUnavailableReason?: 'purchases_disabled' | 'payment_service_unavailable' | 'official_services_unavailable' | 'payment_review' | string;
};
export type GatewayPlans = GatewayBillingAvailability & { plans: GatewayPlan[]; plansUrl?: string; purchaseMode?: 'credits'; paymentMode?: 'test' | 'live' };
export type GatewayRechargeOrder = {
  id: string; planId: string; planName?: string; operationId?: string;
  amountUnits: string; currency: string; creditUnits: string;
  status: string; paymentStatus: string; creditStatus: string; reviewRequired: boolean;
  paymentMode: 'test' | 'live'; createdAt: string; expiresAt?: string; paidAt: string | null; completedAt: string | null;
};
export type GatewayCreditGrant = { id: string; kind: 'grant' | 'reserve' | 'settle' | 'release' | 'refund' | 'migration'; units: string; createdAt: string; businessKey: string; source?: string; facts?: { model?: string; requestId?: string; releasedUnits?: string; reason?: string } };
export type GatewayBillingSummary = {
  balance: GatewayBalanceSnapshot;
  subscription: { id: string; status: string; periodStart: string; periodEnd: string; cancelAtPeriodEnd: boolean; nextPlanId: string | null; plan?: GatewayPlan } | null;
  billingAvailable: boolean;
  billingUnavailableReason?: GatewayBillingAvailability['billingUnavailableReason'];
  purchaseMode?: 'credits';
  plansUrl?: string;
  paymentReview?: boolean;
};
export type GatewayWebDestination = 'recharge' | 'account' | 'usage' | 'faq';
const publicCatalogTtlMs = 60 * 60_000;
export function createGatewayAccountService(client: Pick<RuntimeClient, 'get' | 'post' | 'patch'> & Partial<Pick<RuntimeClient, 'rawGet'>>, options: { authorizationReturnUrl?: string; billingReturnUrl?: string } = {}) {
  const rawGet = client.rawGet?.bind(client);
  let avatarCache: { key: string; work: Promise<Blob> } | undefined;
  let accountId: string | undefined;
  let accountGeneration = 0;
  let summaryCache: { accountId: string; value: GatewayBillingSummary } | undefined;
  let summaryWork: Promise<GatewayBillingSummary> | undefined;
  const catalogCache: Partial<Record<'image' | 'video' | 'text', { value: GatewayModelCatalog; fetchedAt: number }>> = {};
  const catalogWork: Partial<Record<'image' | 'video' | 'text', Promise<GatewayModelCatalog>>> = {};
  function readCatalog(modality: 'image' | 'video' | 'text', refresh = false): Promise<GatewayModelCatalog> {
    const cached = catalogCache[modality];
    if (!refresh && cached && Date.now() - cached.fetchedAt < publicCatalogTtlMs) return Promise.resolve(cached.value);
    if (catalogWork[modality]) return catalogWork[modality];
    const path = modality === 'image' ? '/gateway/models/catalog' : `/gateway/models/catalog?modality=${modality}`;
    const work = client.get<GatewayModelCatalog>(path).then(value => {
      catalogCache[modality] = { value, fetchedAt: Date.now() };
      return value;
    }).finally(() => { if (catalogWork[modality] === work) delete catalogWork[modality]; });
    catalogWork[modality] = work;
    return work;
  }
  function clearSummary(nextAccountId?: string) {
    accountGeneration++; accountId = nextAccountId;
    summaryCache = undefined; summaryWork = undefined;
  }
  function getSummary(): Promise<GatewayBillingSummary> {
    if (summaryWork) return summaryWork;
    const expected = accountGeneration; const owner = accountId;
    const work = client.get<GatewayBillingSummary>('/gateway/billing/summary').then(value => {
      if (owner && expected === accountGeneration) summaryCache = { accountId: owner, value };
      return value;
    }).finally(() => { if (summaryWork === work) summaryWork = undefined; });
    summaryWork = work;
    return work;
  }
  function observeState(state: GatewayAccountState, expected = accountGeneration): GatewayAccountState {
    if (expected !== accountGeneration) return state;
    const nextAccountId = state.authState === 'signed_in' ? state.account?.id : undefined;
    if (nextAccountId !== accountId) {
      clearSummary(nextAccountId);
      // Warm the account view without delaying sign-in or model preparation.
      if (nextAccountId) void getSummary().catch(() => undefined);
    }
    return state;
  }
  return {
    ...(rawGet ? { getAvatar(accountId: string, revision: string): Promise<Blob> {
      const key = `${accountId}:${revision}`;
      if (avatarCache?.key === key) return avatarCache.work;
      const work = rawGet('/gateway/avatar?accountId=' + encodeURIComponent(accountId)).then(response => {
        if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(response.headers.get('content-type')?.split(';')[0] ?? '')) throw new Error('Account picture is unavailable');
        return response.blob();
      }).catch(error => { if (avatarCache?.key === key) avatarCache = undefined; throw error; });
      avatarCache = { key, work };
      return work;
    } } : {}),
    async getState(options?: { checkAuthorization?: boolean; refreshModels?: boolean }): Promise<GatewayAccountState> {
      const expected = accountGeneration;
      if (options?.checkAuthorization) {
        const state = observeState(await client.post<GatewayAccountState>('/gateway/auth/check', {}), expected);
        if (!options.refreshModels) return state;
      }
      return observeState(await client.get<GatewayAccountState>('/gateway/account' + (options?.refreshModels ? '?refreshModels=1' : '')), expected);
    },
    getCachedImageCatalog(): GatewayImageCatalog | undefined { return catalogCache.image?.value; },
    getCachedVideoCatalog(): GatewayVideoCatalog | undefined { return catalogCache.video?.value; },
    getCachedTextCatalog(): GatewayModelCatalog | undefined { return catalogCache.text?.value; },
    getImageCatalog(options?: { refresh?: boolean }): Promise<GatewayImageCatalog> { return readCatalog('image', options?.refresh); },
    getVideoCatalog(options?: { refresh?: boolean }): Promise<GatewayVideoCatalog> { return readCatalog('video', options?.refresh); },
    getTextCatalog(options?: { refresh?: boolean }): Promise<GatewayModelCatalog> { return readCatalog('text', options?.refresh); },
    async start(): Promise<GatewayAuthorization> {
      const grant = await client.post<GatewayAuthorization>('/gateway/auth/start', {});
      if (!options.authorizationReturnUrl) return grant;
      const url = new URL(grant.authorizationUrl);
      url.searchParams.set('returnTo', options.authorizationReturnUrl);
      return { ...grant, authorizationUrl: url.href };
    },
    async cancel(): Promise<GatewayAccountState> { return observeState(await client.post<GatewayAccountState>('/gateway/auth/cancel', {})); },
    async logout(): Promise<GatewayAccountState> {
      clearSummary();
      return observeState(await client.post<GatewayAccountState>('/gateway/auth/logout', {}));
    },
    activate(): Promise<GatewayAccountState> { return client.post('/gateway/auth/activate', {}); },
    setSource(source: ServiceSource): Promise<GatewayAccountState> { return client.patch('/gateway/source', { source }); },
    setRegion(region: 'auto' | 'domestic' | 'overseas'): Promise<GatewayAccountState> { return client.patch('/gateway/supplier-region', { region }); },
    selectModel(modality: import('@opencreator/protocol').GatewayModelPurpose, model: string): Promise<GatewayAccountState> { return client.patch('/gateway/model', { modality, model }); },
    rememberTaskModel(templateId: string, modality: import('@opencreator/protocol').GatewayModelPurpose, model: string): Promise<GatewayAccountState> { return client.patch('/gateway/task-model', { templateId, modality, model }); },
    probeModel(modality: import('@opencreator/protocol').GatewayModel['modality'], model: string, options?: GatewayModelProbeOptions): Promise<{ model: string; modality: import('@opencreator/protocol').GatewayModel['modality']; costBearer: 'customer' }> {
      return client.post('/gateway/model/probe', { modality, model, ...options });
    },
    getBalance(): Promise<GatewayBalanceState> { return client.get('/gateway/billing'); },
    getSummary,
    getCachedSummary(owner: string): GatewayBillingSummary | undefined { return summaryCache?.accountId === owner ? summaryCache.value : undefined; },
    openWebAccount(destination: GatewayWebDestination, locale: 'zh' | 'en'): Promise<{ url: string }> {
      return client.post('/gateway/account/web', { destination, locale, ...(options.billingReturnUrl ? { returnUrl: options.billingReturnUrl } : {}) });
    },
    getPlans(): Promise<GatewayPlans> { return client.get('/gateway/plans'); },
    getOrders(): Promise<{ items: GatewayRechargeOrder[] }> { return client.get('/gateway/billing/orders'); },
    getOrder(id: string): Promise<{ order: GatewayRechargeOrder }> { return client.get('/gateway/billing/orders/' + encodeURIComponent(id)); },
    getCreditGrants(cursor?: string): Promise<{ items: GatewayCreditGrant[]; nextCursor?: string }> { return client.get('/gateway/billing/ledger' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')); },
    checkout(planId: string, operationId: string, options: { locale?: 'zh' | 'en'; currency?: string } = {}): Promise<{ url: string; orderId: string }> { return client.post('/gateway/billing/checkout', { planId, operationId, ...options }); },
    portal(): Promise<{ url: string }> { return client.post('/gateway/billing/portal', {}); }
  };
}
export type GatewayAccountSettingsService = Omit<ReturnType<typeof createGatewayAccountService>, 'openWebAccount' | 'probeModel' | 'setRegion' | 'getCachedSummary' | 'getImageCatalog' | 'getVideoCatalog' | 'getTextCatalog' | 'getCachedImageCatalog' | 'getCachedVideoCatalog' | 'getCachedTextCatalog' | 'rememberTaskModel'> & Partial<Pick<ReturnType<typeof createGatewayAccountService>, 'openWebAccount' | 'probeModel' | 'setRegion' | 'getCachedSummary' | 'getImageCatalog' | 'getVideoCatalog' | 'getTextCatalog' | 'getCachedImageCatalog' | 'getCachedVideoCatalog' | 'getCachedTextCatalog' | 'rememberTaskModel'>>;
