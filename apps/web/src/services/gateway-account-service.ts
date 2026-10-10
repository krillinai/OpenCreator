import type { GatewayAccountState, GatewayAuthorization, GatewayBalanceSnapshot, GatewayBalanceState, ServiceSource } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';
export type GatewayPlan = { id: string; name: string; currency: string; amountUnits: string; creditUnits: string };
export type GatewayBillingSummary = {
  balance: GatewayBalanceSnapshot;
  subscription: { id: string; status: string; periodStart: string; periodEnd: string; cancelAtPeriodEnd: boolean; nextPlanId: string | null; plan?: GatewayPlan } | null;
  billingAvailable: boolean;
  purchaseMode?: 'credits';
  plansUrl?: string;
  paymentReview?: boolean;
};
export function createGatewayAccountService(client: Pick<RuntimeClient, 'get' | 'post' | 'patch'> & Partial<Pick<RuntimeClient, 'rawGet'>>) {
  const rawGet = client.rawGet?.bind(client);
  let avatarCache: { key: string; work: Promise<Blob> } | undefined;
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
    getState(): Promise<GatewayAccountState> { return client.get('/gateway/account'); },
    start(): Promise<GatewayAuthorization> { return client.post('/gateway/auth/start', {}); },
    cancel(): Promise<GatewayAccountState> { return client.post('/gateway/auth/cancel', {}); },
    logout(): Promise<GatewayAccountState> { return client.post('/gateway/auth/logout', {}); },
    activate(): Promise<GatewayAccountState> { return client.post('/gateway/auth/activate', {}); },
    setSource(source: ServiceSource): Promise<GatewayAccountState> { return client.patch('/gateway/source', { source }); },
    selectModel(modality: import('@opencreator/protocol').GatewayModel['modality'], model: string): Promise<GatewayAccountState> { return client.patch('/gateway/model', { modality, model }); },
    getBalance(): Promise<GatewayBalanceState> { return client.get('/gateway/billing'); },
    getSummary(): Promise<GatewayBillingSummary> { return client.get('/gateway/billing/summary'); },
    getPlans(): Promise<{ plans: GatewayPlan[]; billingAvailable: boolean; plansUrl?: string; purchaseMode?: 'credits'; paymentMode?: 'test' | 'live' }> { return client.get('/gateway/plans'); },
    checkout(planId: string, operationId: string): Promise<{ url: string }> { return client.post('/gateway/billing/checkout', { planId, operationId }); },
    portal(): Promise<{ url: string }> { return client.post('/gateway/billing/portal', {}); }
  };
}
export type GatewayAccountSettingsService = ReturnType<typeof createGatewayAccountService>;
