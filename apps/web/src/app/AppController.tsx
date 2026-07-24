import type {
  AttachmentResponse,
  ApprovalDecisionResponse,
  CodexMcpListResponse,
  CodexProfileListResponse,
  CodexSkillListResponse,
  CodexSkillMarketInstallRecordResponse,
  ConversationSearchResult,
  CreateMemoryRequest,
  CreateThreadRequest,
  RunDiagnosticsResponse,
  RunContextResponse,
  RunResponse,
  RunSubmissionMode,
  SandboxMode,
  ScheduleResponse,
  TaskItem,
  ThreadHistoryItem,
  ThreadResponse
} from '@clawee/protocol';
import { skillMarketCatalog } from '@clawee/skill-market';
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent
} from 'react';
import { FolderInput } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import { Timeline, type TimelineHandle } from '../components/timeline/Timeline.js';
import { eventToTimelineItem, type TimelineItem } from '../components/timeline/timeline-model.js';
import type { CapabilitiesViewProps } from '../features/capabilities/CapabilitiesView.js';
import { ConversationEmptyState } from '../features/conversation/ConversationEmptyState.js';
import { ConversationHeader } from '../features/conversation/ConversationHeader.js';
import { MemorySuggestion } from '../features/conversation/MemorySuggestion.js';
import { useThreadHistory } from '../features/conversation/use-thread-history.js';
import { DetailPanel } from '../features/details/DetailPanel.js';
import { getSkillMarketDisplayTitle } from '../features/plugins/skill-market-model.js';
import {
  collectTaskTransitions,
  createTaskNotification,
  shouldAutoSubscribeTask,
  shouldSendSystemNotification
} from '../features/tasks/task-monitor.js';
import type {
  SkillMarketOperation,
  SkillMarketUseError
} from '../features/plugins/SkillMarketView.js';
import {
  findProjectById,
  groupThreadsByPurpose,
  parseLegacyLocalStorageProjects,
  PROJECTS_STORAGE_KEY,
  type ClaweeConversation,
  type ClaweeProject,
  type ProjectPermission
} from '../features/projects/project-model.js';
import { ProjectManagementDialog } from '../features/projects/ProjectManagementDialog.js';
import {
  Composer,
  type ComposerAttachment,
  type ComposerDraftRequest,
  type ComposerQueuedItem,
  type ComposerRunConfig,
  type ComposerSlashCommand
} from '../features/runs/Composer.js';
import { RunDetailPanel } from '../features/runs/RunDetailPanel.js';
import { createScheduleTaskSummaries } from '../features/schedules/schedule-task-model.js';
import {
  getRunCancelState,
  getThreadActiveRun,
  initialRunRegistryState,
  runRegistryReducer,
  type RunSubscriptionState
} from '../features/runs/run-registry.js';
import {
  createRunEventController,
  type RunEventController,
  type RunEventControllerState
} from '../features/runs/run-event-controller.js';
import {
  createRunReplayDeduper,
  mergeTimelineHistoryWithCache
} from '../features/runs/run-event-replay.js';
import type {
  DefaultPermissionPreference,
  RuntimeStatus
} from '../features/settings/ClaweeSettingsView.js';
import type { McpCapabilities } from '../features/settings/McpSettingsView.js';
import { ClaweeSidebar } from '../features/shell/ClaweeSidebar.js';
import {
  createScheduleDraftSidebarSummaries,
  createSidebarTaskSummaries
} from '../features/shell/sidebar-task-model.js';
import { browserBridge } from '../host/browser-bridge.js';
import type { HostBridge } from '../host/bridge.js';
import { ApiClientError, RuntimeClient } from '../runtime/client.js';
import { createFrameBatcher, type FrameBatcher } from '../runtime/frame-batcher.js';
import { subscribeRunEvents as defaultSubscribeRunEvents, type SubscribeRunEventsInput } from '../runtime/sse.js';
import type { ConnectionConfig } from '../runtime/types.js';
import { createCapabilityService } from '../services/capability-service.js';
import { createAttachmentService } from '../services/attachment-service.js';
import { createApprovalService } from '../services/approval-service.js';
import { createConnectionService, type ConnectionState } from '../services/connection-service.js';
import { createCleanupService } from '../services/cleanup-service.js';
import { createDiagnosticsService } from '../services/diagnostics-service.js';
import { createMockFileService } from '../services/file-service.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import { createProjectService } from '../services/project-service.js';
import { createMcpService } from '../services/mcp-service.js';
import { createMemoryService } from '../services/memory-service.js';
import { createNotificationService } from '../services/notification-service.js';
import { createProfileService } from '../services/profile-service.js';
import { createRunService } from '../services/run-service.js';
import { createScheduleService } from '../services/schedule-service.js';
import { createSearchService } from '../services/search-service.js';
import { createSkillMarketService } from '../services/skill-market-service.js';
import { createTaskService } from '../services/task-service.js';
import { createThreadService } from '../services/thread-service.js';
import { createWorkspaceFileService } from '../services/workspace-file-service.js';
import { readJsonFromStorage, writeJsonToStorage } from '../storage/browser-storage.js';
import {
  applyColorMode,
  readColorModePreference,
  type ColorMode,
  writeColorModePreference
} from '../styles/color-mode.js';
import { initialAppState, reduceAppState, type ActiveView, type AppState } from './app-state.js';
import { formatRoute, type AppRoute } from './routes.js';

type AppFileService = {
  listTree(): Promise<FileTreeNode[]>;
  openFile(path: string): Promise<WorkspaceFile>;
  saveFile(path: string, content: string): Promise<WorkspaceFile>;
};

type CapabilityService = ReturnType<typeof createCapabilityService>;
type SkillMarketService = ReturnType<typeof createSkillMarketService>;
type ThreadService = ReturnType<typeof createThreadService>;
type ScheduleService = ReturnType<typeof createScheduleService>;
type SearchService = ReturnType<typeof createSearchService>;
type ProjectService = ReturnType<typeof createProjectService>;
type PendingRunStart = {
  id: string;
  threadId?: string;
  cancelRequested: boolean;
};
type PendingRunStartsById = Record<string, PendingRunStart | undefined>;
type ActiveRunEventController = {
  threadId: string;
  controller: RunEventController;
};

const CONVERSATION_PANE_MIN_WIDTH = 320;
const FILE_WORKSPACE_MIN_WIDTH = 520;
const RESIZE_KEY_STEP = 32;
function canScrollVertically(
  target: EventTarget | null,
  boundary: HTMLElement,
  deltaY: number
): boolean {
  if (!(target instanceof Element) || deltaY === 0) return false;

  let element: Element | null = target;
  while (element !== null && boundary.contains(element)) {
    if (element instanceof HTMLElement) {
      const overflowY = window.getComputedStyle(element).overflowY;
      const scrollableOverflow =
        overflowY === 'auto'
        || overflowY === 'scroll'
        || overflowY === 'overlay';
      if (scrollableOverflow && element.scrollHeight > element.clientHeight) {
        if (deltaY < 0 && element.scrollTop > 0) return true;
        if (
          deltaY > 0
          && element.scrollTop + element.clientHeight < element.scrollHeight - 1
        ) {
          return true;
        }
      }
    }
    element = element.parentElement;
  }

  return false;
}
const DEFAULT_PERMISSION_STORAGE_KEY = 'clawee.preferences.defaultPermission';
const NAVIGATION_STORAGE_KEY = 'clawee.navigation.v3';
const SCHEDULE_DRAFT_TITLE = '任务草稿';
const SCHEDULE_CREATION_DRAFT =
  '我们一起来设置一个已安排任务吧。首先，说明已安排任务在 Clawee 中的工作方式。然后询问我需要安排什么，以及应该在什么时间运行。';
