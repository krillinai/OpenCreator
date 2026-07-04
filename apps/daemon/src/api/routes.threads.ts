import type { FastifyInstance } from 'fastify';
import { createThreadManager } from '../threads/manager.js';
import type { CreateRuntimeThreadInput } from '../threads/types.js';

export async function registerThreadRoutes(server: FastifyInstance): Promise<void> {
  const manager = createThreadManager({ dataDir: '.runtime' });

  server.post<{ Body: CreateRuntimeThreadInput }>('/threads', async request => {
    return manager.createThread(request.body ?? {});
  });
}
