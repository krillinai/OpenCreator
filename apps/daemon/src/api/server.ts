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
import { createKrillinTtsService } from '../creator/krillin/tts-service.js';
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
import { createClipExecutor } from '../creator/clip/executor.js';
import { createStickmanExecutor } from '../creator/stickman/executor.js';
import { createSmartDubbingExecutor } from '../creator/smart-dubbing/executor.js';
import { createCreatorProjectCoverService } from '../creator/project-cover.js';
import {
  createCreatorReferenceImageUploadService,
  type CreatorReferenceImageUploadService
} from '../creator/reference-image-upload.js';
import {
  createCreatorSourceUploadService,
  type CreatorSourceUploadService
} from '../creator/source-upload.js';
import { createCreatorArtifactImportService } from '../creator/artifact-import.js';
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
import { removeEmptyLegacyDataDirectories } from '../config/product-data-migration.js';
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
import { registerDiagnosticsRoutes } from './routes.diagnostics.js';
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
import { registerVideoGenerationRoutes } from './routes.video-generation.js';
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
  creatorReferenceImageUploadService?: CreatorReferenceImageUploadService;
  creatorReferenceImageMaxSizeBytes?: number;
  creatorSourceUploadService?: CreatorSourceUploadService;
  creatorSourceMediaProbe?(path: string): Promise<MediaProbe>;
  creatorSourceMaxSizeBytes?: number;
  creatorYtDlpPath?: string;
  creatorYtDlpUpdateManager?: YtDlpUpdateManager;
  creatorExecutors?: CreatorExecutor[];
  creatorAgentRuntime?: AgentRuntimeAdapter;
  allowedWebOrigins?: string[];
};

const ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export async function buildServer(input: BuildServerInput) {
  const server = Fastify({ logger: false });
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
  const notificationService = createNotificationService({ db });
  const approvalManager = input.approvalManager ?? createApprovalManager({ db });
  const unsubscribeApprovalNotifications = approvalManager.subscribe(approval => {
    if (approval.status === 'pending') {
      notificationService.enqueueApproval(approval.id);
    }
  });
  const memoryService = createMemoryService({ db });
  const openCreatorSettingsStore = createOpenCreatorSettingsStore(configFile);
  const storedCreatorServicesConfigStore =
    input.creatorServicesConfigStore ?? (
      input.credentialsFile === undefined
        ? createFileCreatorServicesConfigStore(
            join(dataDir, 'config', 'creator-services.json')
          )
        : createOpenCreatorCreatorServicesConfigStore({
            configFile,
            credentialsFile: input.credentialsFile,
            legacyFile: join(dataDir, 'config', 'creator-services.json')
          })
    );
  const codexProviderCredentialStore =
    input.codexProviderCredentialStore ?? (
      input.credentialsFile === undefined
        ? createFileCodexProviderCredentialStore(
            join(dataDir, 'config', 'codex-provider.json')
          )
        : createOpenCreatorCodexProviderCredentialStore(
            input.credentialsFile,
            join(dataDir, 'config', 'codex-provider.json')
        )
    );
  if (input.credentialsFile !== undefined) {
    await Promise.all([
      storedCreatorServicesConfigStore.read(),
      codexProviderCredentialStore.readApiKey()
    ]);
    removeEmptyLegacyDataDirectories(dataDir);
  }
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
    ?? join(runtimeDir, 'krillinai');
  const creatorJobsRoot = join(creatorDir, 'jobs');
  const krillinDependencyLoader = createKrillinDependencyLoader({
    root: join(runtimeDir, 'krillinai', 'dependencies')
  });
  const krillinTtsService = createKrillinTtsService({
    resourceRoot: creatorRuntimeRoot,
    workRoot: join(creatorJobsRoot, '.tts'),
    configStore: creatorServicesConfigStore
  });
  const smartDubbingService = createSmartDubbingService({
    dataDir,
    ttsService: krillinTtsService
  });
  const creatorExecutors: CreatorExecutor[] = input.creatorExecutors ?? [];
  let creatorFfmpegPath: string | undefined;
  let creatorFfprobePath: string | undefined;
  let creatorYtDlpUpdateManager = input.creatorYtDlpUpdateManager;
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
    const getYtDlpRuntime = () =>
      creatorYtDlpUpdateManager?.getRuntime() ?? ytDlp;
    if (input.creatorExecutors === undefined) {
      creatorExecutors.push(createKrillinExecutor({
        resourceRoot: creatorRuntimeRoot,
        jobsRoot: creatorJobsRoot,
        dependencyLoader: krillinDependencyLoader,
        configStore: creatorServicesConfigStore,
        getYtDlpRuntime
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
        getYtDlpRuntime: () => getYtDlpRuntime()!,
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
        getYtDlpRuntime: () => getYtDlpRuntime()!
      }));
    }
    if (input.creatorExecutors === undefined && creatorFfmpegPath && creatorFfprobePath) {
      creatorExecutors.push(
        createClipExecutor({ configStore: creatorServicesConfigStore, ffmpegPath: creatorFfmpegPath, ffprobePath: creatorFfprobePath }),
        createStickmanExecutor({ configStore: creatorServicesConfigStore, ffmpegPath: creatorFfmpegPath, ffprobePath: creatorFfprobePath })
      );
    }
  } catch (error) {
    console.warn(`Creator optional runtime executors are unavailable: ${formatError(error)}`);
  }
  if (input.creatorExecutors === undefined) {
    creatorExecutors.push(createSmartDubbingExecutor({
      ttsService: krillinTtsService
    }));
    creatorExecutors.push(createImageExecutor({
      configStore: creatorServicesConfigStore,
      ...(creatorFfmpegPath === undefined
        ? {}
        : {
            normalizeCoverImage: createFfmpegCoverImageNormalizer(
              creatorFfmpegPath
            )
          })
    }));
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
  const creatorReferenceImageUploadService = input.creatorReferenceImageUploadService
    ?? createCreatorReferenceImageUploadService({
        jobsRoot: creatorJobsRoot,
        creator: creatorService,
        maxSizeBytes: input.creatorReferenceImageMaxSizeBytes
      });
  const creatorArtifactImportService = createCreatorArtifactImportService({
    jobsRoot: creatorJobsRoot,
    creator: creatorService
  });
  let coverWorkflow: CoverWorkflow | undefined;
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
          void coverWorkflow?.handleStageChanged(stage).catch(error => {
            console.warn(`Cover workflow continuation failed: ${formatError(error)}`);
          });
          void videoTranslationWorkflow?.handleStageChanged(stage).catch(error => {
            console.warn(`Video translation workflow continuation failed: ${formatError(error)}`);
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
  void coverWorkflow?.recover().catch(error => {
    console.warn(`Cover workflow recovery failed: ${formatError(error)}`);
  });
  void videoTranslationWorkflow?.recover().catch(error => {
    console.warn(`Video translation workflow recovery failed: ${formatError(error)}`);
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
    }
  );
  await registerSmartDubbingRoutes(server, smartDubbingService);
  await registerCreatorRuntimeRoutes(server, creatorYtDlpUpdateManager);
  await registerCreatorRoutes(server, creatorService, creatorEvents, {
    sseHeartbeatMs: input.sseHeartbeatMs,
    jobsRoot: creatorJobsRoot,
    agentService: creatorAgentService,
    coverWorkflow,
    videoTranslationWorkflow,
    projectCoverService: creatorProjectCoverService,
    referenceImageUploadService: creatorReferenceImageUploadService,
    sourceUploadService: creatorSourceUploadService,
    artifactImportService: creatorArtifactImportService,
    dispatcher: creatorCommandDispatcher,
    stageRunner: creatorStageRunner
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
