import type Database from 'better-sqlite3';
import Fastify from 'fastify';
import { join } from 'node:path';
import { resolveCodexHome } from '../codex/home.js';
import { createRunManager, type RunManager } from '../runs/manager.js';
import { openRuntimeDatabase } from '../storage/database.js';
import { requireAuth } from './auth.js';
import { registerCodexRoutes } from './routes.codex.js';
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
import { registerRunRoutes } from './routes.runs.js';
import { registerThreadRoutes } from './routes.threads.js';

export type BuildServerInput = {
  token: string;
  dataDir?: string;
  db?: Database.Database;
  codexBin?: string;
  codexHome?: string;
  runManager?: RunManager;
};

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
  const auth = requireAuth(input.token);
  const dataDir = input.dataDir ?? '.runtime';
  const codexHome = input.codexHome ?? resolveCodexHome().path;
  const db = input.db ?? openRuntimeDatabase(join(dataDir, 'app.sqlite'));
  const ownsDb = input.db === undefined;
  const runManager =
    input.runManager ??
    createRunManager({
      db,
      dataDir,
      codexBin: input.codexBin ?? 'codex',
      codexHome
    });

  server.addHook('onClose', async () => {
    if (ownsDb) db.close();
  });

  server.get('/healthz', async () => ({ ok: true }));

  server.addHook('preHandler', async (request, reply) => {
    if (request.url === '/healthz') return;
    await auth(request, reply);
  });

  await registerCodexRoutes(server);
  await registerRunRoutes(server, runManager);
  await registerDiagnosticsRoutes(server, dataDir);
  await registerThreadRoutes(server, dataDir);

  return server;
}
