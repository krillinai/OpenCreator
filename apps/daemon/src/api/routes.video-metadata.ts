import type { FastifyInstance } from 'fastify';
import {
  VideoMetadataError,
  type VideoMetadataService
} from '../video-metadata/service.js';
import { apiError } from './errors.js';

export async function registerVideoMetadataRoutes(
  server: FastifyInstance,
  service: VideoMetadataService
): Promise<void> {
  server.get('/video-metadata', async (request, reply) => {
    const { url } = request.query as { url?: string };
    if (typeof url !== 'string' || url.trim().length === 0) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'url is required'));
    }

    try {
      return await service.get(url);
    } catch (error) {
      if (error instanceof VideoMetadataError) {
        if (error.code === 'UNSUPPORTED_SOURCE') {
          return reply.code(400).send(apiError('VALIDATION_FAILED', error.message));
        }
        return reply.code(502).send(apiError('VIDEO_METADATA_UNAVAILABLE', error.message));
      }
      throw error;
    }
  });
}
