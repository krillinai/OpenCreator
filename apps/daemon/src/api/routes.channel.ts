import type { FastifyInstance, FastifyReply } from 'fastify';
import { apiError } from './errors.js';
import {
  ChannelPipelineError,
  type ChannelPipelineService
} from '../channel/service.js';

export async function registerChannelRoutes(
  server: FastifyInstance,
  service: ChannelPipelineService
): Promise<void> {
  server.get('/channel/health', async () => service.health());

  server.get('/channel/status', async (_request, reply) => {
    try {
      return await service.status();
    } catch (error) {
      return sendChannelError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/channel/ingest', async (request, reply) => {
    try {
      const body = isRecord(request.body) ? request.body : {};
      return await service.ingest({
        ...(typeof body.url === 'string' ? { url: body.url } : {}),
        ...(body.inbox === true ? { inbox: true } : {}),
        ...(isChannelSource(body.source) ? { source: body.source } : {})
      });
    } catch (error) {
      return sendChannelError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/channel/process', async (request, reply) => {
    try {
      const body = isRecord(request.body) ? request.body : {};
      return await service.process({
        ...(typeof body.jobId === 'string' ? { jobId: body.jobId } : {})
      });
    } catch (error) {
      return sendChannelError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/channel/publish', async (request, reply) => {
    try {
      const body = isRecord(request.body) ? request.body : {};
      return await service.publish({
        jobId: typeof body.jobId === 'string' ? body.jobId : '',
        targets: Array.isArray(body.targets)
          ? body.targets.filter(isChannelTarget)
          : [],
        ...(body.force === true ? { force: true } : {})
      });
    } catch (error) {
      return sendChannelError(reply, error);
    }
  });
}

function sendChannelError(reply: FastifyReply, error: unknown) {
  if (error instanceof ChannelPipelineError) {
    return reply.code(error.statusCode).send(apiError(
      error.code,
      error.message,
      error.details
    ));
  }
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChannelSource(value: unknown): value is 'self' | 'licensed' | 'cc' | 'rework' | 'unknown' {
  return value === 'self'
    || value === 'licensed'
    || value === 'cc'
    || value === 'rework'
    || value === 'unknown';
}

function isChannelTarget(value: unknown): value is 'manual' | 'bilibili' | 'youtube' | 'tiktok' {
  return value === 'manual'
    || value === 'bilibili'
    || value === 'youtube'
    || value === 'tiktok';
}
