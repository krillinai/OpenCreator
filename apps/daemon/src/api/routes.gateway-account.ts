import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { apiError } from './errors.js';
import { GatewayError } from '../gateway/client.js';
import type { GatewayAccountService } from '../gateway/account-service.js';

export async function registerGatewayAccountRoutes(server: FastifyInstance, service: GatewayAccountService) {
  async function respond(work: () => Promise<unknown>, reply: import('fastify').FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    try { return await work(); } catch (error) {
      const cloud = error instanceof GatewayError ? error : new GatewayError('gateway_unavailable');
      const code = cloud.status === 401 ? 'GATEWAY_AUTH_REQUIRED' : cloud.code === 'account_disabled' ? 'GATEWAY_ACCOUNT_DISABLED'
        : cloud.status === 402 ? 'GATEWAY_CREDITS_INSUFFICIENT' : cloud.status === 409 ? 'GATEWAY_REQUEST_CONFLICT'
          : cloud.code === 'services_not_ready' ? 'GATEWAY_SERVICES_NOT_READY' : 'GATEWAY_UNAVAILABLE';
      return reply.code(cloud.status).send(apiError(code, code === 'GATEWAY_REQUEST_CONFLICT' ? '请等待当前任务结束后再切换账户或服务来源' : cloud.message, { gatewayCode: cloud.code }));
    }
  }
  server.get('/gateway/account', (_r, reply) => respond(() => service.readState(), reply));
  server.get('/gateway/avatar', (r, reply) => respond(async () => {
    const query = z.object({ accountId: z.string().min(1).max(512) }).strict().safeParse(r.query);
    if (!query.success) throw new GatewayError('invalid_parameters', 400);
    const image = await service.readAvatar(query.data.accountId);
    return reply.header('X-Content-Type-Options', 'nosniff').type(image.contentType).send(Buffer.from(image.data));
  }, reply));
  server.post('/gateway/auth/start', (_r, reply) => respond(() => service.startAuthorization(), reply));
  server.post('/gateway/auth/cancel', (_r, reply) => respond(async () => { await service.cancelAuthorization(); return service.readState(); }, reply));
  server.post('/gateway/auth/logout', (_r, reply) => respond(async () => { await service.logout(); return service.readState(); }, reply));
  server.post('/gateway/auth/activate', (_r, reply) => respond(async () => { await service.activate(); return service.readState(); }, reply));
  server.patch('/gateway/source', (r, reply) => respond(async () => { const value = z.object({ source: z.enum(['manual', 'gateway']) }).strict().safeParse(r.body); if (!value.success) throw new GatewayError('invalid_source', 400); await service.setSource(value.data.source); return service.readState(); }, reply));
  server.get('/gateway/billing', (_r, reply) => respond(() => service.readBalance(), reply));
  server.patch('/gateway/model', (r, reply) => respond(async () => {
    const value = z.object({ modality: z.enum(['text', 'image', 'video', 'speech', 'transcription']), model: z.string().min(1).max(256) }).strict().safeParse(r.body);
    if (!value.success) throw new GatewayError('invalid_model', 400);
    return service.selectModel(value.data.modality, value.data.model);
  }, reply));
  server.get('/gateway/billing/summary', (_r, reply) => respond(() => service.billing('/api/v1/billing/summary'), reply));
  server.get('/gateway/plans', (_r, reply) => respond(() => service.readPlans(), reply));
  for (const resource of ['orders', 'ledger'] as const) server.get(`/gateway/billing/${resource}`, (_r, reply) => respond(() => service.billing(`/api/v1/billing/${resource}`), reply));
  for (const action of ['checkout', 'portal'] as const) server.post(`/gateway/billing/${action}`, (r, reply) => respond(() => service.billing(`/api/v1/billing/${action}`, r.body ?? {}), reply));
}
