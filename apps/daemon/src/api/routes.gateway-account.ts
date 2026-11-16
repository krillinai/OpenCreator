import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import { apiError } from './errors.js';
import { GatewayError } from '../gateway/client.js';
import type { GatewayAccountService } from '../gateway/account-service.js';
import { ModelProbeError } from '../gateway/model-selection-probe.js';

export async function registerGatewayAccountRoutes(server: FastifyInstance, service: GatewayAccountService) {
  async function respond(work: () => Promise<unknown>, reply: import('fastify').FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    try { return await work(); } catch (error) {
      const cloud = error instanceof GatewayError ? error : new GatewayError('gateway_unavailable');
      const code = cloud.status === 401 ? 'GATEWAY_AUTH_REQUIRED' : cloud.code === 'account_disabled' ? 'GATEWAY_ACCOUNT_DISABLED'
        : cloud.status === 402 ? 'GATEWAY_CREDITS_INSUFFICIENT' : cloud.status === 409 ? 'GATEWAY_REQUEST_CONFLICT'
          : cloud.code === 'services_not_ready' ? 'GATEWAY_SERVICES_NOT_READY' : 'GATEWAY_UNAVAILABLE';
      return reply.code(cloud.status).send(apiError(code, code === 'GATEWAY_REQUEST_CONFLICT' ? 'Wait for the active task to finish before switching accounts or service sources.' : cloud.message, { gatewayCode: cloud.code,
        ...(cloud instanceof ModelProbeError && cloud.publicFacts ? { publicFacts: cloud.publicFacts } : {}),
        ...(cloud instanceof ModelProbeError && cloud.diagnostics ? { probeRequest: cloud.diagnostics } : {}) }));
    }
  }
  server.get('/gateway/account', (r, reply) => respond(() => {
    const query = z.object({ refreshModels: z.literal('1').optional() }).safeParse(r.query);
    if (!query.success) throw new GatewayError('invalid_parameters', 400);
    return service.readState({ refreshModels: query.data.refreshModels === '1' });
  }, reply));
  server.get('/gateway/models/catalog', (r, reply) => respond(() => {
    const query = z.object({ modality: z.enum(['image', 'video', 'text']).optional() }).strict().safeParse(r.query);
    if (!query.success) throw new GatewayError('invalid_parameters', 400);
    return query.data.modality === 'text' ? service.readPublicTextCatalog()
      : query.data.modality === 'video' ? service.readPublicVideoCatalog() : service.readPublicImageCatalog();
  }, reply));
  server.post('/gateway/account/web', (r, reply) => respond(async () => {
    const value = z.object({ destination: z.enum(['recharge', 'account', 'usage', 'faq']), locale: z.enum(['zh', 'en']), returnUrl: z.string().max(2048).optional() }).strict().safeParse(r.body);
    if (!value.success) throw new GatewayError('invalid_parameters', 400);
    try { return await service.billing('/api/v1/auth/browser/start', value.data); }
    catch (error) {
      // Older gateways apply browser CSRF checks before recognizing the new device endpoint.
      if (error instanceof GatewayError && error.status === 403 && error.code === 'invalid_origin') throw new GatewayError('browser_handoff_unavailable', 404);
      throw error;
    }
  }, reply));
  server.get('/gateway/avatar', (r, reply) => respond(async () => {
    const query = z.object({ accountId: z.string().min(1).max(512) }).strict().safeParse(r.query);
    if (!query.success) throw new GatewayError('invalid_parameters', 400);
    const image = await service.readAvatar(query.data.accountId);
    return reply.header('X-Content-Type-Options', 'nosniff').type(image.contentType).send(Buffer.from(image.data));
  }, reply));
  server.post('/gateway/auth/start', (_r, reply) => respond(() => service.startAuthorization(), reply));
  server.post('/gateway/auth/check', (_r, reply) => respond(async () => { service.checkAuthorization(); return service.readState(); }, reply));
  server.post('/gateway/auth/cancel', (_r, reply) => respond(async () => { await service.cancelAuthorization(); return service.readState(); }, reply));
  server.post('/gateway/auth/logout', (_r, reply) => respond(async () => { await service.logout(); return service.readState(); }, reply));
  server.post('/gateway/auth/activate', (_r, reply) => respond(async () => { await service.activate(); return service.readState(); }, reply));
  server.patch('/gateway/source', (r, reply) => respond(async () => { const value = z.object({ source: z.enum(['manual', 'gateway']) }).strict().safeParse(r.body); if (!value.success) throw new GatewayError('invalid_source', 400); await service.setSource(value.data.source); return service.readState(); }, reply));
  server.get('/gateway/billing', (_r, reply) => respond(() => service.readBalance(), reply));
  server.patch('/gateway/supplier-region', (r, reply) => respond(async () => {
    const value = z.object({ region: z.enum(['auto', 'domestic', 'overseas']) }).strict().safeParse(r.body);
    if (!value.success) throw new GatewayError('invalid_parameters', 400);
    return service.setRegion(value.data.region);
  }, reply));
  server.post('/gateway/model/probe', (r, reply) => respond(async () => {
    const value = z.object({ modality: z.enum(['text', 'image', 'video', 'speech', 'transcription']), model: z.string().min(1).max(256),
      textApi: z.enum(['responses', 'chat/completions']).optional() }).strict().safeParse(r.body);
    if (!value.success) throw new GatewayError('invalid_model', 400);
    if (value.data.textApi && value.data.modality !== 'text') throw new GatewayError('invalid_parameters', 400);
    return service.probeModel(value.data.modality, value.data.model, value.data.textApi ? { textApi: value.data.textApi } : undefined);
  }, reply));
  server.patch('/gateway/model', (r, reply) => respond(async () => {
    const value = z.object({ modality: z.enum(['text', 'image', 'video', 'speech', 'transcription']), model: z.string().min(1).max(256) }).strict().safeParse(r.body);
    if (!value.success) throw new GatewayError('invalid_model', 400);
    return service.selectModel(value.data.modality, value.data.model);
  }, reply));
  server.patch('/gateway/task-model', (r, reply) => respond(async () => {
    const value = z.object({ templateId: z.string().min(1).max(128), modality: z.enum(['text', 'image', 'video', 'speech', 'transcription']), model: z.string().min(1).max(256) }).strict().safeParse(r.body);
    if (!value.success) throw new GatewayError('invalid_model', 400);
    return service.rememberTaskModel(value.data.templateId, value.data.modality, value.data.model);
  }, reply));
  server.get('/gateway/billing/summary', (_r, reply) => respond(() => service.billing('/api/v1/billing/summary'), reply));
  server.get('/gateway/plans', (_r, reply) => respond(() => service.readPlans(), reply));
  server.get('/gateway/billing/orders', (_r, reply) => respond(() => service.billing('/api/v1/billing/orders'), reply));
  server.get('/gateway/billing/orders/:id', (r, reply) => respond(() => {
    const params = z.object({ id: z.string().min(1).max(128) }).safeParse(r.params);
    if (!params.success) throw new GatewayError('invalid_parameters', 400);
    return service.billing('/api/v1/billing/orders/' + encodeURIComponent(params.data.id));
  }, reply));
  server.get('/gateway/billing/ledger', (r, reply) => respond(() => {
    const query = z.object({ cursor: z.string().max(256).optional() }).strict().safeParse(r.query);
    if (!query.success) throw new GatewayError('invalid_parameters', 400);
    const suffix = query.data.cursor ? '?cursor=' + encodeURIComponent(query.data.cursor) : '';
    return service.billing('/api/v1/billing/ledger' + suffix);
  }, reply));
  for (const action of ['checkout', 'portal'] as const) server.post(`/gateway/billing/${action}`, (r, reply) => respond(() => service.billing(`/api/v1/billing/${action}`, r.body ?? {}), reply));
}
