import type Database from 'better-sqlite3';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { join } from 'node:path';
import {
  ATTACHMENT_DRAFT_TTL_MS,
  ATTACHMENT_MAX_SIZE_BYTES,
  createAttachmentService
} from '../attachments/service.js';
import {
  createApprovalManager,
  type ApprovalManager
} from '../approvals/manager.js';
import {
  createAgentCapabilityTokenStore,
  type AgentCapabilityTokenStore
} from '../agent-tools/capability-token.js';
import {
  createDefaultAgentScheduleOperations,
  isAgentToolInternalRequest,
  registerAgentToolRoutes,
  type AgentScheduleOperations
} from '../agent-tools/internal-routes.js';
import {
  createAgentScheduleRunInjector,
  resolveAgentScheduleStdioCommand
} from '../agent-tools/run-injection.js';
import {
  isResumeExecutionSupported,
  withRuntimeSkillCapabilities,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
import { resolveCodexHome } from '../codex/home.js';
import { createMcpManager } from '../codex/mcp/manager.js';
import { createMemoryService } from '../memory/service.js';
import { createProfileManager } from '../codex/profiles/manager.js';
import { readCodexSessionHistory } from '../codex/sessions/history.js';
import {
  createCodexSessionIndexRepository,
  ThreadHistoryCursorError
} from '../codex/sessions/index-repository.js';
import { createCodexSessionIndexer } from '../codex/sessions/indexer.js';
import { scanCodexSessionsWithMetadata } from '../codex/sessions/scanner.js';
import { createSkillManager } from '../codex/skills/manager.js';
import { MarketArchiveDownloader, type MarketArchiveDownloader as MarketArchiveDownloaderType } from '../codex/skills/market-downloader.js';
import { createSkillMarketManager } from '../codex/skills/market-manager.js';
import { createSkillMarketRecordRepository } from '../codex/skills/market-records.js';
import { buildCodexStatusResponse } from '../codex/status.js';
import { createCleanupService } from '../cleanup/service.js';
import { createRunManager, type RunManager } from '../runs/manager.js';
import {
  createScheduleCoordinator,
  type ScheduleCoordinator
} from '../scheduler/coordinator.js';
import { ScheduleRepository } from '../scheduler/repository.js';
import { createSchedulerService, type SchedulerService } from '../scheduler/service.js';
import { openRuntimeDatabase } from '../storage/database.js';
import { createRunRepository, createThreadRepository } from '../storage/repositories.js';
import { createConversationSearchService } from '../search/service.js';
import { createThreadManager } from '../threads/manager.js';
import { createTaskService } from '../tasks/service.js';
import { createDefaultRevealExecutor } from '../workspace-files/reveal.js';
import { createWorkspaceFileService } from '../workspace-files/service.js';
import { prepareSchedulerStartup } from '../startup.js';
import { requireAuth } from './auth.js';
import { apiError } from './errors.js';
import { registerAttachmentRoutes } from './routes.attachments.js';
import { registerApprovalRoutes } from './routes.approvals.js';
import { registerCodexRoutes } from './routes.codex.js';
import { registerCleanupRoutes } from './routes.cleanup.js';
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
import { registerMcpRoutes } from './routes.mcp.js';
import { registerMemoryRoutes } from './routes.memory.js';
import { registerProfileRoutes } from './routes.profiles.js';
import { registerRunRoutes } from './routes.runs.js';
import { registerSearchRoutes } from './routes.search.js';
import { registerScheduleRoutes } from './routes.schedules.js';
import { registerSkillMarketRoutes } from './routes.skill-market.js';
import { registerSkillRoutes } from './routes.skills.js';
import { registerTaskRoutes } from './routes.tasks.js';
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
  scheduleCoordinator?: ScheduleCoordinator;
  schedulerAutostart?: boolean;
  startupSessionClassifier?(): void;
  sseHeartbeatMs?: number;
  resumeCapabilityVerified?: boolean;
  capabilities?: RuntimeCapabilityMatrix;
  marketArchiveDownloader?: MarketArchiveDownloaderType;
  attachmentMaxSizeBytes?: number;
  attachmentDraftTtlMs?: number;
  approvalManager?: ApprovalManager;
  agentCapabilityTokens?: AgentCapabilityTokenStore;
  agentScheduleOperations?: AgentScheduleOperations;
  agentToolsEnabled?: boolean;
  codexThreadRotationRunThreshold?: number;
  memoryHistoryReader?(threadId: string): { items: import('@clawee/protocol').ThreadHistoryItem[] } | undefined;
};

