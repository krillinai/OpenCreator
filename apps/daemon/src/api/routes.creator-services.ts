import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  CreatorServicesConfigStoreError,
  parseCreatorServicesConfig,
  type CreatorServicesConfigStore
} from '../creator-services/config-store.js';
import { apiError } from './errors.js';

export async function registerCreatorServicesRoutes(
  server: FastifyInstance,
  store: CreatorServicesConfigStore
): Promise<void> {
  server.get('/creator-services/config', async (_request, reply) => {
    try {
      return { config: await store.read() };
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  server.patch<{ Body: unknown }>('/creator-services/config', async (request, reply) => {
    try {
      const config = parseCreatorServicesConfig(request.body);
      return { config: await store.write(config) };
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send(apiError(
          'VALIDATION_FAILED',
          'Creator services configuration is invalid'
        ));
      }
      return sendStoreError(reply, error);
    }
  });

  server.delete('/creator-services/config', async (_request, reply) => {
    try {
      return { config: await store.reset() };
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });
}

function sendStoreError(reply: FastifyReply, error: unknown) {
  if (error instanceof CreatorServicesConfigStoreError) {
    return reply.code(503).send(apiError(error.code, 'Secure credential storage is unavailable'));
  }
  throw error;
}
