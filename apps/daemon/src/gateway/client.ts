import { z } from 'zod/v3';
import type { GatewayModel, GatewayConnectionDiagnostics } from '@opencreator/protocol';
import { isDirectTransport, isSupplierBase, supplierBases, type SupplierRegion } from './supplier.js';

const tokenSchema = z.object({ accessToken: z.string().min(12), refreshToken: z.string().min(12), expiresIn: z.number().int().positive() });
const modelSchema = z.object({
  catalogSchema: z.number().int().optional(),
  id: z.string().min(1), name: z.string().optional(),
  modality: z.enum(['text', 'image', 'video', 'speech', 'transcription']),
  capabilities: z.array(z.string()), voices: z.array(z.string().min(1)).optional(),
  textOptions: z.object({ maxOutputTokens: z.number().int().positive() }).optional(),
  voiceProfiles: z.record(z.object({
    gender: z.enum(['female', 'male', 'neutral']).optional(),
    traits: z.record(z.array(z.string())).optional(),
    useCases: z.record(z.array(z.string())).optional(),
    description: z.record(z.string()).optional(),
    sourceUrls: z.array(z.string().url()).optional()
  })).optional(),
  vendor: z.string().optional(), status: z.enum(['ready','temporarily_unavailable','retired']).optional(), statusReason: z.string().optional(), recommended: z.boolean().optional(),
  price: z.object({estimates:z.record(z.object({creditUnits:z.string().regex(/^\d+$/),usage:z.record(z.number().int().nonnegative()).optional(),resolution:z.string().optional(),quality:z.string().optional(),seconds:z.number().int().positive().optional(),images:z.number().int().positive().optional()})).optional(),version:z.string(),billing:z.literal('usage').optional(),inputPerMillion:z.number().optional(),cachedInputPerMillion:z.number().optional(),cacheWritePerMillion:z.number().optional(),imageInputPerMillion:z.number().optional(),outputPerMillion:z.number().optional(),perMinute:z.number().optional(),perMillionCharacters:z.number().optional(),perRequest:z.number().optional(),videoUnitsPerSecond:z.record(z.number().int().positive().max(1_000_000_000_000)).optional()}).optional(),
  videoOptions: z.object({ profile:z.string(), maxImages:z.number().int().min(0).max(30), maxVideos:z.number().int().min(0).max(10), maxAudios:z.number().int().min(0).max(10), firstLastFrames:z.boolean(), framesExclusive:z.boolean(), generateAudio:z.boolean(), referenceDuration:z.number().int().positive().optional() }).optional(),
  sizes: z.array(z.string().regex(/^(?:\d+x\d+|[1-9]\d?K)$/)).optional(),
  durations: z.array(z.number().int().positive()).optional(),
  resolutions: z.array(z.string().min(1)).optional(),
  aspectRatios: z.array(z.string().min(1)).optional(),
  verification: z.object({
    adapterVersion: z.number().int().positive(), verifiedAt: z.string().datetime(),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/))
  }).optional(),
  imageOptions: z.object({
    aspectRatios: z.array(z.string()).optional(), resolutions: z.array(z.string()).optional(),
    qualities: z.array(z.string()).optional(), outputFormats: z.array(z.string()).optional(),
    imagesPerRequest: z.number().int().min(1).max(4).optional(),
    maxImages: z.number().int().min(1).max(10), maxReferences: z.number().int().nonnegative()
  }).optional()
});
const catalogMetadata = {
  catalogVersion:z.string().optional(),catalogUpdatedAt:z.string().optional(),catalogRefreshState:z.enum(['ready','stale','unavailable']).optional(),
};
export const catalogSchema = z.object({ models: z.array(modelSchema), defaults:z.record(z.string()).optional(), ...catalogMetadata,
  modelAvailability:z.array(z.object({model:z.string(),operation:z.enum(['responses','chat/completions','images/generations','images/edits','audio/speech','audio/transcriptions','video/jobs']),status:z.literal('recent_success'),checkedAt:z.string()})).optional(),
});
export const accountSchema = z.object({ id: z.string().min(1), email: z.string(), verified: z.boolean(), avatarUrl: z.string().url().max(2048).optional() });
export const cachedModelUsePolicy = 'cached-key-v1';
export const bootstrapCredentialsSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]), account: accountSchema,
  transport: z.enum(['gateway', 'openrouter-direct', 'supplier-direct']).optional(),
  supplier: z.enum(['openrouter', '88api', 'chatanywhere']).optional(),
  keyRotation: z.boolean().optional(), rotationPending: z.boolean().optional(),
  modelUsePolicy: z.literal(cachedModelUsePolicy).optional(),
  modelKey: z.string().min(1).optional(), keyVersion: z.string().min(1), bindingVersion: z.string().min(1), baseUrl: z.string().url(),
  models: z.array(modelSchema), defaults: z.record(z.string()), ...catalogMetadata
});
export const bootstrapSchema = bootstrapCredentialsSchema
  .refine(value => value.transport === 'gateway' && value.schemaVersion === 3 ? !value.modelKey && (!value.supplier || value.supplier === 'chatanywhere') && value.keyRotation === false : !!value.modelKey && value.schemaVersion !== 3, 'Invalid gateway credentials')
  .refine(value => value.modelUsePolicy !== cachedModelUsePolicy || (isDirectTransport(value.transport) && value.keyRotation === false), 'Cached model credentials require a stable direct binding')
  .refine(value => value.transport !== 'supplier-direct' || (value.schemaVersion === 2 && value.supplier !== 'openrouter' && isSupplierBase(value.supplier, value.baseUrl)), 'Invalid supplier binding')
  .refine(value => value.transport !== 'openrouter-direct' || ((!value.supplier || value.supplier === 'openrouter') && value.baseUrl === supplierBases.openrouter), 'Invalid OpenRouter binding')
  .transform(value => value.transport === 'gateway' ? { ...value, supplier: 'chatanywhere' as const } : value);
