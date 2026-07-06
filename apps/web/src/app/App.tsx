import type { RunDiagnosticsResponse, RunResponse } from '@clawee/protocol';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import { Timeline } from '../components/timeline/Timeline.js';
import { eventToTimelineItem, type TimelineItem } from '../components/timeline/timeline-model.js';
import { FileEditor } from '../components/editor/FileEditor.js';
import { FileTree } from '../components/editor/FileTree.js';
import { CapabilitiesView } from '../features/capabilities/CapabilitiesView.js';
import type { CapabilitiesViewProps } from '../features/capabilities/CapabilitiesView.js';
import { ConnectionPanel } from '../features/connection/ConnectionPanel.js';
import { Composer } from '../features/runs/Composer.js';
import { RunDetailPanel } from '../features/runs/RunDetailPanel.js';
import { ThreadList } from '../features/threads/ThreadList.js';
import { browserBridge } from '../host/browser-bridge.js';
import type { HostBridge } from '../host/bridge.js';
import { RuntimeClient } from '../runtime/client.js';
import { subscribeRunEvents as defaultSubscribeRunEvents, type SubscribeRunEventsInput } from '../runtime/sse.js';
import type { ConnectionConfig } from '../runtime/types.js';
import { createMockChangeService } from '../services/change-service.js';
import { createConnectionService, type ConnectionState } from '../services/connection-service.js';
import { createDiagnosticsService } from '../services/diagnostics-service.js';
import { createMockFileService } from '../services/file-service.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import { createMockProjectService } from '../services/project-service.js';
import { createRunService } from '../services/run-service.js';
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
  const defaultFileService = useMemo(() => createMockFileService(), []);
  const fileService = props.fileService ?? defaultFileService;
  const hostBridge = props.hostBridge ?? browserBridge;
  const runtimeFetch = props.runtimeFetch ?? fetch;
  const subscribeRunEvents = props.subscribeRunEvents ?? defaultSubscribeRunEvents;
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [treeLoadError, setTreeLoadError] = useState<string>();
  const [timelineItems, setTimelineItems] = useState<TimelineItem[]>([]);
  const [connectionConfig, setConnectionConfig] = useState<ConnectionConfig | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>({ status: 'disconnected', message: '未连接 Runtime' });
  const [runDiagnosticsById, setRunDiagnosticsById] = useState<Record<string, RunDiagnosticsResponse | undefined>>({});
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [savedFileByPath, setSavedFileByPath] = useState<Record<string, WorkspaceFile>>({});
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string>(state.selectedFilePath);
  const [loadErrorByPath, setLoadErrorByPath] = useState<Record<string, string | undefined>>({});
  const [saveErrorByPath, setSaveErrorByPath] = useState<Record<string, string | undefined>>({});
  const [savingFilePaths, setSavingFilePaths] = useState<Set<string>>(() => new Set());
  const projectService = useMemo(() => createMockProjectService(), []);
  const changeService = useMemo(() => createMockChangeService(), []);
  const timelineIdSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const selectedFilePathRef = useRef(state.selectedFilePath);
  const savedFileByPathRef = useRef<Record<string, WorkspaceFile>>({});
  const draftContentByPathRef = useRef<Record<string, string>>({});
  const openRequestByPathRef = useRef<Record<string, number>>({});
  const fileRevisionByPathRef = useRef<Record<string, number>>({});
  const savingFilePathsRef = useRef(new Set<string>());
  const connectionConfigRef = useRef<ConnectionConfig | null>(null);
  const sseAbortControllerRef = useRef<AbortController | null>(null);

  const runtimeClient = useMemo(
    () => connectionConfig === null ? null : new RuntimeClient({ ...connectionConfig, fetchImpl: runtimeFetch }),
    [connectionConfig, runtimeFetch]
  );
  const connectionService = useMemo(
    () => runtimeClient === null ? null : createConnectionService(runtimeClient),
    [runtimeClient]
  );
  const runService = useMemo(() => runtimeClient === null ? null : createRunService(runtimeClient), [runtimeClient]);
  const diagnosticsService = useMemo(
    () => runtimeClient === null ? null : createDiagnosticsService(runtimeClient),
    [runtimeClient]
  );

  useEffect(() => {
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

    hostBridge
      .readConnectionConfig()
      .then(config => {
        if (!canceled) setConnectionConfig(config);
      })
      .catch(() => {
        if (!canceled) setConnectionConfig(null);
      });

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
      setConnectionState({ status: 'disconnected', message: '未连接 Runtime' });
      return () => {
        canceled = true;
      };
    }

    connectionService
      .check()
      .then(nextState => {
        if (canceled || !mountedRef.current) return;
        setConnectionState(nextState);
      })
      .catch(() => {
        if (canceled || !mountedRef.current) return;
        setConnectionState({ status: 'disconnected', message: 'Runtime 连接失败' });
      });

    return () => {
      canceled = true;
    };
  }, [connectionService]);

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
  const dirty = currentFile !== undefined && selectedDraftContent !== currentFile.content;
  const savingCurrentFile = savingFilePaths.has(selectedFilePath);
  const loadingSelectedFile = loadingFilePath === selectedFilePath && currentFile === undefined;
  const loadError = loadErrorByPath[selectedFilePath];
  const saveError = saveErrorByPath[selectedFilePath];
  const runDiagnostics = state.selectedRunId === undefined ? undefined : runDiagnosticsById[state.selectedRunId];
  const rightPanel =
    props.capabilitiesView !== undefined ? (
      <CapabilitiesView {...props.capabilitiesView} />
    ) : state.rightPanelMode === 'run_detail' ? (
      <RunDetailPanel runId={state.selectedRunId} diagnostics={runDiagnostics} />
    ) : (
      loadingSelectedFile ? (
        <div className="panel-header">正在加载文件...</div>
      ) : currentFile === undefined ? (
        <div className="panel-header">{loadError ?? '无法加载文件'}</div>
      ) : (
        <FileEditor
          path={currentFile.path}
          content={selectedDraftContent}
          dirty={dirty}
          saving={savingCurrentFile}
          loadError={loadError}
          saveError={saveError}
          onChange={handleEditorContentChange}
          onSave={saveCurrentFile}
        />
      )
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

  async function handleConnect(config: ConnectionConfig) {
    setConnectionConfig(config);
    await hostBridge.writeConnectionConfig(config);
  }

  function submitPrompt(prompt: string) {
    if (connectionState.status === 'connected' && runService !== null && connectionConfigRef.current !== null) {
      void submitRuntimePrompt(prompt);
      return;
    }

    const nextItems: TimelineItem[] = [
      {
        kind: 'user_message',
        id: createTimelineId('user'),
        text: prompt,
        source: 'mock'
      },
      {
        kind: 'assistant_message',
        id: createTimelineId('assistant'),
        text: '当前未连接 Runtime，已在 mock workspace 中记录本次任务。',
        source: 'mock'
      }
    ];

    if (currentFile !== undefined) {
      const change = changeService.createPromptChange(prompt, currentFile.path);
      nextItems.push({
        kind: 'change_card',
        id: createTimelineId('change'),
        title: change.title,
        path: change.path,
        delta: change.delta,
        source: change.source
      });
    }

    setTimelineItems(previous => [...previous, ...nextItems]);
  }

  async function submitRuntimePrompt(prompt: string) {
    if (runService === null || connectionConfigRef.current === null) return;
    if (runtimeBusy) return;

    setRuntimeBusy(true);
    setTimelineItems(previous => [
      ...previous,
      { kind: 'user_message', id: createTimelineId('user'), text: prompt, source: 'runtime' }
    ]);

    try {
      const run = await runService.startStandaloneRun({ prompt });
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
      signal: abortController.signal,
      onEvent(event) {
        if (!mountedRef.current) return;
        setTimelineItems(previous => [...previous, eventToTimelineItem(event)]);
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

  return (
    <WorkbenchLayout
      sidebar={
        <div className="sidebar-stack">
          <ConnectionPanel
            status={connectionState.status}
            codexStatus={connectionState.status === 'connected' ? connectionState.codexStatus : undefined}
            initialConfig={connectionConfig}
            message={connectionState.status === 'connected' ? undefined : connectionState.message}
            onConnect={handleConnect}
          />
          <ThreadList threads={[]} selectedThreadId={state.selectedThreadId} onSelect={() => {}} onNewThread={() => {}} />
        </div>
      }
      timeline={
        <div className="timeline-shell">
          <Timeline items={timelineItems} onOpenRunDetail={openRunDetail} />
          <Composer disabled={runtimeBusy} onSubmit={submitPrompt} />
        </div>
      }
      rightPanel={rightPanel}
      fileTree={
        <>
          <div className="panel-header">{treeLoadError ?? '项目文件'}</div>
          <FileTree
            nodes={treeNodes}
            selectedPath={state.selectedFilePath}
            onSelect={path => {
              selectedFilePathRef.current = path;
              dispatch({ type: 'select_file', path });
            }}
          />
        </>
      }
    />
  );
}

function hasOwnPath<T>(record: Record<string, T>, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, path);
}