const CapabilitiesPage = lazy(() => import('../features/capabilities/CapabilitiesPage.js'));
const FilesPage = lazy(() => import('../features/files/FilesPage.js'));
const PluginsPage = lazy(() => import('../features/plugins/PluginsPage.js'));
const ScheduleThreadHeader = lazy(async () => {
  const module = await import('../features/schedules/ScheduleThreadHeader.js');
  return { default: module.ScheduleThreadHeader };
});
const SchedulesPage = lazy(() => import('../features/schedules/SchedulesPage.js'));
const SearchPage = lazy(() => import('../features/search/SearchPage.js'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.js'));
const TaskCenterPage = lazy(() => import('../features/tasks/TaskCenterPage.js'));

type PersistedNavigation = {
  currentProjectId?: string;
  selectedThreadId?: string;
};

export type AppControllerProps = {
  fileService?: AppFileService;
  capabilitiesView?: CapabilitiesViewProps;
  hostBridge?: HostBridge;
  runtimeFetch?: typeof fetch;
  subscribeRunEvents?: (input: SubscribeRunEventsInput) => Promise<void>;
  route: AppRoute;
  onNavigate: (route: AppRoute, options?: { replace?: boolean }) => void;
};

export function AppController(props: AppControllerProps) {
  const persistedNavigation = useMemo(readPersistedNavigation, []);
  const initialState = useMemo(
    () => createInitialState(props.route, persistedNavigation),
    []
  );
  const [state, dispatch] = useReducer(reduceAppState, initialState);
  const [runRegistry, dispatchRunRegistry] = useReducer(
    runRegistryReducer,
    initialRunRegistryState
  );
  const [projects, setProjects] = useState<ClaweeProject[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<ClaweeProject[]>([]);
  const defaultFileService = useMemo(() => createMockFileService(), []);
  const fileService = props.fileService ?? defaultFileService;
  const hostBridge = props.hostBridge ?? browserBridge;
  const runtimeFetch = useMemo(() => props.runtimeFetch ?? globalThis.fetch.bind(globalThis), [props.runtimeFetch]);
  const subscribeRunEvents = props.subscribeRunEvents ?? defaultSubscribeRunEvents;
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [treeLoadError, setTreeLoadError] = useState<string>();
  const [timelineItems, setTimelineItemsState] = useState<TimelineItem[]>([]);
  const [resolvingApprovalIds, setResolvingApprovalIds] = useState<Set<string>>(
    () => new Set()
  );
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string | undefined>>({});
  const [connectionConfig, setConnectionConfig] = useState<ConnectionConfig | null>(null);
  const [runtimeThreads, setRuntimeThreads] = useState<ThreadResponse[]>([]);
  const [runtimeSchedules, setRuntimeSchedules] = useState<ScheduleResponse[]>([]);
  const [runtimeTasks, setRuntimeTasks] = useState<TaskItem[]>([]);
  const [threadLoadError, setThreadLoadError] = useState<string>();
  const [projectLoadError, setProjectLoadError] = useState<string>();
  const [projectManagementOpen, setProjectManagementOpen] = useState(false);
  const [projectManagementProjectId, setProjectManagementProjectId] = useState<string>();
  const [projectMutationBusy, setProjectMutationBusy] = useState(false);
  const [projectDropActive, setProjectDropActive] = useState(false);
  const [unassignedThreads, setUnassignedThreads] = useState<ThreadResponse[]>([]);
  const [threadHistoryLoadError, setThreadHistoryLoadError] = useState<string>();
  const [historyLoadingThreadId, setHistoryLoadingThreadId] = useState<string>();
  const [historyLoadedThreadId, setHistoryLoadedThreadId] = useState<string>();
  const [threadConfigUpdateError, setThreadConfigUpdateError] = useState<string>();
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    message: '正在等待本地服务'
  });
  const [runDiagnosticsById, setRunDiagnosticsById] = useState<Record<string, RunDiagnosticsResponse | undefined>>({});
  const [runAttachmentsById, setRunAttachmentsById] = useState<Record<string, AttachmentResponse[] | undefined>>({});
  const [runContextById, setRunContextById] = useState<Record<string, RunContextResponse | undefined>>({});
  const [pendingMemorySuggestion, setPendingMemorySuggestion] = useState<{ id: number; content: string }>();
  const [composerRunConfig, setComposerRunConfig] = useState<ComposerRunConfig | null>(null);
  const [codexSkills, setCodexSkills] = useState<CodexSkillListResponse>();
  const [codexMcp, setCodexMcp] = useState<CodexMcpListResponse>();
  const [codexProfiles, setCodexProfiles] = useState<CodexProfileListResponse>();
  const [skillMarketInstallRecords, setSkillMarketInstallRecords] = useState<CodexSkillMarketInstallRecordResponse[]>();
  const [skillMarketLoading, setSkillMarketLoading] = useState(false);
  const [skillMarketLoadError, setSkillMarketLoadError] = useState<string>();
  const [skillMarketOperation, setSkillMarketOperation] = useState<SkillMarketOperation>();
  const [skillMarketUseError, setSkillMarketUseError] = useState<SkillMarketUseError>();
  const [pendingComposerDraft, setPendingComposerDraft] = useState<
    { threadId: string; request: ComposerDraftRequest } | undefined
  >();

  useEffect(() => {
    if (threadConfigUpdateError === undefined) return;
    const timeoutId = window.setTimeout(() => {
      setThreadConfigUpdateError(undefined);
    }, 4200);
    return () => window.clearTimeout(timeoutId);
  }, [threadConfigUpdateError]);
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false);
  const [capabilitiesLoadError, setCapabilitiesLoadError] = useState<string>();
  const [pendingRunStartsById, setPendingRunStartsById] = useState<PendingRunStartsById>({});
  const [runsLoadingThreadId, setRunsLoadingThreadId] = useState<string>();
  const [runsLoadedThreadId, setRunsLoadedThreadId] = useState<string>();
  const [savedFileByPath, setSavedFileByPath] = useState<Record<string, WorkspaceFile>>({});
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string>(state.selectedFilePath);
  const [loadErrorByPath, setLoadErrorByPath] = useState<Record<string, string | undefined>>({});
  const [saveErrorByPath, setSaveErrorByPath] = useState<Record<string, string | undefined>>({});
  const [savingFilePaths, setSavingFilePaths] = useState<Set<string>>(() => new Set());
  const [conversationPaneWidth, setConversationPaneWidth] = useState<number>();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [defaultPermission, setDefaultPermission] = useState(readDefaultPermissionPreference);
  const [defaultPermissionSyncError, setDefaultPermissionSyncError] = useState<string>();
  const [colorMode, setColorMode] = useState(readColorModePreference);
  const [threadHistoryReloadKey, setThreadHistoryReloadKey] = useState(0);
  const [searchHistoryTarget, setSearchHistoryTarget] = useState<
    { threadId: string; itemId: string } | undefined
  >();
  const [timelineRunTarget, setTimelineRunTarget] = useState<
    { threadId: string; runId: string } | undefined
  >(() => (
    props.route.view === 'thread' && props.route.runId !== undefined
      ? { threadId: props.route.threadId, runId: props.route.runId }
      : undefined
  ));
  const [timelineApprovalTarget, setTimelineApprovalTarget] = useState<
    { threadId: string; approvalId: string } | undefined
  >(() => (
    props.route.view === 'thread' && props.route.approvalId !== undefined
      ? { threadId: props.route.threadId, approvalId: props.route.approvalId }
      : undefined
  ));
  const timelineIdSequenceRef = useRef(0);
  const timelineItemsRef = useRef<TimelineItem[]>([]);
  const timelineRef = useRef<TimelineHandle>(null);
  const timelineItemsByThreadIdRef = useRef<Record<string, TimelineItem[] | undefined>>({});
  const timelineThreadIdRef = useRef<string | undefined>(initialState.selectedThreadId);
  const mountedRef = useRef(true);
  const selectedFilePathRef = useRef(state.selectedFilePath);
  const savedFileByPathRef = useRef<Record<string, WorkspaceFile>>({});
  const draftContentByPathRef = useRef<Record<string, string>>({});
  const openRequestByPathRef = useRef<Record<string, number>>({});
  const fileRevisionByPathRef = useRef<Record<string, number>>({});
  const savingFilePathsRef = useRef(new Set<string>());
  const connectionConfigRef = useRef<ConnectionConfig | null>(null);
  const connectionConfigVersionRef = useRef(0);
  const runEventControllersRef = useRef(new Map<string, ActiveRunEventController>());
  const replayedTargetRunKeyRef = useRef<string>();
  const timelineEventBatchersByThreadIdRef = useRef(new Map<string, FrameBatcher<TimelineItem>>());
  const runRegistryRef = useRef(runRegistry);
  const pendingRunStartsByIdRef = useRef<PendingRunStartsById>({});
  const conversationFileLayoutRef = useRef<HTMLElement | null>(null);
  const allowInitialRuntimeProjectFocusRef = useRef(
    props.route.view === 'home' && persistedNavigation === null
  );

  useEffect(() => {
    applyColorMode(colorMode);
  }, [colorMode]);
  const navigationPersistenceReadyRef = useRef(
    persistedNavigation !== null || props.route.view !== 'home'
  );
  const restoredThreadIdRef = useRef(initialState.selectedThreadId);
  const initialRouteKeyRef = useRef(formatRoute(props.route));
  const pendingRouteKeyRef = useRef<string>();
  const skipNextHistoryLoadForThreadRef = useRef<string>();
  const skillMarketMutationInFlightRef = useRef(false);
  const skillMarketUseInFlightRef = useRef(false);
  const skillMarketRuntimeGenerationRef = useRef(0);
  const capabilityLoadGenerationRef = useRef<number>();
  const profileLoadGenerationRef = useRef<number>();
  const skillMarketLoadGenerationRef = useRef<number>();
  const mobileSidebarHistoryEntryRef = useRef(false);
  const defaultPermissionAppliedByThreadRef = useRef(new Map<string, SandboxMode>());
  const defaultPermissionSyncFailuresRef = useRef(new Set<string>());
  const projectDirectoryDialogInFlightRef = useRef(false);
  const capabilityServiceRef = useRef<CapabilityService | null>(null);
  const skillMarketServiceRef = useRef<SkillMarketService | null>(null);
  const threadServiceRef = useRef<ThreadService | null>(null);
  const scheduleServiceRef = useRef<ScheduleService | null>(null);
  const runtimeThreadsRef = useRef(runtimeThreads);
  const currentProjectIdRef = useRef(state.currentProjectId);
  const connectionStatusRef = useRef<ConnectionState['status']>(connectionState.status);
  const activeViewRef = useRef(state.activeView);
  const selectedThreadIdRef = useRef(state.selectedThreadId);
  const taskStatusesRef = useRef(new Map<string, TaskItem['status']>());
  const taskBaselineReadyRef = useRef(false);
  const nextComposerDraftIdRef = useRef(0);
  const composerAttachmentDraftIdsRef = useRef(new Map<string, string>());
  const retainedAttachmentPreviewUrlsRef = useRef(new Map<string, string>());
  runRegistryRef.current = runRegistry;
  runtimeThreadsRef.current = runtimeThreads;
  currentProjectIdRef.current = state.currentProjectId;

  const runtimeClient = useMemo(
    () => connectionConfig === null ? null : new RuntimeClient({ ...connectionConfig, fetchImpl: runtimeFetch }),
    [connectionConfig, runtimeFetch]
  );
  const connectionService = useMemo(
    () => runtimeClient === null ? null : createConnectionService(runtimeClient),
    [runtimeClient]
  );
  const runService = useMemo(() => runtimeClient === null ? null : createRunService(runtimeClient), [runtimeClient]);
  const attachmentService = useMemo(
    () => runtimeClient === null ? null : createAttachmentService(runtimeClient),
    [runtimeClient]
  );
  const approvalService = useMemo(
    () => runtimeClient === null ? null : createApprovalService(runtimeClient),
    [runtimeClient]
  );
  const threadService = useMemo(
    () => runtimeClient === null ? null : createThreadService(runtimeClient),
    [runtimeClient]
  );
  const projectService: ProjectService | null = useMemo(
    () => runtimeClient === null ? null : createProjectService(runtimeClient),
    [runtimeClient]
  );
  const searchService: SearchService | null = useMemo(
    () => runtimeClient === null ? null : createSearchService(runtimeClient),
    [runtimeClient]
  );
  const scheduleService = useMemo(
    () => runtimeClient === null ? null : createScheduleService(runtimeClient),
    [runtimeClient]
  );
  const mcpService = useMemo(
    () => runtimeClient === null ? null : createMcpService(runtimeClient),
    [runtimeClient]
  );
  const profileService = useMemo(
    () => runtimeClient === null ? null : createProfileService(runtimeClient),
    [runtimeClient]
  );
  const diagnosticsService = useMemo(
    () => runtimeClient === null ? null : createDiagnosticsService(runtimeClient),
    [runtimeClient]
  );
  const cleanupService = useMemo(
    () => runtimeClient === null ? null : createCleanupService(runtimeClient),
    [runtimeClient]
  );
  const memoryService = useMemo(
    () => runtimeClient === null ? null : createMemoryService(runtimeClient),
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
  const taskService = useMemo(
    () => runtimeClient === null ? null : createTaskService(runtimeClient),
    [runtimeClient]
  );
  const notificationService = useMemo(
    () => createNotificationService({
      hostBridge,
      ...(typeof Notification === 'undefined' ? {} : { notificationApi: Notification })
    }),
    [hostBridge]
  );
  const [notificationSettings, setNotificationSettings] = useState(
    () => notificationService.getSettings()
  );
  const [desktopCloseBehavior, setDesktopCloseBehavior] = useState<
    'hide' | 'quit' | undefined
  >(undefined);
  const [unreadTaskIds, setUnreadTaskIds] = useState<Set<string>>(
    () => notificationService.getUnreadIds()
  );
  const visibleRuntimeThreads = useMemo(
    () => runtimeThreads.filter(shouldShowThreadInSidebar),
    [runtimeThreads]
  );
  const visibleThreadGroups = useMemo(
    () => groupThreadsByPurpose(visibleRuntimeThreads),
    [visibleRuntimeThreads]
  );
  const conversations = useMemo(
    () => visibleThreadGroups.conversationThreads.map(
      thread => mapThreadToConversation(thread)
    ).filter((conversation): conversation is ClaweeConversation => conversation !== undefined),
    [projects, visibleThreadGroups.conversationThreads]
  );
  const scheduleTaskSummaries = useMemo(
    () => createScheduleTaskSummaries(runtimeSchedules, runtimeThreads, runRegistry),
    [runRegistry, runtimeSchedules, runtimeThreads]
  );
  const runningThreadIds = useMemo(
    () => new Set(
      Object.entries(runRegistry.activeRunIdByThreadId)
        .filter(([, runId]) => runId !== undefined)
        .map(([threadId]) => threadId)
    ),
    [runRegistry.activeRunIdByThreadId]
  );
  const scheduleDraftSidebarTasks = useMemo(
    () => createScheduleDraftSidebarSummaries(
      visibleThreadGroups.scheduleDraftThreads,
      runtimeTasks,
      unreadTaskIds,
      runningThreadIds
    ),
    [
      runningThreadIds,
      runtimeTasks,
      unreadTaskIds,
      visibleThreadGroups.scheduleDraftThreads
    ]
  );
  const scheduleSidebarTasks = useMemo(
    () => createSidebarTaskSummaries(
      scheduleTaskSummaries,
      runtimeTasks,
      unreadTaskIds
    ),
    [runtimeTasks, scheduleTaskSummaries, unreadTaskIds]
  );
  const sidebarTasks = useMemo(
    () => [...scheduleDraftSidebarTasks, ...scheduleSidebarTasks],
    [scheduleDraftSidebarTasks, scheduleSidebarTasks]
  );
  const runningConversationIds = runningThreadIds;
  const selectedThreadExists = state.selectedThreadId !== undefined
    && runtimeThreads.some(thread => thread.id === state.selectedThreadId);
  activeViewRef.current = state.activeView;
  selectedThreadIdRef.current = state.selectedThreadId;
  const consumeSkipInitialHistoryLoad = useCallback((threadId: string) => {
    if (skipNextHistoryLoadForThreadRef.current !== threadId) return false;
    skipNextHistoryLoadForThreadRef.current = undefined;
    return true;
  }, []);
  const handleComposerDraftApplied = useCallback((draftId: number) => {
    setPendingComposerDraft(currentDraft =>
      currentDraft !== undefined
        && currentDraft.threadId === selectedThreadIdRef.current
        && currentDraft.request.id === draftId
        ? undefined
        : currentDraft
    );
  }, []);
  const editUserMessage = useCallback((
    item: Extract<TimelineItem, { kind: 'user_message' }>
  ) => {
    const threadId = selectedThreadIdRef.current;
    if (threadId === undefined) return;
    nextComposerDraftIdRef.current += 1;
    setPendingComposerDraft({
      threadId,
      request: {
        id: nextComposerDraftIdRef.current,
        text: item.text
      }
    });
  }, []);
  const threadHistory = useThreadHistory({
    threadId: state.selectedThreadId,
    targetItemId:
      searchHistoryTarget !== undefined
      && searchHistoryTarget.threadId === state.selectedThreadId
        ? searchHistoryTarget.itemId
        : undefined,
    enabled:
      connectionState.status === 'connected'
      && selectedThreadExists,
    service: threadService,
    reloadKey: threadHistoryReloadKey,
    consumeSkipInitialLoad: consumeSkipInitialHistoryLoad
  });

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      for (const batcher of timelineEventBatchersByThreadIdRef.current.values()) {
        batcher.clear();
      }
      timelineEventBatchersByThreadIdRef.current.clear();
      stopAllRunEventSubscriptions(false);
      for (const url of retainedAttachmentPreviewUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      retainedAttachmentPreviewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    function handleBrowserBack() {
      mobileSidebarHistoryEntryRef.current = false;
      setMobileSidebarOpen(false);
    }

    window.addEventListener('popstate', handleBrowserBack);
    return () => window.removeEventListener('popstate', handleBrowserBack);
  }, []);

  useEffect(() => {
    const routeKey = formatRoute(props.route);
    if (initialRouteKeyRef.current === routeKey) {
      initialRouteKeyRef.current = '';
      return;
    }
    if (pendingRouteKeyRef.current === routeKey) {
      pendingRouteKeyRef.current = undefined;
      return;
    }
    applyRouteFromLocation(props.route);
  }, [props.route]);

  useEffect(() => {
    selectedFilePathRef.current = state.selectedFilePath;
  }, [state.selectedFilePath]);

  useEffect(() => {
    if (timelineThreadIdRef.current === state.selectedThreadId) return;
    showTimelineForThread(state.selectedThreadId, [], false);
  }, [state.selectedThreadId]);

  useEffect(() => {
    if (!navigationPersistenceReadyRef.current) return;
    writePersistedNavigation({
      currentProjectId: state.currentProjectId,
      selectedThreadId: state.selectedThreadId
    });
  }, [state.currentProjectId, state.selectedThreadId]);

  useEffect(() => {
    connectionConfigRef.current = connectionConfig;
  }, [connectionConfig]);

  useEffect(() => {
    setNotificationSettings(notificationService.getSettings());
    setUnreadTaskIds(notificationService.getUnreadIds());
  }, [notificationService]);

  useEffect(() => {
    let active = true;
    if (
      hostBridge.kind !== 'desktop'
      || hostBridge.readDesktopPreferences === undefined
    ) {
      setDesktopCloseBehavior(undefined);
      return () => {
        active = false;
      };
    }
    void hostBridge.readDesktopPreferences()
      .then(preferences => {
        if (active) setDesktopCloseBehavior(preferences.closeBehavior);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [hostBridge]);

  useEffect(() => {
    const connection = connectionState.status === 'connected'
      ? connectionConfig
      : null;
    void notificationService.syncBackground(connection);
  }, [
    connectionConfig,
    connectionState.status,
    notificationService,
    notificationSettings.enabled
  ]);

  useEffect(() => {
    if (timelineApprovalTarget === undefined) return;
    const task = runtimeTasks.find(item => (
      item.threadId === timelineApprovalTarget.threadId
      && item.pendingApproval?.id === timelineApprovalTarget.approvalId
    ));
    const approval = task?.pendingApproval;
    if (approval === undefined) return;
    appendTimelineItemsForThread(timelineApprovalTarget.threadId, [{
      kind: 'approval',
      id: `restored_${approval.id}`,
      runId: approval.runId,
      approval,
      source: 'runtime'
    }]);
  }, [runtimeTasks, timelineApprovalTarget]);

  useEffect(() => {
    let canceled = false;
    taskStatusesRef.current = new Map();
    taskBaselineReadyRef.current = false;

    if (connectionState.status !== 'connected' || taskService === null) {
      setRuntimeTasks([]);
      return () => {
        canceled = true;
      };
    }
    const activeTaskService = taskService;

    async function refreshTasks() {
      try {
        const response = await activeTaskService.list({ status: 'all', limit: 50 });
        if (canceled) return;
        setRuntimeTasks(response.tasks);
        const result = collectTaskTransitions(
          taskStatusesRef.current,
          response.tasks,
          taskBaselineReadyRef.current
        );
        const transitionedTaskIds = new Set(result.transitions.map(task => task.id));
        const selectedThreadId = selectedThreadIdRef.current;
        const unseenSelectedTask = selectedThreadId === undefined
          ? undefined
            : response.tasks.find(task => (
              task.threadId === selectedThreadId
              && shouldAutoSubscribeTask(task, transitionedTaskIds.has(task.id))
              && runRegistryRef.current.runsById[task.runId] === undefined
            ));
        if (
          unseenSelectedTask !== undefined
          && unseenSelectedTask.threadId !== undefined
        ) {
          void refreshThreadRunState(unseenSelectedTask.threadId);
          const config = connectionConfigRef.current;
          if (config !== null) {
            subscribeToRunEvents(
              unseenSelectedTask.runId,
              unseenSelectedTask.threadId,
              config
            );
          }
        }
        taskStatusesRef.current = result.statuses;
        taskBaselineReadyRef.current = true;
        if (result.transitions.length === 0) return;

        setUnreadTaskIds(current => {
          const next = new Set(current);
          for (const task of result.transitions) next.add(task.id);
          notificationService.setUnreadIds(next);
          return next;
        });

        for (const task of result.transitions) {
          if (!notificationService.shouldNotifyInForeground(task.createdBy)) continue;
          if (!shouldSendSystemNotification(
            task,
            activeViewRef.current,
            selectedThreadIdRef.current
          )) continue;
          const message = createTaskNotification(task);
          void notificationService.notify(message).catch(() => undefined);
        }
      } catch {
        return;
      }
    }

    void refreshTasks();
    const interval = window.setInterval(() => void refreshTasks(), 5_000);
    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [connectionState.status, notificationService, taskService]);

  useEffect(() => {
    if (connectionState.status === 'connected') return;
    stopAllRunEventSubscriptions(false);
    dispatchRunRegistry({ type: 'reset' });
    setRunsLoadingThreadId(undefined);
    setRunsLoadedThreadId(undefined);
  }, [connectionState.status]);

  useEffect(() => {
    let canceled = false;
    const loadVersion = connectionConfigVersionRef.current;

    readHostRuntimeConfig(loadVersion, () => canceled);
    const unsubscribe = hostBridge.subscribeConnectionConfig?.(config => {
      if (canceled) return;
      connectionConfigVersionRef.current += 1;
      setConnectionConfig(config);
      if (config === null) {
        setConnectionState({ status: 'disconnected', message: '正在恢复本地服务连接' });
      }
    });

    return () => {
      canceled = true;
      unsubscribe?.();
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

  const availabilityProbeStatus = connectionState.status === 'connected'
    ? connectionState.codexStatus.availabilityProbe?.status
    : undefined;

  useEffect(() => {
    if (
      connectionService === null
      || connectionState.status !== 'connected'
      || availabilityProbeStatus !== 'pending'
    ) {
      return;
    }
    let canceled = false;
    const refresh = () => {
      void connectionService.check()
        .then(nextState => {
          if (!canceled) setConnectionState(nextState);
        })
        .catch(() => undefined);
    };
    const timer = window.setInterval(refresh, 1_500);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [
    availabilityProbeStatus,
    connectionService,
    connectionState.status
  ]);

  useEffect(() => {
    let canceled = false;

    if (
      connectionState.status !== 'connected'
      || projectService === null
      || threadService === null
    ) {
      if (connectionState.status !== 'connected') {
        setProjects([]);
        setArchivedProjects([]);
        setRuntimeThreads([]);
      }
      return () => {
        canceled = true;
      };
    }

    const activeProjectService = projectService;
    const activeThreadService = threadService;
    async function loadRuntimeWorkspace() {
      try {
        const legacyProjects = parseLegacyLocalStorageProjects(
          readJsonFromStorage<unknown>(PROJECTS_STORAGE_KEY)
        );
        const migration = await activeProjectService.migrateLocalStorageV1({
          projects: legacyProjects
        });
        let [activeResponse, allResponse] = await Promise.all([
          activeProjectService.listProjects('active'),
          activeProjectService.listProjects('all')
        ]);
        if (canceled) return;

        let initialProjectError: string | undefined;
        if (
          allResponse.projects.length === 0
          && hostBridge.ensureDefaultProjectDirectory !== undefined
        ) {
          try {
            const cwd = await hostBridge.ensureDefaultProjectDirectory();
            try {
              await activeProjectService.createProject({
                cwd,
                name: '默认项目'
              });
            } catch (error) {
              if (
                !(error instanceof ApiClientError)
                || error.code !== 'PROJECT_DIRECTORY_CONFLICT'
              ) {
                throw error;
              }
            }
            [activeResponse, allResponse] = await Promise.all([
              activeProjectService.listProjects('active'),
              activeProjectService.listProjects('all')
            ]);
            if (canceled) return;
          } catch (error) {
            initialProjectError = getRuntimeErrorMessage(
              error,
              '无法自动创建默认项目，请手动添加项目'
            );
          }
        }

        const activeProjects = activeResponse.projects;
        setProjects(activeProjects);
        setArchivedProjects(
          allResponse.projects.filter(project => project.status === 'archived')
        );
        setProjectLoadError(initialProjectError);

        const previousProjectId =
          persistedNavigation?.currentProjectId ?? currentProjectIdRef.current;
        const migratedProjectId = previousProjectId === undefined
          ? undefined
          : migration.projectIdMap[previousProjectId] ?? previousProjectId;
        const nextProjectId = activeProjects.some(project => project.id === migratedProjectId)
          ? migratedProjectId
          : activeProjects[0]?.id;
        dispatch({ type: 'set_current_project', projectId: nextProjectId });
        navigationPersistenceReadyRef.current = true;

        const response = await activeThreadService.listActiveThreads();
        if (canceled) return;
        setRuntimeThreads(response.threads);
        setThreadLoadError(undefined);

        const restoredThreadId = restoredThreadIdRef.current;
        restoredThreadIdRef.current = undefined;
        if (
          restoredThreadId === undefined
          || response.threads.some(thread => thread.id === restoredThreadId)
        ) return;

        try {
          const restored = await activeThreadService.getThread(restoredThreadId);
          if (canceled) return;
          if (restored.thread.status !== 'active' || !shouldShowThreadInSidebar(restored.thread)) {
            dispatch({ type: 'new_conversation' });
            return;
          }
          setRuntimeThreads(previous => upsertThread(previous, restored.thread));
        } catch (error) {
          if (canceled) return;
          if (error instanceof ApiClientError && error.status === 404) {
            dispatch({ type: 'new_conversation' });
            return;
          }
          setThreadLoadError('无法恢复上次打开的历史会话');
        }
      } catch {
        if (canceled) return;
        setProjects([]);
        setArchivedProjects([]);
        setRuntimeThreads([]);
        dispatch({ type: 'set_current_project', projectId: undefined });
        setProjectLoadError('无法迁移或加载项目，请稍后重试');
        setThreadLoadError(undefined);
      }
    }

    void loadRuntimeWorkspace();

    return () => {
      canceled = true;
    };
  }, [connectionState.status, hostBridge, projectService, threadService]);

  useEffect(() => {
    let canceled = false;

    if (connectionState.status !== 'connected' || scheduleService === null) {
      if (connectionState.status !== 'connected') setRuntimeSchedules([]);
      return () => {
        canceled = true;
      };
    }

    scheduleService
      .listSchedules()
      .then(response => {
        if (!canceled) setRuntimeSchedules(response.schedules);
      })
      .catch(() => {
        if (!canceled) setRuntimeSchedules([]);
      });

    return () => {
      canceled = true;
    };
  }, [connectionState.status, scheduleService]);

  useEffect(() => {
    connectionStatusRef.current = connectionState.status;
    capabilityServiceRef.current = capabilityService;
    skillMarketServiceRef.current = skillMarketService;
    threadServiceRef.current = threadService;
    scheduleServiceRef.current = scheduleService;
    skillMarketRuntimeGenerationRef.current += 1;
    skillMarketMutationInFlightRef.current = false;
    skillMarketUseInFlightRef.current = false;
    setSkillMarketOperation(undefined);
    setSkillMarketUseError(undefined);
  }, [
    capabilityService,
    connectionState.status,
    scheduleService,
    skillMarketService,
    threadService
  ]);

  useEffect(() => {
    if (
      defaultPermission === 'follow-project'
      || connectionState.status !== 'connected'
      || threadService === null
    ) {
      defaultPermissionAppliedByThreadRef.current.clear();
      if (defaultPermission === 'follow-project') {
        defaultPermissionSyncFailuresRef.current.clear();
        setDefaultPermissionSyncError(undefined);
      }
      return;
    }

    const sandbox = toRuntimeSandbox(defaultPermission);
    for (const thread of runtimeThreads) {
      if (thread.purpose !== 'conversation') continue;
      if (defaultPermissionAppliedByThreadRef.current.get(thread.id) === sandbox) continue;

      defaultPermissionAppliedByThreadRef.current.set(thread.id, sandbox);
      defaultPermissionSyncFailuresRef.current.delete(thread.id);
      if (thread.sandbox === sandbox) continue;

      void threadService
        .updateThread(thread.id, { sandbox })
        .then(response => {
          if (
            !mountedRef.current
            || defaultPermissionAppliedByThreadRef.current.get(thread.id) !== sandbox
          ) {
            return;
          }
          defaultPermissionSyncFailuresRef.current.delete(thread.id);
          setRuntimeThreads(previous => upsertThread(previous, response.thread));
          setDefaultPermissionSyncError(
            defaultPermissionSyncFailuresRef.current.size > 0
              ? '部分普通会话的全局权限同步失败，重新打开会话后会重试'
              : undefined
          );
        })
        .catch(() => {
          if (defaultPermissionAppliedByThreadRef.current.get(thread.id) === sandbox) {
            defaultPermissionAppliedByThreadRef.current.delete(thread.id);
          }
          if (!mountedRef.current) return;
          defaultPermissionSyncFailuresRef.current.add(thread.id);
          setDefaultPermissionSyncError('部分普通会话的全局权限同步失败，重新打开会话后会重试');
        });
    }
  }, [
    connectionState.status,
    defaultPermission,
    runtimeThreads,
    state.selectedThreadId,
    threadService
  ]);

  useEffect(() => {
    if (connectionState.status !== 'connected' || capabilityService === null || skillMarketService === null) {
      skillMarketMutationInFlightRef.current = false;
      skillMarketUseInFlightRef.current = false;
      capabilityLoadGenerationRef.current = undefined;
      profileLoadGenerationRef.current = undefined;
      skillMarketLoadGenerationRef.current = undefined;
      setCodexSkills(undefined);
      setCodexMcp(undefined);
      setCodexProfiles(undefined);
      setSkillMarketInstallRecords(undefined);
      setCapabilitiesLoading(false);
      setSkillMarketLoading(false);
      setCapabilitiesLoadError(undefined);
      setSkillMarketLoadError(undefined);
      setSkillMarketOperation(undefined);
      setSkillMarketUseError(undefined);
    }
  }, [capabilityService, connectionState.status, skillMarketService]);

  useEffect(() => {
    if (
      connectionState.status !== 'connected'
      || capabilityService === null
      || state.activeView !== 'conversation'
    ) {
      return;
    }

    const generation = skillMarketRuntimeGenerationRef.current;
    if (capabilityLoadGenerationRef.current === generation) {
      if (codexSkills !== undefined && codexMcp !== undefined) {
        setCapabilitiesLoadError(undefined);
      }
      return;
    }

    capabilityLoadGenerationRef.current = generation;
    setCapabilitiesLoading(true);
    setCapabilitiesLoadError(undefined);
    const activeCapabilityService = capabilityService;

    Promise.allSettled([
      codexSkills === undefined
        ? Promise.resolve().then(() => activeCapabilityService.listSkills())
        : Promise.resolve(codexSkills),
      codexMcp === undefined
        ? Promise.resolve().then(() => activeCapabilityService.listMcp())
        : Promise.resolve(codexMcp)
    ])
      .then(results => {
        if (!isCurrentCapabilityRuntime(generation, activeCapabilityService)) return;
        const [skillsResult, mcpResult] = results;
        if (skillsResult?.status === 'fulfilled') setCodexSkills(skillsResult.value);
        else setCodexSkills(undefined);
        if (mcpResult?.status === 'fulfilled') setCodexMcp(mcpResult.value);
        else setCodexMcp(undefined);
        if (skillsResult?.status === 'rejected' || mcpResult?.status === 'rejected') {
          setCapabilitiesLoadError('本机能力检测失败');
        }
      })
      .finally(() => {
        if (isCurrentCapabilityRuntime(generation, activeCapabilityService)) {
          setCapabilitiesLoading(false);
        }
      });
  }, [capabilityService, codexMcp, codexSkills, connectionState.status, state.activeView]);

  useEffect(() => {
    if (
      connectionState.status !== 'connected'
      || capabilityService === null
      || state.activeView !== 'conversation'
    ) {
      return;
    }

    let refreshing = false;
    const generation = skillMarketRuntimeGenerationRef.current;
    const activeCapabilityService = capabilityService;
    const refreshSkills = () => {
      if (refreshing || !isCurrentCapabilityRuntime(generation, activeCapabilityService)) return;
      refreshing = true;
      void activeCapabilityService.listSkills()
        .then(response => {
          if (isCurrentCapabilityRuntime(generation, activeCapabilityService)) {
            setCodexSkills(response);
            setCapabilitiesLoadError(undefined);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
        });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshSkills();
    };

    window.addEventListener('focus', refreshSkills);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', refreshSkills);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [capabilityService, connectionState.status, state.activeView]);

  useEffect(() => {
    if (
      connectionState.status !== 'connected'
      || capabilityService === null
      || (state.activeView !== 'conversation' && state.activeView !== 'schedules')
    ) {
      return;
    }

    const generation = skillMarketRuntimeGenerationRef.current;
    if (profileLoadGenerationRef.current === generation || codexProfiles !== undefined) {
      profileLoadGenerationRef.current = generation;
      return;
    }

    profileLoadGenerationRef.current = generation;
    const activeCapabilityService = capabilityService;
    Promise.resolve()
      .then(() => activeCapabilityService.listProfiles())
      .then(response => {
        if (isCurrentCapabilityRuntime(generation, activeCapabilityService)) {
          setCodexProfiles(response);
        }
      })
      .catch(() => {
        if (isCurrentCapabilityRuntime(generation, activeCapabilityService)) {
          setCodexProfiles(undefined);
        }
      });
  }, [capabilityService, codexProfiles, connectionState.status, state.activeView]);

  useEffect(() => {
    if (
      connectionState.status !== 'connected'
      || capabilityService === null
      || skillMarketService === null
      || state.activeView !== 'plugins'
    ) {
      return;
    }

    const generation = skillMarketRuntimeGenerationRef.current;
    if (skillMarketLoadGenerationRef.current === generation) {
      if (codexSkills !== undefined && skillMarketInstallRecords !== undefined) {
        setSkillMarketLoadError(undefined);
      }
      return;
    }

    skillMarketLoadGenerationRef.current = generation;
    setSkillMarketLoading(true);
    setSkillMarketLoadError(undefined);
    const activeCapabilityService = capabilityService;
    const activeSkillMarketService = skillMarketService;

    Promise.allSettled([
      codexSkills === undefined
        ? Promise.resolve().then(() => activeCapabilityService.listSkills())
        : Promise.resolve(codexSkills),
      Promise.resolve().then(() => activeSkillMarketService.listInstallRecords())
    ])
      .then(results => {
        if (!isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) return;
        const [skillsResult, recordsResult] = results;
        if (skillsResult?.status === 'fulfilled') setCodexSkills(skillsResult.value);
        else setCodexSkills(undefined);
        if (recordsResult?.status === 'fulfilled') setSkillMarketInstallRecords(recordsResult.value.records);
        else setSkillMarketInstallRecords(undefined);
        const marketErrors: string[] = [];
        if (skillsResult?.status === 'rejected') marketErrors.push('Skill 状态加载失败');
        if (recordsResult?.status === 'rejected') marketErrors.push('安装记录加载失败');
        setSkillMarketLoadError(marketErrors.length > 0 ? marketErrors.join('；') : undefined);
      })
      .finally(() => {
        if (isCurrentSkillMarketRuntime(generation, activeCapabilityService, activeSkillMarketService)) {
          setSkillMarketLoading(false);
        }
      });
  }, [
    capabilityService,
    codexSkills,
    connectionState.status,
    skillMarketInstallRecords,
    skillMarketService,
    state.activeView
  ]);

  useEffect(() => {
    if (!allowInitialRuntimeProjectFocusRef.current) return;
    if (state.activeView !== 'conversation' || state.selectedThreadId !== undefined) return;
    if (conversations.length === 0) return;

    const firstRuntimeProjectId = conversations[0]?.projectId;
    allowInitialRuntimeProjectFocusRef.current = false;
    if (firstRuntimeProjectId === undefined) return;

    navigationPersistenceReadyRef.current = true;
    if (firstRuntimeProjectId === state.currentProjectId) {
      writePersistedNavigation({ currentProjectId: firstRuntimeProjectId });
      return;
    }

    dispatch({ type: 'select_project', projectId: firstRuntimeProjectId });
  }, [conversations, state.activeView, state.currentProjectId, state.selectedThreadId]);

  useEffect(() => {
    const selectedThreadId = state.selectedThreadId;
    if (selectedThreadId === undefined || threadHistory.threadId !== selectedThreadId) {
      setThreadHistoryLoadError(undefined);
      setHistoryLoadingThreadId(undefined);
      setHistoryLoadedThreadId(undefined);
      return;
    }

    if (threadHistory.initialLoading) {
      setThreadHistoryLoadError(undefined);
      setHistoryLoadingThreadId(selectedThreadId);
      setHistoryLoadedThreadId(undefined);
      showTimelineForThread(selectedThreadId, [], false);
      return;
    }

    if (!threadHistory.loaded) {
      setHistoryLoadingThreadId(undefined);
      setHistoryLoadedThreadId(undefined);
      return;
    }

    if (
      threadHistory.codexThreadId !== undefined
      && threadHistory.codexThreadId !== null
    ) {
      setRuntimeThreads(previous => {
        let changed = false;
        const nextThreads = previous.map(thread => {
          if (
            thread.id !== selectedThreadId
            || thread.codexThreadId === threadHistory.codexThreadId
          ) {
            return thread;
          }
          changed = true;
          return { ...thread, codexThreadId: threadHistory.codexThreadId };
        });
        return changed ? nextThreads : previous;
      });
    }

    const historyItems = mapHistoryItemsToTimelineItems(threadHistory.items);
    const cachedItems = timelineItemsByThreadIdRef.current[selectedThreadId] ?? [];
    showTimelineForThread(
      selectedThreadId,
      mergeTimelineHistoryWithCache(historyItems, cachedItems),
      true
    );
    setThreadHistoryLoadError(threadHistory.error);
    setHistoryLoadingThreadId(undefined);
    setHistoryLoadedThreadId(selectedThreadId);
  }, [
    state.selectedThreadId,
    threadHistory.codexThreadId,
    threadHistory.error,
    threadHistory.initialLoading,
    threadHistory.items,
    threadHistory.loaded,
    threadHistory.threadId
  ]);

  useEffect(() => {
    let canceled = false;
    const selectedThreadId = state.selectedThreadId;

    if (
      selectedThreadId === undefined
      || threadService === null
      || connectionState.status !== 'connected'
      || !selectedThreadExists
    ) {
      setRunsLoadingThreadId(undefined);
      setRunsLoadedThreadId(undefined);
      return () => {
        canceled = true;
      };
    }

    setRunsLoadingThreadId(selectedThreadId);
    setRunsLoadedThreadId(undefined);
    const knownRunIdsAtRequestStart = [
      ...(runRegistryRef.current.runIdsByThreadId[selectedThreadId] ?? [])
    ];
    threadService
      .listThreadRuns(selectedThreadId)
      .then(response => {
        if (canceled) return;
        setRunAttachmentsById(previous => {
          const next = { ...previous };
          for (const run of response.runs) next[run.id] = run.attachments ?? [];
          return next;
        });
        dispatchRunRegistry({
          type: 'merge_thread_runs',
          threadId: selectedThreadId,
          knownRunIdsAtRequestStart,
          runs: response.runs
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!canceled) {
          setRunsLoadingThreadId(current => (
            current === selectedThreadId ? undefined : current
          ));
          setRunsLoadedThreadId(selectedThreadId);
        }
      });

    return () => {
      canceled = true;
    };
  }, [connectionState.status, state.selectedThreadId, selectedThreadExists, threadService]);

  useEffect(() => {
    const selectedThreadId = state.selectedThreadId;
    if (
      selectedThreadId === undefined
      || connectionConfig === null
      || connectionState.status !== 'connected'
      || historyLoadedThreadId !== selectedThreadId
      || runsLoadedThreadId !== selectedThreadId
    ) return;

    const activeRun = getThreadActiveRun(runRegistry, selectedThreadId);
    if (activeRun === undefined) return;
    if (runEventControllersRef.current.has(activeRun.id)) return;

    subscribeToRunEvents(activeRun.id, selectedThreadId, connectionConfig);
  }, [
    connectionConfig,
    connectionState.status,
    historyLoadedThreadId,
    runRegistry,
    runsLoadedThreadId,
    state.selectedThreadId
  ]);

  useEffect(() => {
    const target = timelineRunTarget;
    if (target === undefined) {
      replayedTargetRunKeyRef.current = undefined;
      return;
    }
    const targetKey = `${target.threadId}:${target.runId}`;
    if (
      target.threadId !== state.selectedThreadId
      || connectionConfig === null
      || connectionState.status !== 'connected'
      || runsLoadedThreadId !== target.threadId
      || runRegistry.runsById[target.runId] === undefined
      || replayedTargetRunKeyRef.current === targetKey
    ) {
      return;
    }

    replayedTargetRunKeyRef.current = targetKey;
    subscribeToRunEvents(target.runId, target.threadId, connectionConfig);
  }, [
    connectionConfig,
    connectionState.status,
    runRegistry,
    runsLoadedThreadId,
    state.selectedThreadId,
    timelineRunTarget
  ]);

  useEffect(() => {
    for (const [runId, subscription] of runEventControllersRef.current.entries()) {
      const run = runRegistry.runsById[runId];
      if (run === undefined || !isTerminalRunStatus(run.status)) continue;
      const consumedSeq = runRegistry.lastSeqByRunId[runId] ?? 0;
      if (consumedSeq < (run.lastEventSeq ?? 0)) continue;
      runEventControllersRef.current.delete(runId);
      subscription.controller.stop();
      timelineEventBatchersByThreadIdRef.current.get(subscription.threadId)?.flush();
    }
  }, [runRegistry.runsById]);

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
  const selectedRunAttachments =
    state.selectedRunId === undefined ? undefined : runAttachmentsById[state.selectedRunId];
  const selectedRunContext =
    state.selectedRunId === undefined ? undefined : runContextById[state.selectedRunId];
  const currentProject = findProjectById(projects, state.currentProjectId);
  const currentProjectName = currentProject?.name ?? '未选择项目';
  const selectedConversation = conversations.find(conversation => conversation.id === state.selectedThreadId);
  const selectedScheduleTask = scheduleTaskSummaries.find(
    task => task.threadId === state.selectedThreadId
  );
  const selectedSchedule = selectedScheduleTask === undefined
    ? undefined
    : runtimeSchedules.find(schedule => schedule.id === selectedScheduleTask.scheduleId);
  const selectedSidebarTask = selectedScheduleTask === undefined
    ? undefined
    : scheduleSidebarTasks.find(task => task.id === selectedScheduleTask.scheduleId);
  const selectedThread = runtimeThreads.find(thread => thread.id === state.selectedThreadId);
  const selectedActiveRun = getThreadActiveRun(runRegistry, state.selectedThreadId);
  const selectedPendingRunStart = findPendingRunStart(
    pendingRunStartsById,
    state.selectedThreadId
  );
  const currentRunBusy = selectedActiveRun !== undefined || selectedPendingRunStart !== undefined;
  const currentRunCanceling = selectedActiveRun === undefined
    ? selectedPendingRunStart?.cancelRequested === true
    : getRunCancelState(runRegistry, selectedActiveRun.id) === 'requested';
  const runtimeStatus = mapRuntimeStatus(connectionState);
  const slashCommands = useMemo(
    () => buildComposerSlashCommands(codexSkills),
    [codexSkills]
  );
  const composerQueuedItems = useMemo<ComposerQueuedItem[]>(
    () => timelineItems.flatMap(item => (
      item.kind === 'user_message'
      && item.runStatus === 'queued'
      && item.runId !== undefined
        ? [{
            runId: item.runId,
            text: item.text,
            queuePosition: item.queuePosition
          }]
        : []
    )),
    [timelineItems]
  );
  const composerAttachmentScope = `${state.currentProjectId}:${state.selectedThreadId ?? 'new'}`;
  const composerAttachmentDraftId = getOrCreateComposerAttachmentDraftId(
    composerAttachmentDraftIdsRef.current,
    composerAttachmentScope
  );
  const imageInputSupported = readImageInputSupported(connectionState, selectedThread);
  const memoryProjectOptions = useMemo(
    () => buildMemoryProjectOptions(visibleRuntimeThreads, projects),
    [projects, visibleRuntimeThreads]
  );
  const memoryThreadOptions = useMemo(
    () => visibleRuntimeThreads.map(thread => ({
      key: thread.id,
      label: thread.title?.trim() || thread.id
    })),
    [visibleRuntimeThreads]
  );
  const currentMemoryProjectKey = selectedThread === undefined
    ? state.currentProjectId
    : selectedThread.purpose === 'conversation'
      ? selectedThread.projectId ?? undefined
      : undefined;

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

  function setTimelineItems(
    update: TimelineItem[] | ((previous: TimelineItem[]) => TimelineItem[])
  ) {
    const nextItems = typeof update === 'function'
      ? update(timelineItemsRef.current)
      : update;
    const threadId = timelineThreadIdRef.current;
    timelineItemsRef.current = nextItems;
    if (threadId !== undefined) {
      timelineItemsByThreadIdRef.current[threadId] = nextItems;
    }
    setTimelineItemsState(nextItems);
  }

  function appendTimelineItemsForThread(threadId: string, items: TimelineItem[]) {
    if (items.length === 0) return;
    const previousItems = timelineItemsByThreadIdRef.current[threadId]
      ?? (timelineThreadIdRef.current === threadId ? timelineItemsRef.current : []);
    const nextItems = mergeTimelineItems(previousItems, items);
    timelineItemsByThreadIdRef.current[threadId] = nextItems;
    if (timelineThreadIdRef.current !== threadId) return;
    timelineItemsRef.current = nextItems;
    setTimelineItemsState(nextItems);
  }

  function replaceApproval(response: ApprovalDecisionResponse) {
    const threadId = response.approval.threadId ?? undefined;
    if (threadId === undefined) return;
    updateTimelineItemsForThread(threadId, items => items.map(item => (
      item.kind === 'approval' && item.approval.id === response.approval.id
        ? { ...item, approval: response.approval }
        : item
    )));
  }

  async function resolveApproval(id: string, decision: 'approve' | 'reject') {
    if (approvalService === null || resolvingApprovalIds.has(id)) return;
    setResolvingApprovalIds(previous => new Set(previous).add(id));
    setApprovalErrors(previous => ({ ...previous, [id]: undefined }));
    try {
      const response = decision === 'approve'
        ? await approvalService.approve(id)
        : await approvalService.reject(id);
      replaceApproval(response);
    } catch (error) {
      setApprovalErrors(previous => ({
        ...previous,
        [id]: error instanceof Error ? error.message : '审批操作失败'
      }));
    } finally {
      setResolvingApprovalIds(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  function updateTimelineItemsForThread(
    threadId: string,
    update: (items: TimelineItem[]) => TimelineItem[]
  ) {
    const previousItems = timelineItemsByThreadIdRef.current[threadId]
      ?? (timelineThreadIdRef.current === threadId ? timelineItemsRef.current : []);
    const nextItems = update(previousItems);
    timelineItemsByThreadIdRef.current[threadId] = nextItems;
    if (timelineThreadIdRef.current !== threadId) return;
    timelineItemsRef.current = nextItems;
    setTimelineItemsState(nextItems);
  }

  function getTimelineEventBatcher(threadId: string): FrameBatcher<TimelineItem> {
    const existing = timelineEventBatchersByThreadIdRef.current.get(threadId);
    if (existing !== undefined) return existing;
    const batcher = createFrameBatcher<TimelineItem>({
      onFlush(items) {
        if (!mountedRef.current) return;
        appendTimelineItemsForThread(threadId, items);
      }
    });
    timelineEventBatchersByThreadIdRef.current.set(threadId, batcher);
    return batcher;
  }

  function showTimelineForThread(
    threadId: string | undefined,
    items: TimelineItem[],
    cache: boolean
  ) {
    timelineThreadIdRef.current = threadId;
    timelineItemsRef.current = items;
    if (cache && threadId !== undefined) {
      timelineItemsByThreadIdRef.current[threadId] = items;
    }
    setTimelineItemsState(items);
  }

  function adoptCurrentTimelineForThread(threadId: string) {
    timelineThreadIdRef.current = threadId;
    timelineItemsByThreadIdRef.current[threadId] = timelineItemsRef.current;
  }

  function updatePendingRunStart(next: PendingRunStart) {
    const updated = {
      ...pendingRunStartsByIdRef.current,
      [next.id]: next
    };
    pendingRunStartsByIdRef.current = updated;
    if (mountedRef.current) setPendingRunStartsById(updated);
  }

  function removePendingRunStart(id: string) {
    if (pendingRunStartsByIdRef.current[id] === undefined) return;
    const updated = { ...pendingRunStartsByIdRef.current };
    delete updated[id];
    pendingRunStartsByIdRef.current = updated;
    if (mountedRef.current) setPendingRunStartsById(updated);
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

  function handleColorModeChange(mode: ColorMode) {
    setColorMode(mode);
    applyColorMode(mode);
    writeColorModePreference(mode);
  }

  function handleDefaultPermissionChange(permission: DefaultPermissionPreference) {
    setDefaultPermission(permission);
    setComposerRunConfig(null);
    defaultPermissionSyncFailuresRef.current.clear();
    setDefaultPermissionSyncError(undefined);
    writeDefaultPermissionPreference(permission);
  }

  function openMobileSidebar() {
    setSidebarCollapsed(false);
    if (
      isMobileNavigationViewport()
      && !mobileSidebarHistoryEntryRef.current
    ) {
      window.history.pushState(
        { ...window.history.state, claweeMobileNavigation: true },
        ''
      );
      mobileSidebarHistoryEntryRef.current = true;
    }
    setMobileSidebarOpen(true);
  }

  function closeMobileSidebar() {
    setMobileSidebarOpen(false);
    if (window.history.state?.claweeMobileNavigation !== true) {
      mobileSidebarHistoryEntryRef.current = false;
    }
  }

  function dismissMobileSidebar() {
    setMobileSidebarOpen(false);
    if (
      mobileSidebarHistoryEntryRef.current
      && window.history.state?.claweeMobileNavigation === true
    ) {
      mobileSidebarHistoryEntryRef.current = false;
      window.history.back();
    }
  }

  async function submitPrompt(
    prompt: string,
    config?: ComposerRunConfig,
    attachments: ComposerAttachment[] = [],
    submissionMode?: RunSubmissionMode
  ): Promise<boolean> {
    if (
      connectionState.status === 'connected'
      && runService !== null
      && threadService !== null
      && connectionConfigRef.current !== null
    ) {
      const submitted = await submitRuntimePrompt(prompt, config, attachments, submissionMode);
      if (submitted && shouldSuggestMemory(prompt)) {
        setPendingMemorySuggestion({
          id: Date.now(),
          content: prompt.trim().slice(0, 2000)
        });
      }
      return submitted;
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
    return false;
  }

  function startNewConversation(options: {
    updateRoute?: boolean;
    projectId?: string;
  } = {}) {
    closeMobileSidebar();
    allowInitialRuntimeProjectFocusRef.current = false;
    navigationPersistenceReadyRef.current = true;
    showTimelineForThread(undefined, [], false);
    setHistoryLoadingThreadId(undefined);
    setHistoryLoadedThreadId(undefined);
    setRunsLoadedThreadId(undefined);
    setThreadConfigUpdateError(undefined);
    setSearchHistoryTarget(undefined);
    setTimelineRunTarget(undefined);
    setTimelineApprovalTarget(undefined);
    if (
      options.projectId !== undefined
      && options.projectId !== state.currentProjectId
    ) {
      dispatch({ type: 'select_project', projectId: options.projectId });
    }
    dispatch({ type: 'new_conversation' });
    if (options.updateRoute !== false) navigateToRoute({ view: 'home' });
  }

  function selectProject(projectId: string, options: { updateRoute?: boolean } = {}) {
    closeMobileSidebar();
    allowInitialRuntimeProjectFocusRef.current = false;
    navigationPersistenceReadyRef.current = true;
    setComposerRunConfig(null);
    showTimelineForThread(undefined, [], false);
    setHistoryLoadingThreadId(undefined);
    setHistoryLoadedThreadId(undefined);
    setRunsLoadedThreadId(undefined);
    setThreadConfigUpdateError(undefined);
    setSearchHistoryTarget(undefined);
    setTimelineRunTarget(undefined);
    setTimelineApprovalTarget(undefined);
    dispatch({ type: 'select_project', projectId });
    if (options.updateRoute !== false) navigateToRoute({ view: 'home' });
  }

  async function addProjectDirectory() {
    const selectDirectory = hostBridge.selectProjectDirectory;
    if (
      selectDirectory === undefined
      || projectService === null
      || projectDirectoryDialogInFlightRef.current
    ) return;
    projectDirectoryDialogInFlightRef.current = true;
    try {
      const path = await selectDirectory();
      if (path === null) return;
      await registerProjectDirectory(path);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '添加项目失败，请重试'));
    } finally {
      projectDirectoryDialogInFlightRef.current = false;
    }
  }

  async function createBlankProject(name: string): Promise<boolean> {
    const createDirectory = hostBridge.createProjectDirectory;
    if (
      createDirectory === undefined
      || projectService === null
      || projectDirectoryDialogInFlightRef.current
    ) return false;
    projectDirectoryDialogInFlightRef.current = true;
    try {
      const path = await createDirectory(name);
      await registerProjectDirectory(path);
      return true;
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '新建项目失败，请重试'));
      return false;
    } finally {
      projectDirectoryDialogInFlightRef.current = false;
    }
  }

  async function registerProjectDirectory(path: string) {
    if (projectService === null) return;
    try {
      const response = await projectService.createProject({ cwd: path });
      setProjects(current => upsertProject(current, response.project));
      selectProject(response.project.id);
      setProjectLoadError(undefined);
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code !== 'PROJECT_DIRECTORY_CONFLICT') {
        throw error;
      }
      const refreshed = await projectService.listProjects('active');
      setProjects(refreshed.projects);
      const existing = refreshed.projects.find(project => (
        normalizeWorkspacePath(project.cwd) === normalizeWorkspacePath(path)
        || (
          project.canonicalCwd !== null
          && normalizeWorkspacePath(project.canonicalCwd) === normalizeWorkspacePath(path)
        )
      ));
      if (existing !== undefined) {
        selectProject(existing.id);
        setProjectLoadError(undefined);
        return;
      }
      throw new Error('项目已存在，但无法在项目列表中找到');
    }
  }

  function handleProjectDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!canImportDroppedProject(event.dataTransfer, hostBridge, projectService)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setProjectDropActive(true);
  }

  function handleProjectDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!canImportDroppedProject(event.dataTransfer, hostBridge, projectService)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!projectDropActive) setProjectDropActive(true);
  }

  function handleProjectDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setProjectDropActive(false);
  }

  async function handleProjectDrop(event: ReactDragEvent<HTMLDivElement>) {
    const file = readDroppedDirectory(event.dataTransfer);
    if (
      file === undefined
      || hostBridge.resolveDroppedFilePath === undefined
      || projectService === null
    ) {
      setProjectDropActive(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setProjectDropActive(false);

    const path = hostBridge.resolveDroppedFilePath(file);
    if (path === null) {
      setProjectLoadError('无法读取拖入的项目文件夹路径');
      return;
    }
    try {
      await registerProjectDirectory(path);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '拖入项目失败，请确认选择的是文件夹'));
    }
  }

  async function archiveProject(projectId: string) {
    if (projectService === null) return;
    try {
      const response = await projectService.archiveProject(projectId);
      const remaining = projects.filter(project => project.id !== projectId);
      setProjects(remaining);
      setArchivedProjects(current => upsertProject(current, response.project));
      if (state.currentProjectId === projectId) {
        const nextProjectId = remaining[0]?.id;
        if (nextProjectId === undefined) {
          dispatch({ type: 'set_current_project', projectId: undefined });
          startNewConversation();
        } else {
          selectProject(nextProjectId);
        }
      }
      setProjectLoadError(undefined);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '移除项目失败，请重试'));
    }
  }

  async function openProjectManagement(projectId?: string) {
    setProjectManagementProjectId(projectId);
    setProjectManagementOpen(true);
    if (projectService === null) return;
    try {
      const response = await projectService.listUnassignedThreads();
      if (mountedRef.current) setUnassignedThreads(response.threads);
    } catch (error) {
      if (mountedRef.current) {
        setProjectLoadError(getRuntimeErrorMessage(error, '无法加载待归属会话'));
      }
    }
  }

  async function refreshProjectsFromRuntime() {
    if (projectService === null) return;
    const [activeResponse, allResponse] = await Promise.all([
      projectService.listProjects('active'),
      projectService.listProjects('all')
    ]);
    setProjects(activeResponse.projects);
    setArchivedProjects(
      allResponse.projects.filter(project => project.status === 'archived')
    );
  }

  async function updateManagedProject(
    projectId: string,
    input: Parameters<ProjectService['updateProject']>[1]
  ) {
    if (projectService === null) return;
    setProjectMutationBusy(true);
    try {
      const response = await projectService.updateProject(projectId, input);
      setProjects(current => upsertProject(current, response.project));
      setProjectLoadError(undefined);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '更新项目失败，请重试'));
    } finally {
      setProjectMutationBusy(false);
    }
  }

  async function restoreManagedProject(projectId: string) {
    if (projectService === null) return;
    setProjectMutationBusy(true);
    try {
      await projectService.restoreProject(projectId);
      await refreshProjectsFromRuntime();
      setProjectLoadError(undefined);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '恢复项目失败，请重试'));
    } finally {
      setProjectMutationBusy(false);
    }
  }

  async function replaceManagedProjectDirectory(projectId: string) {
    if (projectService === null || hostBridge.selectProjectDirectory === undefined) return;
    const cwd = await hostBridge.selectProjectDirectory();
    if (cwd === null) return;
    setProjectMutationBusy(true);
    try {
      const response = await projectService.replaceProjectDirectory(projectId, { cwd });
      setProjects(current => upsertProject(current, response.project));
      setProjectLoadError(undefined);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '更换项目目录失败，请重试'));
    } finally {
      setProjectMutationBusy(false);
    }
  }

  async function assignManagedThread(threadId: string, projectId: string) {
    if (projectService === null) return;
    setProjectMutationBusy(true);
    try {
      const response = await projectService.assignThreadProject(threadId, { projectId });
      setRuntimeThreads(current => upsertThread(current, response.thread));
      setUnassignedThreads(current => current.filter(thread => thread.id !== threadId));
      setProjectLoadError(undefined);
    } catch (error) {
      setProjectLoadError(getRuntimeErrorMessage(error, '认领会话失败，请重试'));
    } finally {
      setProjectMutationBusy(false);
    }
  }

  async function deleteScheduleDraft(threadId: string) {
    if (threadService === null) return;
    try {
      await threadService.archiveThread(threadId);
      setRuntimeThreads(current => current.filter(thread => thread.id !== threadId));
      delete timelineItemsByThreadIdRef.current[threadId];
      if (state.selectedThreadId === threadId) {
        startNewConversation();
      }
      setThreadLoadError(undefined);
    } catch (error) {
      setThreadLoadError(getRuntimeErrorMessage(error, '删除任务草稿失败，请重试'));
    }
  }

  function selectConversation(conversationId: string, options: { updateRoute?: boolean } = {}) {
    closeMobileSidebar();
    allowInitialRuntimeProjectFocusRef.current = false;
    navigationPersistenceReadyRef.current = true;
    setThreadConfigUpdateError(undefined);
    setSearchHistoryTarget(undefined);
    setTimelineRunTarget(undefined);
    setTimelineApprovalTarget(undefined);
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
        setHistoryLoadingThreadId(conversationId);
        setHistoryLoadedThreadId(undefined);
        setThreadHistoryReloadKey(previous => previous + 1);
      }
      if (options.updateRoute !== false) {
        navigateToRoute({ view: 'thread', threadId: conversationId });
      }
      return;
    }

    setHistoryLoadingThreadId(conversationId);
    setHistoryLoadedThreadId(undefined);
    setRunsLoadedThreadId(undefined);
    showTimelineForThread(conversationId, [], false);
    dispatch({ type: 'select_thread', threadId: conversationId });
    if (options.updateRoute !== false) {
      navigateToRoute({ view: 'thread', threadId: conversationId });
    }
  }

  function selectSidebarTask(threadId: string) {
    const thread = runtimeThreads.find(item => item.id === threadId);
    if (thread === undefined) return;
    markThreadTasksRead(threadId);
    selectConversation(threadId);
  }

  function navigateToRoute(route: AppRoute, options?: { replace?: boolean }) {
    const routeKey = formatRoute(route);
    const replaceMobileSidebarEntry =
      mobileSidebarHistoryEntryRef.current
      && window.history.state?.claweeMobileNavigation === true;
    if (replaceMobileSidebarEntry) {
      mobileSidebarHistoryEntryRef.current = false;
      setMobileSidebarOpen(false);
    }
    if (routeKey === formatRoute(props.route) && !replaceMobileSidebarEntry) return;
    pendingRouteKeyRef.current = routeKey;
    props.onNavigate(route, {
      ...options,
      replace: options?.replace === true || replaceMobileSidebarEntry
    });
  }

  function applyRouteFromLocation(route: AppRoute) {
    switch (route.view) {
      case 'home':
        startNewConversation({ updateRoute: false });
        return;
      case 'thread':
        void openScheduleTask(route.threadId, route.runId, {
          updateRoute: false,
          approvalId: route.approvalId
        });
        return;
      case 'search':
      case 'schedules':
      case 'tasks':
      case 'plugins':
      case 'settings':
        closeMobileSidebar();
        dispatch({
          type: 'set_active_view',
          activeView: route.view
        });
        return;
      case 'files':
        closeMobileSidebar();
        if (route.threadId !== undefined && route.threadId !== state.selectedThreadId) {
          selectConversation(route.threadId, { updateRoute: false });
        }
        if (route.path === undefined) {
          dispatch({ type: 'open_files' });
        } else {
          dispatch({ type: 'select_workspace_file', path: route.path });
        }
        return;
      case 'capabilities':
        return;
    }
  }

  function openPrimaryView(activeView: ActiveView) {
    closeMobileSidebar();
    if (activeView === 'files') {
      dispatch({ type: 'open_files' });
      navigateToRoute({
        view: 'files',
        ...(state.selectedThreadId === undefined ? {} : { threadId: state.selectedThreadId })
      });
      return;
    }

    dispatch({ type: 'set_active_view', activeView });
    navigateToRoute(routeForActiveView(activeView, state.selectedThreadId));
  }

  function closeFileWorkspace() {
    dispatch({ type: 'close_file_workspace' });
    navigateToRoute(routeForConversation(state.selectedThreadId));
  }

  function selectWorkspaceFile(path: string) {
    dispatch({ type: 'select_workspace_file', path });
    navigateToRoute({
      view: 'files',
      ...(state.selectedThreadId === undefined ? {} : { threadId: state.selectedThreadId }),
      path
    });
  }

  async function openSearchResult(result: ConversationSearchResult) {
    closeMobileSidebar();
    if (threadService === null) return;
    let thread = runtimeThreads.find(item => item.id === result.threadId);
    if (thread === undefined) {
      try {
        const response = await threadService.getThread(result.threadId);
        if (!mountedRef.current) return;
        thread = response.thread;
        setRuntimeThreads(previous => upsertThread(previous, response.thread));
      } catch {
        if (mountedRef.current) setThreadLoadError('无法打开搜索结果对应的会话');
        return;
      }
    }

    allowInitialRuntimeProjectFocusRef.current = false;
    navigationPersistenceReadyRef.current = true;
    setThreadLoadError(undefined);
    setThreadConfigUpdateError(undefined);
    setTimelineRunTarget(undefined);
    setTimelineApprovalTarget(undefined);
    setHistoryLoadingThreadId(thread.id);
    setHistoryLoadedThreadId(undefined);
    setRunsLoadedThreadId(undefined);
    setSearchHistoryTarget(undefined);
    showTimelineForThread(thread.id, [], false);

    if (result.projectId !== state.currentProjectId) {
      dispatch({ type: 'set_current_project', projectId: result.projectId });
    }
    dispatch({ type: 'select_thread', threadId: thread.id });
    navigateToRoute({ view: 'thread', threadId: thread.id });
    setThreadHistoryReloadKey(previous => previous + 1);
  }

  async function handleComposerPermissionChange(
    permission: ComposerRunConfig['permission']
  ): Promise<boolean> {
    const baseConfig = composerRunConfig
      ?? defaultComposerRunConfig(currentProject, defaultPermission);

    if (selectedThread === undefined) {
      setComposerRunConfig({ ...baseConfig, permission });
      setThreadConfigUpdateError(undefined);
      return true;
    }
    if (currentRunBusy) {
      setThreadConfigUpdateError('任务运行期间不能修改访问权限，请等待当前任务结束');
      return false;
    }

    const sandbox = toRuntimeSandbox(permission);
    if (sandbox === selectedThread.sandbox) {
      setThreadConfigUpdateError(undefined);
      return true;
    }
    if (threadService === null) {
      setThreadConfigUpdateError('本地服务暂不可用，无法更新会话访问权限');
      return false;
    }

    try {
      const response = await threadService.updateThread(selectedThread.id, { sandbox });
      if (!mountedRef.current) return false;
      setRuntimeThreads(previous => upsertThread(previous, response.thread));
      setThreadConfigUpdateError(undefined);
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setThreadConfigUpdateError(
          error instanceof ApiClientError && error.code === 'THREAD_HAS_ACTIVE_RUN'
            ? '任务运行期间不能修改访问权限，请等待当前任务结束'
            : '无法更新会话访问权限'
        );
      }
      return false;
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

  function isCurrentCapabilityRuntime(
    generation: number,
    activeCapabilityService: CapabilityService
  ) {
    return mountedRef.current
      && skillMarketRuntimeGenerationRef.current === generation
      && connectionStatusRef.current === 'connected'
      && capabilityServiceRef.current === activeCapabilityService;
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

  async function useMarketSkill(skillId: string, projectId: string) {
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

    const project = findProjectById(projects, projectId);
    if (project === undefined) {
      setSkillMarketUseError({ skillId, error: '未找到所选项目' });
      return;
    }
    const config = defaultComposerRunConfig(project, defaultPermission);
    const title = getSkillMarketDisplayTitle(entry);
    const generation = skillMarketRuntimeGenerationRef.current;
    skillMarketUseInFlightRef.current = true;

    try {
      const request = buildThreadRequest(title, project, config);
      const created = await activeThreadService.createThread(request);
      if (!isCurrentThreadRuntime(generation, activeThreadService)) return;

      setRuntimeThreads(previous => upsertThread(previous, created.thread));
      showTimelineForThread(created.thread.id, [], true);
      setThreadHistoryLoadError(undefined);
      setHistoryLoadingThreadId(undefined);
      setHistoryLoadedThreadId(created.thread.id);
      setRunsLoadedThreadId(undefined);
      setThreadConfigUpdateError(undefined);
      skipNextHistoryLoadForThreadRef.current = created.thread.id;
      allowInitialRuntimeProjectFocusRef.current = false;
      if (project.id !== state.currentProjectId) {
        dispatch({ type: 'select_project', projectId: project.id });
      }
      dispatch({ type: 'select_thread', threadId: created.thread.id });
      navigateToRoute({ view: 'thread', threadId: created.thread.id });
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

  async function submitRuntimePrompt(
    prompt: string,
    config?: ComposerRunConfig,
    attachments: ComposerAttachment[] = [],
    submissionMode?: RunSubmissionMode
  ): Promise<boolean> {
    if (runService === null || threadService === null || connectionConfigRef.current === null) {
      return false;
    }
    if (
      findPendingRunStart(
        pendingRunStartsByIdRef.current,
        state.selectedThreadId
      ) !== undefined
      || (
        runsLoadingThreadId !== undefined
        && runsLoadingThreadId === state.selectedThreadId
      )
    ) return false;

    const effectiveConfig = config
      ?? composerRunConfig
      ?? defaultComposerRunConfig(currentProject, defaultPermission);
    setComposerRunConfig(effectiveConfig);
    const pendingRunStartId = createTimelineId('pending_start');
    updatePendingRunStart({
      id: pendingRunStartId,
      threadId: state.selectedThreadId,
      cancelRequested: false
    });
    let runThreadId = state.selectedThreadId;
    const userMessageId = createTimelineId('user');
    const attachmentMetadata = attachments.map(item => item.attachment);
    const attachmentPreviewUrls = Object.fromEntries(
      attachments.map(item => [item.attachment.id, item.previewUrl])
    );
    for (const item of attachments) {
      const previousUrl = retainedAttachmentPreviewUrlsRef.current.get(item.attachment.id);
      if (previousUrl !== undefined && previousUrl !== item.previewUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      retainedAttachmentPreviewUrlsRef.current.set(item.attachment.id, item.previewUrl);
    }
    setTimelineItems(previous => [
      ...previous,
      {
        kind: 'user_message',
        id: userMessageId,
        text: prompt,
        attachments: attachmentMetadata,
        attachmentPreviewUrls,
        source: 'runtime'
      }
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
      runThreadId = resolvedThread.threadId;
      const pendingRunStart = pendingRunStartsByIdRef.current[pendingRunStartId];
      updatePendingRunStart({
        id: pendingRunStartId,
        threadId: resolvedThread.threadId,
        cancelRequested: pendingRunStart?.cancelRequested ?? false
      });
      const runInput: {
        threadId: string;
        prompt: string;
        resumeMode: 'auto';
        model?: string;
        reasoning?: NonNullable<ComposerRunConfig['reasoning']>;
        draftId?: string;
        attachmentIds?: string[];
        submissionMode?: RunSubmissionMode;
      } = {
        threadId: resolvedThread.threadId,
        prompt,
        resumeMode: 'auto'
      };
      if (submissionMode !== undefined) runInput.submissionMode = submissionMode;
      if (resolvedThread.created) {
        if (effectiveConfig.model !== null) runInput.model = effectiveConfig.model;
        if (effectiveConfig.reasoning !== null) runInput.reasoning = effectiveConfig.reasoning;
      }
      if (attachments.length > 0) {
        const draftId = attachments[0]!.attachment.draftId;
        if (draftId === undefined) throw new Error('附件缺少草稿归属，无法发送');
        runInput.draftId = draftId;
        runInput.attachmentIds = attachments.map(item => item.attachment.id);
      }
      const run = await runService.startThreadRun(runInput);
      setRunAttachmentsById(previous => ({
        ...previous,
        [run.id]: run.attachments ?? attachmentMetadata
      }));
      updateTimelineItemsForThread(resolvedThread.threadId, previous => previous.map(item =>
        item.id === userMessageId && item.kind === 'user_message'
          ? {
              ...item,
              attachments: run.attachments ?? attachmentMetadata,
              runId: run.id,
              runStatus: run.status,
              submissionMode: run.submissionMode ?? submissionMode ?? 'enqueue',
              queuePosition: run.queuePosition
            }
          : item
      ));
      handleRunStarted(run);
      void refreshThreadRunState(resolvedThread.threadId);
      const cancelRequested = pendingRunStartsByIdRef.current[pendingRunStartId]?.cancelRequested === true;
      removePendingRunStart(pendingRunStartId);
      if (cancelRequested) {
        dispatchRunRegistry({
          type: 'set_cancel_state',
          runId: run.id,
          state: 'requested'
        });
        await requestRunCancellation(run.id);
      }
      subscribeToRunEvents(run.id, resolvedThread.threadId, connectionConfigRef.current);
      composerAttachmentDraftIdsRef.current.delete(composerAttachmentScope);
      return true;
    } catch (error) {
      if (mountedRef.current) {
        const item: TimelineItem = {
          kind: 'diagnostic',
          id: createTimelineId('runtime_error'),
          severity: 'error',
          message: error instanceof Error ? error.message : 'Runtime run failed',
          content: error instanceof Error ? error.message : String(error),
          source: 'runtime'
        };
        if (runThreadId === undefined) setTimelineItems(previous => [...previous, item]);
        else appendTimelineItemsForThread(runThreadId, [item]);
      }
      return true;
    } finally {
      removePendingRunStart(pendingRunStartId);
    }
  }

  async function cancelActiveRun() {
    const pendingStart = findPendingRunStart(
      pendingRunStartsByIdRef.current,
      state.selectedThreadId
    );
    if (pendingStart !== undefined) {
      if (!pendingStart.cancelRequested) {
        updatePendingRunStart({ ...pendingStart, cancelRequested: true });
      }
      return;
    }

    const activeRun = getThreadActiveRun(runRegistry, state.selectedThreadId);
    if (activeRun === undefined) return;
    if (getRunCancelState(runRegistry, activeRun.id) === 'requested') return;

    dispatchRunRegistry({
      type: 'set_cancel_state',
      runId: activeRun.id,
      state: 'requested'
    });
    await requestRunCancellation(activeRun.id);
  }

  async function requestRunCancellation(runId: string) {
    let cancellationError: unknown;
    try {
      if (runService === null) throw new Error('本地运行内核已断开，无法停止任务');
      await runService.cancelRun(runId);
    } catch (error) {
      cancellationError = error;
    }
    if (cancellationError === undefined) return;

    if (!mountedRef.current) return;
    const currentRun = runRegistryRef.current.runsById[runId];
    if (currentRun !== undefined && isTerminalRunStatus(currentRun.status)) return;
    if (runService !== null) {
      try {
        const latestRun = await runService.getRun(runId);
        if (!mountedRef.current) return;
        dispatchRunRegistry({ type: 'upsert_run', run: latestRun });
        if (isTerminalRunStatus(latestRun.status)) return;
      } catch {
        // Preserve the original cancellation error when status reconciliation fails.
      }
    }

    dispatchRunRegistry({
      type: 'set_cancel_state',
      runId,
      state: 'failed'
    });
    const message = getRuntimeErrorMessage(cancellationError, '停止任务失败，请重试');
    const item: TimelineItem = {
      kind: 'diagnostic',
      id: createTimelineId('cancel_error'),
      runId,
      severity: 'error',
      message,
      content: message,
      source: 'runtime'
    };
    const threadId = runRegistryRef.current.runsById[runId]?.threadId;
    if (threadId === undefined) setTimelineItems(previous => [...previous, item]);
    else appendTimelineItemsForThread(threadId, [item]);
  }

  async function resolveThreadIdForPrompt(
    prompt: string,
    config: ComposerRunConfig
  ): Promise<{ threadId: string; created: boolean }> {
    if (state.selectedThreadId !== undefined) return { threadId: state.selectedThreadId, created: false };
    if (threadService === null) throw new Error('Thread service is not available');

    if (currentProject === undefined) {
      throw new Error('请先添加项目');
    }
    const created = await threadService.createThread(
      buildThreadRequest(prompt, currentProject, config)
    );
    setRuntimeThreads(previous => upsertThread(previous, created.thread));
    skipNextHistoryLoadForThreadRef.current = created.thread.id;
    navigationPersistenceReadyRef.current = true;
    adoptCurrentTimelineForThread(created.thread.id);
    dispatch({ type: 'select_thread', threadId: created.thread.id });
    navigateToRoute({ view: 'thread', threadId: created.thread.id });
    return { threadId: created.thread.id, created: true };
  }

  function handleRunStarted(run: RunResponse) {
    dispatchRunRegistry({ type: 'upsert_run', run });
    const item: TimelineItem = {
      kind: 'run_status',
      id: createTimelineId('run'),
      runId: run.id,
      label: run.status,
      content: JSON.stringify(run),
      source: 'runtime'
    };
    if (run.threadId === undefined) setTimelineItems(previous => [...previous, item]);
    else appendTimelineItemsForThread(run.threadId, [item]);
  }

  async function refreshThreadRunState(threadId: string) {
    if (threadService === null) return;
    const knownRunIdsAtRequestStart = [
      ...(runRegistryRef.current.runIdsByThreadId[threadId] ?? [])
    ];
    try {
      const response = await threadService.listThreadRuns(threadId);
      if (!mountedRef.current) return;
      const runsById = new Map(response.runs.map(run => [run.id, run]));
      dispatchRunRegistry({
        type: 'merge_thread_runs',
        threadId,
        knownRunIdsAtRequestStart,
        runs: response.runs
      });
      updateTimelineItemsForThread(threadId, items => items.map(item => {
        if (item.kind !== 'user_message' || item.runId === undefined) return item;
        const run = runsById.get(item.runId);
        if (run === undefined) return item;
        if (
          item.runStatus !== undefined
          && isTerminalRunStatus(item.runStatus)
          && !isTerminalRunStatus(run.status)
        ) {
          return item;
        }
        return {
          ...item,
          runStatus: run.status,
          submissionMode: run.submissionMode,
          queuePosition: run.queuePosition
        };
      }));
    } catch {
      // SSE and the local registry remain the fallback when a refresh request fails.
    }
  }

  async function refreshScheduleDraftBinding(threadId: string) {
    const current = runtimeThreadsRef.current.find(thread => thread.id === threadId);
    if (current?.purpose !== 'schedule_draft') return;

    const activeThreadService = threadServiceRef.current;
    const activeScheduleService = scheduleServiceRef.current;
    if (activeThreadService === null || activeScheduleService === null) return;

    try {
      const [threadResponse, scheduleResponse] = await Promise.all([
        activeThreadService.getThread(threadId),
        activeScheduleService.listSchedules()
      ]);
      if (
        !mountedRef.current
        || threadServiceRef.current !== activeThreadService
        || scheduleServiceRef.current !== activeScheduleService
      ) {
        return;
      }
      setRuntimeThreads(previous => upsertThread(previous, threadResponse.thread));
      setRuntimeSchedules(scheduleResponse.schedules);
    } catch {
      // The draft stays usable when terminal-state reconciliation is unavailable.
    }
  }

  function stopAllRunEventSubscriptions(markDisconnected = true) {
    const activeControllers = [...runEventControllersRef.current.entries()];
    runEventControllersRef.current.clear();
    for (const [runId, subscription] of activeControllers) {
      subscription.controller.stop();
      if (!markDisconnected || !mountedRef.current) continue;
      const run = runRegistryRef.current.runsById[runId];
      if (run?.status !== 'running' && run?.status !== 'queued') continue;
      dispatchRunRegistry({
        type: 'set_subscription_state',
        runId,
        state: 'disconnected'
      });
    }
  }

  function subscribeToRunEvents(
    runId: string,
    threadId: string,
    config: ConnectionConfig
  ) {
    if (runEventControllersRef.current.has(runId)) return;

    const fromSeq = runRegistryRef.current.lastSeqByRunId[runId] ?? 0;
    const replayUntilSeq = Math.max(
      fromSeq,
      runRegistryRef.current.runsById[runId]?.lastEventSeq ?? fromSeq
    );
    const cachedTimelineItems = timelineItemsByThreadIdRef.current[threadId]
      ?? (timelineThreadIdRef.current === threadId ? timelineItemsRef.current : []);
    const replayDeduper = replayUntilSeq > fromSeq
      ? createRunReplayDeduper(cachedTimelineItems)
      : undefined;
    const controller = createRunEventController({
      subscribe: subscribeRunEvents
    });
    runEventControllersRef.current.set(runId, { threadId, controller });
    const isCurrentSubscription = () => (
      mountedRef.current
      && runEventControllersRef.current.get(runId)?.controller === controller
    );

    controller.start({
      ...config,
      runId,
      fromSeq,
      fetchImpl: runtimeFetch,
      onStateChange(state) {
        if (!isCurrentSubscription()) return;
        dispatchRunRegistry({
          type: 'set_subscription_state',
          runId,
          state: mapRunEventControllerState(state)
        });
      },
      onEvent(event) {
        if (!isCurrentSubscription()) return;
        dispatchRunRegistry({ type: 'record_event', event });
        if (event.type === 'status') {
          updateTimelineItemsForThread(threadId, items => items.map(item =>
            item.kind === 'user_message' && item.runId === event.runId
              ? {
                  ...item,
                  runStatus: event.payload.label === 'queued' ? 'queued' : 'running',
                  ...(event.payload.label === 'queued' ? {} : { queuePosition: undefined })
                }
              : item
          ));
        } else if (event.type === 'done') {
          updateTimelineItemsForThread(threadId, items => items.map(item =>
            item.kind === 'user_message' && item.runId === event.runId
              ? {
                  ...item,
                  runStatus: event.payload.status,
                  queuePosition: undefined
                }
              : item
          ));
        }
        const item = eventToTimelineItem(event);
        if (
          item !== null
          && (
            event.seq > replayUntilSeq
            || replayDeduper === undefined
            || replayDeduper.shouldAppend(item)
          )
        ) {
          getTimelineEventBatcher(threadId).push(item);
        }
        if (event.type === 'done') {
          runEventControllersRef.current.delete(runId);
          controller.stop();
          getTimelineEventBatcher(threadId).flush();
          void loadRunDiagnostics(event.runId);
          void refreshThreadRunState(threadId);
          void refreshScheduleDraftBinding(threadId);
        }
      },
      onError(error) {
        if (!isCurrentSubscription()) return;
        dispatchRunRegistry({
          type: 'set_subscription_state',
          runId,
          state: 'disconnected'
        });
        getTimelineEventBatcher(threadId).push({
          kind: 'diagnostic',
          id: createTimelineId('sse_error'),
          runId,
          severity: 'error',
          message: error.message,
          content: error.message,
          source: 'runtime'
        });
        getTimelineEventBatcher(threadId).flush();
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

  async function loadRunContext(runId: string) {
    if (memoryService === null) return;
    try {
      const context = await memoryService.getRunContext(runId);
      if (!mountedRef.current) return;
      setRunContextById(previous => ({ ...previous, [runId]: context }));
    } catch {
      if (!mountedRef.current) return;
      setRunContextById(previous => ({
        ...previous,
        [runId]: { runId, items: [] }
      }));
    }
  }

  function openRunDetail(runId: string) {
    dispatch({ type: 'select_run_detail', runId });
    void loadRunDiagnostics(runId);
    void loadRunContext(runId);
    void runService?.getRun(runId).then(run => {
      if (!mountedRef.current) return;
      setRunAttachmentsById(previous => ({
        ...previous,
        [runId]: run.attachments ?? []
      }));
    }).catch(() => undefined);
  }

  async function saveMemorySuggestion(input: CreateMemoryRequest) {
    if (memoryService === null) throw new Error('记忆服务暂不可用');
    await memoryService.createMemory(input);
  }

  async function openScheduleTask(
    threadId: string,
    runId?: string,
    options: { updateRoute?: boolean; approvalId?: string } = {}
  ): Promise<boolean> {
    let thread = runtimeThreads.find(item => item.id === threadId);
    if (thread === undefined && threadService !== null) {
      try {
        const response = await threadService.getThread(threadId);
        if (!mountedRef.current) return false;
        thread = response.thread;
        setRuntimeThreads(previous => upsertThread(previous, response.thread));
      } catch {
        if (mountedRef.current) setThreadLoadError('无法打开任务对应的会话');
        return false;
      }
    }
    if (thread === undefined) return false;

    closeMobileSidebar();
    allowInitialRuntimeProjectFocusRef.current = false;
    navigationPersistenceReadyRef.current = true;
    setThreadLoadError(undefined);
    setThreadConfigUpdateError(undefined);
    setSearchHistoryTarget(undefined);
    setTimelineRunTarget(
      runId === undefined ? undefined : { threadId: thread.id, runId }
    );
    setTimelineApprovalTarget(
      options.approvalId === undefined
        ? undefined
        : { threadId: thread.id, approvalId: options.approvalId }
    );
    setHistoryLoadingThreadId(thread.id);
    setHistoryLoadedThreadId(undefined);
    setRunsLoadedThreadId(undefined);
    showTimelineForThread(thread.id, [], false);
    if (
      thread.purpose === 'conversation'
      && thread.projectId !== null
      && thread.projectId !== state.currentProjectId
    ) {
      dispatch({ type: 'set_current_project', projectId: thread.projectId });
    }
    dispatch({ type: 'select_thread', threadId: thread.id });
    if (options.updateRoute !== false) {
      navigateToRoute({
        view: 'thread',
        threadId: thread.id,
        ...(runId === undefined ? {} : { runId }),
        ...(options.approvalId === undefined
          ? {}
          : { approvalId: options.approvalId })
      });
    }
    setThreadHistoryReloadKey(previous => previous + 1);
    return true;
  }

  function handleScheduleChanged(schedule: ScheduleResponse) {
    setRuntimeSchedules(previous => upsertSchedule(previous, schedule));
  }

  function handleScheduleDeleted(schedule: ScheduleResponse) {
    setRuntimeSchedules(previous => previous.filter(item => item.id !== schedule.id));
    setRuntimeThreads(previous => previous.filter(item => item.id !== schedule.threadId));
  }

  async function runScheduleNow(schedule: ScheduleResponse) {
    const alreadyOpen =
      state.activeView === 'conversation'
      && state.selectedThreadId === schedule.threadId;
    const opened = alreadyOpen || await openScheduleTask(schedule.threadId);
    if (!opened) throw new Error('无法打开任务对应的会话');
    if (alreadyOpen) {
      setTimelineRunTarget(undefined);
      setTimelineApprovalTarget(undefined);
      navigateToRoute({ view: 'thread', threadId: schedule.threadId });
    }

    try {
      if (scheduleService === null) {
        throw new Error('本地服务暂不可用，无法立即运行任务');
      }
      const response = await scheduleService.runNow(schedule.id);
      handleScheduleChanged(response.schedule);
      if (response.run !== null) {
        const run: RunResponse = {
          ...response.run,
          threadId: response.run.threadId ?? schedule.threadId
        };
        handleRunStarted(run);
        void refreshThreadRunState(schedule.threadId);
        if (connectionConfigRef.current !== null) {
          subscribeToRunEvents(run.id, schedule.threadId, connectionConfigRef.current);
        }
        return;
      }

      const message = response.queued
        ? '本次运行已排队，会在当前任务结束后执行'
        : response.skipped
          ? '已有任务在运行，本次已跳过'
          : undefined;
      if (message !== undefined) {
        appendTimelineItemsForThread(schedule.threadId, [
          {
            kind: 'assistant_message',
            id: createTimelineId('schedule_run_status'),
            text: message,
            source: 'runtime'
          }
        ]);
      }
    } catch (error) {
      const message = getRuntimeErrorMessage(error, '无法立即运行任务');
      appendTimelineItemsForThread(schedule.threadId, [
        {
          kind: 'diagnostic',
          id: createTimelineId('schedule_run_failed'),
          severity: 'error',
          message,
          content: message,
          source: 'runtime'
        }
      ]);
      throw error;
    }
  }

  async function openScheduleCreationConversation() {
    const activeThreadService = threadService;
    if (activeThreadService === null) {
      throw new Error('本地服务暂不可用，无法创建对话');
    }

    const generation = skillMarketRuntimeGenerationRef.current;
      const created = await activeThreadService.createThread(
      {
        title: SCHEDULE_DRAFT_TITLE,
        workspaceMode: 'managed',
        profile: 'default',
        sandbox: 'workspace-write',
        purpose: 'schedule_draft'
      }
    );
    if (!isCurrentThreadRuntime(generation, activeThreadService)) return;

    closeMobileSidebar();
    setRuntimeThreads(previous => upsertThread(previous, created.thread));
    showTimelineForThread(created.thread.id, [], true);
    setThreadHistoryLoadError(undefined);
    setHistoryLoadingThreadId(undefined);
    setHistoryLoadedThreadId(created.thread.id);
    setRunsLoadedThreadId(undefined);
    setThreadConfigUpdateError(undefined);
    skipNextHistoryLoadForThreadRef.current = created.thread.id;
    allowInitialRuntimeProjectFocusRef.current = false;
    dispatch({ type: 'select_thread', threadId: created.thread.id });
    navigateToRoute({ view: 'thread', threadId: created.thread.id });
    nextComposerDraftIdRef.current += 1;
    setPendingComposerDraft({
      threadId: created.thread.id,
      request: {
        id: nextComposerDraftIdRef.current,
        text: SCHEDULE_CREATION_DRAFT
      }
    });
  }

  async function openTask(task: TaskItem) {
    markTaskRead(task.id);
    const threadId = task.threadId;
    if (threadId === undefined) {
      openRunDetail(task.runId);
      return;
    }
    if (task.pendingApproval?.status === 'pending') {
      await openScheduleTask(threadId, task.runId, {
        approvalId: task.pendingApproval.id
      });
      return;
    }

    let thread = runtimeThreads.find(item => item.id === threadId);
    if (thread === undefined && threadService !== null) {
      try {
        const response = await threadService.getThread(threadId);
        if (!mountedRef.current) return;
        thread = response.thread;
        setRuntimeThreads(previous => upsertThread(previous, response.thread));
      } catch {
        setThreadLoadError('无法打开任务对应的会话');
        return;
      }
    }
    if (thread === undefined) return;

    closeMobileSidebar();
    allowInitialRuntimeProjectFocusRef.current = false;
    navigationPersistenceReadyRef.current = true;
    setThreadLoadError(undefined);
    setThreadConfigUpdateError(undefined);
    setSearchHistoryTarget(undefined);
    setTimelineApprovalTarget(undefined);
    setHistoryLoadingThreadId(thread.id);
    setHistoryLoadedThreadId(undefined);
    setRunsLoadedThreadId(undefined);
    showTimelineForThread(thread.id, [], false);
    if (
      thread.purpose === 'conversation'
      && thread.projectId !== null
      && thread.projectId !== state.currentProjectId
    ) {
      dispatch({ type: 'set_current_project', projectId: thread.projectId });
    }
    dispatch({ type: 'select_thread', threadId: thread.id });
    navigateToRoute({ view: 'thread', threadId: thread.id });
    setThreadHistoryReloadKey(previous => previous + 1);
    openRunDetail(task.runId);
  }

  function markTaskRead(taskId: string) {
    setUnreadTaskIds(current => {
      if (!current.has(taskId)) return current;
      const next = new Set(current);
      next.delete(taskId);
      notificationService.setUnreadIds(next);
      return next;
    });
  }

  function markThreadTasksRead(threadId: string) {
    const taskIds = new Set(
      runtimeTasks
        .filter(task => task.threadId === threadId)
        .map(task => task.id)
    );
    if (taskIds.size === 0) return;
    setUnreadTaskIds(current => {
      const next = new Set(current);
      let changed = false;
      for (const taskId of taskIds) {
        changed = next.delete(taskId) || changed;
      }
      if (!changed) return current;
      notificationService.setUnreadIds(next);
      return next;
    });
  }

  function clearUnreadTasks() {
    const next = new Set<string>();
    notificationService.setUnreadIds(next);
    setUnreadTaskIds(next);
  }

  async function enableTaskNotifications() {
    setNotificationSettings(await notificationService.enable());
  }

  function disableTaskNotifications() {
    setNotificationSettings(notificationService.disable());
  }

  function openTimelineFile(path: string) {
    const workspacePath = toWorkspaceRelativePath(path, selectedThread);
    dispatch({ type: 'select_workspace_file', path: workspacePath });
    navigateToRoute({
      view: 'files',
      ...(state.selectedThreadId === undefined ? {} : { threadId: state.selectedThreadId }),
      path: workspacePath
    });
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
  const selectedRunsLoading = runsLoadingThreadId !== undefined
    && runsLoadingThreadId === state.selectedThreadId;
  const conversationNeedsProject =
    selectedThread === undefined || selectedThread.purpose === 'conversation';
  const composerDisabled = (
    conversationNeedsProject && currentProject === undefined
  )
    || selectedPendingRunStart !== undefined
    || selectedRunsLoading
    || connectionState.status !== 'connected';
  const composerDisabledReason = connectionState.status !== 'connected'
    ? '正在连接本地运行内核'
    : projectLoadError !== undefined
      ? projectLoadError
      : conversationNeedsProject && currentProject === undefined
        ? '请先添加项目'
        : currentRunCanceling
          ? '正在停止任务'
          : selectedPendingRunStart !== undefined
            ? '正在提交任务'
            : '正在检查会话任务';
  const fileWorkspaceOpen = state.activeView === 'conversation' && state.rightPanelMode === 'file';
  const effectiveComposerConfig = selectedThread === undefined
    ? composerRunConfig ?? defaultComposerRunConfig(currentProject, defaultPermission)
    : {
        permission: fromRuntimeSandbox(selectedThread.sandbox),
        profile: selectedThread.profile,
        model: selectedThread.model ?? null,
        reasoning: (selectedThread.reasoning ?? null) as ComposerRunConfig['reasoning']
      };
  const conversationFileLayoutStyle = conversationPaneWidth === undefined
    ? undefined
    : ({ '--conversation-pane-width': `${conversationPaneWidth}px` } as CSSProperties);
  const showHistoryLoadingOverlay =
    historyLoadingThreadId !== undefined && historyLoadingThreadId === state.selectedThreadId;
  function handleComposerWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (canScrollVertically(event.target, event.currentTarget, event.deltaY)) return;
    if (timelineRef.current?.scrollBy(event.deltaY) !== true) return;
    event.preventDefault();
  }
  const conversationPage = (
    <section className="conversation-page">
      <ConversationHeader
        title={
          selectedConversation?.title
          ?? selectedScheduleTask?.name
          ?? selectedThread?.title
          ?? '新对话'
        }
        projectName={currentProjectName}
        statusLabel={getConnectionStatusLabel(connectionState)}
        taskToolbar={
          selectedScheduleTask?.bindingStatus === 'ready'
          && selectedSchedule !== undefined
          && selectedSidebarTask !== undefined
          && scheduleService !== null ? (
            <Suspense fallback={<div className="schedule-thread-header" aria-hidden="true" />}>
              <ScheduleThreadHeader
                schedule={selectedSchedule}
                status={selectedSidebarTask.status}
                nextRunLabel={selectedSidebarTask.nextRunLabel}
                service={scheduleService}
                projects={projects}
                profiles={codexProfiles?.profiles}
                onRunNow={runScheduleNow}
                onScheduleChanged={handleScheduleChanged}
              />
            </Suspense>
          ) : undefined
        }
        onOpenLocation={() => openPrimaryView('files')}
      />
      <div className="conversation-body">
        {treeLoadError ? <p className="inline-error">{treeLoadError}</p> : null}
        {projectLoadError ? <p className="inline-error">{projectLoadError}</p> : null}
        {threadLoadError ? <p className="inline-error">{threadLoadError}</p> : null}
        {threadHistoryLoadError ? <p className="inline-error">{threadHistoryLoadError}</p> : null}
        {threadConfigUpdateError ? (
          <div className="conversation-toast" role="alert">
            {threadConfigUpdateError}
          </div>
        ) : null}
        {timelineItems.length === 0 ? (
          <ConversationEmptyState projectName={currentProject?.name} />
        ) : (
          <Timeline
            ref={timelineRef}
            key={state.selectedThreadId ?? 'draft'}
            items={timelineItems}
            hasMore={threadHistory.hasMore}
            loadingOlder={threadHistory.loadingOlder}
            targetItemId={
              searchHistoryTarget !== undefined
              && searchHistoryTarget.threadId === state.selectedThreadId
                ? searchHistoryTarget.itemId
                : undefined
            }
            targetRunId={
              timelineRunTarget !== undefined
              && timelineRunTarget.threadId === state.selectedThreadId
                ? timelineRunTarget.runId
                : undefined
            }
            targetApprovalId={
              timelineApprovalTarget !== undefined
              && timelineApprovalTarget.threadId === state.selectedThreadId
                ? timelineApprovalTarget.approvalId
                : undefined
            }
            onLoadOlder={threadHistory.loadOlder}
            onOpenRunDetail={openRunDetail}
            onOpenFile={openTimelineFile}
            onEditUserMessage={editUserMessage}
            resolvingApprovalIds={resolvingApprovalIds}
            approvalErrors={approvalErrors}
            onApproveApproval={(id) => void resolveApproval(id, 'approve')}
            onRejectApproval={(id) => void resolveApproval(id, 'reject')}
          />
        )}
        {showHistoryLoadingOverlay ? (
          <div className="conversation-history-loading" role="status" aria-label="正在加载会话历史">
            <span>正在加载会话历史...</span>
          </div>
        ) : null}
      </div>
      <div className="composer-wrap" onWheel={handleComposerWheel}>
        {pendingMemorySuggestion !== undefined && memoryService !== null ? (
          <MemorySuggestion
            key={pendingMemorySuggestion.id}
            content={pendingMemorySuggestion.content}
            projectKey={currentMemoryProjectKey}
            threadKey={state.selectedThreadId}
            onSave={saveMemorySuggestion}
            onDismiss={() => setPendingMemorySuggestion(undefined)}
          />
        ) : null}
        <Composer
          key={composerAttachmentScope}
          projectId={currentProject?.id ?? ''}
          projectName={currentProjectName}
          projects={projects}
          showProjectSelector={
            selectedThread === undefined || selectedThread.purpose === 'conversation'
          }
          permission={effectiveComposerConfig.permission}
          profile={effectiveComposerConfig.profile}
          model={effectiveComposerConfig.model}
          reasoning={effectiveComposerConfig.reasoning}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
          running={currentRunBusy}
          canceling={currentRunCanceling}
          permissionChangeDisabled={selectedThread !== undefined && currentRunBusy}
          slashCommands={slashCommands}
          slashCommandsLoading={capabilitiesLoading}
          slashCommandsError={capabilitiesLoadError}
          queuedItems={composerQueuedItems}
          imageInputSupported={imageInputSupported}
          imageInputUnsupportedReason={
            imageInputSupported
              ? undefined
              : '当前 Codex 版本不支持图片输入，请更新 Codex'
          }
          draftRequest={
            pendingComposerDraft !== undefined && pendingComposerDraft.threadId === state.selectedThreadId
              ? pendingComposerDraft.request
              : undefined
          }
          onSelectProject={selectProject}
          onCreateBlankProject={
            projectService === null || hostBridge.createProjectDirectory === undefined
              ? undefined
              : createBlankProject
          }
          onAddProjectDirectory={
            projectService === null || hostBridge.selectProjectDirectory === undefined
              ? undefined
              : addProjectDirectory
          }
          onPermissionChange={handleComposerPermissionChange}
          onDraftApplied={handleComposerDraftApplied}
          onCancel={() => void cancelActiveRun()}
          onCancelQueuedRun={(runId) => void requestRunCancellation(runId)}
          onSteerQueuedRun={() => void cancelActiveRun()}
          onUploadAttachment={async file => {
            if (attachmentService === null) throw new Error('附件服务暂不可用');
            const response = await attachmentService.upload({
              file,
              draftId: composerAttachmentDraftId
            });
            return response.attachment;
          }}
          onDeleteAttachment={async attachment => {
            if (attachmentService === null || attachment.draftId === undefined) return;
            await attachmentService.delete({
              id: attachment.id,
              draftId: attachment.draftId
            });
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
      <FilesPage
        selectedThread={selectedThread}
        selectedPath={state.workspaceTargetPath}
        workspaceFileService={workspaceFileService}
        onClose={closeFileWorkspace}
        onSelectPath={selectWorkspaceFile}
        onOpenExternal={(url) => void hostBridge.openExternal(url)}
      />
    </section>
  ) : conversationPage;
  const main = props.capabilitiesView !== undefined ? (
    <CapabilitiesPage {...props.capabilitiesView} />
  ) : state.activeView === 'search' ? (
    <SearchPage
      connected={connectionState.status === 'connected'}
      service={searchService}
      projects={projects}
      recentThreads={visibleRuntimeThreads.filter(thread => (
        thread.purpose === 'conversation' && thread.projectId !== null
      ))}
      onOpenResult={result => void openSearchResult(result)}
    />
  ) : state.activeView === 'schedules' ? (
    <SchedulesPage
      connected={connectionState.status === 'connected'}
      service={scheduleService}
      projects={projects}
      currentProjectId={state.currentProjectId ?? ''}
      editScheduleId={
        props.route.view === 'schedules' ? props.route.scheduleId : undefined
      }
      profiles={codexProfiles?.profiles}
      defaultTimezone={resolveDefaultTimezone()}
      onCreateWithClawee={openScheduleCreationConversation}
      onOpenTask={(threadId, runId) => void openScheduleTask(threadId, runId)}
      onRunNow={runScheduleNow}
      onScheduleChanged={handleScheduleChanged}
      onScheduleDeleted={handleScheduleDeleted}
    />
  ) : state.activeView === 'tasks' ? (
    <TaskCenterPage
      service={taskService}
      approvalService={approvalService}
      notificationSettings={notificationSettings}
      unreadIds={unreadTaskIds}
      onEnableNotifications={enableTaskNotifications}
      onDisableNotifications={disableTaskNotifications}
      onClearUnread={clearUnreadTasks}
      onOpenTask={task => void openTask(task)}
      onMarkRead={markTaskRead}
      onEditSchedule={scheduleId => {
        navigateToRoute({ view: 'schedules', scheduleId });
      }}
      onPauseSchedule={async scheduleId => {
        if (scheduleService === null) throw new Error('本地运行内核未连接');
        const updated = await scheduleService.updateSchedule(scheduleId, { enabled: false });
        handleScheduleChanged(updated);
      }}
    />
  ) : state.activeView === 'settings' ? (
    <SettingsPage
      runtimeStatus={runtimeStatus}
      defaultPermission={defaultPermission}
      defaultPermissionError={defaultPermissionSyncError}
      onDefaultPermissionChange={handleDefaultPermissionChange}
      colorMode={colorMode}
      onColorModeChange={handleColorModeChange}
      desktopCloseBehavior={desktopCloseBehavior}
      onDesktopCloseBehaviorChange={behavior => {
        const update = hostBridge.updateDesktopPreferences;
        if (update === undefined) return;
        const previous = desktopCloseBehavior;
        setDesktopCloseBehavior(behavior);
        void update({ closeBehavior: behavior })
          .then(preferences => setDesktopCloseBehavior(preferences.closeBehavior))
          .catch(() => setDesktopCloseBehavior(previous));
      }}
      mcpService={mcpService}
      mcpData={codexMcp}
      mcpCapabilities={readMcpCapabilities(connectionState)}
      onMcpDataChange={setCodexMcp}
      profileService={profileService}
      profileData={codexProfiles}
      onProfileDataChange={setCodexProfiles}
      cleanupService={cleanupService}
      memoryService={memoryService}
      memoryProjects={memoryProjectOptions}
      memoryThreads={memoryThreadOptions}
      codexStatus={connectionState.status === 'connected' ? connectionState.codexStatus : undefined}
      onBack={() => {
        dispatch({ type: 'back_to_app' });
        navigateToRoute(routeForConversation(state.selectedThreadId));
      }}
    />
  ) : state.activeView === 'plugins' ? (
    <PluginsPage
      connected={connectionState.status === 'connected'}
      skills={codexSkills}
      installRecords={skillMarketInstallRecords}
      loading={skillMarketLoading}
      loadError={skillMarketLoadError}
      operation={skillMarketOperation}
      useError={skillMarketUseError}
      projects={projects}
      currentProjectId={currentProject?.id ?? ''}
      onInstall={skillId => void installMarketSkill(skillId)}
      onUpdate={skillId => void updateMarketSkill(skillId)}
      onUse={(skillId, projectId) => void useMarketSkill(skillId, projectId)}
    />
  ) : state.activeView === 'conversation' ? (
    conversationWorkspace
  ) : (
    <PlaceholderView label={getPlaceholderLabel(state.activeView)} />
  );

  return (
    <div
      className="app-drop-shell"
      data-project-drop-root="true"
      onDragEnter={handleProjectDragEnter}
      onDragOver={handleProjectDragOver}
      onDragLeave={handleProjectDragLeave}
      onDrop={(event) => void handleProjectDrop(event)}
    >
      <WorkbenchLayout
      sidebar={
        <ClaweeSidebar
          projects={projects}
          conversations={conversations}
          tasks={sidebarTasks}
          runningConversationIds={runningConversationIds}
          currentProjectId={state.currentProjectId}
          selectedConversationId={state.selectedThreadId}
          activeView={state.activeView}
          collapsed={sidebarCollapsed}
          colorMode={colorMode}
          onNewConversation={projectId => startNewConversation({ projectId })}
          onSelectProject={selectProject}
          onSelectConversation={selectConversation}
          onSelectTask={selectSidebarTask}
          onOpenView={openPrimaryView}
          onAddProject={
            hostBridge.selectProjectDirectory === undefined
              ? undefined
              : () => void addProjectDirectory()
          }
          onManageProjects={() => void openProjectManagement()}
          onEditProject={projectId => void openProjectManagement(projectId)}
          onReplaceProjectDirectory={projectId => void replaceManagedProjectDirectory(projectId)}
          onArchiveProject={projectId => void archiveProject(projectId)}
          onDeleteTaskDraft={threadId => deleteScheduleDraft(threadId)}
          onOpenSettings={() => {
            closeMobileSidebar();
            dispatch({ type: 'open_settings' });
            navigateToRoute({ view: 'settings' });
          }}
          onToggleCollapsed={() => setSidebarCollapsed((currentValue) => !currentValue)}
        />
      }
      main={(
        <Suspense fallback={<PageLoading />}>
          {main}
        </Suspense>
      )}
      detail={detailPanel}
      detailOpen={detailPanel !== null && state.activeView === 'conversation'}
      sidebarCollapsed={sidebarCollapsed}
      mobileSidebarOpen={mobileSidebarOpen}
      onOpenMobileSidebar={openMobileSidebar}
      onCloseMobileSidebar={dismissMobileSidebar}
      />
      {projectDropActive ? (
        <div className="project-drop-overlay" role="status" aria-live="polite">
          <FolderInput aria-hidden="true" size={30} />
          <strong>松开以添加项目文件夹</strong>
        </div>
      ) : null}
      <ProjectManagementDialog
        open={projectManagementOpen}
        projects={projects}
        archivedProjects={archivedProjects}
        unassignedThreads={unassignedThreads}
        initialProjectId={projectManagementProjectId}
        busy={projectMutationBusy}
        error={projectManagementOpen ? projectLoadError : undefined}
        onClose={() => {
          setProjectManagementOpen(false);
          setProjectManagementProjectId(undefined);
        }}
        onUpdate={updateManagedProject}
        onArchive={archiveProject}
        onRestore={restoreManagedProject}
        onReplaceDirectory={replaceManagedProjectDirectory}
        onAssignThread={assignManagedThread}
        onAddProject={
          hostBridge.selectProjectDirectory === undefined
            ? undefined
            : async () => {
                await addProjectDirectory();
                setProjectManagementOpen(true);
              }
        }
      />
    </div>
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
          content={
            <RunDetailPanel
              runId={state.selectedRunId}
              diagnostics={runDiagnostics}
              attachments={selectedRunAttachments}
              context={selectedRunContext}
            />
          }
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

function mergeTimelineItems(
  previousItems: TimelineItem[],
  incomingItems: TimelineItem[]
): TimelineItem[] {
  let nextItems = previousItems;
  for (const incoming of incomingItems) {
    if (incoming.kind !== 'approval') {
      nextItems = [...nextItems, incoming];
      continue;
    }
    const index = nextItems.findIndex(item => (
      item.kind === 'approval' && item.approval.id === incoming.approval.id
    ));
    if (index < 0) {
      nextItems = [...nextItems, incoming];
      continue;
    }
    nextItems = nextItems.map((item, itemIndex) => (
      itemIndex === index ? incoming : item
    ));
  }
  return nextItems;
}

function createInitialState(
  route: AppRoute,
  persistedNavigation: PersistedNavigation | null
): AppState {
  const persistedState: AppState = {
    ...initialAppState,
    currentProjectId: persistedNavigation?.currentProjectId ?? initialAppState.currentProjectId,
    selectedThreadId: persistedNavigation?.selectedThreadId
  };

  switch (route.view) {
    case 'home':
      return persistedState;
    case 'thread':
      return {
        ...persistedState,
        activeView: 'conversation',
        selectedThreadId: route.threadId
      };
    case 'search':
    case 'schedules':
    case 'tasks':
    case 'plugins':
    case 'settings':
      return {
        ...persistedState,
        activeView: route.view,
        rightPanelMode: 'closed'
      };
    case 'files':
      return {
        ...persistedState,
        activeView: 'conversation',
        selectedThreadId: route.threadId ?? persistedState.selectedThreadId,
        selectedFilePath: route.path ?? persistedState.selectedFilePath,
        workspaceTargetPath: route.path,
        rightPanelMode: 'file'
      };
    case 'capabilities':
      return persistedState;
  }
}

function routeForActiveView(activeView: ActiveView, selectedThreadId?: string): AppRoute {
  switch (activeView) {
    case 'conversation':
      return routeForConversation(selectedThreadId);
    case 'search':
      return { view: 'search' };
    case 'schedules':
      return { view: 'schedules' };
    case 'tasks':
      return { view: 'tasks' };
    case 'plugins':
      return { view: 'plugins' };
    case 'settings':
      return { view: 'settings' };
    case 'files':
      return {
        view: 'files',
        ...(selectedThreadId === undefined ? {} : { threadId: selectedThreadId })
      };
  }
}

function routeForConversation(selectedThreadId?: string): AppRoute {
  return selectedThreadId === undefined
    ? { view: 'home' }
    : { view: 'thread', threadId: selectedThreadId };
}

function PageLoading() {
  return (
    <section className="page-loading" role="status" aria-label="正在加载页面">
      <span>正在加载页面...</span>
    </section>
  );
}

function getConnectionStatusLabel(connectionState: ConnectionState) {
  if (connectionState.status === 'connected') return '本地运行内核正常';
  return connectionState.message;
}

function readPersistedNavigation(): PersistedNavigation | null {
  const value = readJsonFromStorage<unknown>(NAVIGATION_STORAGE_KEY);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  if (
    record.currentProjectId !== undefined
    && (
      typeof record.currentProjectId !== 'string'
      || record.currentProjectId.length === 0
    )
  ) {
    return null;
  }
  if (record.selectedThreadId !== undefined && typeof record.selectedThreadId !== 'string') return null;

  return {
    currentProjectId: record.currentProjectId as string | undefined,
    selectedThreadId: record.selectedThreadId
  };
}

function writePersistedNavigation(value: PersistedNavigation): void {
  try {
    writeJsonToStorage(NAVIGATION_STORAGE_KEY, value);
  } catch {
    return;
  }
}

function readDefaultPermissionPreference(): DefaultPermissionPreference {
  try {
    const value = window.localStorage.getItem(DEFAULT_PERMISSION_STORAGE_KEY);
    if (value === 'follow-global') return 'workspace-write';
    return isDefaultPermissionPreference(value) ? value : 'follow-project';
  } catch {
    return 'follow-project';
  }
}

function resolveDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function writeDefaultPermissionPreference(permission: DefaultPermissionPreference): void {
  try {
    window.localStorage.setItem(DEFAULT_PERMISSION_STORAGE_KEY, permission);
  } catch {
    return;
  }
}

function canImportDroppedProject(
  dataTransfer: DataTransfer,
  hostBridge: HostBridge,
  projectService: ProjectService | null
): boolean {
  return projectService !== null
    && hostBridge.resolveDroppedFilePath !== undefined
    && readDroppedDirectory(dataTransfer) !== undefined;
}

function readDroppedDirectory(dataTransfer: DataTransfer): File | undefined {
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry?.isDirectory !== true) continue;
    const file = item.getAsFile();
    if (file !== null) return file;
  }
  return undefined;
}

function PlaceholderView(props: { label: string }) {
  return (
    <section className="placeholder-page" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title">Clawee：{props.label}</h1>
    </section>
  );
}

function getPlaceholderLabel(activeView: 'schedules' | 'plugins' | 'files') {
  switch (activeView) {
    case 'schedules':
      return '已安排';
    case 'plugins':
      return '插件';
    case 'files':
      return '文件';
  }
}

function isMobileNavigationViewport(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 920px)').matches;
}

function getSkillMarketEntry(skillId: string): (typeof skillMarketCatalog)[number] | undefined {
  return skillMarketCatalog.find(entry => entry.id === skillId);
}

function shouldShowThreadInSidebar(thread: ThreadResponse): boolean {
  if (thread.purpose === 'schedule_draft') return true;
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

function mapThreadToConversation(
  thread: ThreadResponse
): ClaweeConversation | undefined {
  if (thread.projectId === null) return undefined;
  return {
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title ?? thread.codexThreadId ?? thread.id,
    updatedLabel: formatRelativeTime(thread.updatedAt)
  };
}

function buildMemoryProjectOptions(
  threads: ThreadResponse[],
  projects: ClaweeProject[]
): Array<{ key: string; label: string }> {
  const options = new Map<string, string>();
  for (const thread of threads) {
    if (thread.purpose !== 'conversation' || thread.projectId === null) continue;
    const label = findProjectById(projects, thread.projectId)?.name ?? '未知项目';
    options.set(thread.projectId, label);
  }
  return Array.from(options, ([key, label]) => ({ key, label }));
}

function shouldSuggestMemory(prompt: string): boolean {
  return /(记住|以后|偏好|始终|每次|默认)/.test(prompt);
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

export function formatRelativeTime(iso: string): string {
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/.exec(
    iso
  );
  const timestamp = Date.parse(
    sqliteUtc === null
      ? iso
      : `${sqliteUtc[1]}T${sqliteUtc[2]}${sqliteUtc[3] ?? ''}Z`
  );
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

function buildThreadRequest(
  prompt: string,
  project: ClaweeProject,
  config: ComposerRunConfig
): CreateThreadRequest {
  const request: CreateThreadRequest = {
    projectId: project.id,
    title: prompt.trim() || '新对话',
    profile: config.profile,
    sandbox: toRuntimeSandbox(config.permission)
  };
  if (config.model !== null) request.model = config.model;
  if (config.reasoning !== null) {
    request.reasoning = config.reasoning;
  }
  return request;
}

function defaultComposerRunConfig(
  project: ClaweeProject | undefined,
  defaultPermission: DefaultPermissionPreference
): ComposerRunConfig {
  return {
    permission: resolveDefaultPermission(project, defaultPermission),
    profile: project?.profile ?? 'default',
    model: project?.model ?? null,
    reasoning: (project?.reasoning ?? null) as ComposerRunConfig['reasoning']
  };
}

function resolveDefaultPermission(
  project: ClaweeProject | undefined,
  preference: DefaultPermissionPreference
): ProjectPermission {
  if (preference !== 'follow-project') return preference;
  if (
    project?.sandbox === 'workspace-write'
    || project?.sandbox === 'danger-full-access'
  ) {
    return project.sandbox;
  }
  return 'workspace-write';
}

function isDefaultPermissionPreference(value: string | null): value is DefaultPermissionPreference {
  return value === 'follow-project'
    || value === 'follow-global'
    || value === 'workspace-write'
    || value === 'danger-full-access';
}

function getOrCreateComposerAttachmentDraftId(
  draftIds: Map<string, string>,
  scope: string
): string {
  const existing = draftIds.get(scope);
  if (existing !== undefined) return existing;
  const created = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  draftIds.set(scope, created);
  return created;
}

function readImageInputSupported(
  connectionState: ConnectionState,
  thread?: ThreadResponse
): boolean {
  if (connectionState.status !== 'connected') return false;
  const capabilities = connectionState.codexStatus.capabilities;
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return false;
  }
  const record = capabilities as Record<string, unknown>;
  const resumesExistingThread =
    thread?.codexThreadId !== undefined && thread.codexThreadId !== null;
  return resumesExistingThread
    ? record.resumeImages === true
    : record.execImages === true;
}

function readMcpCapabilities(connectionState: ConnectionState): McpCapabilities | undefined {
  if (connectionState.status !== 'connected') return undefined;
  const capabilities = connectionState.codexStatus.capabilities;
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return undefined;
  }
  const record = capabilities as Record<string, unknown>;
  return {
    mcpAdd: record.mcpAdd === true,
    mcpRemove: record.mcpRemove === true,
    mcpLogin: record.mcpLogin === true,
    mcpLogout: record.mcpLogout === true,
    mcpAddEnv: record.mcpAddEnv === true,
    mcpAddUrl: record.mcpAddUrl === true,
    mcpAddBearerTokenEnvVar: record.mcpAddBearerTokenEnvVar === true,
    mcpAddOAuth: record.mcpAddOAuth === true
  };
}

function buildComposerSlashCommands(
  skills: CodexSkillListResponse | undefined
): ComposerSlashCommand[] {
  return (skills?.skills ?? [])
    .filter(skill => skill.status === 'valid')
    .map(skill => ({
      id: `skill:${skill.id}`,
      category: 'skill' as const,
      label: skill.name ?? skill.id,
      description: skill.description ?? skill.id,
      insertText: `$${skill.id} `
    }));
}

function toRuntimeSandbox(permission: ClaweeProject['sandbox'] | undefined): SandboxMode {
  if (permission === 'danger-full-access' || permission === 'workspace-write') return permission;
  return 'workspace-write';
}

function fromRuntimeSandbox(sandbox: SandboxMode): ProjectPermission {
  if (sandbox === 'danger-full-access' || sandbox === 'workspace-write') return sandbox;
  return 'follow-global';
}

function upsertThread(threads: ThreadResponse[], thread: ThreadResponse): ThreadResponse[] {
  const withoutThread = threads.filter(item => item.id !== thread.id);
  return [thread, ...withoutThread];
}

function upsertProject(
  projects: ClaweeProject[],
  project: ClaweeProject
): ClaweeProject[] {
  return [project, ...projects.filter(item => item.id !== project.id)];
}

function upsertSchedule(
  schedules: ScheduleResponse[],
  schedule: ScheduleResponse
): ScheduleResponse[] {
  const withoutSchedule = schedules.filter(item => item.id !== schedule.id);
  return [schedule, ...withoutSchedule];
}

function findPendingRunStart(
  pendingRunStartsById: PendingRunStartsById,
  threadId: string | undefined
): PendingRunStart | undefined {
  return Object.values(pendingRunStartsById).find(pending => pending?.threadId === threadId);
}

function mapRunEventControllerState(
  state: RunEventControllerState
): RunSubscriptionState {
  switch (state) {
    case 'idle':
      return 'idle';
    case 'connecting':
    case 'reconnecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'disconnected':
      return 'disconnected';
  }
}

function isTerminalRunStatus(status: RunResponse['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function mapHistoryItemsToTimelineItems(items: ThreadHistoryItem[]): TimelineItem[] {
  let currentRunId: string | undefined;
  let currentRunHasDone = false;
  let currentRunHasPersistedId = false;
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
    if (item.type === 'user_message' || item.type === 'schedule_trigger') {
      closeCurrentRun();
      currentRunId = item.type === 'schedule_trigger' && item.runId !== undefined
        ? item.runId
        : item.turnId === undefined
          ? `history_item_${item.id}`
          : `history_${item.turnId}`;
      currentRunHasDone = false;
      currentRunHasPersistedId = item.type === 'schedule_trigger' && item.runId !== undefined;
      timelineItems.push(mapHistoryItemToTimelineItem(item, currentRunId));
      continue;
    }

    if (item.type === 'done') {
      timelineItems.push(mapHistoryItemToTimelineItem(item, currentRunId));
      currentRunHasDone = true;
      currentRunId = undefined;
      currentRunHasPersistedId = false;
      continue;
    }

    timelineItems.push(mapHistoryItemToTimelineItem(
      item,
      item.turnId === undefined || currentRunHasPersistedId ? currentRunId : undefined
    ));
  }

  closeCurrentRun();
  return timelineItems;
}

function mapHistoryItemToTimelineItem(item: ThreadHistoryItem, fallbackRunId?: string): TimelineItem {
  const runId = item.type === 'schedule_trigger' && item.runId !== undefined
    ? item.runId
    : fallbackRunId
      ?? (item.turnId === undefined ? undefined : `history_${item.turnId}`);
  const base = {
    id: item.id,
    timestamp: item.createdAt,
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
    case 'schedule_trigger':
      return {
        ...base,
        kind: 'schedule_trigger',
        runId: item.runId ?? runId ?? `history_item_${item.id}`,
        prompt: item.prompt,
        triggeredAt: item.triggeredAt,
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

function hasOwnPath<T>(record: Record<string, T>, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, path);
}
