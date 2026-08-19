import type { CleanupDeleteResponse, CleanupPreviewResponse } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CleanupError } from '../cleanup/service.js';
import { apiError } from './errors.js';

export type RuntimeCleanupService = {
  preview(request: { olderThanDays: number }): CleanupPreviewResponse;
  delete(request: { olderThanDays: number }): CleanupDeleteResponse;
};

export async function registerCleanupRoutes(
  server: FastifyInstance,
  cleanup: RuntimeCleanupService
): Promise<void> {
  server.get('/runtime/cleanup/preview', async (request, reply) => {
    try {
      const { olderThanDays } = request.query as { olderThanDays?: string };
      return cleanup.preview({ olderThanDays: parsePositiveInteger(olderThanDays) });
    } catch (error) {
      return sendCleanupError(reply, error);
    }
  });

  server.post('/runtime/cleanup', async (request, reply) => {
    try {
      const body = parseCleanupBody(request.body);
      return cleanup.delete({ olderThanDays: body.olderThanDays });
    } catch (error) {
      return sendCleanupError(reply, error);
    }
  });
}

function parseCleanupBody(body: unknown): { olderThanDays: number } {
  if (!isPlainObject(body)) {
    throw new CleanupError('VALIDATION_FAILED', 'body must be an object');
  }
  if (body.confirm !== true) {
    throw new CleanupError('VALIDATION_FAILED', 'confirm must be true');
  }
  return { olderThanDays: parsePositiveInteger(body.olderThanDays) };
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return Number(value);
  throw new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sendCleanupError(reply: FastifyReply, error: unknown) {
  if (error instanceof CleanupError && error.code === 'VALIDATION_FAILED') {
    return reply.code(400).send(apiError('VALIDATION_FAILED', error.message));
  }
  return reply.code(500).send(apiError('CLEANUP_FAILED', 'Runtime cleanup failed'));
}
