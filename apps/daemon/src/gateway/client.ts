import { z } from 'zod';
import type { GatewayModel } from '@opencreator/protocol';

const tokenSchema = z.object({ accessToken: z.string().min(12), refreshToken: z.string().min(12), expiresIn: z.number().int().positive() });
const modelSchema = z.object({
  id: z.string().min(1), name: z.string().optional(),
  modality: z.enum(['text', 'image', 'video', 'speech', 'transcription']),
  capabilities: z.array(z.string()), voices: z.array(z.string().min(1)).optional(),
  sizes: z.array(z.string().regex(/^\d+x\d+$/)).optional(),
  durations: z.array(z.number().int().positive()).optional(),
  resolutions: z.array(z.string().min(1)).optional(),
  aspectRatios: z.array(z.string().min(1)).optional(),
  imageOptions: z.object({
    aspectRatios: z.array(z.string()).optional(), resolutions: z.array(z.string()).optional(),
    qualities: z.array(z.string()).optional(), outputFormats: z.array(z.string()).optional(),
    maxImages: z.number().int().min(1).max(10), maxReferences: z.number().int().nonnegative()
  }).optional()
});
export const catalogSchema = z.object({ models: z.array(modelSchema).min(1) });
export const accountSchema = z.object({ id: z.string().min(1), email: z.string(), verified: z.boolean(), avatarUrl: z.string().url().max(2048).optional() });
export const bootstrapSchema = z.object({
  schemaVersion: z.literal(1), account: accountSchema,
  transport: z.enum(['gateway', 'openrouter-direct']).optional(),
  keyRotation: z.boolean().optional(), rotationPending: z.boolean().optional(),
  modelKey: z.string().min(1), keyVersion: z.string().min(1), bindingVersion: z.string().min(1), baseUrl: z.string().url(),
  models: z.array(modelSchema), defaults: z.record(z.string())
});
export type GatewayBootstrap = z.infer<typeof bootstrapSchema>;
export type GatewayTokens = z.infer<typeof tokenSchema>;
export type GatewayDeviceGrant = { attemptId: string; deviceSecret: string; authorizationUrl: string; interval: number; expiresIn: number };
export type GatewayClient = {
  origin: string;
  startDevice(): Promise<GatewayDeviceGrant>;
  pollDevice(id: string, secret: string): Promise<GatewayTokens>;
  cancelDevice(id: string, secret: string): Promise<void>;
  refresh(refresh: string): Promise<GatewayTokens>;
  bootstrap(access: string, options?: { rotate: boolean }): Promise<GatewayBootstrap>;
  avatar(access: string, accountId: string): Promise<{ data: Uint8Array; contentType: string }>;
  logout(access: string): Promise<void>;
  request(path: string, access: string, body?: unknown): Promise<unknown>;
};
export class GatewayError extends Error {
  constructor(readonly code: string, readonly status = 503) { super('OpenCreator 网关请求未完成'); }
}
export function validateGatewayOrigin(origin: string) {
  const u = new URL(origin);
  const local = u.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
  if ((!local && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new GatewayError('invalid_gateway_origin');
  return u.origin;
}
export function createGatewayClient(origin: string, fetcher: typeof fetch = fetch): GatewayClient {
  origin = validateGatewayOrigin(origin);
  async function readResponse(path: string, access: string, body?: unknown) {
    if (!path.startsWith('/api/v1/') || path.includes('..')) throw new GatewayError('invalid_gateway_path');
    let res: Response;
    try {
      res = await fetcher(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new GatewayError('gateway_unavailable'); }
    const reader = res.body?.getReader();
    if (!reader) throw new GatewayError('invalid_gateway_response');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); throw new GatewayError('invalid_gateway_response'); }
        chunks.push(item.value);
      }
    } catch (error) { if (error instanceof GatewayError) throw error; throw new GatewayError('gateway_unavailable'); }
    return { res, data: Buffer.concat(chunks) };
  }
  function responseError(data: Uint8Array, status: number): never {
    let value: unknown;
    try { value = JSON.parse(Buffer.from(data).toString('utf8')); } catch { throw new GatewayError('invalid_gateway_response'); }
    const parsed = z.object({ error: z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }) }).safeParse(value);
    throw new GatewayError(parsed.success ? parsed.data.error.code : 'gateway_unavailable', status);
  }
  async function request(path: string, access: string, body?: unknown): Promise<unknown> {
    const { res, data } = await readResponse(path, access, body);
    if (!res.ok) responseError(data, res.status);
    const text = data.toString('utf8');
    let value: unknown; try { value = JSON.parse(text); } catch { throw new GatewayError('invalid_gateway_response'); }
    return value;
  }
  return {
    origin, request,
    async startDevice() { return z.object({ attemptId: z.string().min(1), deviceSecret: z.string().min(12), authorizationUrl: z.string().url(), interval: z.number().positive(), expiresIn: z.number().positive() }).parse(await request('/api/v1/auth/device/start', '', { label: 'OpenCreator' })); },
    async pollDevice(attemptId, deviceSecret) { return tokenSchema.parse(await request('/api/v1/auth/device/token', '', { attemptId, deviceSecret })); },
    async cancelDevice(attemptId, deviceSecret) { await request('/api/v1/auth/device/cancel', '', { attemptId, deviceSecret }); },
    async refresh(refreshToken) { return tokenSchema.parse(await request('/api/v1/auth/refresh', '', { refreshToken })); },
    async bootstrap(access, options) {
      const value = bootstrapSchema.parse(await request('/api/v1/client/bootstrap' + (options ? `?rotate=${options.rotate ? '1' : '0'}` : ''), access));
      const expected = value.transport === 'openrouter-direct' ? 'https://openrouter.ai/api/v1' : `${origin}/v1`;
      if (value.baseUrl !== expected) throw new GatewayError('invalid_gateway_response');
      return value;
    },
    async avatar(access, accountId) {
      const { res, data } = await readResponse('/api/v1/me/avatar?accountId=' + encodeURIComponent(accountId), access);
      if (!res.ok) responseError(data, res.status);
      const contentType = res.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(contentType)) throw new GatewayError('invalid_gateway_response');
      return { data, contentType };
    },
    async logout(access) { await request('/api/v1/auth/logout', access, {}); }
  };
}

export function gatewayModel(models: GatewayModel[], modality: GatewayModel['modality']) { return models.find(model => model.modality === modality); }
