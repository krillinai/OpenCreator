import type {
  CodexMcpListResponse,
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  CreateThreadRequest,
  RunDiagnosticsResponse,
  RunResponse,
  SandboxMode,
  ThreadHistoryItem,
  ThreadResponse
} from '@clawee/protocol';
import { skillMarketCatalog } from '@clawee/skill-market';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import Lightfall from '../components/effects/Lightfall.js';
import { Timeline } from '../components/timeline/Timeline.js';
import { eventToTimelineItem, type TimelineItem } from '../components/timeline/timeline-model.js';
import { CapabilitiesView } from '../features/capabilities/CapabilitiesView.js';
import type { CapabilitiesViewProps } from '../features/capabilities/CapabilitiesView.js';
import { ConversationEmptyState } from '../features/conversation/ConversationEmptyState.js';
import { ConversationHeader } from '../features/conversation/ConversationHeader.js';
import { DetailPanel } from '../features/details/DetailPanel.js';
import { FileWorkspaceView } from '../features/files/FileWorkspaceView.js';
import { getSkillMarketDisplayTitle } from '../features/plugins/skill-market-model.js';
import {
  SkillMarketView,
  type SkillMarketOperation,
  type SkillMarketUseError
} from '../features/plugins/SkillMarketView.js';
import { createDefaultProjects, findProjectById, type ClaweeConversation, type ClaweeProject } from '../features/projects/project-model.js';
import { Composer, type ComposerDraftRequest, type ComposerRunConfig, type ComposerSlashCommand } from '../features/runs/Composer.js';
import { ClaweeSettingsView, type RuntimeStatus } from '../features/settings/ClaweeSettingsView.js';
import { ClaweeSidebar } from '../features/shell/ClaweeSidebar.js';
import { browserBridge } from '../host/browser-bridge.js';
import type { HostBridge } from '../host/bridge.js';
import { RuntimeClient } from '../runtime/client.js';
import { subscribeRunEvents as defaultSubscribeRunEvents, type SubscribeRunEventsInput } from '../runtime/sse.js';
import type { ConnectionConfig } from '../runtime/types.js';
import { createCapabilityService } from '../services/capability-service.js';
import { createConnectionService, type ConnectionState } from '../services/connection-service.js';
import { createDiagnosticsService } from '../services/diagnostics-service.js';
import { createMockFileService } from '../services/file-service.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import { createMockProjectService } from '../services/project-service.js';
import { createRunService } from '../services/run-service.js';
import { createSkillMarketService } from '../services/skill-market-service.js';
import { createThreadService } from '../services/thread-service.js';
import { createWorkspaceFileService } from '../services/workspace-file-service.js';
import { initialAppState, reduceAppState } from './app-state.js';

type AppFileService = {
  listTree(): Promise<FileTreeNode[]>;
  openFile(path: string): Promise<WorkspaceFile>;
  saveFile(path: string, content: string): Promise<WorkspaceFile>;
};

type CapabilityService = ReturnType<typeof createCapabilityService>;
type SkillMarketService = ReturnType<typeof createSkillMarketService>;
type ThreadService = ReturnType<typeof createThreadService>;

const CONVERSATION_PANE_MIN_WIDTH = 320;
const FILE_WORKSPACE_MIN_WIDTH = 520;
const RESIZE_KEY_STEP = 32;
const CONVERSATION_LIGHTFALL_COLORS = ['#AD4D1F', '#D86532', '#F0A866'];
const DYNAMIC_BACKGROUND_STORAGE_KEY = 'clawee.preferences.dynamicBackground';

export type AppProps = {
  fileService?: AppFileService;
  capabilitiesView?: CapabilitiesViewProps;
  hostBridge?: HostBridge;
  runtimeFetch?: typeof fetch;
  subscribeRunEvents?: (input: SubscribeRunEventsInput) => Promise<void>;
};

