import type Database from 'better-sqlite3';
import type { CodexAvailabilityProbe } from '@clawee/protocol';
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
import { registerAgentScheduleMcpRoute } from '../agent-tools/mcp-routes.js';
import {
  createAgentScheduleProcessInjector,
  createAgentScheduleRunInjector,
  type AgentToolRunInjection,
  type RunMcpInjector
} from '../agent-tools/run-injection.js';
import {
  createUnknownCapabilityMatrix,
  isResumeExecutionSupported,
  withRuntimeSkillCapabilities,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
import { createCodexAppServerClient } from '../codex/app-server-client.js';
import { resolveCodexHome } from '../codex/home.js';
import {
  createCodexModelCatalog,
  type CodexModelCatalog
} from '../codex/model-catalog-2026-08-05.js';
import { createMcpManager } from '../codex/mcp/manager.js';
import {
  createCodexMcpRuntimeInjector
} from '../codex/mcp/runtime-injector-2026-08-12.js';
import { createMemoryService } from '../memory/service.js';
import { createNotificationService } from '../notifications/service.js';
import { createProjectManager } from '../projects/manager.js';
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
import { createPersistentAppServerExecutor } from '../runs/persistent-app-server-executor-2026-07-28.js';
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
import type { EnterpriseCredentialStore } from '../enterprise/credential-store-2026-07-30.js';
import {
  EnterpriseCredentialStoreError
} from '../enterprise/credential-store-2026-07-30.js';
import {
  createEnterpriseHttpClient,
  type EnterpriseHttpClient
} from '../enterprise/http-client-2026-07-30.js';
import {
  createEnterpriseCollectorInstaller,
  type EnterpriseCollectorInstaller
} from '../enterprise/collector-installer-2026-08-06.js';
import { resolveEnterpriseOrigin } from '../enterprise/config-2026-07-30.js';
import { createEnterpriseSessionManager } from '../enterprise/session-manager-2026-07-30.js';
import { createEnterpriseInstallRecordRepository } from '../enterprise/install-records-2026-07-30.js';
import {
  createEnterpriseSkillManager,
  type EnterpriseSkillManager
} from '../enterprise/skill-manager-2026-07-30.js';
import {
  createEnterpriseKnowledgeManager,
  type EnterpriseKnowledgeManager
} from '../enterprise/knowledge-manager-2026-08-05.js';
import {
  createEnterpriseSharedDriveManager,
  type EnterpriseSharedDriveManager
} from '../enterprise/shared-drive-manager-2026-08-06.js';
import {
  createEnterpriseAgentIdentityStore,
  type EnterpriseAgentIdentityStore
} from '../enterprise/agent-identity-2026-08-02.js';
import {
  createEnterpriseMcpManager,
  type EnterpriseMcpManager
} from '../enterprise/mcp-manager-2026-08-07.js';
import {
  createEnterpriseMcpPreferenceRepository
} from '../enterprise/mcp-preferences-2026-08-07.js';
import type {
  EnterpriseMcpTokenStore
} from '../enterprise/mcp-token-store-2026-08-07.js';
import {
  EnterpriseMcpTokenStoreError
} from '../enterprise/mcp-token-store-2026-08-07.js';
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
import { registerProjectRoutes } from './routes.projects.js';
import { registerRunRoutes } from './routes.runs.js';
import { registerSearchRoutes } from './routes.search.js';
import { registerScheduleRoutes } from './routes.schedules.js';
import { registerSkillMarketRoutes } from './routes.skill-market.js';
import { registerSkillRoutes } from './routes.skills.js';
import { registerTaskRoutes } from './routes.tasks.js';
import { registerThreadRoutes } from './routes.threads.js';
import { registerWorkspaceFileRoutes } from './routes.workspace-files.js';
import { registerEnterpriseRoutes } from './routes.enterprise-2026-07-30.js';
import {
  registerEnterpriseKnowledgeRoutes
} from './routes.enterprise-knowledge-2026-08-05.js';
import {
  registerEnterpriseDriveRoutes
} from './routes.enterprise-drive-2026-08-06.js';

export type BuildServerInput = {
  token: string;
  dataDir?: string;
  db?: Database.Database;
  codexBin?: string;
  codexHome?: string;
  defaultCwd?: string;
  defaultProjectRoot?: string;
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
  persistentAppServerEnabled?: boolean;
  codexThreadRotationRunThreshold?: number;
  codexSessionProvider?: CodexSessionProvider;
  codexModelCatalog?: CodexModelCatalog;
  getCodexAvailabilityProbe?(): CodexAvailabilityProbe | undefined;
  memoryHistoryReader?(threadId: string): { items: import('@clawee/protocol').ThreadHistoryItem[] } | undefined;
  allowedWebOrigins?: string[];
  enterpriseAgentIdentityStore?: EnterpriseAgentIdentityStore;
  enterpriseConfigPath?: string;
  enterpriseCredentialStore?: EnterpriseCredentialStore;
  enterpriseMcpTokenStore?: EnterpriseMcpTokenStore;
  enterpriseCollectorInstaller?: EnterpriseCollectorInstaller;
  enterpriseHttpClient?: EnterpriseHttpClient;
  enterpriseOrigin?: string;
  enterpriseE2ERunId?: string;
  enterpriseSkillManager?: EnterpriseSkillManager;
  enterpriseMcpManager?: EnterpriseMcpManager;
  enterpriseKnowledgeManager?: EnterpriseKnowledgeManager;
  enterpriseKnowledgeDocumentMaxBytes?: number;
  enterpriseSharedDriveManager?: EnterpriseSharedDriveManager;
  enterpriseSharedFileMaxBytes?: number;
};

const ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
  const allowedWebOrigins = new Set(
    input.allowedWebOrigins ?? ['http://127.0.0.1:9000']
  );
  await server.register(cors, {
    origin(origin, callback) {
      if (origin === undefined) return callback(null, false);
      if (allowedWebOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
    credentials: false,
    maxAge: 600
  });
  const auth = requireAuth(input.token);
  const dataDir = input.dataDir ?? '.runtime';
  const enterpriseOrigin = resolveEnterpriseOrigin(input.enterpriseOrigin);
  const enterpriseConfigPath =
    input.enterpriseConfigPath ?? join(dataDir, 'config.toml');
  const enterpriseHttpClient =
    input.enterpriseHttpClient ??
    createEnterpriseHttpClient({ origin: enterpriseOrigin.origin });
  const enterpriseAgentIdentityStore =
    input.enterpriseAgentIdentityStore
    ?? createEnterpriseAgentIdentityStore({
      configPath: enterpriseConfigPath,
      legacyDataDir: dataDir
    });
  if (input.enterpriseConfigPath !== undefined) {
    await enterpriseAgentIdentityStore.getOrCreate();
  }
  let handleEnterpriseSessionSignedOut: (() => void) | undefined;
  const enterpriseSessionManager = createEnterpriseSessionManager({
    agentIdentityStore: enterpriseAgentIdentityStore,
    collectorInstaller:
      input.enterpriseCollectorInstaller
      ?? createEnterpriseCollectorInstaller({
        claweeAgentConfigPath: enterpriseConfigPath
      }),
    credentialStore:
      input.enterpriseCredentialStore ?? createUnavailableCredentialStore(),
    httpClient: enterpriseHttpClient,
    transportSecurity: enterpriseOrigin.transportSecurity,
    onSignedOut() {
      handleEnterpriseSessionSignedOut?.();
    }
  });
  const codexBin = input.codexBin ?? 'codex';
  const defaultCwd = input.defaultCwd ?? process.cwd();
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
  const projectManager = createProjectManager({
    db,
    managedProjectRoot: input.defaultProjectRoot === undefined
      ? undefined
      : join(input.defaultProjectRoot, 'Clawee')
  });
  const threadManager = createThreadManager({ db, dataDir, projectManager });
  const codexSessionProvider = input.codexSessionProvider ?? createCodexSessionProvider({
    client: createCodexAppServerClient({
      codexBin,
      codexHome
    })
  });
  const codexModelCatalog = input.codexModelCatalog ?? createCodexModelCatalog({
    client: createCodexAppServerClient({
      codexBin,
      codexHome
    })
  });
  const workspaceFileService = createWorkspaceFileService({
    getThread: (id) => threadManager.getPublicThread(id),
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
  const enterpriseInstallRecords =
    createEnterpriseInstallRecordRepository(db);
  const enterpriseSkillManager =
    input.enterpriseSkillManager ??
    createEnterpriseSkillManager({
      dataDir,
      sessionManager: enterpriseSessionManager,
      httpClient: enterpriseHttpClient,
      skillManager,
      publicRecords: skillMarketRecords,
      records: enterpriseInstallRecords
    });
  const enterpriseKnowledgeManager =
    input.enterpriseKnowledgeManager ??
    createEnterpriseKnowledgeManager({
      dataDir,
      sessionManager: enterpriseSessionManager,
      httpClient: enterpriseHttpClient,
      maxDocumentBytes: input.enterpriseKnowledgeDocumentMaxBytes
    });
  const enterpriseSharedDriveManager =
    input.enterpriseSharedDriveManager ??
    createEnterpriseSharedDriveManager({
      dataDir,
      sessionManager: enterpriseSessionManager,
      httpClient: enterpriseHttpClient,
      projectManager,
      maxFileBytes: input.enterpriseSharedFileMaxBytes
    });
  let persistentAppServerExecutor:
    | ReturnType<typeof createPersistentAppServerExecutor>
    | undefined;
  const invalidatePersistentRuntime = (reason: string) => {
    void persistentAppServerExecutor?.invalidate(reason).catch(error => {
      console.warn(
        `Persistent app-server invalidation failed: ${formatError(error)}`
      );
    });
  };
  const mcpManager = createMcpManager({
    codexBin,
    codexHome: resolvedCodexHome,
    db,
    capabilities,
    onConfigurationChanged: invalidatePersistentRuntime
  });
  const legacyEnterpriseMcpPreferences =
    createEnterpriseMcpPreferenceRepository(db);
  const enterpriseMcpManager =
    input.enterpriseMcpManager ??
    createEnterpriseMcpManager({
      enterpriseOrigin: enterpriseOrigin.origin,
      agentIdentityStore: enterpriseAgentIdentityStore,
      sessionManager: enterpriseSessionManager,
      httpClient: enterpriseHttpClient,
      tokenStore:
        input.enterpriseMcpTokenStore ?? createUnavailableMcpTokenStore(),
      mcpManager,
      legacyPreferences: legacyEnterpriseMcpPreferences,
      onRuntimeConfigurationChanged: invalidatePersistentRuntime
    });
  handleEnterpriseSessionSignedOut = () => {
    void enterpriseMcpManager.handleSessionSignedOut().catch(error => {
      console.warn(`Enterprise MCP sign-out cleanup failed: ${formatError(error)}`);
    });
  };
  enterpriseSessionManager.startRestore();
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
  const runtimeTransport =
    capabilities.appServerApprovals === true ? 'app-server' : 'exec';
  const getAgentToolBaseUrl = () =>
    resolveListeningOrigin(server.server.address());
  const scheduleRunInjector = input.agentToolsEnabled !== true
    ? undefined
    : createAgentScheduleRunInjector({
        capabilities: agentCapabilityTokens,
        getBaseUrl: getAgentToolBaseUrl
      });
  const agentToolProcessInjector = input.agentToolsEnabled !== true
    ? undefined
    : createAgentScheduleProcessInjector({
        capabilities: agentCapabilityTokens,
        getBaseUrl: getAgentToolBaseUrl
      });
  const enterpriseMcpRunInjector: RunMcpInjector = {
    prepare(run) {
      return enterpriseMcpManager.prepareRuntime(run);
    }
  };
  const codexMcpRuntimeInjector = createCodexMcpRuntimeInjector({
    codexHome
  });
  const agentToolInjector = combineRunInjectors(
    scheduleRunInjector,
    codexMcpRuntimeInjector,
    enterpriseMcpRunInjector
  );
  persistentAppServerExecutor =
    input.runManager === undefined
    && input.persistentAppServerEnabled !== false
    && runtimeTransport === 'app-server'
      ? createPersistentAppServerExecutor({
          codexBin,
          codexHome,
          processInjector: agentToolProcessInjector,
          runtimeInjector: combineRunInjectors(
            codexMcpRuntimeInjector,
            enterpriseMcpRunInjector
          )
        })
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
      runtimeTransport,
      approvalManager,
      persistentAppServerExecutor,
      codexThreadRotationRunThreshold:
        input.codexThreadRotationRunThreshold
        ?? parseNonNegativeInteger(process.env.CLAWEE_CODEX_THREAD_ROTATION_RUN_THRESHOLD),
      prepareThreadRotationContext: context =>
        memoryService.prepareThreadRotationContext(context),
      agentToolInjector,
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
    defaultCwd,
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

  server.setErrorHandler((error, request, reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply
        .code(400)
        .send(apiError('VALIDATION_FAILED', 'body must be valid JSON'));
    }
    if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      if (
        request.method === 'POST'
        && request.url.startsWith('/enterprise/knowledge-bases/')
      ) {
        return reply
          .code(413)
          .send(apiError(
            'ENTERPRISE_DOCUMENT_TOO_LARGE',
            'Enterprise document is too large'
          ));
      }
      if (
        request.method === 'POST'
        && request.url.startsWith('/enterprise/shared-spaces/')
      ) {
        return reply
          .code(413)
          .send(apiError(
            'ENTERPRISE_SHARED_FILE_TOO_LARGE',
            'Enterprise shared file is too large'
          ));
      }
      return reply
        .code(413)
        .send(apiError('ATTACHMENT_TOO_LARGE', 'Attachment exceeds the configured size limit'));
    }
    throw error;
  });

  server.addHook('onClose', async () => {
    let firstError: unknown;
    const capture = async (operation: () => void | Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        firstError ??= error;
      }
    };

    await capture(() => clearInterval(attachmentCleanupTimer));
    await capture(() => enterpriseSessionManager.close());
    await capture(() => unsubscribeApprovalNotifications());
    await capture(() => scheduler.stop());
    await capture(() => runManager.close());
    await capture(() => codexSessionProvider.close());
    await capture(() => codexModelCatalog.close());
    await capture(() => agentCapabilityTokens.close());
    if (ownsDb) {
      await capture(() => {
        if (db.open) db.close();
      });
    }
    if (firstError !== undefined) throw firstError;
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
    capabilities,
    modelCatalog: codexModelCatalog,
    getAvailabilityProbe: input.getCodexAvailabilityProbe
  });
  await registerEnterpriseRoutes(server, {
    sessionManager: enterpriseSessionManager,
    skillManager: enterpriseSkillManager,
    mcpManager: enterpriseMcpManager
  });
  await registerEnterpriseKnowledgeRoutes(
    server,
    enterpriseKnowledgeManager,
    { maxDocumentBytes: input.enterpriseKnowledgeDocumentMaxBytes }
  );
  await registerEnterpriseDriveRoutes(
    server,
    enterpriseSharedDriveManager,
    { maxFileBytes: input.enterpriseSharedFileMaxBytes }
  );
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
  await registerProjectRoutes(server, projectManager, runManager);
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
  if (input.agentToolsEnabled === true) {
    await registerAgentScheduleMcpRoute(server, {
      capabilities: agentCapabilityTokens,
      getBaseUrl: () => resolveListeningOrigin(server.server.address())
    });
  }
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
        capabilities,
        availabilityProbe: input.getCodexAvailabilityProbe?.()
      })
  });
  await registerWorkspaceFileRoutes(server, workspaceFileService);
  await registerSearchRoutes(server, {
    provider: codexSessionProvider,
    threadManager
  });
  await registerThreadRoutes(server, threadManager, runManager, {
    profileValidator: profileManager,
    attachmentService,
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

function createUnavailableCredentialStore(): EnterpriseCredentialStore {
  return {
    async read() {
      return undefined;
    },
    async write() {
      throw new EnterpriseCredentialStoreError('write');
    },
    async delete() {
      throw new EnterpriseCredentialStoreError('delete');
    }
  };
}

function createUnavailableMcpTokenStore(): EnterpriseMcpTokenStore {
  return {
    async read() {
      return undefined;
    },
    async write() {
      throw new EnterpriseMcpTokenStoreError('write');
    },
    async delete() {
      throw new EnterpriseMcpTokenStoreError('delete');
    }
  };
}

function combineRunInjectors(
  ...injectors: Array<RunMcpInjector | undefined>
): RunMcpInjector | undefined {
  const active = injectors.filter(
    (injector): injector is RunMcpInjector => injector !== undefined
  );
  if (active.length === 0) return undefined;
  return {
    async prepare(run) {
      const prepared = (
        await Promise.all(active.map(injector => injector.prepare(run)))
      ).filter(
        (injection): injection is AgentToolRunInjection =>
          injection !== undefined
      );
      if (prepared.length === 0) return undefined;
      return {
        mcpServers: prepared.flatMap(injection => injection.mcpServers),
        env: Object.assign({}, ...prepared.map(injection => injection.env)),
        configurationFingerprint: prepared
          .map(injection => injection.configurationFingerprint)
          .filter((value): value is string => value !== undefined)
          .join(':')
      };
    }
  };
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
