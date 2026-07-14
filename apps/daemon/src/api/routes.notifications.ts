import type { FastifyInstance } from 'fastify';
import type { NotificationService } from '../notifications/service.js';
import { apiError } from './errors.js';

export async function registerNotificationRoutes(
  server: FastifyInstance,
  notifications: NotificationService
): Promise<void> {
  server.get<{
    Querystring: { after?: string; limit?: string };
  }>('/notifications', async (request, reply) => {
    const after = parseNonNegativeInteger(request.query.after, 0);
    const limit = parsePositiveInteger(request.query.limit, 50, 100);
    if (after === undefined || limit === undefined) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_FAILED', 'after and limit must be valid integers'));
    }
    return notifications.listPending({ after, limit });
  });

  server.post<{ Body: unknown }>(
    '/notifications/acknowledge',
    async (request, reply) => {
      const ids = parseIds(request.body);
      if (ids === undefined) {
        return reply
          .code(400)
          .send(apiError('VALIDATION_FAILED', 'ids must contain 1 to 100 notification ids'));
      }
      return notifications.acknowledge(ids);
    }
  );
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number
): number | undefined {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
): number | undefined {
  const parsed = parseNonNegativeInteger(value, fallback);
  if (parsed === undefined || parsed < 1) return undefined;
  return Math.min(parsed, maximum);
}

function parseIds(body: unknown): string[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.ids)) return undefined;
  if (body.ids.length < 1 || body.ids.length > 100) return undefined;
  const ids = body.ids.filter((value): value is string => (
    typeof value === 'string' && value.length > 0
  ));
  if (ids.length !== body.ids.length) return undefined;
  return [...new Set(ids)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
