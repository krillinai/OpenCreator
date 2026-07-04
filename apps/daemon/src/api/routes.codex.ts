import type { FastifyInstance } from 'fastify';
import { resolveCodexHome } from '../codex/home.js';

export async function registerCodexRoutes(server: FastifyInstance): Promise<void> {
  server.get('/codex/status', async () => {
    const home = resolveCodexHome();
    return {
      codexBin: 'codex',
      codexVersion: 'unknown',
      codexHome: home.path,
      codexHomeMode: home.mode,
      diagnostics: []
    };
  });
}
