import type { FastifyInstance } from 'fastify';
import { z } from 'zod/v3';
import type { CreatorTelemetryOutbox } from './outbox.js';
import { CREATOR_TELEMETRY_BATCH_SIZE } from './outbox.js';
import { apiError } from '../api/errors.js';

export async function registerTelemetryRoutes(
  server: FastifyInstance,
  outbox: CreatorTelemetryOutbox
): Promise<void> {
  server.get('/telemetry/events', (request, reply) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(CREATOR_TELEMETRY_BATCH_SIZE).optional()
    }).strict().safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'Invalid telemetry event query'));
    }
    reply.header('Cache-Control', 'no-store');
    return { events: outbox.list(query.data.limit) };
  });

  server.post('/telemetry/events/ack', (request, reply) => {
    const body = z.object({
      event_ids: z.array(z.string().uuid()).min(1).max(CREATOR_TELEMETRY_BATCH_SIZE)
    }).strict().safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'Invalid telemetry event acknowledgment'));
    }
    return { acknowledged: outbox.ack(body.data.event_ids) };
  });
}
