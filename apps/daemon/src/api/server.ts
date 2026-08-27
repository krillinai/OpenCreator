import type Database from 'better-sqlite3';
import type { CodexAvailabilityProbe, CodexRuntimeComponentReadiness } from '@opencreator/protocol';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { createCreatorToolOperations } from '../agent-tools/creator-tools.js';
import { createAgentContextBuilder } from '../creator/agent/context-builder.js';
import { createCreatorAgentService } from '../creator/agent/agent-service.js';
import { createCreatorAgentRepository } from '../creator/agent/repository.js';
import { createCreatorAgentReconciler } from '../creator/agent/reconciler.js';
import {
  createUnavailableAgentRuntimeAdapter,
  type AgentRuntimeAdapter
} from '../creator/agent/runtime-adapter.js';
import { bootstrapCreatorAgentRuntime } from '../creator/agent/bootstrap.js';
import { createCodexCreatorAdapter } from '../creator/agent/codex-adapter.js';
import { createCreatorStageRunner } from '../creator/stage-runner.js';
import { createCreatorStageScheduler } from '../creator/stage-scheduler.js';
import { createCreatorCommandDispatcher } from '../creator/command-dispatcher.js';
import type { CreatorExecutor } from '../creator/executor.js';
import { createKrillinExecutor } from '../creator/krillin/adapter.js';
import { createKrillinDependencyLoader } from '../creator/krillin/dependency-loader.js';
import { readKrillinRuntimeManifest, resolveInside, verifyKrillinRuntimeManifest } from '../creator/krillin/manifest.js';
import { createKrillinRuntimeHost } from '../creator/krillin/runtime-host.js';
import { createDownloadExecutor } from '../creator/download/executor.js';
import { createImageExecutor } from '../creator/image/executor.js';
import { createClipExecutor } from '../creator/clip/executor.js';
import { createStickmanExecutor } from '../creator/stickman/executor.js';
import { createCreatorProjectCoverService } from '../creator/project-cover.js';
import {
  createCreatorSourceUploadService,
  type CreatorSourceUploadService
} from '../creator/source-upload.js';
import { validateMediaFile, type MediaProbe } from '../creator/validators/media.js';
import {
  createVideoTranslationWorkflow,
  type VideoTranslationWorkflow
} from '../creator/templates/video-translation-actions.js';
import {
  registerCreatorMcpRoute,
  registerAgentScheduleMcpRoute,
  registerKnowledgeMcpRoute
} from '../agent-tools/mcp-routes.js';
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
import {
  createAppServerRuntimeManager,
  type AppServerRuntimeManager
} from '../codex/app-server-runtime-manager.js';
import { createCodexRuntimeReadiness } from '../codex/runtime-readiness.js';
import { createCodexProviderConfigService } from '../codex/provider-config.js';
import {
  createFileCodexProviderCredentialStore,
  readCodexProviderApiKey,
  type CodexProviderCredentialStore
} from '../codex/provider-credential-store.js';
import {
  ensureCodexFileCredentialStore,
  isCodexCredentialStoreConfigurationDiagnostic
} from '../codex/credential-storage.js';
import { resolveCodexHome } from '../codex/home.js';
import { isEnterpriseKnowledgeThread } from '../threads/types.js';
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
import {
  createCreatorServicesConfigStoreWithTextModelFallback,
  createFileCreatorServicesConfigStore,
  type CreatorServicesConfigStore
} from '../creator-services/config-store.js';
import {
  createCreatorEventHub,
  creatorAgentEventKind,
  creatorStageEventId
} from '../creator/events.js';
import { createCreatorRepository } from '../creator/repository.js';
import { createCreatorService, type CreatorService } from '../creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../creator/templates/registry.js';
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
import {
  createVideoMetadataService,
  type VideoMetadataService
} from '../video-metadata/service.js';
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
import { createKnowledgeConversationManager } from '../enterprise/knowledge-conversation-2026-08-05.js';
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
import { registerCreatorServicesRoutes } from './routes.creator-services.js';
import { registerCreatorRoutes } from './routes.creator.js';
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
import { registerSmartDubbingRoutes } from './routes.smart-dubbing.js';
import { registerVideoGenerationRoutes } from './routes.video-generation.js';
import { registerTaskRoutes } from './routes.tasks.js';
import { registerThreadRoutes } from './routes.threads.js';
import { registerKnowledgeConversationRoutes } from './routes.knowledge-conversation-2026-08-05.js';
import { registerWorkspaceFileRoutes } from './routes.workspace-files.js';
import { registerVideoMetadataRoutes } from './routes.video-metadata.js';
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
  runtimeTransport?: 'exec' | 'app-server';
  codexThreadRotationRunThreshold?: number;
  codexSessionProvider?: CodexSessionProvider;
  codexModelCatalog?: CodexModelCatalog;
  getCodexAvailabilityProbe?(): CodexAvailabilityProbe | undefined;
  memoryHistoryReader?(threadId: string): { items: import('@opencreator/protocol').ThreadHistoryItem[] } | undefined;
  creatorServicesConfigStore?: CreatorServicesConfigStore;
  codexProviderCredentialStore?: CodexProviderCredentialStore;
  creatorService?: CreatorService;
  creatorSourceUploadService?: CreatorSourceUploadService;
  creatorSourceMediaProbe?(path: string): Promise<MediaProbe>;
  creatorSourceMaxSizeBytes?: number;
  creatorAgentRuntime?: AgentRuntimeAdapter;
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
  const dataDir = resolve(input.dataDir ?? '.runtime');
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
        opencreatorAgentConfigPath: enterpriseConfigPath
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
  try {
    await ensureCodexFileCredentialStore(codexHome);
  } catch (error) {
    if (!isCodexCredentialStoreConfigurationDiagnostic(error)) throw error;
  }
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
      : join(input.defaultProjectRoot, 'OpenCreator')
  });
  const threadManager = createThreadManager({ db, dataDir, projectManager });
  const knowledgeConversationManager = createKnowledgeConversationManager({
    dataDir,
    sessionManager: enterpriseSessionManager,
    threadManager,
    httpClient: enterpriseHttpClient
  });
  const codexControlClient = createCodexAppServerClient({
    codexBin,
    codexHome
  });
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
  let appServerRuntimeManager: AppServerRuntimeManager | undefined;
  let creatorAppServerRuntimeManager: AppServerRuntimeManager | undefined;
  const invalidatePersistentRuntime = (reason: string): Promise<void> => {
    const work = Promise.all([
      appServerRuntimeManager?.invalidate(reason)
        ?? persistentAppServerExecutor?.invalidate(reason)
        ?? Promise.resolve(),
      creatorAppServerRuntimeManager?.invalidate(reason) ?? Promise.resolve()
    ]).then(() => undefined);
    void work.catch(error => {
      console.warn(
        `Persistent app-server invalidation failed: ${formatError(error)}`
      );
    });
    return work;
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
  const storedCreatorServicesConfigStore =
    input.creatorServicesConfigStore ?? createFileCreatorServicesConfigStore(
      join(dataDir, 'config', 'creator-services.json')
    );
  const codexProviderCredentialStore =
    input.codexProviderCredentialStore ?? createFileCodexProviderCredentialStore(
      join(dataDir, 'config', 'codex-provider.json')
    );
  const resolveCodexProviderApiKey = async (provider: {
    baseUrl: string;
    model: string;
  }): Promise<string | undefined> => readCodexProviderApiKey({
    store: codexProviderCredentialStore,
    provider,
    async readLegacy() {
      return (await storedCreatorServicesConfigStore.read()).llm;
    }
  });
  const creatorEvents = createCreatorEventHub();
  const creatorRepository = createCreatorRepository(db);
  const creatorAgentRepository = createCreatorAgentRepository(db);
  const creatorAgentReconciler = createCreatorAgentReconciler({
    repository: creatorAgentRepository
  });
  creatorAgentReconciler.reconcileAfterDaemonRestart();
  const creatorService = input.creatorService ?? createCreatorService({
    repository: creatorRepository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const agentCapabilityTokens =
    input.agentCapabilityTokens ?? createAgentCapabilityTokenStore();
  const runtimeTransport = input.runtimeTransport ?? 'app-server';
  const getAgentToolBaseUrl = () =>
    resolveListeningOrigin(server.server.address());
  const creatorAgentBootstrap = bootstrapCreatorAgentRuntime({
    sourceCodexHome: codexHome,
    runtimeRoot: join(dataDir, 'creator-runtime'),
    bundledSkillDir: join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'runtime',
      'opencreator-runtime'
    )
  });
  const codexRuntimeReadiness = createCodexRuntimeReadiness({
    client: codexControlClient,
    mode: process.env.OPENCREATOR_CODEX_RUNTIME_MODE === 'external'
      ? 'external'
      : 'bundled',
    version: capabilities.codexVersion.replace(/^codex-cli\s+/, ''),
    commit: process.env.OPENCREATOR_CODEX_RUNTIME_MODE === 'external'
      ? null
      : '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
    binaryPath: codexBin,
    codexHome,
    cwd: dataDir,
    binary: readCodexBinaryReadiness(
      process.env.OPENCREATOR_CODEX_RUNTIME_MODE === 'external'
        ? undefined
        : process.env.OPENCREATOR_CODEX_RUNTIME_ROOT
    ),
    checkToolServer: () => creatorAgentBootstrap.available
      ? { status: 'ready' }
      : {
          status: 'unavailable',
          errorCode: 'creator_agent_unavailable',
          message: creatorAgentBootstrap.error ?? 'Creator Tool Server is unavailable'
        }
  });
  const codexProviderConfig = createCodexProviderConfigService({
    client: codexControlClient,
    readiness: codexRuntimeReadiness,
    async readStoredApiKey(provider) {
      return resolveCodexProviderApiKey(provider);
    },
    async onProviderUpdated(provider) {
      if (provider.apiKey !== undefined) {
        await codexProviderCredentialStore.writeApiKey(provider.apiKey);
      }
    },
    async onConfigurationChanged() {
      await Promise.all([
        codexModelCatalog.restart?.(),
        codexSessionProvider.restart?.(),
        invalidatePersistentRuntime('codex_provider_config_changed')
      ]);
    }
  });
  const creatorServicesConfigStore =
    createCreatorServicesConfigStoreWithTextModelFallback(
      storedCreatorServicesConfigStore,
      {
        async read() {
          const provider = await codexProviderConfig.read();
          const apiKey = await resolveCodexProviderApiKey(provider);
          return {
            baseUrl: provider.baseUrl,
            model: provider.model,
            ...(apiKey === undefined ? {} : { apiKey })
          };
        }
      }
    );
  const creatorRuntimeRoot = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT
    ?? join(dataDir, 'creator-runtime', 'krillinai');
  const creatorJobsRoot = join(dataDir, 'creator', 'jobs');
  const krillinDependencyLoader = createKrillinDependencyLoader({
    root: join(dataDir, 'creator-runtime', 'dependencies', 'krillinai')
  });
  const krillinRuntimeHost = createKrillinRuntimeHost({
    resourceRoot: creatorRuntimeRoot,
    jobsRoot: creatorJobsRoot
  });
  const creatorExecutors: CreatorExecutor[] = [
    createKrillinExecutor({
      resourceRoot: creatorRuntimeRoot,
      jobsRoot: creatorJobsRoot,
      dependencyLoader: krillinDependencyLoader,
      runtimeHost: krillinRuntimeHost,
      configStore: creatorServicesConfigStore
    }),
    createImageExecutor({ configStore: creatorServicesConfigStore })
  ];
  let creatorFfmpegPath: string | undefined;
  let creatorFfprobePath: string | undefined;
  try {
    const runtimeManifest = readKrillinRuntimeManifest(creatorRuntimeRoot);
    verifyKrillinRuntimeManifest(creatorRuntimeRoot, runtimeManifest);
    const executable = (pattern: RegExp) => {
      const resource = runtimeManifest.resources.find(candidate => (
        candidate.kind === 'executable' && pattern.test(candidate.path)
      ));
      return resource === undefined ? undefined : resolveInside(creatorRuntimeRoot, resource.path);
    };
    creatorFfmpegPath = executable(/(?:^|\/)ffmpeg(?:\.exe)?$/i);
    creatorFfprobePath = executable(/(?:^|\/)ffprobe(?:\.exe)?$/i);
    const ytDlpPath = executable(/(?:^|\/)yt-dlp(?:\.exe)?$/i);
    if (ytDlpPath && creatorFfprobePath) {
      creatorExecutors.push(createDownloadExecutor({ ytDlpPath, ffprobePath: creatorFfprobePath }));
    }
    if (creatorFfmpegPath && creatorFfprobePath) {
      creatorExecutors.push(
        createClipExecutor({ configStore: creatorServicesConfigStore, ffmpegPath: creatorFfmpegPath, ffprobePath: creatorFfprobePath }),
        createStickmanExecutor({ configStore: creatorServicesConfigStore, ffmpegPath: creatorFfmpegPath, ffprobePath: creatorFfprobePath })
      );
    }
  } catch (error) {
    console.warn(`Creator optional runtime executors are unavailable: ${formatError(error)}`);
  }
  const creatorProjectCoverService = createCreatorProjectCoverService({
    jobsRoot: creatorJobsRoot,
    ...(creatorFfmpegPath === undefined ? {} : { ffmpegPath: creatorFfmpegPath })
  });
  const creatorSourceMediaProbe = input.creatorSourceMediaProbe
    ?? (creatorFfprobePath === undefined
      ? undefined
      : (path: string) => validateMediaFile(path, creatorFfprobePath!));
  const creatorSourceUploadService = input.creatorSourceUploadService
    ?? (creatorSourceMediaProbe === undefined
      ? undefined
      : createCreatorSourceUploadService({
          jobsRoot: creatorJobsRoot,
          creator: creatorService,
          probeMedia: creatorSourceMediaProbe,
          maxSizeBytes: input.creatorSourceMaxSizeBytes
        }));
  let videoTranslationWorkflow: VideoTranslationWorkflow | undefined;
  const creatorStageRunner = input.creatorService === undefined
    ? createCreatorStageRunner({
        repository: creatorRepository,
        templates: creatorService.templates,
        workRoot: creatorJobsRoot,
        executors: creatorExecutors,
        onJobChanged(job) {
          creatorEvents.publish({
            id: `snapshot:${job.revision}`,
            jobId: job.id,
            revision: job.revision,
            kind: 'snapshot_changed',
            payload: { revision: job.revision }
          });
        },
        onStageChanged(stage) {
          const job = creatorService.getJob(stage.jobId);
          if (job === undefined) return;
          creatorEvents.publish({
            id: creatorStageEventId(stage),
            jobId: stage.jobId,
            revision: job.revision,
            kind: 'stage_progress',
            payload: { stage }
          });
        },
        onStageSucceeded(stage) {
          videoTranslationWorkflow?.handleStageChanged(stage);
        }
      })
    : undefined;
  const creatorStageScheduler = creatorStageRunner === undefined
    ? undefined
    : createCreatorStageScheduler({
        repository: creatorRepository,
        runner: creatorStageRunner
      });
  const creatorCommandDispatcher = createCreatorCommandDispatcher({
    service: creatorService,
    repository: creatorRepository,
    receipts: creatorAgentRepository,
    onQueuedStage: () => creatorStageScheduler?.wake(),
    onCommitted(result) {
      const activity = result.job.activities.find(candidate => (
        candidate.revision === result.job.revision
      ));
      if (activity !== undefined) {
        creatorEvents.publish({
          id: `activity:${activity.id}`,
          jobId: result.job.id,
          revision: result.job.revision,
          kind: 'activity_changed',
          payload: { activity },
          createdAt: activity.createdAt
        });
      }
      const stageRunId = result.commandReceipt.stageRunId;
      const stage = stageRunId === null
        ? undefined
        : result.job.stages.find(candidate => candidate.id === stageRunId)
          ?? creatorRepository.getStageRun(stageRunId);
      if (stage !== undefined) {
        creatorEvents.publish({
          id: creatorStageEventId(stage),
          jobId: result.job.id,
          revision: result.job.revision,
          kind: 'stage_progress',
          payload: { stage }
        });
      }
      creatorEvents.publish({
        id: `snapshot:${result.job.revision}`,
        jobId: result.job.id,
        revision: result.job.revision,
        kind: 'snapshot_changed',
        payload: { revision: result.job.revision }
      });
    }
  });
  videoTranslationWorkflow = creatorStageRunner === undefined
    ? undefined
    : createVideoTranslationWorkflow({
        creator: creatorService,
        dispatcher: creatorCommandDispatcher,
        configStore: creatorServicesConfigStore
      });
  videoTranslationWorkflow?.recover();
  const scheduleRunInjector = createAgentScheduleRunInjector({
    capabilities: agentCapabilityTokens,
    getBaseUrl: getAgentToolBaseUrl,
    knowledgeToolIsolationSupported: capabilities.knowledgeToolIsolation === true,
    scheduleToolsEnabled: input.agentToolsEnabled === true
  });
  const agentToolProcessInjector = createAgentScheduleProcessInjector({
    capabilities: agentCapabilityTokens,
    getBaseUrl: getAgentToolBaseUrl,
    includeCreator: false
  });
  const creatorAgentToolProcessInjector = createAgentScheduleProcessInjector({
    capabilities: agentCapabilityTokens,
    getBaseUrl: getAgentToolBaseUrl,
    includeSchedule: false
  });
  appServerRuntimeManager = createAppServerRuntimeManager({
    codexBin,
    codexHome,
    processInjector: agentToolProcessInjector
  });
  creatorAppServerRuntimeManager = createAppServerRuntimeManager({
    codexBin,
    codexHome,
    processInjector: creatorAgentToolProcessInjector
  });
  const creatorAgentRuntime = input.creatorAgentRuntime ?? (creatorAgentBootstrap.available
    ? createCodexCreatorAdapter({
        runtimeManager: creatorAppServerRuntimeManager,
        threads: threadManager,
        skillPath: creatorAgentBootstrap.skillPath,
        guideVersion: creatorAgentBootstrap.guideVersion,
        guideHash: creatorAgentBootstrap.hash,
        available: true
      })
    : createUnavailableAgentRuntimeAdapter(creatorAgentBootstrap.error));
  const creatorAgentContextBuilder = createAgentContextBuilder({ templates: creatorService.templates });
  const creatorAgentService = createCreatorAgentService({
    creator: creatorService,
    dispatcher: creatorCommandDispatcher,
    repository: creatorAgentRepository,
    threads: threadManager,
    contextBuilder: creatorAgentContextBuilder,
    runtime: creatorAgentRuntime,
    onEvent(event) {
      const job = creatorService.getJob(event.jobId);
      if (job === undefined) return;
      creatorEvents.publish({
        id: `agent:${event.sequence}`,
        jobId: event.jobId,
        revision: job.revision,
        kind: creatorAgentEventKind(event),
        payload: { event },
        createdAt: event.createdAt
      });
    }
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
          runtimeManager: appServerRuntimeManager,
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
        ?? parseNonNegativeInteger(process.env.OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD),
      prepareThreadRotationContext: context =>
        memoryService.prepareThreadRotationContext(context),
      agentToolInjector,
      async beforeRunSpawn({ thread }) {
        if (!isEnterpriseKnowledgeThread(thread)) return;
        await knowledgeConversationManager.prepareSearch(thread.id);
      },
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
    await capture(() => appServerRuntimeManager?.close());
    await capture(() => creatorAppServerRuntimeManager?.close());
    await capture(() => codexSessionProvider.close());
    await capture(() => codexModelCatalog.close());
    await capture(() => codexControlClient.close());
    await capture(() => creatorStageScheduler?.close());
    await capture(() => creatorStageRunner?.close());
    await capture(() => krillinRuntimeHost.close());
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
    readiness: codexRuntimeReadiness,
    providerConfig: codexProviderConfig,
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
    schedules: agentScheduleOperations,
    creator: createCreatorToolOperations({
      service: creatorService,
      dispatcher: creatorCommandDispatcher,
      contextBuilder: creatorAgentContextBuilder
    })
  });
  if (input.agentToolsEnabled === true) {
    await registerAgentScheduleMcpRoute(server, {
      capabilities: agentCapabilityTokens,
      getBaseUrl: () => resolveListeningOrigin(server.server.address())
    });
  }
  await registerCreatorMcpRoute(server, {
    capabilities: agentCapabilityTokens,
    getBaseUrl: () => resolveListeningOrigin(server.server.address())
  });
  await registerKnowledgeMcpRoute(server, {
    capabilities: agentCapabilityTokens,
    manager: knowledgeConversationManager
  });
  await registerCleanupRoutes(server, cleanupService);
  await registerCreatorServicesRoutes(server, creatorServicesConfigStore);
  await registerCreatorRoutes(server, creatorService, creatorEvents, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    agentService: creatorAgentService,
    videoTranslationWorkflow,
    projectCoverService: creatorProjectCoverService,
    sourceUploadService: creatorSourceUploadService,
    dispatcher: creatorCommandDispatcher
  });
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
  await registerKnowledgeConversationRoutes(
    server,
    knowledgeConversationManager,
    runManager,
    {
      attachmentService,
      async readHistory(thread, options) {
        if (thread.codexThreadId === undefined || thread.codexThreadId === null) {
          return { items: [], hasMore: false };
        }
        const provider = createCodexSessionProvider({
          client: createCodexAppServerClient({
            codexBin,
            codexHome: join(thread.cwd, '.codex-runtime')
          })
        });
        try {
          return await provider.listTurns({
            codexThreadId: thread.codexThreadId,
            limit: options.limit,
            ...(options.cursor === undefined ? {} : { cursor: options.cursor })
          });
        } finally {
          await provider.close();
        }
      }
    }
  );

  if (input.schedulerAutostart === true) scheduler.start();
  return server;
}

