import type { FastifyInstance, FastifyReply } from 'fastify';
import type { YtDlpUpdateManager } from '../creator/yt-dlp/update-manager.js';
import { YtDlpUpdateError } from '../creator/yt-dlp/update-manager.js';
import { apiError } from './errors.js';

export async function registerCreatorRuntimeRoutes(
  server: FastifyInstance,
  ytDlp: YtDlpUpdateManager | undefined
): Promise<void> {
  server.get('/creator/yt-dlp/status', async (_request, reply) => {
    if (ytDlp === undefined) return unavailable(reply);
    return { ytDlp: ytDlp.status() };
  });

  server.post<{ Body: unknown }>('/creator/yt-dlp/check', async (request, reply) => {
    if (ytDlp === undefined) return unavailable(reply);
    try {
      const force = readForce(request.body);
      return { ytDlp: await ytDlp.check({ force }) };
    } catch (error) {
      return sendUpdateError(reply, error);
    }
  });

  server.post('/creator/yt-dlp/update', async (_request, reply) => {
    if (ytDlp === undefined) return unavailable(reply);
    try {
      return { ytDlp: await ytDlp.update() };
    } catch (error) {
      return sendUpdateError(reply, error);
    }
  });
}

function readForce(value: unknown): boolean {
  if (value === undefined) return true;
  if (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && ('force' in value)
  ) {
    if (typeof value.force === 'boolean') return value.force;
    throw new YtDlpUpdateError(
      'creator_yt_dlp_update_check_failed',
      'force must be a boolean',
      400
    );
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return true;
  }
  throw new YtDlpUpdateError(
    'creator_yt_dlp_update_check_failed',
    'body must be an object',
    400
  );
}

function unavailable(reply: FastifyReply) {
  return reply.code(503).send(apiError(
    'creator_yt_dlp_update_unavailable',
    'yt-dlp updates are unavailable for this Runtime'
  ));
}

function sendUpdateError(reply: FastifyReply, error: unknown) {
  if (error instanceof YtDlpUpdateError) {
    return reply.code(error.statusCode).send(apiError(error.code, error.message));
  }
  throw error;
}
