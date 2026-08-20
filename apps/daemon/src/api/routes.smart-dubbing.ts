import type { CreateSmartDubbingRequest } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  SmartDubbingError,
  type SmartDubbingService
} from '../smart-dubbing/service.js';
import { apiError } from './errors.js';

export async function registerSmartDubbingRoutes(
  server: FastifyInstance,
  service: SmartDubbingService
): Promise<void> {
  server.post<{ Body: CreateSmartDubbingRequest }>('/smart-dubbing/preview', async (request, reply) => {
    try {
      const { mime, content } = await service.preview(request.body);
      return reply
        .header('Content-Type', mime)
        .header('Content-Length', String(content.length))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(content);
    } catch (error) {
      return sendSmartDubbingError(reply, error);
    }
  });

  server.post<{ Body: CreateSmartDubbingRequest }>('/smart-dubbing/results', async (request, reply) => {
    try {
      const result = await service.generate(request.body);
      return reply.code(201).send({ result });
    } catch (error) {
      return sendSmartDubbingError(reply, error);
    }
  });

  server.get<{ Params: { id: string } }>('/smart-dubbing/results/:id', async (request, reply) => {
    try {
      return { result: await service.get(request.params.id) };
    } catch (error) {
      return sendSmartDubbingError(reply, error);
    }
  });

  server.get<{ Params: { id: string } }>('/smart-dubbing/results/:id/content', async (request, reply) => {
    try {
      const { result, content } = await service.read(request.params.id);
      return reply
        .header('Content-Type', result.mime)
        .header('Content-Disposition', contentDisposition(result.fileName))
        .header('Content-Length', String(content.length))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(content);
    } catch (error) {
      return sendSmartDubbingError(reply, error);
    }
  });
}

function sendSmartDubbingError(reply: FastifyReply, error: unknown) {
  if (error instanceof SmartDubbingError) {
    return reply.code(error.statusCode).send(apiError(error.code, error.message));
  }
  throw error;
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="dubbing"; filename*=UTF-8''${encoded}`;
}
