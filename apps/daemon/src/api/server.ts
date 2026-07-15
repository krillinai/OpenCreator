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
import { createCodexAppServerClient } from '../codex/app-server-client.js';
import { resolveCodexHome } from '../codex/home.js';
import { createMcpManager } from '../codex/mcp/manager.js';
import { createMemoryService } from '../memory/service.js';
import { createNotificationService } from '../notifications/service.js';
import { createProfileManager } from '../codex/profiles/manager.js';
import {
  createCodexSessionProvider,
  type CodexSessionProvider
} from '../codex/sessions/app-server-provider.js';
import { createSkillManager } from '../codex/skills/manager.js';
import { createSkillMarketManager } from '../codex/skills/market-manager.js';
import { createSkillMarketRecordRepository } from '../codex/skills/market-records.js';
import {
  createCodexSkillSourceInstaller,
  type CodexSkillSourceInstaller
} from '../codex/skills/source-installer.js';
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
import { registerNotificationRoutes } from './routes.notifications.js';
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
  skillMarketSourceInstaller?: CodexSkillSourceInstaller;
  attachmentMaxSizeBytes?: number;
  attachmentDraftTtlMs?: number;
  approvalManager?: ApprovalManager;
  agentCapabilityTokens?: AgentCapabilityTokenStore;
  agentScheduleOperations?: AgentScheduleOperations;
  agentToolsEnabled?: boolean;
  codexThreadRotationRunThreshold?: number;
  codexSessionProvider?: CodexSessionProvider;
  memoryHistoryReader?(threadId: string): { items: import('@clawee/protocol').ThreadHistoryItem[] } | undefined;
};

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
  const threadManager = createThreadManager({ db, dataDir });
  const codexSessionProvider = input.codexSessionProvider ?? createCodexSessionProvider({
    client: createCodexAppServerClient({
      codexBin,
      codexHome
    }),
    importThread(session) {
      const existing = threadManager.getThreadByCodexThreadId(session.codexThreadId);
      if (existing?.purpose === 'schedule_task') return existing;
      if (runRepository.isLegacyScheduleCodexThread(session.codexThreadId)) return undefined;
      return threadManager.importCodexThread(session);
    }
  });
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
    sourceInstaller:
      input.skillMarketSourceInstaller ?? createCodexSkillSourceInstaller({ codexHome })
  });
  const mcpManager = createMcpManager({ codexBin, codexHome: resolvedCodexHome, db, capabilities });
  const notificationService = createNotificationService({ db });
  const approvalManager = input.approvalManager ?? createApprovalManager({ db });
  const unsubscribeApprovalNotifications = approvalManager.subscribe(approval => {
    if (approval.status === 'pending') {
      notificationService.enqueueApproval(approval.id);
    }
  });
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
      onRunTerminal(runId) {
        agentCapabilityTokens.revokeRun(runId);
        notificationService.enqueueRunTerminal(runId);
      }
    });
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
      ? input.startupSessionClassifier
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
    unsubscribeApprovalNotifications();
    scheduler.stop();
    agentCapabilityTokens.close();
    try {
      await Promise.all([
        codexSessionProvider.close(),
        runManager.close({ timeoutMs: 5_000 })
      ]);
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
  await registerNotificationRoutes(server, notificationService);
  await registerTaskRoutes(server, taskService);
  await registerMemoryRoutes(server, memoryService, {
    async readThreadHistory(threadId) {
      if (input.memoryHistoryReader !== undefined) {
        return input.memoryHistoryReader(threadId);
      }
      const thread = threadManager.getThread(threadId);
      if (thread === undefined) return undefined;
      if (thread.codexThreadId === undefined || thread.codexThreadId === null) {
        return { items: [] };
      }
      return {
        items: await readAllCodexHistory(codexSessionProvider, thread.codexThreadId)
      };
    }
  });
  await registerDiagnosticsRoutes(server, {
    dataDir,
    runs: runRepository,
    schedules: scheduleRepository,
    getCodexStatusSnapshot: () =>
      buildCodexStatusResponse({
        codexBin,
        codexHome: resolvedCodexHome,
        capabilities
      })
  });
  await registerWorkspaceFileRoutes(server, workspaceFileService);
  await registerSearchRoutes(server, codexSessionProvider);
  await registerThreadRoutes(server, threadManager, runManager, {
    profileValidator: profileManager,
    attachmentService,
    async listRecentCodexThreads({ limit }) {
      return (await codexSessionProvider.listRecent({ limit })).threads;
    },
    readThreadHistory(codexThreadId, options) {
      return codexSessionProvider.listTurns({
        codexThreadId,
        limit: options.limit,
        ...(options.cursor === undefined ? {} : { cursor: options.cursor })
      });
    }
  });

  if (input.schedulerAutostart === true) scheduler.start();
  return server;
}

async function readAllCodexHistory(
  provider: CodexSessionProvider,
  codexThreadId: string
): Promise<import('@clawee/protocol').ThreadHistoryItem[]> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let items: import('@clawee/protocol').ThreadHistoryItem[] = [];
  do {
    const page = await provider.listTurns({
      codexThreadId,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor })
    });
    items = [...page.items, ...items];
    cursor = page.nextCursor;
    if (cursor !== undefined && seenCursors.has(cursor)) {
      throw new Error('Codex app-server returned a repeated history cursor');
    }
    if (cursor !== undefined) seenCursors.add(cursor);
  } while (cursor !== undefined);
  return items;
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
