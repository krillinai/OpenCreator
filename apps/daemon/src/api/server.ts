import type Database from 'better-sqlite3';
import type { CodexAvailabilityProbe, CodexRuntimeComponentReadiness } from '@opencreator/protocol';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
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
import { publishCreatorArtifacts } from '../creator/artifact-publisher.js';
import { createCreatorStageScheduler } from '../creator/stage-scheduler.js';
import { createCreatorCommandDispatcher } from '../creator/command-dispatcher.js';
import type { CreatorExecutor } from '../creator/executor.js';
import { createKrillinExecutor } from '../creator/krillin/adapter.js';
import { createKrillinDependencyLoader } from '../creator/krillin/dependency-loader.js';
import { readKrillinRuntimeManifest, resolveInside } from '../creator/krillin/manifest.js';
import {
  hasKrillinRuntimeVerificationWorker,
  startKrillinRuntimeVerification
} from '../creator/krillin/runtime-verifier.js';
import { createKrillinTtsService } from '../creator/krillin/tts-service.js';
import {
  createKrillinCodexLlmGateway,
  KRILLIN_LLM_ROUTE_PREFIX
} from '../creator/krillin/codex-llm-gateway.js';
import { createDownloadExecutor } from '../creator/download/executor.js';
import { resolveYtDlpRuntime } from '../creator/yt-dlp/runtime.js';
import {
  createYtDlpUpdateManager,
  type YtDlpUpdateManager
} from '../creator/yt-dlp/update-manager.js';
import { createCoverAnalysisExecutor } from '../creator/cover/executor.js';
import {
  createFfmpegCoverImageNormalizer,
  createImageExecutor
} from '../creator/image/executor.js';
import { createVideoExecutor } from '../creator/video/executor.js';
import { createClipExecutor } from '../creator/clip/executor.js';
import { createSmartDubbingExecutor } from '../creator/smart-dubbing/executor.js';
import { createXiaohongshuPostExecutor } from '../creator/xiaohongshu/executor.js';
import { createShortVideoScriptExecutor } from '../creator/short-video-script/executor.js';
import { createWechatArticleExecutor } from '../creator/article/executor.js';
import { createArticleImageGenerator } from '../creator/article/image-generator.js';
import { createArticleSourceExtractor } from '../creator/article/source-extractor.js';
import { createWechatArticleModel } from '../creator/article/model.js';
import {
  migrateStickmanVisualAssetState,
  purgeLegacyStickmanJobs
} from '../creator/stickman/legacy-migration.js';
import { createStickmanContentExecutor } from '../creator/stickman/content-executor.js';
import { createStickmanCodexJsonCompletion } from '../creator/stickman/codex-json-completion.js';
import { createStickmanAudioExecutor } from '../creator/stickman/audio-executor.js';
import { createStickmanImageExecutor } from '../creator/stickman/image-executor.js';
import { createStickmanVisualAssetRegistry } from '../creator/stickman/visual-assets.js';
import { createStickmanValidationExecutor } from '../creator/stickman/validation-executor.js';
import { createStickmanTimelineExecutor } from '../creator/stickman/timeline-executor.js';
import { createStickmanRemotionExecutor } from '../creator/stickman/remotion-executor.js';
import { createStickmanMediaValidationExecutor } from '../creator/stickman/media-validation-executor.js';
import { createStickmanDeliveryExecutor } from '../creator/stickman/delivery-executor.js';
import { CreatorProviderRequestLedger } from '../creator/provider-requests.js';
import { createCreatorProjectCoverService } from '../creator/project-cover.js';
import { createVideoGenerationService } from '../video-generation/service.js';
import { createImageGenerationService } from '../image-generation/service.js';
import {
  createCreatorReferenceImageUploadService,
  type CreatorReferenceImageUploadService
} from '../creator/reference-image-upload.js';
import {
  createCreatorSourceUploadService,
  type CreatorSourceUploadService
} from '../creator/source-upload.js';
import {
  createCreatorDocumentUploadService,
  type CreatorDocumentUploadService
} from '../creator/document-upload.js';
import { createCreatorArtifactImportService } from '../creator/artifact-import.js';
import { createCreatorPreflight } from '../creator/preflight.js';
import { validateMediaFile, type MediaProbe } from '../creator/validators/media.js';
import {
  createCoverWorkflow,
  type CoverWorkflow
} from '../creator/templates/cover-actions.js';
import {
  createVideoTranslationWorkflow,
  type VideoTranslationWorkflow
} from '../creator/templates/video-translation-actions.js';
import {
  createAutoClipWorkflow,
  type AutoClipWorkflow
} from '../creator/templates/auto-clip-actions.js';
import {
  createStickmanVideoWorkflow,
  type StickmanVideoWorkflow
} from '../creator/templates/stickman-video-actions.js';
import {
  registerCreatorMcpRoute,
  registerAgentScheduleMcpRoute
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
  createOpenCreatorCodexProviderCredentialStore,
  readCodexProviderApiKey,
  type CodexProviderCredentialStore
} from '../codex/provider-credential-store.js';
import {
  ensureCodexFileCredentialStore,
  isCodexCredentialStoreConfigurationDiagnostic
} from '../codex/credential-storage.js';
import { resolveCodexHome } from '../codex/home.js';
import { createCodexIsolatedHome } from '../codex/probe-home.js';
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
  createOpenCreatorCreatorServicesConfigStore,
  type CreatorServicesConfigStore
} from '../creator-services/config-store.js';
import { createSmartDubbingService } from '../smart-dubbing/service.js';
import {
  createCreatorEventHub,
  creatorAgentEventKind,
  creatorIssueEventId,
  creatorStageEventId
} from '../creator/events.js';
import { createCreatorRepository } from '../creator/repository.js';
import { createCreatorIssueService } from '../creator/issues.js';
import { createCreatorService, type CreatorService } from '../creator/service.js';
import {
  loadCreatorPresetCatalog,
  resolveCreatorPresetCatalogRoot
} from '../creator/presets/catalog.js';
import { assertCreatorPresetStageRequirement } from '../creator/presets/requirements.js';
import type { CreatorPresetRegistry } from '../creator/presets/types.js';
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
import { createOpenCreatorSettingsStore } from '../settings/store.js';
import { createDefaultRevealExecutor } from '../workspace-files/reveal.js';
import { createWorkspaceFileService } from '../workspace-files/service.js';
import {
  createVideoMetadataService,
  type VideoMetadataService
} from '../video-metadata/service.js';
import { prepareSchedulerStartup } from '../startup.js';
import { requireAuth } from './auth.js';
import { apiError } from './errors.js';
import { registerAttachmentRoutes } from './routes.attachments.js';
import { registerApprovalRoutes } from './routes.approvals.js';
import { registerCodexRoutes } from './routes.codex.js';
import { registerCleanupRoutes } from './routes.cleanup.js';
import { registerCreatorServicesRoutes } from './routes.creator-services.js';
import { registerCreatorRoutes } from './routes.creator.js';
import { registerCreatorRuntimeRoutes } from './routes.creator-runtime.js';
import { createChannelPipelineService } from '../channel/service.js';
import { registerChannelRoutes } from './routes.channel.js';
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
import { registerImageGenerationRoutes } from './routes.image-generation.js';
import { registerMcpRoutes } from './routes.mcp.js';
import { registerMemoryRoutes } from './routes.memory.js';
import { registerNotificationRoutes } from './routes.notifications.js';
import { registerProfileRoutes } from './routes.profiles.js';
import { registerProjectRoutes } from './routes.projects.js';
import { registerRunRoutes } from './routes.runs.js';
import { registerSearchRoutes } from './routes.search.js';
import { registerSettingsRoutes } from './routes.settings.js';
import { registerScheduleRoutes } from './routes.schedules.js';
import { registerSkillMarketRoutes } from './routes.skill-market.js';
import { registerSkillRoutes } from './routes.skills.js';
import { registerSmartDubbingRoutes } from './routes.smart-dubbing.js';
import { registerTaskRoutes } from './routes.tasks.js';
import { registerThreadRoutes } from './routes.threads.js';
import { registerWorkspaceFileRoutes } from './routes.workspace-files.js';
import { registerVideoMetadataRoutes } from './routes.video-metadata.js';

