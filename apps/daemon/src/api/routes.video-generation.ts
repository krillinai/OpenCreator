import type { CreateVideoGenerationRequest } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  VideoGenerationError,
  type VideoGenerationService
} from '../video-generation/service.js';
import { apiError } from './errors.js';

export async function registerVideoGenerationRoutes(
  server: FastifyInstance,
  service: VideoGenerationService
): Promise<void> {
  server.post<{ Body: CreateVideoGenerationRequest }>(
    '/video-generation/results',
    { config: { bodyLimit: 8 * 1024 * 1024 } },
    async (request, reply) => {
      try {
        return reply.code(202).send({ result: await service.create(request.body) });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  server.get<{ Params: { id: string } }>('/video-generation/results/:id', async (request, reply) => {
    try {
      return { result: await service.refresh(request.params.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.get<{ Params: { id: string } }>('/video-generation/results/:id/content', async (request, reply) => {
    try {
      const { result, content } = await service.read(request.params.id);
      return reply
        .header('Content-Type', result.mime)
        .header('Content-Disposition', contentDisposition(result.fileName ?? 'OpenCreator-video.mp4'))
        .header('Content-Length', String(content.length))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(content);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof VideoGenerationError) {
    return reply.code(error.statusCode).send(apiError(error.code, error.message));
  }
  throw error;
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="generated-video"; filename*=UTF-8''${encoded}`;
}