export type GatewayBootstrap = z.infer<typeof bootstrapSchema>;
export type GatewayTokens = z.infer<typeof tokenSchema>;
export type GatewayDeviceGrant = { attemptId: string; deviceSecret: string; authorizationUrl: string; interval: number; expiresIn: number };
export type GatewayClient = {
  origin: string;
  startDevice(): Promise<GatewayDeviceGrant>;
  pollDevice(id: string, secret: string): Promise<GatewayTokens>;
  cancelDevice(id: string, secret: string): Promise<void>;
  refresh(refresh: string): Promise<GatewayTokens>;
  bootstrap(access: string, options?: { rotate: boolean; modelUsePolicy?: typeof cachedModelUsePolicy; region?: SupplierRegion }): Promise<GatewayBootstrap>;
  avatar(access: string, accountId: string): Promise<{ data: Uint8Array; contentType: string }>;
  logout(access: string): Promise<void>;
  request(path: string, access: string, body?: unknown): Promise<unknown>;
  cancelPendingRequests?(): void;
};
export class GatewayError extends Error {
  constructor(readonly code: string, readonly status = 503, readonly diagnostics?: GatewayConnectionDiagnostics) { super('The OpenCreator gateway request did not complete'); }
}
export function validateGatewayOrigin(origin: string) {
  const u = new URL(origin);
  const local = u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
  if ((!local && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new GatewayError('invalid_gateway_origin');
  return u.origin;
}
export function createGatewayClient(origin: string, fetcher: typeof fetch = fetch): GatewayClient {
  origin = validateGatewayOrigin(origin);
  const pendingRequests = new Set<AbortController>();
  async function readResponse(path: string, access: string, body?: unknown, cancellation?: AbortSignal) {
    if (!path.startsWith('/api/v1/') || path.includes('..')) throw new GatewayError('invalid_gateway_path');
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000), ...(cancellation ? [cancellation] : [])]);
    pendingRequests.add(controller);
    try {
      let res: Response;
      try {
        res = await fetcher(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
          headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      } catch (error) { throw new GatewayError('gateway_unavailable', 503, connectionDiagnostics(path, error, signal)); }
      const reader = res.body?.getReader();
      if (!reader) throw new GatewayError('invalid_gateway_response', 503, { path: path.split('?')[0]!, reason: 'invalid_response', httpStatus: res.status });
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > 1024 * 1024) { await reader.cancel(); throw new GatewayError('invalid_gateway_response', 503, { path: path.split('?')[0]!, reason: 'invalid_response', httpStatus: res.status }); }
          chunks.push(item.value);
        }
      } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('gateway_unavailable', 503, connectionDiagnostics(path, error, signal)); }
      return { res, data: Buffer.concat(chunks) };
    } finally { pendingRequests.delete(controller); }
  }
  async function readBillingSummary(access: string) {
    const primary = new AbortController(); const backup = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const first = readResponse('/api/v1/billing/summary', access, undefined, primary.signal);
      // This read is free and idempotent; a stalled CDN connection need not block it.
      const second = new Promise<Awaited<ReturnType<typeof readResponse>>>(resolve => {
        timer = setTimeout(() => {
          void readResponse('/api/v1/billing/summary', access, undefined, backup.signal)
            .then(result => { if (result.res.ok) resolve(result); }).catch(() => undefined);
        }, 800);
      });
      return await Promise.race([first, second]);
    } finally {
      clearTimeout(timer); primary.abort(); backup.abort();
    }
  }
  function responseError(data: Uint8Array, status: number, path: string): never {
    const diagnostics: GatewayConnectionDiagnostics = { path: path.split('?')[0]!, reason: 'http', httpStatus: status };
    let value: unknown;
    try { value = JSON.parse(Buffer.from(data).toString('utf8')); } catch { throw new GatewayError('invalid_gateway_response', status, diagnostics); }
    const parsed = z.object({ error: z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }) }).safeParse(value);
    throw new GatewayError(parsed.success ? parsed.data.error.code : 'gateway_unavailable', status, diagnostics);
  }
  async function request(path: string, access: string, body?: unknown): Promise<unknown> {
    const { res, data } = await (path === '/api/v1/billing/summary' && body === undefined
      ? readBillingSummary(access) : readResponse(path, access, body));
    if (!res.ok) responseError(data, res.status, path);
    const text = data.toString('utf8');
    let value: unknown; try { value = JSON.parse(text); } catch { throw new GatewayError('invalid_gateway_response', 503, { path: path.split('?')[0]!, reason: 'invalid_response', httpStatus: res.status }); }
    return value;
  }
  return {
    origin, request,
    cancelPendingRequests() { for (const controller of pendingRequests) controller.abort(); },
    async startDevice() { return z.object({ attemptId: z.string().min(1), deviceSecret: z.string().min(12), authorizationUrl: z.string().url(), interval: z.number().positive(), expiresIn: z.number().positive() }).parse(await request('/api/v1/auth/device/start', '', { label: 'OpenCreator' })); },
    async pollDevice(attemptId, deviceSecret) { return tokenSchema.parse(await request('/api/v1/auth/device/token', '', { attemptId, deviceSecret })); },
    async cancelDevice(attemptId, deviceSecret) { await request('/api/v1/auth/device/cancel', '', { attemptId, deviceSecret }); },
    async refresh(refreshToken) { return tokenSchema.parse(await request('/api/v1/auth/refresh', '', { refreshToken })); },
    async bootstrap(access, options) {
      const query = new URLSearchParams();
      query.set('protocolVersion', '3');
      query.set('catalogSchema', '2');
      query.set('publicMetadata', '1');
      query.set('sizeLabels', '1');
      if (options) query.set('rotate', options.rotate ? '1' : '0');
      if (options?.modelUsePolicy) query.set('modelUsePolicy', options.modelUsePolicy);
      if (options?.region) query.set('region', options.region);
      const parsed = bootstrapSchema.safeParse(await request('/api/v1/client/bootstrap' + (query.size ? `?${query}` : ''), access));
      if (!parsed.success) throw new GatewayError('invalid_gateway_response');
      const value = parsed.data;
      const expected = value.transport === 'supplier-direct' && isSupplierBase(value.supplier, value.baseUrl) ? value.baseUrl : value.transport === 'openrouter-direct' ? supplierBases.openrouter : `${origin}/v1`;
      if (value.baseUrl !== expected) throw new GatewayError('invalid_gateway_response');
      return value;
    },
    async avatar(access, accountId) {
      const { res, data } = await readResponse('/api/v1/me/avatar?accountId=' + encodeURIComponent(accountId), access);
      if (!res.ok) responseError(data, res.status, '/api/v1/me/avatar');
      const contentType = res.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(contentType)) throw new GatewayError('invalid_gateway_response');
      return { data, contentType };
    },
    async logout(access) { await request('/api/v1/auth/logout', access, {}); }
  };
}

function connectionDiagnostics(path: string, error: unknown, signal: AbortSignal): GatewayConnectionDiagnostics {
  const value = error as { name?: string; code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = value?.cause?.code ?? value?.code;
  const networkCode = typeof code === 'string' && /^[A-Z_]{2,64}$/.test(code) ? code : undefined;
  return { path: path.split('?')[0]!, reason: signal.reason?.name === 'TimeoutError' || value?.name === 'TimeoutError' || networkCode?.includes('TIMEOUT') || networkCode === 'ETIMEDOUT' ? 'timeout' : 'network',
    ...(networkCode ? { networkCode } : {}) };
}

export function gatewayModel(models: GatewayModel[], modality: GatewayModel['modality']) { return models.find(model => model.modality === modality); }