export type BuildServerInput = {
  token: string;
  appHome?: string;
  dataDir?: string;
  configFile?: string;
  credentialsFile?: string;
  runtimeDir?: string;
  creatorDir?: string;
  db?: Database.Database;
  codexBin?: string;
  codexHome?: string;
  localCodexHome?: string;
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
  creatorPresetRegistry?: CreatorPresetRegistry;
  creatorPresetCatalogRoot?: string;
  creatorReferenceImageUploadService?: CreatorReferenceImageUploadService;
  creatorReferenceImageMaxSizeBytes?: number;
  creatorSourceUploadService?: CreatorSourceUploadService;
  creatorDocumentUploadService?: CreatorDocumentUploadService;
  creatorDocumentMaxSizeBytes?: number;
  creatorSourceMediaProbe?(path: string): Promise<MediaProbe>;
  creatorSourceMaxSizeBytes?: number;
  creatorYtDlpPath?: string;
  creatorYtDlpUpdateManager?: YtDlpUpdateManager;
  creatorRuntimePlatform?: NodeJS.Platform;
  creatorRuntimeArch?: string;
  channelRepoPath?: string;
  creatorExecutors?: CreatorExecutor[];
  creatorAgentRuntime?: AgentRuntimeAdapter;
  allowedWebOrigins?: string[];
};

const ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const KRILLIN_VERIFICATION_BACKGROUND_DELAY_MS = 500;

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({
    logger: false,
    forceCloseConnections: true
  });
  const allowedWebOrigins = new Set(
    input.allowedWebOrigins ?? ['http://127.0.0.1:19861']
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
  const appHome = resolve(input.appHome ?? dataDir);
  const configFile = resolve(input.configFile ?? join(appHome, 'config.toml'));
  const runtimeDir = resolve(input.runtimeDir ?? join(dataDir, 'creator-runtime'));
  const creatorDir = resolve(input.creatorDir ?? join(dataDir, 'creator'));
  const defaultManagedProjectRoot = join(
    input.defaultProjectRoot ?? join(homedir(), 'Documents'),
    'OpenCreator'
  );
  const openCreatorSettingsStore = createOpenCreatorSettingsStore(configFile, {
    defaultProjectRoot: defaultManagedProjectRoot,
    outputRoot: join(defaultManagedProjectRoot, 'Exports')
  });
  const codexBin = input.codexBin ?? 'codex';
  const defaultCwd = input.defaultCwd ?? process.cwd();
  const resolvedCodexHome =
    input.codexHome === undefined
      ? resolveCodexHome()
      : resolveCodexHome({ isolatedHome: input.codexHome });
  const codexHome = resolvedCodexHome.path;
  const localCodexHome = resolve(input.localCodexHome ?? codexHome);
  if (
    input.localCodexHome !== undefined
    && resolvedCodexHome.mode === 'isolated'
    && localCodexHome !== codexHome
  ) {
    createCodexIsolatedHome(localCodexHome, codexHome);
  }
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
    managedProjectRoot: defaultManagedProjectRoot,
    resolveManagedProjectRoot: () => (
      openCreatorSettingsStore.readStorage().settings.defaultProjectRoot
    )
  });
  const threadManager = createThreadManager({ db, dataDir, projectManager });
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
  let persistentAppServerExecutor:
    | ReturnType<typeof createPersistentAppServerExecutor>
    | undefined;
  let appServerRuntimeManager: AppServerRuntimeManager | undefined;
  let creatorAppServerRuntimeManager: AppServerRuntimeManager | undefined;
  const stickmanContentRuntimeManager = input.creatorExecutors === undefined
    ? createAppServerRuntimeManager({ codexBin, codexHome })
    : undefined;
  const invalidatePersistentRuntime = (reason: string): Promise<void> => {
    const work = Promise.all([
      appServerRuntimeManager?.invalidate(reason)
        ?? persistentAppServerExecutor?.invalidate(reason)
        ?? Promise.resolve(),
      creatorAppServerRuntimeManager?.invalidate(reason) ?? Promise.resolve(),
      stickmanContentRuntimeManager?.invalidate(reason) ?? Promise.resolve()
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
  const notificationService = createNotificationService({ db });
  const approvalManager = input.approvalManager ?? createApprovalManager({ db });
  const unsubscribeApprovalNotifications = approvalManager.subscribe(approval => {
    if (approval.status === 'pending') {
      notificationService.enqueueApproval(approval.id);
    }
  });
  const memoryService = createMemoryService({ db });
  const storedCreatorServicesConfigStore =
    input.creatorServicesConfigStore ?? (
      input.credentialsFile === undefined
        ? createFileCreatorServicesConfigStore(
            join(dataDir, 'config', 'creator-services.json')
          )
        : createOpenCreatorCreatorServicesConfigStore({
            configFile,
            credentialsFile: input.credentialsFile
          })
    );
  const codexProviderCredentialStore =
    input.codexProviderCredentialStore ?? (
      input.credentialsFile === undefined
        ? createFileCodexProviderCredentialStore(
            join(dataDir, 'config', 'codex-provider.json')
          )
        : createOpenCreatorCodexProviderCredentialStore(input.credentialsFile)
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
  const creatorJobsRoot = join(creatorDir, 'jobs');
  await purgeLegacyStickmanJobs({ db, jobsRoot: creatorJobsRoot });
  migrateStickmanVisualAssetState({ db });
  const creatorRepository = createCreatorRepository(db);
  const creatorIssueService = createCreatorIssueService(creatorRepository, {
    onChanged(issue) {
      if (issue.scope.kind !== 'creator-job') return;
      const job = creatorRepository.getJob(issue.scope.jobId);
      if (job === undefined) return;
      creatorEvents.publish({
        id: creatorIssueEventId(issue),
        jobId: job.id,
        revision: job.revision,
        kind: 'issue_changed',
        payload: JSON.parse(JSON.stringify({ issue })) as Record<string, import('@opencreator/protocol').CreatorJson>,
        createdAt: issue.lastOccurredAt
      });
    }
  });
  const creatorProviderRequestLedger = new CreatorProviderRequestLedger(
    creatorRepository,
    creatorIssueService
  );
  const creatorAgentRepository = createCreatorAgentRepository(db);
  const creatorAgentReconciler = createCreatorAgentReconciler({
    repository: creatorAgentRepository
  });
  creatorAgentReconciler.reconcileAfterDaemonRestart();
  const creatorTemplates = createDefaultCreatorTemplateRegistry();
  const creatorPresetCatalogRoot = resolve(
    input.creatorPresetCatalogRoot ?? resolveCreatorPresetCatalogRoot()
  );
  const creatorPresetRegistry = input.creatorPresetRegistry
    ?? await loadCreatorPresetCatalog({
      root: creatorPresetCatalogRoot,
      templates: creatorTemplates,
      verificationCachePath: join(
        dataDir,
        'runtime-verification',
        'creator-presets.json'
      )
    });
  const agentCapabilityTokens =
    input.agentCapabilityTokens ?? createAgentCapabilityTokenStore();
  const runtimeTransport = input.runtimeTransport ?? 'app-server';
  const getAgentToolBaseUrl = () =>
    resolveListeningOrigin(server.server.address());
  const krillinCodexLlmGateway = createKrillinCodexLlmGateway({
    codexBin,
    codexHome,
    cwd: dataDir
  });
  const creatorAgentBootstrapInput = {
    sourceCodexHome: localCodexHome,
    runtimeRoot: runtimeDir,
    ...(input.appHome === undefined
      ? {}
      : { codexHome: join(runtimeDir, 'creator-codex') }),
    bundledSkillDir: join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'runtime',
      'opencreator-runtime'
    )
  };
  let creatorAgentBootstrap = bootstrapCreatorAgentRuntime(creatorAgentBootstrapInput);
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
        await codexProviderCredentialStore.writeApiKey(provider.apiKey, provider);
      }
    },
    async onConfigurationChanged() {
      await Promise.all([
        codexModelCatalog.restart?.(),
        codexSessionProvider.restart?.(),
        invalidatePersistentRuntime('codex_provider_config_changed')
      ]);
      for (const thread of threadManager.listThreads({
        status: 'active',
        purpose: 'creator_agent'
      })) {
        threadManager.setCodexThreadId(thread.id, null);
      }
      creatorAgentBootstrap = bootstrapCreatorAgentRuntime(creatorAgentBootstrapInput);
      if (!creatorAgentBootstrap.available) {
        throw new Error(creatorAgentBootstrap.error ?? 'Creator Agent bootstrap failed');
      }
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
  const creatorService = input.creatorService ?? createCreatorService({
    jobsRoot: creatorJobsRoot,
    repository: creatorRepository,
    templates: creatorTemplates,
    providerRequestLedger: creatorProviderRequestLedger,
    presets: creatorPresetRegistry,
    creatorServicesConfig: creatorServicesConfigStore
  });
  const creatorRuntimeRoot = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT
    ?? join(runtimeDir, 'krillinai');
  const krillinVerificationCachePath = join(
    dataDir,
    'runtime-verification',
    'krillinai.json'
  );
  let krillinVerificationTimer: NodeJS.Timeout | undefined;
  let startKrillinVerification: (() => ReturnType<typeof startKrillinRuntimeVerification>) | undefined;
  let ensureKrillinRuntimeReady = async () => {};
  const krillinDependencyLoader = createKrillinDependencyLoader({
    root: join(runtimeDir, 'krillinai', 'dependencies'),
    ...(input.creatorRuntimePlatform === undefined
      ? {}
      : { platform: input.creatorRuntimePlatform }),
    ...(input.creatorRuntimeArch === undefined ? {} : { arch: input.creatorRuntimeArch })
  });
  const krillinTtsService = createKrillinTtsService({
    resourceRoot: creatorRuntimeRoot,
    workRoot: join(creatorJobsRoot, '.tts'),
    configStore: creatorServicesConfigStore,
    verificationCachePath: krillinVerificationCachePath,
    ensureRuntimeReady: () => ensureKrillinRuntimeReady()
  });
  const smartDubbingService = createSmartDubbingService({
    dataDir,
    ttsService: krillinTtsService
  });
  const videoGenerationService = createVideoGenerationService({
    dataDir,
    configStore: creatorServicesConfigStore
  });
  const imageGenerationService = createImageGenerationService({
    dataDir,
    configStore: creatorServicesConfigStore,
    codexNative: { codexHome }
  });
  const developmentStickmanRuntimeRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../desktop/.pack/stickman-runtime'
  );
  const stickmanRuntimeRoot = process.env.OPENCREATOR_STICKMAN_RUNTIME_ROOT
    ?? (existsSync(developmentStickmanRuntimeRoot)
      ? developmentStickmanRuntimeRoot
      : join(dataDir, 'creator-runtime', 'stickman'));
  const packagedStickmanCatalog = join(stickmanRuntimeRoot, 'visual-assets', 'catalog.json');
  const developmentStickmanCatalog = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../resources/stickman/visual-assets/catalog.json'
  );
  const developmentStickmanVisualAssetRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../web/public/dashboard'
  );
  const stickmanVisualAssetOptions = existsSync(packagedStickmanCatalog)
    ? {
        root: stickmanRuntimeRoot,
        catalogPath: packagedStickmanCatalog
      }
    : existsSync(developmentStickmanCatalog)
      ? {
          root: developmentStickmanVisualAssetRoot,
          catalogPath: developmentStickmanCatalog
        }
      : undefined;
  const stickmanVisualAssets = stickmanVisualAssetOptions !== undefined
    ? createStickmanVisualAssetRegistry(stickmanVisualAssetOptions)
    : undefined;
  const creatorTesseractPath = [
    process.env.OPENCREATOR_TESSERACT_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe' : undefined,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe' : undefined
  ].find(candidate => candidate !== undefined && existsSync(candidate));
  const creatorExecutors: CreatorExecutor[] = input.creatorExecutors ?? [];
  if (input.creatorExecutors === undefined) {
    if (stickmanVisualAssets !== undefined) {
      creatorExecutors.push(createStickmanContentExecutor({
        configStore: creatorServicesConfigStore,
        codexCompleteJson: createStickmanCodexJsonCompletion({
          runtimeManager: stickmanContentRuntimeManager!
        }),
        visualAssets: stickmanVisualAssets
      }));
      creatorExecutors.push(createStickmanImageExecutor({
        configStore: creatorServicesConfigStore,
        ledger: creatorProviderRequestLedger,
        codexNative: { codexHome },
        ...(creatorTesseractPath === undefined ? {} : { tesseractPath: creatorTesseractPath })
      }));
    }
    creatorExecutors.push(
      createStickmanValidationExecutor({
        ...(creatorTesseractPath === undefined ? {} : { tesseractPath: creatorTesseractPath })
      }),
      createStickmanTimelineExecutor()
    );
  }
  let creatorFfmpegPath: string | undefined;
  let creatorFfprobePath: string | undefined;
  let creatorYtDlpUpdateManager = input.creatorYtDlpUpdateManager;
  let getYtDlpRuntime: (() => ReturnType<typeof resolveYtDlpRuntime>) | undefined;
  let getCreatorYtDlpRuntime: (() => ReturnType<typeof resolveYtDlpRuntime>) | undefined;
  try {
    const runtimeManifest = readKrillinRuntimeManifest(creatorRuntimeRoot);
    let runtimeVerification: ReturnType<typeof startKrillinRuntimeVerification> | undefined;
    startKrillinVerification = () => {
      if (krillinVerificationTimer !== undefined) {
        clearTimeout(krillinVerificationTimer);
        krillinVerificationTimer = undefined;
      }
      if (runtimeVerification === undefined) {
        runtimeVerification = startKrillinRuntimeVerification({
          resourceRoot: creatorRuntimeRoot,
          cachePath: krillinVerificationCachePath
        });
        void runtimeVerification.catch(error => {
          console.warn(`Creator runtime verification failed: ${formatError(error)}`);
        });
      }
      return runtimeVerification;
    };
    ensureKrillinRuntimeReady = async () => {
      await startKrillinVerification!();
    };
    const executable = (pattern: RegExp) => {
      const resource = runtimeManifest.resources.find(candidate => (
        candidate.kind === 'executable' && pattern.test(candidate.path)
      ));
      return resource === undefined ? undefined : resolveInside(creatorRuntimeRoot, resource.path);
    };
    creatorFfmpegPath = executable(/(?:^|\/)ffmpeg(?:\.exe)?$/i);
    creatorFfprobePath = executable(/(?:^|\/)ffprobe(?:\.exe)?$/i);
    const ytDlp = resolveYtDlpRuntime({
      resourceRoot: creatorRuntimeRoot,
      manifest: runtimeManifest,
      ...(input.creatorYtDlpPath === undefined
        ? {}
        : { overridePath: input.creatorYtDlpPath })
    });
    if (
      creatorYtDlpUpdateManager === undefined
      && input.creatorYtDlpPath === undefined
      && ytDlp?.script !== undefined
    ) {
      try {
        creatorYtDlpUpdateManager = await createYtDlpUpdateManager({
          root: join(runtimeDir, 'yt-dlp'),
          bundledRuntime: ytDlp,
          async readProxy() {
            return (await creatorServicesConfigStore.read()).proxy.trim();
          }
        });
      } catch (error) {
        console.warn(`yt-dlp updater is unavailable: ${formatError(error)}`);
      }
    }
    getYtDlpRuntime = () =>
      creatorYtDlpUpdateManager?.getRuntime() ?? ytDlp;
    getCreatorYtDlpRuntime = getYtDlpRuntime;
    if (input.creatorExecutors === undefined) {
      creatorExecutors.push(createKrillinExecutor({
        resourceRoot: creatorRuntimeRoot,
        jobsRoot: creatorJobsRoot,
        dependencyLoader: krillinDependencyLoader,
        configStore: creatorServicesConfigStore,
        getYtDlpRuntime,
        verificationCachePath: krillinVerificationCachePath,
        ensureRuntimeReady: () => ensureKrillinRuntimeReady(),
        getCodexLlmConfig() {
          const baseUrl = resolveListeningOrigin(server.server.address());
          return baseUrl === undefined ? undefined : krillinCodexLlmGateway.config(baseUrl);
        }
      }));
    }
    if (
      input.creatorExecutors === undefined
      && ytDlp
      && creatorFfmpegPath
      && creatorFfprobePath
    ) {
      creatorExecutors.push(createDownloadExecutor({
        configStore: creatorServicesConfigStore,
        ytDlpPath: ytDlp.executable,
        ytDlpPrefixArgs: ytDlp.prefixArgs,
        ytDlpEnv: ytDlp.env,
        getYtDlpRuntime: () => getYtDlpRuntime!()!,
        ffmpegPath: creatorFfmpegPath,
        ffprobePath: creatorFfprobePath
      }));
    }
    if (input.creatorExecutors === undefined && ytDlp) {
      creatorExecutors.push(createCoverAnalysisExecutor({
        configStore: creatorServicesConfigStore,
        ytDlpPath: ytDlp.executable,
        ytDlpPrefixArgs: ytDlp.prefixArgs,
        ytDlpEnv: ytDlp.env,
        getYtDlpRuntime: () => getYtDlpRuntime!()!
      }));
    }
    if (input.creatorExecutors === undefined && creatorFfmpegPath && creatorFfprobePath) {
      creatorExecutors.push(createClipExecutor({
        configStore: creatorServicesConfigStore,
        ffmpegPath: creatorFfmpegPath,
        ffprobePath: creatorFfprobePath
      }));
    }
    if (input.creatorExecutors === undefined && creatorFfprobePath) {
      creatorExecutors.push(createStickmanAudioExecutor({
        configStore: creatorServicesConfigStore,
        ttsService: krillinTtsService,
        ledger: creatorProviderRequestLedger,
        ffprobePath: creatorFfprobePath
      }));
      creatorExecutors.push(createStickmanRemotionExecutor({
        ffprobePath: creatorFfprobePath,
        runtimeRoot: stickmanRuntimeRoot
      }));
      if (creatorFfmpegPath) {
        creatorExecutors.push(createStickmanMediaValidationExecutor({
          ffprobePath: creatorFfprobePath,
          ffmpegPath: creatorFfmpegPath
        }));
      }
      creatorExecutors.push(createStickmanDeliveryExecutor({
        ffprobePath: creatorFfprobePath,
        ffmpegPath: creatorFfmpegPath
      }));
    }
  } catch (error) {
    console.warn(`Creator optional runtime executors are unavailable: ${formatError(error)}`);
  }
  if (input.creatorExecutors === undefined) {
    creatorExecutors.push(createXiaohongshuPostExecutor({
      configStore: creatorServicesConfigStore
    }));
    creatorExecutors.push(createShortVideoScriptExecutor({
      configStore: creatorServicesConfigStore
    }));
    creatorExecutors.push(createSmartDubbingExecutor({
      ttsService: krillinTtsService
    }));
    creatorExecutors.push(createImageExecutor({
      configStore: creatorServicesConfigStore,
      codexNative: { codexHome },
      ...(creatorFfmpegPath === undefined
        ? {}
        : {
            normalizeCoverImage: createFfmpegCoverImageNormalizer(
              creatorFfmpegPath
            )
          })
    }));
    if (creatorFfprobePath !== undefined) {
      creatorExecutors.push(createVideoExecutor({
        service: videoGenerationService,
        probeVideo: path => validateMediaFile(path, creatorFfprobePath!)
      }));
    }
    creatorExecutors.push(createWechatArticleExecutor({
      sourceExtractor: createArticleSourceExtractor({
        configStore: creatorServicesConfigStore,
        getYtDlpRuntime: getCreatorYtDlpRuntime
      }),
      model: createWechatArticleModel({ configStore: creatorServicesConfigStore }),
      imageGenerator: createArticleImageGenerator({
        configStore: creatorServicesConfigStore,
        codexNative: { codexHome }
      })
    }));
  }
  const creatorPreflight = createCreatorPreflight({
    configStore: creatorServicesConfigStore,
    readCapabilities: () => krillinDependencyLoader.capabilities(),
    resourceRoot: creatorRuntimeRoot,
    jobsRoot: creatorJobsRoot,
    ffmpegPath: creatorFfmpegPath,
    ffprobePath: creatorFfprobePath,
    stickmanRuntimeRoot,
    ...(getYtDlpRuntime === undefined ? {} : { getYtDlpRuntime }),
    runtimeVerificationCachePath: krillinVerificationCachePath,
    ensureRuntimeReady: () => ensureKrillinRuntimeReady(),
    executorIds: creatorExecutors.map(executor => executor.id),
    validateRuntimeAssets: input.creatorExecutors === undefined
  });
  const creatorProjectCoverService = createCreatorProjectCoverService({
    jobsRoot: creatorJobsRoot,
    ensureRuntimeReady: () => ensureKrillinRuntimeReady(),
    ...(creatorFfmpegPath === undefined ? {} : { ffmpegPath: creatorFfmpegPath })
  });
  const creatorSourceMediaProbe = input.creatorSourceMediaProbe
    ?? (creatorFfprobePath === undefined
      ? undefined
      : async (path: string) => {
          await ensureKrillinRuntimeReady();
          return await validateMediaFile(path, creatorFfprobePath!);
        });
  const creatorSourceUploadService = input.creatorSourceUploadService
    ?? (creatorSourceMediaProbe === undefined
      ? undefined
      : createCreatorSourceUploadService({
          jobsRoot: creatorJobsRoot,
          creator: creatorService,
          probeMedia: creatorSourceMediaProbe,
          maxSizeBytes: input.creatorSourceMaxSizeBytes
        }));
  const creatorReferenceImageUploadService = input.creatorReferenceImageUploadService
    ?? createCreatorReferenceImageUploadService({
        jobsRoot: creatorJobsRoot,
        creator: creatorService,
        maxSizeBytes: input.creatorReferenceImageMaxSizeBytes
      });
  const creatorDocumentUploadService = input.creatorDocumentUploadService
    ?? createCreatorDocumentUploadService({
      jobsRoot: creatorJobsRoot,
      creator: creatorService,
      ...(input.creatorDocumentMaxSizeBytes === undefined
        ? {}
        : { maxSizeBytes: input.creatorDocumentMaxSizeBytes })
    });
  const creatorArtifactImportService = createCreatorArtifactImportService({
    jobsRoot: creatorJobsRoot,
    creator: creatorService
  });
  let coverWorkflow: CoverWorkflow | undefined;
  let videoTranslationWorkflow: VideoTranslationWorkflow | undefined;
  let stickmanVideoWorkflow: StickmanVideoWorkflow | undefined;
  let autoClipWorkflow: AutoClipWorkflow | undefined;
  const creatorStageRunner = input.creatorService === undefined
    ? createCreatorStageRunner({
        repository: creatorRepository,
        issueService: creatorIssueService,
        templates: creatorService.templates,
        workRoot: creatorJobsRoot,
        executors: creatorExecutors,
        async beforeRun(job, stageId) {
          assertCreatorPresetStageRequirement({
            job,
            stageId,
            services: await creatorServicesConfigStore.read()
          });
        },
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
          if (['failed', 'canceled', 'interrupted'].includes(stage.status)) {
            void stickmanVideoWorkflow?.handleStageChanged(stage).catch(error => {
              console.warn(`Stickman video workflow reconciliation failed: ${formatError(error)}`);
            });
          }
        },
        onStageSucceeded(stage) {
          const completedJob = creatorService.getJob(stage.jobId);
          if (completedJob !== undefined) {
            const project = projectManager.getProject(completedJob.projectId);
            if (project !== undefined) {
              void publishCreatorArtifacts({
                job: completedJob,
                project,
                outputRoot: openCreatorSettingsStore.readStorage().settings.outputRoot
              }).catch(error => {
                console.warn(`Creator artifact publication failed: ${formatError(error)}`);
              });
            }
          }
          void coverWorkflow?.handleStageChanged(stage).catch(error => {
            console.warn(`Cover workflow continuation failed: ${formatError(error)}`);
          });
          void videoTranslationWorkflow?.handleStageChanged(stage).catch(error => {
            console.warn(`Video translation workflow continuation failed: ${formatError(error)}`);
          });
          void stickmanVideoWorkflow?.handleStageChanged(stage).catch(error => {
            console.warn(`Stickman video workflow continuation failed: ${formatError(error)}`);
          });
          void autoClipWorkflow?.handleStageChanged(stage).catch(error => {
            console.warn(`Video clip workflow continuation failed: ${formatError(error)}`);
          });
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
      void stickmanVideoWorkflow?.handleAction(
        result.job,
        result.commandReceipt.command
      ).catch(error => {
        console.warn(`Stickman video action continuation failed: ${formatError(error)}`);
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
  coverWorkflow = creatorStageRunner === undefined
    ? undefined
    : createCoverWorkflow({
        creator: creatorService,
        dispatcher: creatorCommandDispatcher,
        configStore: creatorServicesConfigStore
      });
  stickmanVideoWorkflow = creatorStageRunner === undefined
    ? undefined
    : createStickmanVideoWorkflow({
        creator: creatorService,
        dispatcher: creatorCommandDispatcher,
        configStore: creatorServicesConfigStore,
        repository: creatorRepository,
        providerLedger: creatorProviderRequestLedger
      });
  autoClipWorkflow = creatorStageRunner === undefined
    ? undefined
    : createAutoClipWorkflow({
        creator: creatorService,
        dispatcher: creatorCommandDispatcher
      });
  void coverWorkflow?.recover().catch(error => {
    console.warn(`Cover workflow recovery failed: ${formatError(error)}`);
  });
  void videoTranslationWorkflow?.recover().catch(error => {
    console.warn(`Video translation workflow recovery failed: ${formatError(error)}`);
  });
  void stickmanVideoWorkflow?.recover().catch(error => {
    console.warn(`Stickman video workflow recovery failed: ${formatError(error)}`);
  });
  void autoClipWorkflow?.recover().catch(error => {
    console.warn(`Video clip workflow recovery failed: ${formatError(error)}`);
  });
  const scheduleRunInjector = createAgentScheduleRunInjector({
    capabilities: agentCapabilityTokens,
    getBaseUrl: getAgentToolBaseUrl,
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
    issueService: creatorIssueService,
    preflight: creatorPreflight,
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
  const codexMcpRuntimeInjector = createCodexMcpRuntimeInjector({
    codexHome
  });
  const agentToolInjector = combineRunInjectors(
    scheduleRunInjector,
    codexMcpRuntimeInjector
  );
  persistentAppServerExecutor =
    input.runManager === undefined
    && input.persistentAppServerEnabled !== false
    && runtimeTransport === 'app-server'
      ? createPersistentAppServerExecutor({
          codexBin,
          codexHome,
          runtimeManager: appServerRuntimeManager,
          runtimeInjector: codexMcpRuntimeInjector
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
  const initialAttachmentCleanup = attachmentService.cleanupExpiredDrafts()
    .then(() => undefined)
    .catch(error => {
      console.warn(`Initial attachment cleanup failed: ${formatError(error)}`);
    });
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
      return reply
        .code(413)
        .send(apiError('ATTACHMENT_TOO_LARGE', 'Attachment exceeds the configured size limit'));
    }
    throw error;
  });

  server.addHook('onListen', () => {
    if (
      startKrillinVerification === undefined
      || !hasKrillinRuntimeVerificationWorker()
    ) return;
    krillinVerificationTimer = setTimeout(() => {
      krillinVerificationTimer = undefined;
      void startKrillinVerification?.();
    }, KRILLIN_VERIFICATION_BACKGROUND_DELAY_MS);
    krillinVerificationTimer.unref();
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
    await capture(() => {
      if (krillinVerificationTimer !== undefined) clearTimeout(krillinVerificationTimer);
    });
    await capture(() => initialAttachmentCleanup);
    await capture(() => unsubscribeApprovalNotifications());
    await capture(() => scheduler.stop());
    await capture(() => runManager.close());
    await capture(() => appServerRuntimeManager?.close());
    await capture(() => creatorAppServerRuntimeManager?.close());
    await capture(() => stickmanContentRuntimeManager?.close());
    await capture(() => krillinCodexLlmGateway.close());
    await capture(() => codexSessionProvider.close());
    await capture(() => codexModelCatalog.close());
    await capture(() => codexControlClient.close());
    await capture(() => creatorStageScheduler?.close());
    await capture(() => creatorStageRunner?.close());
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
    if (request.url.startsWith(`${KRILLIN_LLM_ROUTE_PREFIX}/`)) return;
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
  await krillinCodexLlmGateway.register(server);
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
  await registerCleanupRoutes(server, cleanupService);
  await registerSettingsRoutes(server, openCreatorSettingsStore);
  await registerCreatorServicesRoutes(
    server,
    creatorServicesConfigStore,
    () => krillinDependencyLoader.capabilities(),
    krillinTtsService,
    async () => {
      await videoTranslationWorkflow?.resumeConfiguredJobs();
      await coverWorkflow?.resumeConfiguredJobs();
      await stickmanVideoWorkflow?.resumeConfiguredJobs();
    }
  );
  await registerSmartDubbingRoutes(server, smartDubbingService);
  await registerChannelRoutes(server, createChannelPipelineService({
    repoPath: input.channelRepoPath
  }));
  await registerCreatorRuntimeRoutes(server, creatorYtDlpUpdateManager);
  await registerImageGenerationRoutes(server, imageGenerationService);
  await registerCreatorRoutes(server, creatorService, creatorEvents, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    jobsRoot: creatorJobsRoot,
    agentService: creatorAgentService,
    coverWorkflow,
    videoTranslationWorkflow,
    stickmanVideoWorkflow,
    stickmanVisualAssets,
    projectCoverService: creatorProjectCoverService,
    referenceImageUploadService: creatorReferenceImageUploadService,
    sourceUploadService: creatorSourceUploadService,
    documentUploadService: creatorDocumentUploadService,
    artifactImportService: creatorArtifactImportService,
    dispatcher: creatorCommandDispatcher,
    stageRunner: creatorStageRunner,
    presets: creatorPresetRegistry,
    presetCatalogRoot: creatorPresetCatalogRoot,
    preflight: creatorPreflight,
    issueService: creatorIssueService
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