export function App(props: AppProps = {}) {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const baseProjects = useMemo(() => createDefaultProjects(), []);
  const defaultFileService = useMemo(() => createMockFileService(), []);
  const fileService = props.fileService ?? defaultFileService;
  const hostBridge = props.hostBridge ?? browserBridge;
  const runtimeFetch = useMemo(() => props.runtimeFetch ?? globalThis.fetch.bind(globalThis), [props.runtimeFetch]);
  const subscribeRunEvents = props.subscribeRunEvents ?? defaultSubscribeRunEvents;
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [treeLoadError, setTreeLoadError] = useState<string>();
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [connectionConfig, setConnectionConfig] = useState<ConnectionConfig | null>(null);
  const [runtimeThreads, setRuntimeThreads] = useState<ThreadResponse[]>([]);
  const [threadLoadError, setThreadLoadError] = useState<string>();
  const [threadHistoryLoadError, setThreadHistoryLoadError] = useState<string>();
  const [historyLoadingThreadId, setHistoryLoadingThreadId] = useState<string>();
  const [threadConfigUpdateError, setThreadConfigUpdateError] = useState<string>();
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    message: '正在等待本地服务'
  });
  const [runDiagnosticsById, setRunDiagnosticsById] = useState<Record<string, RunDiagnosticsResponse | undefined>>({});
  const [composerRunConfig, setComposerRunConfig] = useState<ComposerRunConfig | null>(null);
  const [codexSkills, setCodexSkills] = useState<CodexSkillListResponse>();
  const [codexMcp, setCodexMcp] = useState<CodexMcpListResponse>();
  const [skillMarketInstallRecords, setSkillMarketInstallRecords] = useState<CodexSkillMarketInstallRecordResponse[]>();
  const [skillMarketLoading, setSkillMarketLoading] = useState(false);
  const [skillMarketLoadError, setSkillMarketLoadError] = useState<string>();
  const [skillMarketOperation, setSkillMarketOperation] = useState<SkillMarketOperation>();
  const [skillMarketUseError, setSkillMarketUseError] = useState<SkillMarketUseError>();
  const [pendingComposerDraft, setPendingComposerDraft] = useState<
    { threadId: string; request: ComposerDraftRequest } | undefined
  >();
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [capabilitiesLoadError, setCapabilitiesLoadError] = useState<string>();
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [savedFileByPath, setSavedFileByPath] = useState<Record<string, WorkspaceFile>>({});
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string>(state.selectedFilePath);
  const [loadErrorByPath, setLoadErrorByPath] = useState<Record<string, string | undefined>>({});
  const [saveErrorByPath, setSaveErrorByPath] = useState<Record<string, string | undefined>>({});
  const [savingFilePaths, setSavingFilePaths] = useState<Set<string>>(() => new Set());
  const [conversationPaneWidth, setConversationPaneWidth] = useState<number>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dynamicBackgroundEnabled, setDynamicBackgroundEnabled] = useState(readDynamicBackgroundPreference);
  const [threadHistoryReloadKey, setThreadHistoryReloadKey] = useState(0);
  const projectService = useMemo(() => createMockProjectService(), []);
  const timelineIdSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const selectedFilePathRef = useRef(state.selectedFilePath);
  const savedFileByPathRef = useRef<Record<string, WorkspaceFile>>({});
  const draftContentByPathRef = useRef<Record<string, string>>({});
  const openRequestByPathRef = useRef<Record<string, number>>({});
  const fileRevisionByPathRef = useRef<Record<string, number>>({});
  const savingFilePathsRef = useRef(new Set<string>());
  const connectionConfigRef = useRef<ConnectionConfig | null>(null);
  const connectionConfigVersionRef = useRef(0);
  const sseAbortControllerRef = useRef<AbortController | null>(null);
  const conversationBodyRef = useRef<HTMLDivElement | null>(null);
  const conversationFileLayoutRef = useRef<HTMLElement | null>(null);
  const allowInitialRuntimeProjectFocusRef = useRef(true);
  const skipNextHistoryLoadForThreadRef = useRef<string>();
  const skillMarketMutationInFlightRef = useRef(false);
  const skillMarketUseInFlightRef = useRef(false);
  const skillMarketRuntimeGenerationRef = useRef(0);
  const capabilityServiceRef = useRef<CapabilityService | null>(null);
  const skillMarketServiceRef = useRef<SkillMarketService | null>(null);
  const threadServiceRef = useRef<ThreadService | null>(null);
  const connectionStatusRef = useRef<ConnectionState['status']>(connectionState.status);
  const nextComposerDraftIdRef = useRef(0);

  const runtimeClient = useMemo(
    () => connectionConfig === null ? null : new RuntimeClient({ ...connectionConfig, fetchImpl: runtimeFetch }),
    [connectionConfig, runtimeFetch]
  );
  const connectionService = useMemo(
    () => runtimeClient === null ? null : createConnectionService(runtimeClient),
    [runtimeClient]
  );
  const runService = useMemo(() => runtimeClient === null ? null : createRunService(runtimeClient), [runtimeClient]);
  const threadService = useMemo(
    () => runtimeClient === null ? null : createThreadService(runtimeClient),
    [runtimeClient]
  );
  const diagnosticsService = useMemo(
    () => runtimeClient === null ? null : createDiagnosticsService(runtimeClient),
    [runtimeClient]
  );
  const capabilityService = useMemo(
    () => runtimeClient === null ? null : createCapabilityService(runtimeClient),
    [runtimeClient]
  );
  const skillMarketService = useMemo(
    () => runtimeClient === null ? null : createSkillMarketService(runtimeClient),
    [runtimeClient]
  );
  const workspaceFileService = useMemo(
    () => runtimeClient === null ? null : createWorkspaceFileService(runtimeClient),
    [runtimeClient]
  );
  const visibleRuntimeThreads = useMemo(
    () => runtimeThreads.filter(shouldShowThreadInSidebar),
    [runtimeThreads]
  );
  const projects = useMemo(() => createProjectsForThreads(baseProjects, visibleRuntimeThreads), [baseProjects, visibleRuntimeThreads]);
  const conversations = useMemo(
    () => visibleRuntimeThreads.map(thread => mapThreadToConversation(thread, projects)),
    [visibleRuntimeThreads, projects]
  );
  const selectedThreadExists = state.selectedThreadId !== undefined
    && runtimeThreads.some(thread => thread.id === state.selectedThreadId);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      sseAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    selectedFilePathRef.current = state.selectedFilePath;
  }, [state.selectedFilePath]);

  useEffect(() => {
    connectionConfigRef.current = connectionConfig;
  }, [connectionConfig]);

  useEffect(() => {
    let canceled = false;
    const loadVersion = connectionConfigVersionRef.current;

    readHostRuntimeConfig(loadVersion, () => canceled);

    return () => {
      canceled = true;
    };
  }, [hostBridge]);

  useEffect(() => {
    let canceled = false;

    fileService
      .listTree()
      .then(nodes => {
        if (!canceled) {
          setTreeNodes(nodes);
          setTreeLoadError(undefined);
        }
      })
      .catch(() => {
        if (!canceled) setTreeLoadError('无法加载项目文件');
      });

    return () => {
      canceled = true;
    };
  }, [fileService]);

  useEffect(() => {
    void projectService.getDefaultProject().catch(() => undefined);
  }, [projectService]);

  useEffect(() => {
    let canceled = false;

    if (connectionService === null) {
      setConnectionState({ status: 'disconnected', message: '正在等待本地服务' });
      return () => {
        canceled = true;
      };
    }

    connectionService
      .check()
      .then(nextState => {
        if (canceled) return;
        setConnectionState(nextState);
      })
      .catch(() => {
        if (canceled) return;
        setConnectionState({ status: 'disconnected', message: '本地服务连接失败' });
      });

    return () => {
      canceled = true;
    };
  }, [connectionService]);

  useEffect(() => {
    let canceled = false;

    if (connectionState.status !== 'connected' || threadService === null) {
      if (connectionState.status !== 'connected') setRuntimeThreads([]);
      return () => {
        canceled = true;
      };
    }

    threadService
      .listActiveThreads()
      .then(response => {
        if (canceled) return;
        setRuntimeThreads(response.threads);
        setThreadLoadError(undefined);
      })
      .catch(() => {
        if (canceled) return;
        setThreadLoadError('无法加载历史会话');
      });

    return () => {
      canceled = true;
    };
  }, [connectionState.status, threadService]);

  useEffect(() => {
    connectionStatusRef.current = connectionState.status;
    capabilityServiceRef.current = capabilityService;
    skillMarketServiceRef.current = skillMarketService;
    threadServiceRef.current = threadService;
    skillMarketRuntimeGenerationRef.current += 1;
    skillMarketMutationInFlightRef.current = false;
    skillMarketUseInFlightRef.current = false;
    setSkillMarketOperation(undefined);
    setSkillMarketUseError(undefined);
  }, [capabilityService, connectionState.status, skillMarketService, threadService]);

  useEffect(() => {
    let canceled = false;

    if (connectionState.status !== 'connected' || capabilityService === null || skillMarketService === null) {
      skillMarketMutationInFlightRef.current = false;
      skillMarketUseInFlightRef.current = false;
      setCodexSkills(undefined);
      setCodexMcp(undefined);
      setSkillMarketInstallRecords(undefined);
      setCapabilitiesLoading(false);
      setSkillMarketLoading(false);
      setCapabilitiesLoadError(undefined);
      setSkillMarketLoadError(undefined);
      setSkillMarketOperation(undefined);
      setSkillMarketUseError(undefined);
      return () => {
        canceled = true;
      };
    }

    setCapabilitiesLoading(true);
    setSkillMarketLoading(true);
    setCodexSkills(undefined);
    setSkillMarketInstallRecords(undefined);
    setCapabilitiesLoadError(undefined);
    setSkillMarketLoadError(undefined);
    const generation = skillMarketRuntimeGenerationRef.current;
    const activeCapabilityService = capabilityService;
    const activeSkillMarketService = skillMarketService;

    Promise.allSettled([
      Promise.resolve().then(() => activeCapabilityService.listSkills()),
      Promise.resolve().then(() => activeCapabilityService.listMcp()),
      Promise.resolve().then(() => activeSkillMarketService.listInstallRecords())
    ])
      .then(results => {
        if (canceled || !isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) return;
        const [skillsResult, mcpResult, recordsResult] = results;
        if (skillsResult?.status === 'fulfilled') setCodexSkills(skillsResult.value);
        else setCodexSkills(undefined);
        if (mcpResult?.status === 'fulfilled') setCodexMcp(mcpResult.value);
        else setCodexMcp(undefined);
        if (recordsResult?.status === 'fulfilled') setSkillMarketInstallRecords(recordsResult.value.records);
        else setSkillMarketInstallRecords(undefined);
        if (skillsResult?.status === 'rejected' || mcpResult?.status === 'rejected') {
          setCapabilitiesLoadError('本机能力检测失败');
        }
        const marketErrors: string[] = [];
        if (skillsResult?.status === 'rejected') marketErrors.push('Skill 状态加载失败');
        if (recordsResult?.status === 'rejected') marketErrors.push('安装记录加载失败');
        setSkillMarketLoadError(marketErrors.length > 0 ? marketErrors.join('；') : undefined);
      })
      .finally(() => {
        if (!canceled && isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
          setCapabilitiesLoading(false);
          setSkillMarketLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [capabilityService, connectionState.status, skillMarketService]);

  useEffect(() => {
    if (!allowInitialRuntimeProjectFocusRef.current) return;
    if (state.activeView !== 'conversation' || state.selectedThreadId !== undefined) return;
    if (conversations.length === 0) return;

    const currentProjectHasHistory = conversations.some(
      conversation => conversation.projectId === state.currentProjectId
    );
    if (currentProjectHasHistory) {
      allowInitialRuntimeProjectFocusRef.current = false;
      return;
    }

    const firstRuntimeProjectId = conversations[0]?.projectId;
    if (firstRuntimeProjectId === undefined || firstRuntimeProjectId === state.currentProjectId) return;

    allowInitialRuntimeProjectFocusRef.current = false;
    dispatch({ type: 'select_project', projectId: firstRuntimeProjectId });
  }, [conversations, state.activeView, state.currentProjectId, state.selectedThreadId]);

  useEffect(() => {
    let canceled = false;
    const selectedThreadId = state.selectedThreadId;

    if (selectedThreadId === undefined || threadService === null || connectionState.status !== 'connected') {
      setThreadHistoryLoadError(undefined);
      setHistoryLoadingThreadId(undefined);
      return () => {
        canceled = true;
      };
    }

    if (!selectedThreadExists) {
      setHistoryLoadingThreadId(undefined);
      return () => {
        canceled = true;
      };
    }
    if (skipNextHistoryLoadForThreadRef.current === selectedThreadId) {
      skipNextHistoryLoadForThreadRef.current = undefined;
      setHistoryLoadingThreadId(undefined);
      return () => {
        canceled = true;
      };
    }

    setHistoryLoadingThreadId(selectedThreadId);
    setTimelineItems(previous => hasOnlyHistoryLoadingTimelineItem(previous)
      ? [createHistoryLoadingTimelineItem(selectedThreadId)]
      : previous.length === 0
        ? [createHistoryLoadingTimelineItem(selectedThreadId)]
        : previous
    );
    setThreadHistoryLoadError(undefined);

    threadService
      .getThreadHistory(selectedThreadId)
      .then(response => {
        if (canceled) return;
        if (response.codexThreadId !== undefined && response.codexThreadId !== null) {
          setRuntimeThreads(previous => {
            let changed = false;
            const nextThreads = previous.map(thread => {
              if (thread.id !== response.threadId || thread.codexThreadId === response.codexThreadId) return thread;
              changed = true;
              return { ...thread, codexThreadId: response.codexThreadId };
            });
            return changed ? nextThreads : previous;
          });
        }
        setTimelineItems(mapHistoryItemsToTimelineItems(response.items));
        setThreadHistoryLoadError(undefined);
        setHistoryLoadingThreadId(undefined);
      })
      .catch(() => {
        if (canceled) return;
        setTimelineItems([]);
        setThreadHistoryLoadError('无法加载聊天历史');
        setHistoryLoadingThreadId(undefined);
      });

    return () => {
      canceled = true;
    };
  }, [connectionState.status, state.selectedThreadId, selectedThreadExists, threadHistoryReloadKey, threadService]);

  useEffect(() => {
    const body = conversationBodyRef.current;
    if (body === null) return;
    if (typeof body.scrollTo === 'function') {
      body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [timelineItems.length]);

  useEffect(() => {
    const path = state.selectedFilePath;
    const requestId = (openRequestByPathRef.current[path] ?? 0) + 1;
    const openRevision = fileRevisionByPathRef.current[path] ?? 0;
    openRequestByPathRef.current[path] = requestId;

    setLoadingFilePath(path);
    setLoadErrorByPath(previous => ({ ...previous, [path]: undefined }));

    fileService
      .openFile(path)
      .then(file => {
        if (
          !mountedRef.current ||
          openRequestByPathRef.current[path] !== requestId ||
          openRevision !== (fileRevisionByPathRef.current[path] ?? 0)
        ) {
          return;
        }

        const previousSavedFile = savedFileByPathRef.current[path];
        const hasExistingDraft = hasOwnPath(draftContentByPathRef.current, path);
        const existingDraft = draftContentByPathRef.current[path];
        const shouldRefreshDraft =
          !hasExistingDraft || (previousSavedFile !== undefined && existingDraft === previousSavedFile.content);

        const nextSavedFiles = { ...savedFileByPathRef.current, [path]: file };
        savedFileByPathRef.current = nextSavedFiles;
        setSavedFileByPath(nextSavedFiles);

        if (shouldRefreshDraft) {
          const nextDrafts = { ...draftContentByPathRef.current, [path]: file.content };
          draftContentByPathRef.current = nextDrafts;
          setDraftContentByPath(nextDrafts);
        }
        setLoadErrorByPath(previous => ({ ...previous, [path]: undefined }));

        if (selectedFilePathRef.current === path) {
          setLoadingFilePath('');
        }
      })
      .catch(() => {
        if (
          !mountedRef.current ||
          openRequestByPathRef.current[path] !== requestId ||
          openRevision !== (fileRevisionByPathRef.current[path] ?? 0)
        ) {
          return;
        }

        setLoadErrorByPath(previous => ({ ...previous, [path]: '无法加载文件' }));
        if (selectedFilePathRef.current === path) {
          setLoadingFilePath('');
        }
      });
  }, [fileService, state.selectedFilePath]);

  const selectedFilePath = state.selectedFilePath;
  const currentFile = savedFileByPath[selectedFilePath];
  const selectedDraftContent = draftContentByPath[selectedFilePath] ?? currentFile?.content ?? '';
  const loadingSelectedFile = loadingFilePath === selectedFilePath && currentFile === undefined;
  const loadError = loadErrorByPath[selectedFilePath];
  const saveError = saveErrorByPath[selectedFilePath];
  const runDiagnostics = state.selectedRunId === undefined ? undefined : runDiagnosticsById[state.selectedRunId];
  const currentProject = findProjectById(projects, state.currentProjectId) ?? projects[0];
  const currentProjectName = currentProject?.name ?? 'content-design';
  const selectedConversation = conversations.find(conversation => conversation.id === state.selectedThreadId);
  const selectedThread = runtimeThreads.find(thread => thread.id === state.selectedThreadId);
  const runtimeStatus = mapRuntimeStatus(connectionState);
  const slashCommands = useMemo(
    () => buildComposerSlashCommands(codexSkills, codexMcp),
    [codexSkills, codexMcp]
  );

  function handleEditorContentChange(content: string) {
    const path = selectedFilePathRef.current;
    const nextDrafts = { ...draftContentByPathRef.current, [path]: content };
    draftContentByPathRef.current = nextDrafts;
    setDraftContentByPath(nextDrafts);
    setSaveErrorByPath(previous => ({ ...previous, [path]: undefined }));
  }

  function setFileSaving(path: string, saving: boolean) {
    const nextSavingPaths = new Set(savingFilePathsRef.current);
    if (saving) {
      nextSavingPaths.add(path);
    } else {
      nextSavingPaths.delete(path);
    }

    savingFilePathsRef.current = nextSavingPaths;
    setSavingFilePaths(nextSavingPaths);
  }

  function bumpFileRevision(path: string) {
    fileRevisionByPathRef.current[path] = (fileRevisionByPathRef.current[path] ?? 0) + 1;
  }

  function createTimelineId(prefix: string) {
    timelineIdSequenceRef.current += 1;
    return `${prefix}_${Date.now()}_${timelineIdSequenceRef.current}`;
  }

  function readHostRuntimeConfig(loadVersion: number, isCanceled: () => boolean) {
    hostBridge
      .readConnectionConfig()
      .then(config => {
        if (!isCanceled() && connectionConfigVersionRef.current === loadVersion) setConnectionConfig(config);
      })
      .catch(() => {
        if (!isCanceled() && connectionConfigVersionRef.current === loadVersion) setConnectionConfig(null);
      });
  }

  function retryRuntimeConnection() {
    connectionConfigVersionRef.current += 1;
    const loadVersion = connectionConfigVersionRef.current;
    setConnectionConfig(null);
    setConnectionState({ status: 'disconnected', message: '正在等待本地服务' });
    readHostRuntimeConfig(loadVersion, () => false);
  }

  function handleDynamicBackgroundChange(enabled: boolean) {
    setDynamicBackgroundEnabled(enabled);
    writeDynamicBackgroundPreference(enabled);
  }

  function submitPrompt(prompt: string, config?: ComposerRunConfig) {
    if (
      connectionState.status === 'connected'
      && runService !== null
      && threadService !== null
      && connectionConfigRef.current !== null
    ) {
      void submitRuntimePrompt(prompt, config);
      return;
    }

    setTimelineItems(previous => [
      ...previous,
      {
        kind: 'diagnostic',
        id: createTimelineId('runtime_not_connected'),
        severity: 'error',
        message: '本地运行内核尚未连接，无法发送任务。',
        content: getConnectionStatusLabel(connectionState),
        source: 'runtime'
      }
    ]);
  }

  function startNewConversation() {
    allowInitialRuntimeProjectFocusRef.current = false;
    sseAbortControllerRef.current?.abort();
    setTimelineItems([]);
    setHistoryLoadingThreadId(undefined);
    setRuntimeBusy(false);
    setThreadConfigUpdateError(undefined);
    dispatch({ type: 'new_conversation' });
  }

  function selectProject(projectId: string) {
    allowInitialRuntimeProjectFocusRef.current = false;
    sseAbortControllerRef.current?.abort();
    setTimelineItems([]);
    setHistoryLoadingThreadId(undefined);
    setRuntimeBusy(false);
    setThreadConfigUpdateError(undefined);
    dispatch({ type: 'select_project', projectId });
  }

  function selectConversation(conversationId: string) {
    allowInitialRuntimeProjectFocusRef.current = false;
    sseAbortControllerRef.current?.abort();
    setRuntimeBusy(false);
    setThreadConfigUpdateError(undefined);
    const conversation = conversations.find(item => item.id === conversationId);
    const alreadySelected = conversationId === state.selectedThreadId;
    if (conversation !== undefined && conversation.projectId !== state.currentProjectId) {
      dispatch({ type: 'select_project', projectId: conversation.projectId });
    }
    if (alreadySelected) {
      if (state.activeView !== 'conversation') {
        dispatch({ type: 'select_thread', threadId: conversationId });
      }
      if (timelineItems.length === 0) {
        setTimelineItems([createHistoryLoadingTimelineItem(conversationId)]);
        setHistoryLoadingThreadId(conversationId);
        setThreadHistoryReloadKey(previous => previous + 1);
      }
      return;
    }

    setHistoryLoadingThreadId(conversationId);
    setTimelineItems(previous => hasOnlyHistoryLoadingTimelineItem(previous)
      ? [createHistoryLoadingTimelineItem(conversationId)]
      : previous.length === 0
        ? [createHistoryLoadingTimelineItem(conversationId)]
        : previous
    );
    dispatch({ type: 'select_thread', threadId: conversationId });
  }

  async function handleComposerPermissionChange(permission: ComposerRunConfig['permission']) {
    const baseConfig = composerRunConfig ?? defaultComposerRunConfig(currentProject);
    setComposerRunConfig({ ...baseConfig, permission });

    if (selectedThread === undefined) {
      setThreadConfigUpdateError(undefined);
      return;
    }

    const sandbox = toRuntimeSandbox(permission);
    if (sandbox === selectedThread.sandbox) {
      setThreadConfigUpdateError(undefined);
      return;
    }
    if (threadService === null) {
      setThreadConfigUpdateError('本地服务暂不可用，无法更新会话访问权限');
      return;
    }

    try {
      const response = await threadService.updateThread(selectedThread.id, { sandbox });
      if (!mountedRef.current) return;
      setRuntimeThreads(previous => upsertThread(previous, response.thread));
      setThreadConfigUpdateError(undefined);
    } catch {
      if (mountedRef.current) {
        setThreadConfigUpdateError('无法更新会话访问权限');
      }
    }
  }

  function isCurrentSkillMarketRuntime(
    generation: number,
    activeCapabilityService: CapabilityService,
    activeSkillMarketService: SkillMarketService
  ) {
    return mountedRef.current
      && skillMarketRuntimeGenerationRef.current === generation
      && connectionStatusRef.current === 'connected'
      && capabilityServiceRef.current === activeCapabilityService
      && skillMarketServiceRef.current === activeSkillMarketService;
  }

  function isCurrentThreadRuntime(generation: number, activeThreadService: ThreadService) {
    return mountedRef.current
      && skillMarketRuntimeGenerationRef.current === generation
      && connectionStatusRef.current === 'connected'
      && threadServiceRef.current === activeThreadService;
  }

  async function refreshSkillMarketState(
    generation: number,
    activeCapabilityService: CapabilityService,
    activeSkillMarketService: SkillMarketService
  ): Promise<void> {
    const [skillsResult, recordsResult] = await Promise.allSettled([
      Promise.resolve().then(() => activeCapabilityService.listSkills()),
      Promise.resolve().then(() => activeSkillMarketService.listInstallRecords())
    ]);
    if (!isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) return;
    const refreshErrors: string[] = [];
    if (skillsResult.status === 'fulfilled') {
      setCodexSkills(skillsResult.value);
    } else {
      setCodexSkills(undefined);
      refreshErrors.push('Skill 状态刷新失败');
    }
    if (recordsResult.status === 'fulfilled') {
      setSkillMarketInstallRecords(recordsResult.value.records);
    } else {
      setSkillMarketInstallRecords(undefined);
      refreshErrors.push('安装记录刷新失败');
    }
    setSkillMarketLoadError(refreshErrors.length > 0 ? refreshErrors.join('；') : undefined);
  }

  async function installMarketSkill(skillId: string) {
    const activeCapabilityService = capabilityService;
    const activeSkillMarketService = skillMarketService;
    if (activeCapabilityService === null || activeSkillMarketService === null || skillMarketMutationInFlightRef.current) return;

    const generation = skillMarketRuntimeGenerationRef.current;
    skillMarketMutationInFlightRef.current = true;
    setSkillMarketOperation({ skillId, kind: 'install' });
    try {
      await activeSkillMarketService.installSkill(skillId);
      await refreshSkillMarketState(generation, activeCapabilityService, activeSkillMarketService);
      if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
        setSkillMarketOperation(undefined);
      }
    } catch (error) {
      if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
        setSkillMarketOperation({
          skillId,
          kind: 'install',
          error: getRuntimeErrorMessage(error, '安装失败，请重试')
        });
      }
    } finally {
      if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
        skillMarketMutationInFlightRef.current = false;
      }
    }
  }

  async function updateMarketSkill(skillId: string) {
    const activeCapabilityService = capabilityService;
    const activeSkillMarketService = skillMarketService;
    if (activeCapabilityService === null || activeSkillMarketService === null || skillMarketMutationInFlightRef.current) return;

    const generation = skillMarketRuntimeGenerationRef.current;
    skillMarketMutationInFlightRef.current = true;
    setSkillMarketOperation({ skillId, kind: 'update' });
    try {
      await activeSkillMarketService.updateSkill(skillId);
      await refreshSkillMarketState(generation, activeCapabilityService, activeSkillMarketService);
      if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
        setSkillMarketOperation(undefined);
      }
    } catch (error) {
      if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
        setSkillMarketOperation({
          skillId,
          kind: 'update',
          error: getRuntimeErrorMessage(error, '更新失败，请重试')
        });
      }
    } finally {
      if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
        skillMarketMutationInFlightRef.current = false;
      }
    }
  }

  async function useMarketSkill(skillId: string) {
    if (skillMarketUseInFlightRef.current) return;
    setSkillMarketUseError(undefined);

    const activeThreadService = threadService;
    if (activeThreadService === null) {
      setSkillMarketUseError({
        skillId,
        error: '本地服务暂不可用，无法创建对话'
      });
      return;
    }

    const entry = getSkillMarketEntry(skillId);
    if (entry === undefined) {
      setSkillMarketUseError({ skillId, error: '未找到这个 Skill' });
      return;
    }

    const project = currentProject;
    const config = effectiveComposerConfig;
    const title = getSkillMarketDisplayTitle(entry);
    const generation = skillMarketRuntimeGenerationRef.current;
    skillMarketUseInFlightRef.current = true;

    try {
      const request = buildThreadRequest(title, project, config);
      const created = await activeThreadService.createThread(request);
      if (!isCurrentThreadRuntime(generation, activeThreadService)) return;

      sseAbortControllerRef.current?.abort();
      setRuntimeThreads(previous => upsertThread(previous, created.thread));
      setTimelineItems([]);
      setThreadHistoryLoadError(undefined);
      setHistoryLoadingThreadId(undefined);
      setRuntimeBusy(false);
      setThreadConfigUpdateError(undefined);
      skipNextHistoryLoadForThreadRef.current = created.thread.id;
      allowInitialRuntimeProjectFocusRef.current = false;
      dispatch({ type: 'select_thread', threadId: created.thread.id });
      nextComposerDraftIdRef.current += 1;
      setPendingComposerDraft({
        threadId: created.thread.id,
        request: {
          id: nextComposerDraftIdRef.current,
          text: `$${skillId} `
        }
      });
    } catch (error) {
      if (isCurrentThreadRuntime(generation, activeThreadService)) {
        setSkillMarketUseError({
          skillId,
          error: getRuntimeErrorMessage(error, '创建对话失败，请重试')
        });
      }
    } finally {
      if (isCurrentThreadRuntime(generation, activeThreadService)) {
        skillMarketUseInFlightRef.current = false;
      }
    }
  }

  async function submitRuntimePrompt(prompt: string, config?: ComposerRunConfig) {
    if (runService === null || threadService === null || connectionConfigRef.current === null) return;
    if (runtimeBusy) return;

    const effectiveConfig = config ?? composerRunConfig ?? defaultComposerRunConfig(currentProject);
    setComposerRunConfig(effectiveConfig);
    setRuntimeBusy(true);
    setTimelineItems(previous => [
      ...previous,
      { kind: 'user_message', id: createTimelineId('user'), text: prompt, source: 'runtime' }
    ]);

    try {
      const pendingRunId = createTimelineId('pending_run');
      setTimelineItems(previous => [
        ...previous,
        {
          kind: 'run_status',
          id: pendingRunId,
          label: 'queued',
          content: JSON.stringify({ status: 'queued' }),
          source: 'runtime'
        }
      ]);
      const resolvedThread = await resolveThreadIdForPrompt(prompt, effectiveConfig);
      const runInput: {
        threadId: string;
        prompt: string;
        resumeMode: 'auto';
        model?: string;
        reasoning?: NonNullable<ComposerRunConfig['reasoning']>;
      } = {
        threadId: resolvedThread.threadId,
        prompt,
        resumeMode: 'auto'
      };
      if (resolvedThread.created) {
        if (effectiveConfig.model !== null) runInput.model = effectiveConfig.model;
        if (effectiveConfig.reasoning !== null) runInput.reasoning = effectiveConfig.reasoning;
      }
      const run = await runService.startThreadRun(runInput);
      handleRunStarted(run);
      await subscribeToRunEvents(run.id, connectionConfigRef.current);
    } catch (error) {
      if (mountedRef.current) {
        setTimelineItems(previous => [
          ...previous,
          {
            kind: 'diagnostic',
            id: createTimelineId('runtime_error'),
            severity: 'error',
            message: error instanceof Error ? error.message : 'Runtime run failed',
            content: error instanceof Error ? error.message : String(error),
            source: 'runtime'
          }
        ]);
      }
    } finally {
      if (mountedRef.current) setRuntimeBusy(false);
    }
  }

  async function resolveThreadIdForPrompt(
    prompt: string,
    config: ComposerRunConfig
  ): Promise<{ threadId: string; created: boolean }> {
    if (state.selectedThreadId !== undefined) return { threadId: state.selectedThreadId, created: false };
    if (threadService === null) throw new Error('Thread service is not available');

    const created = await threadService.createThread(buildThreadRequest(prompt, currentProject, config));
    setRuntimeThreads(previous => upsertThread(previous, created.thread));
    skipNextHistoryLoadForThreadRef.current = created.thread.id;
    dispatch({ type: 'select_thread', threadId: created.thread.id });
    return { threadId: created.thread.id, created: true };
  }

  function handleRunStarted(run: RunResponse) {
    setTimelineItems(previous => [
      ...previous,
      {
        kind: 'run_status',
        id: createTimelineId('run'),
        runId: run.id,
        label: run.status,
        content: JSON.stringify(run),
        source: 'runtime'
      }
    ]);
  }

  async function subscribeToRunEvents(runId: string, config: ConnectionConfig) {
    sseAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    sseAbortControllerRef.current = abortController;

    await subscribeRunEvents({
      ...config,
      runId,
      fromSeq: 0,
      fetchImpl: runtimeFetch,
      signal: abortController.signal,
      onEvent(event) {
        if (!mountedRef.current) return;
        const item = eventToTimelineItem(event);
        if (item !== null) setTimelineItems(previous => [...previous, item]);
        if (event.type === 'done') {
          void loadRunDiagnostics(event.runId);
        }
      },
      onError(error) {
        if (!mountedRef.current || abortController.signal.aborted) return;
        setTimelineItems(previous => [
          ...previous,
          {
            kind: 'diagnostic',
            id: createTimelineId('sse_error'),
            severity: 'error',
            message: error.message,
            content: error.message,
            source: 'runtime'
          }
        ]);
      }
    });
  }

  async function loadRunDiagnostics(runId: string) {
    if (diagnosticsService === null) return;
    try {
      const diagnostics = await diagnosticsService.getRunDiagnostics(runId);
      if (!mountedRef.current) return;
      setRunDiagnosticsById(previous => ({ ...previous, [runId]: diagnostics }));
    } catch {
      return;
    }
  }

  function openRunDetail(runId: string) {
    dispatch({ type: 'select_run_detail', runId });
    void loadRunDiagnostics(runId);
  }

  function openTimelineFile(path: string) {
    dispatch({ type: 'select_workspace_file', path: toWorkspaceRelativePath(path, selectedThread) });
  }

  async function saveCurrentFile() {
    if (currentFile === undefined) return;
    if (savingFilePathsRef.current.has(currentFile.path)) return;

    const saveSnapshot = { path: currentFile.path, content: selectedDraftContent };
    bumpFileRevision(saveSnapshot.path);
    setFileSaving(saveSnapshot.path, true);
    setSaveErrorByPath(previous => ({ ...previous, [saveSnapshot.path]: undefined }));

    try {
      const savedFile = await fileService.saveFile(saveSnapshot.path, saveSnapshot.content);

      if (!mountedRef.current) return;

      bumpFileRevision(saveSnapshot.path);
      const nextSavedFiles = { ...savedFileByPathRef.current, [saveSnapshot.path]: savedFile };
      savedFileByPathRef.current = nextSavedFiles;
      setSavedFileByPath(nextSavedFiles);
      if (draftContentByPathRef.current[saveSnapshot.path] === saveSnapshot.content) {
        const nextDrafts = { ...draftContentByPathRef.current, [saveSnapshot.path]: savedFile.content };
        draftContentByPathRef.current = nextDrafts;
        setDraftContentByPath(nextDrafts);
      }
    } catch {
      if (mountedRef.current) {
        setSaveErrorByPath(previous => ({ ...previous, [saveSnapshot.path]: '保存到本地草稿失败' }));
      }
    } finally {
      if (mountedRef.current) {
        setFileSaving(saveSnapshot.path, false);
      } else {
        savingFilePathsRef.current.delete(saveSnapshot.path);
      }
    }
  }

  function updateConversationPaneWidth(clientX: number) {
    const layout = conversationFileLayoutRef.current;
    if (!layout) return;

    const rect = layout.getBoundingClientRect();
    setConversationPaneWidth(clampPaneWidth(
      clientX - rect.left,
      CONVERSATION_PANE_MIN_WIDTH,
      Math.max(CONVERSATION_PANE_MIN_WIDTH, rect.width - FILE_WORKSPACE_MIN_WIDTH)
    ));
  }

  function adjustConversationPaneWidth(delta: number) {
    const layout = conversationFileLayoutRef.current;
    const rect = layout?.getBoundingClientRect();
    const fallbackWidth = rect ? Math.round(rect.width * 0.42) : 420;
    const maxWidth = rect
      ? Math.max(CONVERSATION_PANE_MIN_WIDTH, rect.width - FILE_WORKSPACE_MIN_WIDTH)
      : 760;

    setConversationPaneWidth((previous) => clampPaneWidth(
      (previous ?? fallbackWidth) + delta,
      CONVERSATION_PANE_MIN_WIDTH,
      maxWidth
    ));
  }

  function handleConversationResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.preventDefault();
    updateConversationPaneWidth(event.clientX);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      updateConversationPaneWidth(moveEvent.clientX);
    };
    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleConversationResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustConversationPaneWidth(-RESIZE_KEY_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustConversationPaneWidth(RESIZE_KEY_STEP);
    }
  }

  const detailPanel = createDetailPanel();
  const composerDisabled = runtimeBusy || connectionState.status !== 'connected';
  const composerDisabledReason = runtimeBusy ? '当前对话有任务运行中' : '正在连接本地运行内核';
  const fileWorkspaceOpen = state.activeView === 'conversation' && state.rightPanelMode === 'file';
  const effectiveComposerConfig = selectedThread === undefined
    ? composerRunConfig ?? defaultComposerRunConfig(currentProject)
    : {
        permission: fromRuntimeSandbox(selectedThread.sandbox),
        model: selectedThread.model ?? null,
        reasoning: (selectedThread.reasoning ?? null) as ComposerRunConfig['reasoning']
      };
  const conversationFileLayoutStyle = conversationPaneWidth === undefined
    ? undefined
    : ({ '--conversation-pane-width': `${conversationPaneWidth}px` } as CSSProperties);
  const showConversationLightfall =
    dynamicBackgroundEnabled && state.selectedThreadId === undefined && timelineItems.length === 0;
  const showHistoryLoadingOverlay =
    historyLoadingThreadId !== undefined && historyLoadingThreadId === state.selectedThreadId;
  const conversationPage = (
    <section
      className="conversation-page"
      data-background-mode={showConversationLightfall ? 'dynamic' : 'solid'}
      data-dynamic-background={dynamicBackgroundEnabled ? 'on' : 'off'}
    >
      {showConversationLightfall ? (
        <div className="conversation-lightfall-bg" data-testid="conversation-lightfall-background" aria-hidden="true">
          <Lightfall
            colors={CONVERSATION_LIGHTFALL_COLORS}
            backgroundColor="#000000"
            speed={0.28}
            streakCount={3}
            streakWidth={0.32}
            streakLength={0.78}
            glow={0.48}
            density={0.12}
            twinkle={0.62}
            zoom={3.1}
            backgroundGlow={0.34}
            opacity={0.72}
            mouseInteraction={false}
            mouseStrength={0.3}
            mouseRadius={1.05}
            dpr={1.5}
          />
        </div>
      ) : null}
      <ConversationHeader
        title={selectedConversation?.title ?? '新对话'}
        projectName={currentProjectName}
        statusLabel={getConnectionStatusLabel(connectionState)}
        onOpenLocation={() => dispatch({ type: 'open_files' })}
        onToggleDetail={() => {
          if (state.rightPanelMode === 'closed') return;
          dispatch({ type: 'close_detail' });
        }}
      />
      <div className="conversation-body" ref={conversationBodyRef}>
        {treeLoadError ? <p className="inline-error">{treeLoadError}</p> : null}
        {threadLoadError ? <p className="inline-error">{threadLoadError}</p> : null}
        {threadHistoryLoadError ? <p className="inline-error">{threadHistoryLoadError}</p> : null}
        {threadConfigUpdateError ? <p className="inline-error">{threadConfigUpdateError}</p> : null}
        {timelineItems.length === 0 ? (
          <ConversationEmptyState projectName={currentProjectName} />
        ) : (
          <Timeline items={timelineItems} onOpenRunDetail={openRunDetail} onOpenFile={openTimelineFile} />
        )}
        {showHistoryLoadingOverlay ? (
          <div className="conversation-history-loading" role="status" aria-label="正在加载会话历史">
            <span>正在加载会话历史...</span>
          </div>
        ) : null}
      </div>
      <div className="composer-wrap">
        <Composer
          projectName={currentProjectName}
          permission={effectiveComposerConfig.permission}
          model={effectiveComposerConfig.model}
          reasoning={effectiveComposerConfig.reasoning}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
          slashCommands={slashCommands}
          slashCommandsLoading={capabilitiesLoading}
          slashCommandsError={capabilitiesLoadError}
          draftRequest={
            pendingComposerDraft !== undefined && pendingComposerDraft.threadId === state.selectedThreadId
              ? pendingComposerDraft.request
              : undefined
          }
          onPermissionChange={(permission) => void handleComposerPermissionChange(permission)}
          onDraftApplied={(draftId) => {
            setPendingComposerDraft(currentDraft =>
              currentDraft !== undefined
                && currentDraft.threadId === state.selectedThreadId
                && currentDraft.request.id === draftId
                ? undefined
                : currentDraft
            );
          }}
          onSubmit={submitPrompt}
        />
      </div>
    </section>
  );
  const conversationWorkspace = fileWorkspaceOpen ? (
    <section
      className="conversation-file-layout"
      aria-label="会话和文件工作区"
      ref={conversationFileLayoutRef}
      style={conversationFileLayoutStyle}
    >
      {conversationPage}
      <div
        className="pane-resize-handle conversation-file-resize-handle"
        role="separator"
        aria-label="调整会话和文件区域宽度"
        aria-orientation="vertical"
        aria-valuenow={conversationPaneWidth}
        tabIndex={0}
        onMouseDown={handleConversationResizeMouseDown}
        onKeyDown={handleConversationResizeKeyDown}
      />
      <FileWorkspaceView
        selectedThread={selectedThread}
        selectedPath={state.workspaceTargetPath}
        workspaceFileService={workspaceFileService}
        onClose={() => dispatch({ type: 'close_file_workspace' })}
        onSelectPath={(path) => dispatch({ type: 'select_workspace_file', path })}
      />
    </section>
  ) : conversationPage;
  const main = props.capabilitiesView !== undefined ? (
    <CapabilitiesView {...props.capabilitiesView} />
  ) : state.activeView === 'settings' ? (
    <ClaweeSettingsView
      runtimeStatus={runtimeStatus}
      dynamicBackgroundEnabled={dynamicBackgroundEnabled}
      onDynamicBackgroundChange={handleDynamicBackgroundChange}
      onBack={() => dispatch({ type: 'back_to_app' })}
    />
  ) : state.activeView === 'plugins' ? (
    <SkillMarketView
      connected={connectionState.status === 'connected'}
      skills={codexSkills}
      installRecords={skillMarketInstallRecords}
      loading={skillMarketLoading}
      loadError={skillMarketLoadError}
      operation={skillMarketOperation}
      useError={skillMarketUseError}
      onInstall={skillId => void installMarketSkill(skillId)}
      onUpdate={skillId => void updateMarketSkill(skillId)}
      onUse={skillId => void useMarketSkill(skillId)}
    />
  ) : state.activeView === 'conversation' ? (
    conversationWorkspace
  ) : (
    <PlaceholderView label={getPlaceholderLabel(state.activeView)} />
  );

  return (
    <WorkbenchLayout
      sidebar={
        <ClaweeSidebar
          projects={projects}
          conversations={conversations}
          currentProjectId={state.currentProjectId}
          selectedConversationId={state.selectedThreadId}
          activeView={state.activeView}
          collapsed={sidebarCollapsed}
          onNewConversation={startNewConversation}
          onSelectProject={selectProject}
          onSelectConversation={selectConversation}
          onOpenView={(activeView) => dispatch({ type: 'set_active_view', activeView })}
          onOpenSettings={() => dispatch({ type: 'open_settings' })}
          onToggleCollapsed={() => setSidebarCollapsed((currentValue) => !currentValue)}
        />
      }
      main={main}
      detail={detailPanel}
      detailOpen={detailPanel !== null && state.activeView === 'conversation'}
      sidebarCollapsed={sidebarCollapsed}
    />
  );

  function createDetailPanel() {
    if (state.rightPanelMode === 'closed') return null;
    if (state.rightPanelMode === 'file') return null;

    if (state.rightPanelMode === 'run_detail') {
      return (
        <DetailPanel
          mode="run"
          title="运行详情"
          subtitle={state.selectedRunId}
          content={formatRunDiagnostics(runDiagnostics)}
          onClose={() => dispatch({ type: 'close_detail' })}
        />
      );
    }

    if (state.rightPanelMode === 'change') {
      return (
        <DetailPanel
          mode="change"
          title="已编辑 docs/atoms.md"
          subtitle="+903 -0"
          content="docs/atoms.md"
          onClose={() => dispatch({ type: 'close_detail' })}
          onApprove={() => dispatch({ type: 'close_detail' })}
          onRevert={() => dispatch({ type: 'close_detail' })}
        />
      );
    }

    const fileTitle = selectedFilePath.split('/').at(-1) ?? selectedFilePath;
    const fileContent = loadingSelectedFile
      ? '正在加载文件...'
      : loadError ?? saveError ?? (selectedDraftContent.length > 0 ? selectedDraftContent : '暂无预览内容');

    return (
      <DetailPanel
        mode="file"
        title={fileTitle}
        subtitle={selectedFilePath}
        content={fileContent}
        onClose={() => dispatch({ type: 'close_detail' })}
      />
    );
  }
}

