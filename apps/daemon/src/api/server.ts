import type Database from 'better-sqlite3';
import Fastify from 'fastify';
import { join } from 'node:path';
import { resolveCodexHome } from '../codex/home.js';
import { createRunManager, type RunManager } from '../runs/manager.js';
import { openRuntimeDatabase } from '../storage/database.js';
import { createThreadManager } from '../threads/manager.js';
import { requireAuth } from './auth.js';
import { apiError } from './errors.js';
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
  sseHeartbeatMs?: number;
  resumeCapabilityVerified?: boolean;
};

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
  const auth = requireAuth(input.token);
  const dataDir = input.dataDir ?? '.runtime';
  const codexHome = input.codexHome ?? resolveCodexHome().path;
  const db = input.db ?? openRuntimeDatabase(join(dataDir, 'app.sqlite'));
  const ownsDb = input.db === undefined;
  const threadManager = createThreadManager({ db, dataDir });
  const runManager =
    input.runManager ??
    createRunManager({
      db,
      dataDir,
      codexBin: input.codexBin ?? 'codex',
      codexHome,
      threadAccess: threadManager,
      resumeCapabilityVerified: input.resumeCapabilityVerified
    });

  server.setErrorHandler((error, _request, reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply
        .code(400)
        .send(apiError('VALIDATION_FAILED', 'body must be valid JSON'));
    }
    throw error;
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
  await registerRunRoutes(server, runManager, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    threadManager
  });
  await registerDiagnosticsRoutes(server, dataDir);
  await registerThreadRoutes(server, threadManager, runManager);

  return server;
}