function readCodexBinaryReadiness(runtimeRoot: string | undefined): CodexRuntimeComponentReadiness {
  if (runtimeRoot === undefined) return { status: 'ready' };
  try {
    const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8')) as {
      binary?: { sha256?: unknown };
      appServerProtocol?: { schemaSha256?: unknown };
    };
    if (typeof manifest.binary?.sha256 !== 'string') {
      return {
        status: 'invalid',
        errorCode: 'codex_runtime_hash_mismatch',
        message: 'Codex Runtime manifest 未提供二进制 SHA-256'
      };
    }
    return {
      status: 'ready',
      details: {
        sha256: manifest.binary.sha256,
        ...(typeof manifest.appServerProtocol?.schemaSha256 === 'string'
          ? { protocolSchemaSha256: manifest.appServerProtocol.schemaSha256 }
          : {})
      }
    };
  } catch (cause) {
    return {
      status: 'invalid',
      errorCode: 'codex_runtime_hash_mismatch',
      message: cause instanceof Error ? cause.message : String(cause)
    };
  }
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
        builtInTools: prepared.find(
          injection => injection.builtInTools !== undefined
        )?.builtInTools,
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
): Promise<import('@opencreator/protocol').ThreadHistoryItem[]> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let items: import('@opencreator/protocol').ThreadHistoryItem[] = [];
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
