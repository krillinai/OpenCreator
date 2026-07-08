import type {
  CreateThreadRequest,
  RunDiagnosticsResponse,
  RunResponse,
  SandboxMode,
  ThreadHistoryItem,
  ThreadResponse
} from '@clawee/protocol';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import { Timeline } from '../components/timeline/Timeline.js';
import { eventToTimelineItem, type TimelineItem } from '../components/timeline/timeline-model.js';
import { CapabilitiesView } from '../features/capabilities/CapabilitiesView.js';
import type { CapabilitiesViewProps } from '../features/capabilities/CapabilitiesView.js';
import { ConversationEmptyState } from '../features/conversation/ConversationEmptyState.js';
import { ConversationHeader } from '../features/conversation/ConversationHeader.js';
import { DetailPanel } from '../features/details/DetailPanel.js';
import { createDefaultProjects, findProjectById, type ClaweeConversation, type ClaweeProject } from '../features/projects/project-model.js';
import { Composer, type ComposerRunConfig } from '../features/runs/Composer.js';
import { ClaweeSettingsView, type RuntimeStatus } from '../features/settings/ClaweeSettingsView.js';
import { ClaweeSidebar } from '../features/shell/ClaweeSidebar.js';
import { browserBridge } from '../host/browser-bridge.js';
import type { HostBridge } from '../host/bridge.js';
import { RuntimeClient } from '../runtime/client.js';
import { subscribeRunEvents as defaultSubscribeRunEvents, type SubscribeRunEventsInput } from '../runtime/sse.js';
import type { ConnectionConfig } from '../runtime/types.js';
import { createConnectionService, type ConnectionState } from '../services/connection-service.js';
import { createDiagnosticsService } from '../services/diagnostics-service.js';
import { createMockFileService } from '../services/file-service.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import { createMockProjectService } from '../services/project-service.js';
import { createRunService } from '../services/run-service.js';
import { createThreadService } from '../services/thread-service.js';
import { initialAppState, reduceAppState } from './app-state.js';

