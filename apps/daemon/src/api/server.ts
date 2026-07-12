import type Database from 'better-sqlite3';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { join } from 'node:path';
import {
  isResumeExecutionSupported,
  withRuntimeSkillCapabilities,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
import { resolveCodexHome } from '../codex/home.js';
import { createMcpManager } from '../codex/mcp/manager.js';
import { createProfileManager } from '../codex/profiles/manager.js';
import { readCodexSessionHistory } from '../codex/sessions/history.js';
import { createCodexSessionIndexRepository } from '../codex/sessions/index-repository.js';
import { createCodexSessionIndexer } from '../codex/sessions/indexer.js';
import { scanCodexSessionsWithMetadata } from '../codex/sessions/scanner.js';
import { createSkillManager } from '../codex/skills/manager.js';
import { MarketArchiveDownloader, type MarketArchiveDownloader as MarketArchiveDownloaderType } from '../codex/skills/market-downloader.js';
import { createSkillMarketManager } from '../codex/skills/market-manager.js';
import { createSkillMarketRecordRepository } from '../codex/skills/market-records.js';
import { buildCodexStatusResponse } from '../codex/status.js';
import { createCleanupService } from '../cleanup/service.js';
import { createRunManager, type RunManager } from '../runs/manager.js';
import { ScheduleRepository } from '../scheduler/repository.js';
import { createSchedulerService, type SchedulerService } from '../scheduler/service.js';
import { openRuntimeDatabase } from '../storage/database.js';
import { createRunRepository, createThreadRepository } from '../storage/repositories.js';
import { createThreadManager } from '../threads/manager.js';
import { createDefaultRevealExecutor } from '../workspace-files/reveal.js';
import { createWorkspaceFileService } from '../workspace-files/service.js';
import { requireAuth } from './auth.js';
import { apiError } from './errors.js';
import { registerCodexRoutes } from './routes.codex.js';
import { registerCleanupRoutes } from './routes.cleanup.js';
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
import { registerMcpRoutes } from './routes.mcp.js';
import { registerProfileRoutes } from './routes.profiles.js';
import { registerRunRoutes } from './routes.runs.js';
import { registerScheduleRoutes } from './routes.schedules.js';
import { registerSkillMarketRoutes } from './routes.skill-market.js';
import { registerSkillRoutes } from './routes.skills.js';
import { registerThreadRoutes } from './routes.threads.js';
import { registerWorkspaceFileRoutes } from './routes.workspace-files.js';

export type BuildServerInput = {
  token: string;
  dataDir?: string;
  db?: Database.Database;
  codexBin?: string;
  codexHome?: string;
  runManager?: RunManager;
  scheduler?: SchedulerService;
  schedulerAutostart?: boolean;
  sseHeartbeatMs?: number;
  resumeCapabilityVerified?: boolean;
  capabilities?: RuntimeCapabilityMatrix;
  marketArchiveDownloader?: MarketArchiveDownloaderType;
};

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
  await server.register(cors, {
    origin(origin, callback) {
      if (origin === undefined) return callback(null, false);
      if (isAllowedWebOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
    credentials: false,
    maxAge: 600
  });
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
  const capabilities = withRuntimeSkillCapabilities(
    input.capabilities ?? createUnknownCapabilityMatrix()
  );
  const db = input.db ?? openRuntimeDatabase(join(dataDir, 'app.sqlite'));
  const ownsDb = input.db === undefined;
  const runRepository = createRunRepository(db);
  const threadRepository = createThreadRepository(db);
  const codexSessionIndexer = createCodexSessionIndexer({
    codexHome,
    repository: createCodexSessionIndexRepository(db)
  });
  const threadManager = createThreadManager({ db, dataDir });
  const workspaceFileService = createWorkspaceFileService({
    getThread: (id) => threadManager.getThread(id),
    revealExecutor: createDefaultRevealExecutor()
  });
  const profileManager = createProfileManager({ codexHome: resolvedCodexHome });
  const skillManager = createSkillManager({ codexHome: resolvedCodexHome, db });
  const skillMarketRecords = createSkillMarketRecordRepository(db);
  const skillMarketManager = createSkillMarketManager({
    dataDir,
    skillManager,
    records: skillMarketRecords,
    downloader: input.marketArchiveDownloader ?? MarketArchiveDownloader
  });
  const mcpManager = createMcpManager({ codexBin, codexHome: resolvedCodexHome, db, capabilities });
  const runManager =
    input.runManager ??
    createRunManager({
      db,
      dataDir,
      codexBin,
      codexHome,
      threadAccess: threadManager,
      resumeCapabilityVerified,
      profileValidator: profileManager
    });
  const scheduler =
    input.scheduler ??
    createSchedulerService({
      repository: new ScheduleRepository(db),
      runManager,
      defaultCwd: process.cwd(),
      profileValidator: profileManager,
      autostart: false
    });
  const cleanupService = createCleanupService({
    dataDir,
    runs: runRepository,
    threads: threadRepository
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
    scheduler.stop();
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
    capabilities
  });
  await registerProfileRoutes(server, {
    codexHome: resolvedCodexHome,
    profileManager
  });
  await registerSkillRoutes(server, { skillManager });
  await registerSkillMarketRoutes(server, { skillMarketManager });
  await registerMcpRoutes(server, { mcpManager });
  await registerRunRoutes(server, runManager, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    threadManager,
    profileValidator: profileManager
  });
  await registerScheduleRoutes(server, scheduler);
  await registerCleanupRoutes(server, cleanupService);
  await registerDiagnosticsRoutes(server, {
    dataDir,
    runs: runRepository,
    getCodexStatusSnapshot: () =>
      buildCodexStatusResponse({
        codexBin,
        codexHome: resolvedCodexHome,
        capabilities
      })
  });
  await registerWorkspaceFileRoutes(server, workspaceFileService);
  await registerThreadRoutes(server, threadManager, runManager, {
    profileValidator: profileManager,
    syncCodexSessions(limit) {
      let scan;
      try {
        scan = codexSessionIndexer.sync({ limit });
      } catch (error) {
        console.warn(`Codex session index sync failed; using raw JSONL fallback: ${formatError(error)}`);
        scan = scanCodexSessionsWithMetadata({ codexHome, limit });
      }
      for (const codexThreadId of scan.excludedSubagentThreadIds) {
        threadManager.archiveCodexThread(codexThreadId);
      }
      for (const session of scan.sessions) {
        threadManager.importCodexThread({
          codexThreadId: session.codexThreadId,
          title: session.title,
          cwd: session.cwd,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        });
      }
    },
    readThreadHistory(codexThreadId) {
      try {
        codexSessionIndexer.sync();
        return codexSessionIndexer.readHistory(codexThreadId);
      } catch (error) {
        console.warn(`Codex session history index failed; using raw JSONL fallback: ${formatError(error)}`);
        return readCodexSessionHistory({ codexHome, codexThreadId });
      }
    }
  });

  if (input.schedulerAutostart === true) scheduler.start();
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
    mcpList: false,
    mcpGet: false,
    mcpAdd: false,
    mcpRemove: false,
    mcpLogin: false,
    mcpLogout: false,
    mcpAddEnv: false,
    mcpAddUrl: false,
    mcpAddBearerTokenEnvVar: false,
    mcpAddOAuth: false,
    mcpRuntimeDiscoveryVerified: false,
    mcpRuntimeBehaviorVerified: false,
    skillsScan: false,
    skillsInstall: false,
    skillsDelete: false,
    skillsGlobalWrite: false,
    skillsRuntimeDiscoveryVerified: false,
    skillsRuntimeBehaviorVerified: false,
    warnings: ['Codex runtime help has not been collected yet.']
  };
}

function isAllowedWebOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:') return false;
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return false;
    const port = Number(url.port);
    return Number.isInteger(port) && port >= 1024 && port <= 65535;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
