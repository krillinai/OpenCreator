import type { FastifyInstance } from 'fastify';
import { createThreadManager } from '../threads/manager.js';
import type { CreateRuntimeThreadInput } from '../threads/types.js';

export async function registerThreadRoutes(server: FastifyInstance, dataDir = '.runtime'): Promise<void> {
  const manager = createThreadManager({ dataDir });

  server.post<{ Body: CreateRuntimeThreadInput }>('/threads', async request => {
    return manager.createThread(request.body ?? {});
  });
}