type AppFileService = {
  listTree(): Promise<FileTreeNode[]>;
  openFile(path: string): Promise<WorkspaceFile>;
  saveFile(path: string, content: string): Promise<WorkspaceFile>;
};

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
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: 'disconnected',
    message: '正在等待本地服务'
  });
  const [runDiagnosticsById, setRunDiagnosticsById] = useState<Record<string, RunDiagnosticsResponse | undefined>>({});
  const [composerRunConfig, setComposerRunConfig] = useState<ComposerRunConfig | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [savedFileByPath, setSavedFileByPath] = useState<Record<string, WorkspaceFile>>({});
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string>(state.selectedFilePath);
  const [loadErrorByPath, setLoadErrorByPath] = useState<Record<string, string | undefined>>({});
  const [saveErrorByPath, setSaveErrorByPath] = useState<Record<string, string | undefined>>({});
  const [savingFilePaths, setSavingFilePaths] = useState<Set<string>>(() => new Set());
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
  const allowInitialRuntimeProjectFocusRef = useRef(true);

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
  const projects = useMemo(() => createProjectsForThreads(baseProjects, runtimeThreads), [baseProjects, runtimeThreads]);
  const conversations = useMemo(
    () => runtimeThreads.map(thread => mapThreadToConversation(thread, projects)),
    [runtimeThreads, projects]
  );

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
      return () => {
        canceled = true;
      };
    }

    const selectedThread = runtimeThreads.find(thread => thread.id === selectedThreadId);
    if (selectedThread === undefined) {
      return () => {
        canceled = true;
      };
    }
    if (selectedThread.codexThreadId === undefined || selectedThread.codexThreadId === null) {
      setThreadHistoryLoadError(undefined);
      return () => {
        canceled = true;
      };
    }

    setTimelineItems([
      {
        kind: 'run_status',
        id: `history_loading_${selectedThreadId}`,
        label: 'running',
        content: JSON.stringify({ type: 'history_loading', threadId: selectedThreadId }),
        source: 'runtime'
      }
    ]);
    setThreadHistoryLoadError(undefined);

    threadService
      .getThreadHistory(selectedThreadId)
      .then(response => {
        if (canceled) return;
        setTimelineItems(mapHistoryItemsToTimelineItems(response.items));
        setThreadHistoryLoadError(undefined);
      })
      .catch(() => {
        if (canceled) return;
        setTimelineItems([]);
        setThreadHistoryLoadError('无法加载聊天历史');
      });

    return () => {
      canceled = true;
    };
  }, [connectionState.status, runtimeThreads, state.selectedThreadId, threadService]);

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
  const runtimeStatus = mapRuntimeStatus(connectionState);

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
    setRuntimeBusy(false);
    dispatch({ type: 'new_conversation' });
  }

  function selectProject(projectId: string) {
    allowInitialRuntimeProjectFocusRef.current = false;
    sseAbortControllerRef.current?.abort();
    setTimelineItems([]);
    setRuntimeBusy(false);
    dispatch({ type: 'select_project', projectId });
  }

  function selectConversation(conversationId: string) {
    allowInitialRuntimeProjectFocusRef.current = false;
    sseAbortControllerRef.current?.abort();
    setTimelineItems([]);
    setRuntimeBusy(false);
    const conversation = conversations.find(item => item.id === conversationId);
    if (conversation !== undefined && conversation.projectId !== state.currentProjectId) {
      dispatch({ type: 'select_project', projectId: conversation.projectId });
    }
    dispatch({ type: 'select_thread', threadId: conversationId });
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

  function openChangeDetail(changeId: string) {
    dispatch({ type: 'select_change', changeId });
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

  const detailPanel = createDetailPanel();
  const composerDisabled = runtimeBusy || connectionState.status !== 'connected';
  const composerDisabledReason = runtimeBusy ? '当前对话有任务运行中' : '正在连接本地运行内核';
  const main = props.capabilitiesView !== undefined ? (
    <CapabilitiesView {...props.capabilitiesView} />
  ) : state.activeView === 'settings' ? (
    <ClaweeSettingsView runtimeStatus={runtimeStatus} onBack={() => dispatch({ type: 'back_to_app' })} />
  ) : state.activeView === 'conversation' ? (
    <section className="conversation-page">
      <ConversationHeader
        title={selectedConversation?.title ?? '新对话'}
        projectName={currentProjectName}
        statusLabel={getConnectionStatusLabel(connectionState)}
        onOpenLocation={() => dispatch({ type: 'select_file', path: selectedFilePath })}
        onToggleDetail={() => {
          if (state.rightPanelMode === 'closed') {
            dispatch({ type: 'select_file', path: selectedFilePath });
          } else {
            dispatch({ type: 'close_detail' });
          }
        }}
      />
      <div className="conversation-body" ref={conversationBodyRef}>
        {treeLoadError ? <p className="inline-error">{treeLoadError}</p> : null}
        {threadLoadError ? <p className="inline-error">{threadLoadError}</p> : null}
        {threadHistoryLoadError ? <p className="inline-error">{threadHistoryLoadError}</p> : null}
        {timelineItems.length === 0 ? (
          <ConversationEmptyState projectName={currentProjectName} />
        ) : (
          <Timeline items={timelineItems} onOpenRunDetail={openRunDetail} onOpenChange={openChangeDetail} />
        )}
      </div>
      <div className="composer-wrap">
        <Composer
          projectName={currentProjectName}
          permission={(composerRunConfig ?? defaultComposerRunConfig(currentProject)).permission}
          model={(composerRunConfig ?? defaultComposerRunConfig(currentProject)).model}
          reasoning={(composerRunConfig ?? defaultComposerRunConfig(currentProject)).reasoning}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
          onSubmit={submitPrompt}
        />
      </div>
    </section>
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
          onNewConversation={startNewConversation}
          onSelectProject={selectProject}
          onSelectConversation={selectConversation}
          onOpenView={(activeView) => dispatch({ type: 'set_active_view', activeView })}
          onOpenSettings={() => dispatch({ type: 'open_settings' })}
          onCheckUpdates={() => dispatch({ type: 'open_settings' })}
        />
      }
      main={main}
      detail={detailPanel}
      detailOpen={detailPanel !== null && state.activeView === 'conversation'}
    />
  );

  function createDetailPanel() {
    if (state.rightPanelMode === 'closed') return null;

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

function PlaceholderView(props: { label: string }) {
  return (
    <section className="placeholder-page" aria-labelledby="placeholder-title">
      <h1 id="placeholder-title">Clawee：{props.label}</h1>
    </section>
  );
}

function getPlaceholderLabel(activeView: 'search' | 'schedules' | 'plugins') {
  switch (activeView) {
    case 'search':
      return '搜索';
    case 'schedules':
      return '已安排';
    case 'plugins':
      return '插件';
  }
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

function toRuntimeSandbox(permission: ClaweeProject['sandbox'] | undefined): SandboxMode {
  if (permission === 'danger-full-access' || permission === 'workspace-write') return permission;
  return 'read-only';
}

function upsertThread(threads: ThreadResponse[], thread: ThreadResponse): ThreadResponse[] {
  const withoutThread = threads.filter(item => item.id !== thread.id);
  return [thread, ...withoutThread];
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
