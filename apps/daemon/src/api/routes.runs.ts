import type { FastifyInstance } from 'fastify';

export async function registerRunRoutes(server: FastifyInstance): Promise<void> {
  server.post('/runs', async () => {
    return { id: 'run_not_wired', status: 'queued' };
  });

  server.get('/runs/:id', async request => {
    return { id: (request.params as { id: string }).id, status: 'queued' };
  });
}