function getConnectionStatusLabel(connectionState: ConnectionState) {
  if (connectionState.status === 'connected') return '本地运行内核正常';
  return connectionState.message;
}

function readDynamicBackgroundPreference(): boolean {
  try {
    return window.localStorage.getItem(DYNAMIC_BACKGROUND_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeDynamicBackgroundPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(DYNAMIC_BACKGROUND_STORAGE_KEY, String(enabled));
  } catch {
    return;
  }
}

function PlaceholderView(props: { label: string }) {
  return (
    <section className="placeholder-page" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title">Clawee：{props.label}</h1>
    </section>
  );
}

function getPlaceholderLabel(activeView: 'search' | 'schedules' | 'plugins' | 'files') {
  switch (activeView) {
    case 'search':
      return '搜索';
    case 'schedules':
      return '已安排';
    case 'plugins':
      return '插件';
    case 'files':
      return '文件';
  }
}

function getSkillMarketEntry(skillId: string): (typeof skillMarketCatalog)[number] | undefined {
  return skillMarketCatalog.find(entry => entry.id === skillId);
}

function createProjectsForThreads(baseProjects: ClaweeProject[], threads: ThreadResponse[]): ClaweeProject[] {
  const projectById = new Map(baseProjects.map(project => [project.id, project]));

  for (const thread of threads) {
    const projectId = projectIdForThread(thread, baseProjects);
    if (projectById.has(projectId)) continue;

    projectById.set(projectId, {
      id: projectId,
      name: formatProjectName(thread.cwd),
      cwd: thread.cwd,
      sandbox: thread.sandbox === 'danger-full-access' || thread.sandbox === 'workspace-write'
        ? thread.sandbox
        : 'follow-global',
      profile: thread.profile,
      model: thread.model ?? null,
      reasoning: thread.reasoning ?? null
    });
  }

  return Array.from(projectById.values());
}

function shouldShowThreadInSidebar(thread: ThreadResponse): boolean {
  if (thread.workspaceMode === 'managed') return false;
  if (isRuntimeWorkspacePath(thread.cwd)) return false;
  if (isRuntimeWorkspacePath(thread.canonicalCwd)) return false;
  return true;
}

function isRuntimeWorkspacePath(path: string): boolean {
  const normalized = normalizePathForCompare(path).replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === '.runtime/workspaces'
    || normalized.startsWith('.runtime/workspaces/')
    || normalized.includes('/.runtime/workspaces/');
}

function mapThreadToConversation(thread: ThreadResponse, projects: ClaweeProject[]): ClaweeConversation {
  return {
    id: thread.id,
    projectId: projectIdForThread(thread, projects),
    title: thread.title ?? thread.codexThreadId ?? thread.id,
    updatedLabel: formatRelativeTime(thread.updatedAt)
  };
}

function projectIdForThread(thread: ThreadResponse, projects: ClaweeProject[]): string {
  const matched = projects.find(project => pathsLookRelated(project.cwd, thread.cwd));
  return matched?.id ?? projectIdFromCwd(thread.cwd);
}

function pathsLookRelated(left: string, right: string): boolean {
  const normalizedLeft = normalizePathForCompare(left);
  const normalizedRight = normalizePathForCompare(right);
  return normalizedLeft === normalizedRight
    || normalizedLeft.endsWith(`/${lastPathSegment(normalizedRight)}`)
    || normalizedRight.endsWith(`/${lastPathSegment(normalizedLeft)}`);
}

function toWorkspaceRelativePath(path: string, thread: ThreadResponse | undefined): string {
  const trimmedPath = path.trim();
  if (trimmedPath.length === 0 || thread === undefined) return trimmedPath;

  return stripWorkspaceRoot(trimmedPath, thread.canonicalCwd)
    ?? stripWorkspaceRoot(trimmedPath, thread.cwd)
    ?? normalizeWorkspacePath(trimmedPath).replace(/^\.\//, '');
}

function stripWorkspaceRoot(path: string, root: string): string | undefined {
  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedRoot = normalizeWorkspacePath(root).replace(/\/+$/, '');
  if (normalizedRoot.length === 0) return undefined;
  if (normalizedPath === normalizedRoot) return '';
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : undefined;
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function normalizePathForCompare(path: string): string {
  return path.replace(/^~(?=\/)/, '').replace(/\/+$/, '');
}

function projectIdFromCwd(cwd: string): string {
  const name = formatProjectName(cwd);
  return `cwd-${name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'project'}`;
}

function formatProjectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).at(-1) ?? '项目';
}

function lastPathSegment(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function formatRelativeTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return '刚刚';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}分钟`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}小时`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}天`;
  return `${Math.floor(diffMs / (7 * day))}周`;
}

function getRuntimeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return fallback;
}

function buildThreadRequest(prompt: string, project: ClaweeProject | undefined, config: ComposerRunConfig): CreateThreadRequest {
  const request: CreateThreadRequest = {
    title: prompt.trim().slice(0, 80) || '新对话',
    cwd: project?.cwd,
    workspaceMode: 'external',
    profile: project?.profile,
    sandbox: toRuntimeSandbox(config.permission)
  };
  if (config.model !== null) request.model = config.model;
  if (config.reasoning !== null) {
    request.reasoning = config.reasoning;
  }
  return request;
}

function defaultComposerRunConfig(project?: ClaweeProject): ComposerRunConfig {
  return {
    permission: project?.sandbox ?? 'follow-global',
    model: project?.model ?? null,
    reasoning: (project?.reasoning ?? null) as ComposerRunConfig['reasoning']
  };
}

function buildComposerSlashCommands(
  skills: CodexSkillListResponse | undefined,
  mcp: CodexMcpListResponse | undefined
): ComposerSlashCommand[] {
  return [
    ...(skills?.skills ?? [])
      .filter(skill => skill.status === 'valid')
      .map(skill => ({
        id: `skill:${skill.id}`,
        category: 'skill' as const,
        label: skill.name ?? skill.id,
        description: skill.description ?? skill.id,
        insertText: `$${skill.id} `
      })),
    ...(mcp?.servers ?? [])
      .filter(server => server.status === 'configured')
      .map(server => ({
        id: `mcp:${server.name}`,
        category: 'mcp' as const,
        label: server.name,
        description: formatMcpSlashDescription(server),
        insertText: `使用 MCP：${server.name} `
      })),
    ...goalSlashCommands()
  ];
}

function goalSlashCommands(): ComposerSlashCommand[] {
  return [
    {
      id: 'goal:create',
      category: 'goal',
      label: '设置 Goal',
      description: '为这次任务声明明确目标',
      insertText: '目标：'
    },
    {
      id: 'goal:review',
      category: 'goal',
      label: '检查 Goal',
      description: '让 Agent 对齐当前目标和剩余工作',
      insertText: '请先检查当前目标和剩余工作，再继续。'
    },
    {
      id: 'goal:complete',
      category: 'goal',
      label: '完成 Goal',
      description: '让 Agent 在完成后总结目标达成情况',
      insertText: '完成后请总结目标达成情况。'
    }
  ];
}

function formatMcpSlashDescription(server: CodexMcpListResponse['servers'][number]): string {
  const status = server.status === 'configured' ? '已配置' : server.status;
  if (server.command !== undefined && server.command.length > 0) {
    return `${server.transport} · ${status} · ${server.command}`;
  }
  if (server.url !== undefined && server.url.length > 0) {
    return `${server.transport} · ${status} · ${server.url}`;
  }
  return `${server.transport} · ${status}`;
}

function toRuntimeSandbox(permission: ClaweeProject['sandbox'] | undefined): SandboxMode {
  if (permission === 'danger-full-access' || permission === 'workspace-write') return permission;
  return 'read-only';
}

function fromRuntimeSandbox(sandbox: SandboxMode): ClaweeProject['sandbox'] {
  if (sandbox === 'danger-full-access' || sandbox === 'workspace-write') return sandbox;
  return 'follow-global';
}

function upsertThread(threads: ThreadResponse[], thread: ThreadResponse): ThreadResponse[] {
  const withoutThread = threads.filter(item => item.id !== thread.id);
  return [thread, ...withoutThread];
}

function createHistoryLoadingTimelineItem(threadId: string): TimelineItem {
  return {
    kind: 'run_status',
    id: `history_loading_${threadId}`,
    label: 'running',
    content: JSON.stringify({ type: 'history_loading', threadId }),
    source: 'runtime'
  };
}

function hasOnlyHistoryLoadingTimelineItem(items: TimelineItem[]): boolean {
  const item = items[0];
  return items.length === 1
    && item !== undefined
    && item.kind === 'run_status'
    && item.id.startsWith('history_loading_');
}

function mapHistoryItemsToTimelineItems(items: ThreadHistoryItem[]): TimelineItem[] {
  let syntheticTurnSeq = 0;
  let currentRunId: string | undefined;
  let currentRunHasDone = false;
  const timelineItems: TimelineItem[] = [];

  function closeCurrentRun() {
    if (currentRunId === undefined || currentRunHasDone) return;
    timelineItems.push({
      id: `${currentRunId}_done`,
      runId: currentRunId,
      kind: 'done',
      status: 'succeeded',
      content: JSON.stringify({ type: 'done', status: 'succeeded' }),
      source: 'runtime'
    });
    currentRunHasDone = true;
  }

  for (const item of items) {
    if (item.type === 'user_message') {
      closeCurrentRun();
      syntheticTurnSeq += 1;
      currentRunId = item.turnId === undefined ? `history_turn_${syntheticTurnSeq}` : `history_${item.turnId}`;
      currentRunHasDone = false;
      timelineItems.push(mapHistoryItemToTimelineItem(item));
      continue;
    }

    if (item.type === 'done') {
      timelineItems.push(mapHistoryItemToTimelineItem(item, currentRunId));
      currentRunHasDone = true;
      currentRunId = undefined;
      continue;
    }

    timelineItems.push(mapHistoryItemToTimelineItem(item, item.turnId === undefined ? currentRunId : undefined));
  }

  closeCurrentRun();
  return timelineItems;
}

function mapHistoryItemToTimelineItem(item: ThreadHistoryItem, fallbackRunId?: string): TimelineItem {
  const runId = item.turnId === undefined ? fallbackRunId : `history_${item.turnId}`;
  const base = {
    id: item.id,
    ...(runId === undefined ? {} : { runId })
  };

  switch (item.type) {
    case 'user_message':
      return {
        ...base,
        kind: 'user_message',
        text: item.text,
        source: 'runtime'
      };
    case 'assistant_message':
      return {
        ...base,
        kind: 'assistant_message',
        text: item.text,
        content: JSON.stringify(item),
        source: 'runtime'
      };
    case 'reasoning_summary':
      return {
        ...base,
        kind: 'reasoning_summary',
        text: item.text,
        content: JSON.stringify(item),
        source: 'runtime'
      };
    case 'tool_use':
      return {
        ...base,
        kind: 'tool_step',
        name: item.name,
        content: JSON.stringify({ type: 'tool_use', name: item.name, input: item.input }),
        source: 'runtime'
      };
    case 'tool_result':
      return {
        ...base,
        kind: 'tool_step',
        name: item.name,
        content: JSON.stringify({ type: 'tool_result', name: item.name, output: item.output, isError: item.isError }),
        source: 'runtime'
      };
    case 'file_change':
      return {
        ...base,
        kind: 'change_card',
        title: formatHistoryFileChangeTitle(item.changes),
        path: item.changes.find(change => change.path.length > 0)?.path ?? '文件变更',
        delta: `${item.changes.length} 项变更`,
        source: 'runtime'
      };
    case 'done':
      return {
        ...base,
        kind: 'done',
        status: item.status,
        content: JSON.stringify(item),
        source: 'runtime'
      };
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function formatHistoryFileChangeTitle(
  changes: Array<{ kind: 'add' | 'modify' | 'delete' | 'unknown' }>
): string {
  if (changes.length === 0) return '文件变更';

  const counts = new Map<'add' | 'modify' | 'delete' | 'unknown', number>();
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);

  return (['add', 'modify', 'delete', 'unknown'] as const)
    .map(kind => {
      const count = counts.get(kind) ?? 0;
      if (count === 0) return undefined;
      if (kind === 'add') return `新增 ${count} 个文件`;
      if (kind === 'modify') return `修改 ${count} 个文件`;
      if (kind === 'delete') return `删除 ${count} 个文件`;
      return `变更 ${count} 个文件`;
    })
    .filter((part): part is string => part !== undefined)
    .join('，');
}

function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

function mapRuntimeStatus(connectionState: ConnectionState): RuntimeStatus {
  if (connectionState.status !== 'connected') {
    return {
      connected: false,
      runtimeVersion: '0.1.0',
      lastCheckedAt: '2026-07-07 10:00'
    };
  }

  return {
    connected: true,
    runtimeVersion: '0.1.0',
    codexVersion: connectionState.codexStatus.codexVersion,
    codexPath: connectionState.codexStatus.codexBin,
    codexHome: connectionState.codexStatus.codexHome,
    lastCheckedAt: '2026-07-07 10:00'
  };
}

function formatRunDiagnostics(diagnostics: RunDiagnosticsResponse | undefined): string {
  if (diagnostics === undefined) return '正在加载运行详情...';

  return JSON.stringify(
    {
      runId: diagnostics.runId,
      files: diagnostics.files,
      warnings: diagnostics.warnings
    },
    null,
    2
  );
}

function hasOwnPath<T>(record: Record<string, T>, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, path);
}
