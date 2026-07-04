import Fastify from 'fastify';
import { requireAuth } from './auth.js';
import { registerCodexRoutes } from './routes.codex.js';
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
import { registerRunRoutes } from './routes.runs.js';
import { registerThreadRoutes } from './routes.threads.js';

export type BuildServerInput = {
  token: string;
};

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
  const auth = requireAuth(input.token);

  server.get('/healthz', async () => ({ ok: true }));

  server.addHook('preHandler', async (request, reply) => {
    if (request.url === '/healthz') return;
    await auth(request, reply);
  });

  await registerCodexRoutes(server);
  await registerRunRoutes(server);
  await registerDiagnosticsRoutes(server, '.runtime');
  await registerThreadRoutes(server);

  return server;
}
