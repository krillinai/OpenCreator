import type { CreateImageGenerationRequest } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ImageGenerationError,
  type ImageGenerationService
} from '../image-generation/service.js';
import { apiError } from './errors.js';

export async function registerImageGenerationRoutes(
  server: FastifyInstance,
  service: ImageGenerationService
): Promise<void> {
  server.post<{ Body: CreateImageGenerationRequest }>('/image-generation/results', async (request, reply) => {
    try {
      return reply.code(201).send({ result: await service.generate(request.body) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.get<{ Params: { id: string } }>('/image-generation/results/:id', async (request, reply) => {
    try {
      return { result: await service.get(request.params.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  server.get<{ Params: { id: string; index: string } }>('/image-generation/results/:id/content/:index', async (request, reply) => {
    try {
      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 0) {
        throw new ImageGenerationError('VALIDATION_FAILED', 'image index is invalid', 400);
      }
      const { asset, content } = await service.read(request.params.id, index);
      return reply
        .header('Content-Type', asset.mime)
        .header('Content-Disposition', contentDisposition(asset.fileName))
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
  if (error instanceof ImageGenerationError) {
    return reply.code(error.statusCode).send(apiError(error.code, error.message));
  }
  throw error;
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="generated-image"; filename*=UTF-8''${encoded}`;
}