const SEARCH_SESSION_SYNC_INTERVAL_MS = 30_000;
const ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

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
  const scheduleRepository = new ScheduleRepository(db);
  const codexSessionRepository = createCodexSessionIndexRepository(db);
  const codexSessionIndexer = createCodexSessionIndexer({
    codexHome,
    repository: codexSessionRepository
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
  const approvalManager = input.approvalManager ?? createApprovalManager({ db });
  const memoryService = createMemoryService({ db });
  const agentCapabilityTokens =
    input.agentCapabilityTokens ?? createAgentCapabilityTokenStore();
  const agentToolCommand = input.agentToolsEnabled === true
    ? resolveAgentScheduleStdioCommand()
    : undefined;
  const runManager =
    input.runManager ??
    createRunManager({
      db,
      dataDir,
      codexBin,
      codexHome,
      threadAccess: threadManager,
      resumeCapabilityVerified,
      profileValidator: profileManager,
      runtimeTransport: capabilities.appServerApprovals === true ? 'app-server' : 'exec',
      approvalManager,
      codexThreadRotationRunThreshold:
        input.codexThreadRotationRunThreshold
        ?? parseNonNegativeInteger(process.env.CLAWEE_CODEX_THREAD_ROTATION_RUN_THRESHOLD),
      prepareThreadRotationContext: context =>
        memoryService.prepareThreadRotationContext(context),
      agentToolInjector: agentToolCommand === undefined
        ? undefined
        : createAgentScheduleRunInjector({
            capabilities: agentCapabilityTokens,
            getBaseUrl: () => resolveListeningOrigin(server.server.address()),
            command: agentToolCommand.command,
            args: agentToolCommand.args
          }),
      recordRunContext: (runId, items) => memoryService.recordRunContext(runId, items),
      onRunTerminal: runId => agentCapabilityTokens.revokeRun(runId)
    });
  let lastCodexSessionSyncAt: number | undefined;
  function syncCodexSessions(
    limit?: number,
    minimumIntervalMs = 0,
    reconcileLegacyScheduleSessions = true
  ) {
    const now = Date.now();
    if (
      lastCodexSessionSyncAt !== undefined
      && now - lastCodexSessionSyncAt < minimumIntervalMs
    ) {
      return;
    }

    let scan;
    let usedSessionIndex = true;
    try {
      scan = codexSessionIndexer.sync({ limit });
    } catch (error) {
      usedSessionIndex = false;
      console.warn(`Codex session index sync failed; using raw JSONL fallback: ${formatError(error)}`);
      scan = scanCodexSessionsWithMetadata({ codexHome, limit });
    }
    if (reconcileLegacyScheduleSessions) {
      codexSessionRepository.classifyScheduledSessions();
      threadRepository.archiveLegacyScheduleThreads();
    }
    for (const codexThreadId of scan.excludedSubagentThreadIds) {
      threadManager.archiveCodexThread(codexThreadId);
    }
    const sessions = usedSessionIndex
      ? codexSessionRepository.listSessions(limit)
      : scan.sessions;
    for (const session of sessions) {
      const existingThread = threadManager.getThreadByCodexThreadId(session.codexThreadId);
      if (existingThread?.purpose === 'schedule_task') continue;
      if (runRepository.isLegacyScheduleCodexThread(session.codexThreadId)) continue;
      threadManager.importCodexThread({
        codexThreadId: session.codexThreadId,
        title: session.title,
        cwd: session.cwd,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      });
    }
    lastCodexSessionSyncAt = Date.now();
  }

  let scheduler = input.scheduler;
  const scheduleCoordinator = input.scheduleCoordinator ?? createScheduleCoordinator({
    db,
    repository: scheduleRepository,
    threadManager,
    runManager,
    defaultCwd: process.cwd(),
    profileValidator: profileManager,
    onSchedulesChanged: () => scheduler?.refreshTimer()
  });
  prepareSchedulerStartup({
    coordinator: scheduleCoordinator,
    classifySessions: input.schedulerAutostart === true
      ? (input.startupSessionClassifier ?? (() => syncCodexSessions(undefined, 0, false)))
      : undefined
  });
  scheduler ??= createSchedulerService({
    repository: scheduleRepository,
    runManager,
    autostart: false
  });
  const agentScheduleOperations =
    input.agentScheduleOperations
    ?? createDefaultAgentScheduleOperations({
      coordinator: scheduleCoordinator,
      scheduler,
      threadManager
    });
  const taskService = createTaskService({
    db,
    approvals: approvalManager,
    runs: runManager
  });
  const cleanupService = createCleanupService({
    dataDir,
    runs: runRepository,
    threads: threadRepository
  });
  const conversationSearchService = createConversationSearchService(db);
  const attachmentService = createAttachmentService({
    db,
    dataDir,
    maxSizeBytes: input.attachmentMaxSizeBytes ?? ATTACHMENT_MAX_SIZE_BYTES,
    draftTtlMs: input.attachmentDraftTtlMs ?? ATTACHMENT_DRAFT_TTL_MS
  });
  await attachmentService.cleanupExpiredDrafts();
  const attachmentCleanupTimer = setInterval(() => {
    void attachmentService.cleanupExpiredDrafts().catch(error => {
      console.warn(`Attachment cleanup failed: ${formatError(error)}`);
    });
  }, ATTACHMENT_CLEANUP_INTERVAL_MS);
  attachmentCleanupTimer.unref();

  server.setErrorHandler((error, _request, reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply
        .code(400)
        .send(apiError('VALIDATION_FAILED', 'body must be valid JSON'));
    }
    if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .code(413)
        .send(apiError('ATTACHMENT_TOO_LARGE', 'Attachment exceeds the configured size limit'));
    }
    throw error;
  });

  server.addHook('onClose', async () => {
    clearInterval(attachmentCleanupTimer);
    scheduler.stop();
    agentCapabilityTokens.close();
    try {
      await runManager.close({ timeoutMs: 5_000 });
      if (ownsDb) db.close();
    } catch (error) {
      if (ownsDb) {
        void runManager.close()
          .finally(() => {
            if (db.open) db.close();
          })
          .catch(() => undefined);
      }
      throw error;
    }
  });

  server.get('/healthz', async () => ({ ok: true }));

  server.addHook('preHandler', async (request, reply) => {
    if (request.url === '/healthz') return;
    if (isAgentToolInternalRequest(request.url)) return;
    await auth(request, reply);
  });

  await registerCodexRoutes(server, {
    codexBin,
    codexHome: resolvedCodexHome,
    capabilities
  });
  await registerProfileRoutes(server, {
    codexHome: resolvedCodexHome,
    profileManager,
    getProfileUsage(name) {
      return {
        threads: threadRepository.listProfileReferences(name),
        schedules: scheduleRepository.listProfileReferences(name)
      };
    }
  });
  await registerSkillRoutes(server, { skillManager });
  await registerSkillMarketRoutes(server, { skillMarketManager });
  await registerMcpRoutes(server, { mcpManager });
  await registerRunRoutes(server, runManager, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    threadManager,
    profileValidator: profileManager,
    attachmentService,
    capabilities,
    memoryService
  });
  await registerScheduleRoutes(server, scheduleCoordinator, scheduler);
  await registerAgentToolRoutes(server, {
    capabilities: agentCapabilityTokens,
    schedules: agentScheduleOperations
  });
  await registerCleanupRoutes(server, cleanupService);
  await registerAttachmentRoutes(server, attachmentService, {
    maxSizeBytes: input.attachmentMaxSizeBytes
  });
  await registerApprovalRoutes(server, approvalManager);
  await registerTaskRoutes(server, taskService);
  await registerMemoryRoutes(server, memoryService, {
    readThreadHistory(threadId) {
      if (input.memoryHistoryReader !== undefined) {
        return input.memoryHistoryReader(threadId);
      }
      const thread = threadManager.getThread(threadId);
      if (thread === undefined) return undefined;
      if (thread.codexThreadId === undefined || thread.codexThreadId === null) {
        return { items: [] };
      }
      try {
        if (!codexSessionIndexer.isHistoryCurrent(thread.codexThreadId)) {
          syncCodexSessions();
        }
        return {
          items: codexSessionIndexer.readHistory(thread.codexThreadId)
        };
      } catch {
        return {
          items: readCodexSessionHistory({
            codexHome,
            codexThreadId: thread.codexThreadId
          })
        };
      }
    }
  });
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
  await registerSearchRoutes(server, conversationSearchService, {
    syncCodexSessions() {
      syncCodexSessions(undefined, SEARCH_SESSION_SYNC_INTERVAL_MS);
    },
    ensureSearchIndex: () => codexSessionRepository.ensureSearchIndex()
  });
  await registerThreadRoutes(server, threadManager, runManager, {
    profileValidator: profileManager,
    attachmentService,
    syncCodexSessions,
    readThreadHistory(codexThreadId, options) {
      try {
        if (!codexSessionIndexer.isHistoryCurrent(codexThreadId)) {
          syncCodexSessions();
        }
        return options === undefined
          ? { items: codexSessionIndexer.readHistory(codexThreadId) }
          : codexSessionIndexer.readHistoryPage(codexThreadId, options);
      } catch (error) {
        if (error instanceof ThreadHistoryCursorError) throw error;
        console.warn(`Codex session history index failed; using raw JSONL fallback: ${formatError(error)}`);
        if (options !== undefined) throw error;
        return { items: readCodexSessionHistory({ codexHome, codexThreadId }) };
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
    execImages: false,
    resumeImages: false,
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

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function resolveListeningOrigin(
  address: ReturnType<typeof import('node:net').Server.prototype.address>
): string | undefined {
  if (address === null || typeof address === 'string') return undefined;
  const host = address.address === '::' || address.address === '0.0.0.0'
    ? '127.0.0.1'
    : address.address.includes(':')
      ? `[${address.address}]`
      : address.address;
  return `http://${host}:${address.port}`;
}
