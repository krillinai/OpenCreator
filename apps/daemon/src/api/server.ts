import type Database from 'better-sqlite3';
import Fastify from 'fastify';
import { join } from 'node:path';
import {
  isResumeExecutionSupported,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
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
  capabilities?: RuntimeCapabilityMatrix;
};

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
  const auth = requireAuth(input.token);
  const dataDir = input.dataDir ?? '.runtime';
  const codexBin = input.codexBin ?? 'codex';
  const resolvedCodexHome =
    input.codexHome === undefined
      ? resolveCodexHome()
      : resolveCodexHome({ isolatedHome: input.codexHome });
  const codexHome = resolvedCodexHome.path;
  const resumeCapabilityVerified =
    input.resumeCapabilityVerified ?? (
      input.capabilities === undefined ? undefined : isResumeExecutionSupported(input.capabilities)
    );
  const db = input.db ?? openRuntimeDatabase(join(dataDir, 'app.sqlite'));
  const ownsDb = input.db === undefined;
  const threadManager = createThreadManager({ db, dataDir });
  const runManager =
    input.runManager ??
    createRunManager({
      db,
      dataDir,
      codexBin,
      codexHome,
      threadAccess: threadManager,
      resumeCapabilityVerified
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

  await registerCodexRoutes(server, {
    codexBin,
    codexHome: resolvedCodexHome,
    capabilities: input.capabilities ?? createUnknownCapabilityMatrix()
  });
  await registerRunRoutes(server, runManager, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    threadManager
  });
  await registerDiagnosticsRoutes(server, dataDir);
  await registerThreadRoutes(server, threadManager, runManager);

  return server;
}

function createUnknownCapabilityMatrix(): RuntimeCapabilityMatrix {
  return {
    codexVersion: 'unknown',
    checkedAt: new Date().toISOString(),
    execJson: false,
    execStdinPrompt: false,
    execProfile: false,
    execCwd: false,
    execSandbox: false,
    execSkipGitRepoCheck: false,
    resumeJson: false,
    resumeByThreadId: false,
    resumeLast: false,
    resumeModelOverride: false,
    resumeConfigOverride: false,
    resumeCwdOverride: false,
    resumeProfileOverride: false,
    resumeSandboxOverride: false,
    resumeContextContinuityVerified: false,
    mcpAddEnv: false,
    warnings: ['Codex runtime help has not been collected yet.']
  };
}
