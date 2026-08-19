import type {
  ThreadResponse,
  WorkspaceDirectoryResponse,
  WorkspaceFileContentResponse,
  WorkspaceFileMeta,
  WorkspaceFileRevealRequest,
  WorkspaceFileSaveRequest
} from '@opencreator/protocol';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import { beginPaneResize } from '../../components/layout/pane-resize-2026-07-29.js';
import { ApiClientError } from '../../runtime/errors.js';
import { defaultModeForMeta, FileEditorPane, isPreviewable, type FileEditorMode } from './FileEditorPane.js';
import { FileTopBar } from './FileTopBar.js';
import { ProjectFileTree } from './ProjectFileTree.js';
import { chooseSuggestedPath, mergeDirectoryNodes, parentDirectories, workspaceKey } from './file-view-state.js';

export type WorkspaceFileService = {
  listDirectory(threadId: string, path: string): Promise<WorkspaceDirectoryResponse>;
  getMeta(threadId: string, path: string): Promise<WorkspaceFileMeta>;
  openText(threadId: string, path: string): Promise<WorkspaceFileContentResponse>;
  saveText(input: WorkspaceFileSaveRequest): Promise<{ meta: WorkspaceFileMeta; saved: true }>;
  openBlob(threadId: string, path: string): Promise<{ objectUrl: string; mime: string; size: number }>;
  revokeBlob(objectUrl: string): void;
  reveal(input: WorkspaceFileRevealRequest): Promise<unknown>;
};

type FileWorkspaceViewProps = {
  selectedThread?: ThreadResponse;
  selectedPath?: string;
  workspaceFileService?: WorkspaceFileService | null;
  onWorkspaceAvailabilityChange?(threadId: string, hasEntries: boolean): void;
  onClose(): void;
  onSelectPath?(path: string): void;
  onOpenExternal?(url: string): void;
};

const RECENT_PATH_STORAGE_PREFIX = 'opencreator.file-workspace.recent.';
const FILE_TREE_MIN_WIDTH = 220;
const FILE_TREE_MAX_WIDTH = 420;
const FILE_EDITOR_MIN_WIDTH = 360;
const RESIZE_KEY_STEP = 32;
const FILE_REFRESH_INTERVAL_MS = 2000;

export function FileWorkspaceView(props: FileWorkspaceViewProps) {
  const confirm = useConfirmDialog();
  const [nodes, setNodes] = useState<WorkspaceDirectoryResponse['nodes']>([]);
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [truncatedPaths, setTruncatedPaths] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [rootName, setRootName] = useState('工作区');
  const [rootPathLabel, setRootPathLabel] = useState('');
  const [workspaceMessage, setWorkspaceMessage] = useState<string>();
  const [activePath, setActivePath] = useState<string>();
  const [meta, setMeta] = useState<WorkspaceFileMeta>();
  const [savedContent, setSavedContent] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [objectUrl, setObjectUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(true);
  const [treeWidth, setTreeWidth] = useState(280);
  const [fileMode, setFileMode] = useState<FileEditorMode>('preview');
  const objectUrlRef = useRef<string>();
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const loadedPathsRef = useRef(new Set<string>());
  const openRequestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const selectedPathRef = useRef(props.selectedPath);
  selectedPathRef.current = props.selectedPath;

  const thread = props.selectedThread;
  const service = props.workspaceFileService ?? undefined;
  const threadReadonly = thread?.sandbox === 'read-only';
  const dirty = meta !== undefined && isTextMeta(meta) && draftContent !== savedContent;
  const effectiveMeta = useMemo(() => {
    if (!meta) {
      return undefined;
    }

    if (!threadReadonly) {
      return meta;
    }

    return {
      ...meta,
      readonly: true
    };
  }, [meta, threadReadonly]);
  const recentPathStorageKey = thread ? `${RECENT_PATH_STORAGE_PREFIX}${workspaceKey(thread.canonicalCwd)}` : undefined;
  const htmlPreviewResources = useMemo(() => (
    thread && service
      ? {
          async openText(path: string) {
            const response = await service.openText(thread.id, path);
            return { content: response.content, mime: response.meta.mime };
          },
          openBlob(path: string) {
            return service.openBlob(thread.id, path);
          },
          revokeBlob(objectUrl: string) {
            service.revokeBlob(objectUrl);
          }
        }
      : undefined
  ), [service, thread]);

  useEffect(() => {
    setFileMode(workspaceModeForMeta(effectiveMeta));
  }, [effectiveMeta?.path, effectiveMeta?.kind, effectiveMeta?.editable]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (objectUrlRef.current && service) {
        service.revokeBlob(objectUrlRef.current);
      }
    };
  }, [service]);

  useEffect(() => {
    const currentThread = thread;

    loadedPathsRef.current = new Set();
    setNodes([]);
    setExpandedPaths([]);
    setTruncatedPaths([]);
    setSearch('');
    setRootName('工作区');
    setRootPathLabel('');
    setWorkspaceMessage(undefined);
    setActivePath(undefined);
    setMeta(undefined);
    setSavedContent('');
    setDraftContent('');
    setLoadError(undefined);
    setSaveError(undefined);
    setConflictOpen(false);
    replaceObjectUrl(undefined);

    if (!currentThread || !service) {
      return;
    }

    let canceled = false;

    void service
      .listDirectory(currentThread.id, '')
      .then(async (directory) => {
        if (canceled || !mountedRef.current) {
          return;
        }

        props.onWorkspaceAvailabilityChange?.(currentThread.id, directory.nodes.length > 0);
        loadedPathsRef.current.add('');
        setRootName(directory.rootName);
        setRootPathLabel(directory.rootPathLabel);
        setNodes(directory.nodes);
        setTruncatedPaths(directory.truncated ? [''] : []);
        setWorkspaceMessage(directory.warnings[0]);

        const requestedPath = selectedPathRef.current?.trim();
        const recentPath = recentPathStorageKey ? readRecentPath(recentPathStorageKey) : undefined;
        const nextPath = requestedPath && requestedPath.length > 0
          ? resolveDirectoryFilePath(requestedPath, directory.nodes)
          : recentPath ?? chooseSuggestedPath(directory);
        if (nextPath) {
          await openFilePath(nextPath, { skipDirtyConfirm: true });
        }
      })
      .catch((error: unknown) => {
        if (canceled || !mountedRef.current) {
          return;
        }

        setWorkspaceMessage(humanizeError(error, '无法加载文件工作区'));
      });

    return () => {
      canceled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.sandbox, thread?.status, service, recentPathStorageKey]);

  useEffect(() => {
    const requestedPath = props.selectedPath?.trim();
    if (
      requestedPath === undefined
      || requestedPath.length === 0
      || requestedPath === activePath
      || !loadedPathsRef.current.has('')
    ) {
      return;
    }
    void openFilePath(resolveDirectoryFilePath(requestedPath, nodes), { skipDirtyConfirm: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedPath]);

  useEffect(() => {
    if (!thread || !service || !activePath || !meta) return;

    let canceled = false;
    let checking = false;

    const refreshIfChanged = async () => {
      if (
        canceled
        || checking
        || !mountedRef.current
        || dirty
        || document.visibilityState === 'hidden'
      ) {
        return;
      }

      checking = true;
      try {
        const latestMeta = await service.getMeta(thread.id, activePath);
        if (
          canceled
          || !mountedRef.current
          || latestMeta.versionToken === meta.versionToken
        ) {
          return;
        }
        await openFilePath(activePath, { skipDirtyConfirm: true });
      } catch {
        // 后台刷新失败不覆盖当前可用预览，用户主动打开时仍会看到明确错误。
      } finally {
        checking = false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshIfChanged();
    };
    const intervalId = window.setInterval(() => {
      void refreshIfChanged();
    }, FILE_REFRESH_INTERVAL_MS);

    window.addEventListener('focus', refreshIfChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      canceled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshIfChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, dirty, meta?.versionToken, service, thread?.id]);

  async function openFilePath(path: string, options?: { skipDirtyConfirm?: boolean }) {
    if (!thread || !service) {
      return;
    }

    if (!options?.skipDirtyConfirm && dirty && !await confirm({
      title: '放弃未保存的修改？',
      description: '切换文件后，当前文件中尚未保存的修改将丢失。',
      confirmLabel: '放弃并切换',
      destructive: true
    })) {
      return;
    }

    openRequestIdRef.current += 1;
    const requestId = openRequestIdRef.current;
    setLoading(true);
    setLoadError(undefined);
    setSaveError(undefined);
    setConflictOpen(false);

    try {
      const nextMeta = await service.getMeta(thread.id, path);
      if (!mountedRef.current || requestId !== openRequestIdRef.current) {
        return;
      }

      let nextContent = '';
      let nextObjectUrl: string | undefined;

      if (isTextMeta(nextMeta)) {
        const response = await service.openText(thread.id, path);
        if (!mountedRef.current || requestId !== openRequestIdRef.current) {
          return;
        }
        nextContent = response.content;
      } else if (isBlobMeta(nextMeta)) {
        const blob = await service.openBlob(thread.id, path);
        if (!mountedRef.current || requestId !== openRequestIdRef.current) {
          service.revokeBlob(blob.objectUrl);
          return;
        }
        nextObjectUrl = blob.objectUrl;
      }

      replaceObjectUrl(nextObjectUrl);
      setActivePath(path);
      setFileMode(workspaceModeForMeta(nextMeta));
      setMeta(nextMeta);
      setSavedContent(nextContent);
      setDraftContent(nextContent);
      setExpandedPaths((previous) => dedupePaths([...previous, ...parentDirectories(path)]));
      if (recentPathStorageKey) {
        writeRecentPath(recentPathStorageKey, path);
      }
      props.onSelectPath?.(path);
    } catch (error) {
      if (!mountedRef.current || requestId !== openRequestIdRef.current) {
        return;
      }
      setLoadError(humanizeError(error, '无法打开文件'));
    } finally {
      if (mountedRef.current && requestId === openRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function handleToggleDirectory(path: string) {
    if (!thread || !service) {
      return;
    }

    if (expandedPaths.includes(path)) {
      setExpandedPaths((previous) => previous.filter((item) => item !== path));
      return;
    }

    setExpandedPaths((previous) => dedupePaths([...previous, path]));
    if (loadedPathsRef.current.has(path)) {
      return;
    }

    try {
      const directory = await service.listDirectory(thread.id, path);
      if (!mountedRef.current) {
        return;
      }

      loadedPathsRef.current.add(path);
      setNodes((previous) => mergeDirectoryNodes(previous, path, directory.nodes));
      setTruncatedPaths((previous) => {
        const next = new Set(previous);
        if (directory.truncated) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return [...next];
      });
      setWorkspaceMessage(directory.warnings[0]);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      setWorkspaceMessage(humanizeError(error, '无法加载目录'));
    }
  }

  async function handleSave(overwriteConflict = false) {
    if (!thread || !service || !meta || !isTextMeta(meta) || threadReadonly || !dirty || saving) {
      return;
    }

    setSaving(true);
    setSaveError(undefined);
    setConflictOpen(false);

    try {
      const saved = await service.saveText({
        threadId: thread.id,
        path: meta.path,
        content: draftContent,
        baseVersionToken: meta.versionToken,
        overwriteConflict
      });

      if (!mountedRef.current) {
        return;
      }

      setMeta(saved.meta);
      setSavedContent(draftContent);
      setDraftContent(draftContent);
      setConflictOpen(false);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      if (error instanceof ApiClientError && error.status === 409 && error.code === 'FILE_CONFLICT') {
        setConflictOpen(true);
        setSaveError('文件已在其他位置更新，请选择处理方式。');
      } else {
        setSaveError(humanizeError(error, '保存失败'));
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  async function handleOpenFile() {
    if (!thread || !service || !activePath) {
      return;
    }

    setWorkspaceMessage(undefined);
    try {
      await service.reveal({ threadId: thread.id, path: activePath, mode: 'file' });
    } catch (error) {
      setWorkspaceMessage(humanizeError(error, '无法打开文件'));
    }
  }

  async function handleBack() {
    if (dirty && !await confirm({
      title: '关闭文件工作区？',
      description: '当前文件还有未保存的修改，关闭后这些修改将丢失。',
      confirmLabel: '放弃并关闭',
      destructive: true
    })) {
      return;
    }

    props.onClose();
  }

  function updateTreeWidth(clientX: number) {
    const body = workspaceBodyRef.current;
    if (!body) return;

    const rect = body.getBoundingClientRect();
    setTreeWidth(clampPaneWidth(
      rect.right - clientX,
      FILE_TREE_MIN_WIDTH,
      Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, rect.width - FILE_EDITOR_MIN_WIDTH))
    ));
  }

  function adjustTreeWidth(delta: number) {
    const body = workspaceBodyRef.current;
    const rect = body?.getBoundingClientRect();
    const maxWidth = rect
      ? Math.min(FILE_TREE_MAX_WIDTH, Math.max(FILE_TREE_MIN_WIDTH, rect.width - FILE_EDITOR_MIN_WIDTH))
      : FILE_TREE_MAX_WIDTH;

    setTreeWidth((previous) => clampPaneWidth(
      previous + delta,
      FILE_TREE_MIN_WIDTH,
      maxWidth
    ));
  }

  function handleTreeResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    beginPaneResize(event, updateTreeWidth);
  }

  function handleTreeResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustTreeWidth(RESIZE_KEY_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustTreeWidth(-RESIZE_KEY_STEP);
    }
  }

  if (!thread) {
    return renderEmptyWorkspace('请选择或创建一个会话后查看文件');
  }

  if (!service) {
    return renderEmptyWorkspace('本地文件服务暂不可用');
  }

  const fileWorkspaceBodyStyle = {
    '--file-tree-width': `${treeWidth}px`
  } as CSSProperties;

  return (
    <section className="file-workspace-view">
      <FileTopBar
        fileName={effectiveMeta?.name}
        rootName={rootName}
        path={activePath}
        dirty={dirty}
        treeCollapsed={treeCollapsed}
        mode={fileMode}
        canToggleMode={effectiveMeta !== undefined && effectiveMeta.editable && isPreviewable(effectiveMeta)}
        canSave={effectiveMeta !== undefined && effectiveMeta.editable}
        saveDisabled={saving || !dirty || effectiveMeta?.readonly}
        onModeChange={setFileMode}
        onSave={() => void handleSave(false)}
        onOpenFile={() => void handleOpenFile()}
        onToggleTree={() => setTreeCollapsed(previous => !previous)}
        onClose={handleBack}
      />

      <div
        className="file-workspace-body"
        data-tree-collapsed={treeCollapsed ? 'true' : undefined}
        ref={workspaceBodyRef}
        style={fileWorkspaceBodyStyle}
      >
        <div className="file-workspace-editor">
          {threadReadonly ? <div className="file-workspace-notice">当前会话为只读模式，不能保存文件</div> : null}
          {workspaceMessage ? <div className="file-workspace-notice">{workspaceMessage}</div> : null}
          {conflictOpen ? (
            <div className="file-workspace-conflict" role="alert">
              <span>文件内容与最新版本冲突。</span>
              <div className="file-workspace-conflict-actions">
                <button className="button-secondary" type="button" onClick={() => void openFilePath(meta?.path ?? '', { skipDirtyConfirm: true })}>
                  重新加载
                </button>
                <button className="button-secondary" type="button" onClick={() => void handleSave(true)}>
                  覆盖保存
                </button>
                <button className="button-secondary" type="button" onClick={() => setConflictOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          <FileEditorPane
            meta={effectiveMeta}
            content={draftContent}
            objectUrl={objectUrl}
            htmlPreviewResources={htmlPreviewResources}
            dirty={dirty}
            saving={saving}
            loadError={loading ? '正在加载文件...' : loadError}
            saveError={saveError}
            mode={fileMode}
            toolbar="hidden"
            onChange={setDraftContent}
            onSave={() => void handleSave(false)}
            onModeChange={setFileMode}
            onOpenExternal={props.onOpenExternal}
          />
        </div>

        {treeCollapsed ? null : (
          <>
            <div
              className="pane-resize-handle file-tree-resize-handle"
              role="separator"
              aria-label="调整编辑区和目录树宽度"
              aria-orientation="vertical"
              aria-valuenow={treeWidth}
              tabIndex={0}
              onMouseDown={handleTreeResizeMouseDown}
              onKeyDown={handleTreeResizeKeyDown}
            />
            <ProjectFileTree
              nodes={nodes}
              selectedPath={activePath ?? ''}
              expandedPaths={expandedPaths}
              search={search}
              truncatedPaths={truncatedPaths}
              onToggleDirectory={handleToggleDirectory}
              onSelectFile={(path) => void openFilePath(path)}
              onSearchChange={setSearch}
            />
          </>
        )}
      </div>
    </section>
  );

  function replaceObjectUrl(nextObjectUrl: string | undefined) {
    const previousObjectUrl = objectUrlRef.current;
    objectUrlRef.current = nextObjectUrl;
    setObjectUrl(nextObjectUrl);

    if (previousObjectUrl && previousObjectUrl !== nextObjectUrl && service) {
      service.revokeBlob(previousObjectUrl);
    }
  }

  function renderEmptyWorkspace(message: string) {
    return (
      <section className="file-workspace-view is-empty">
        <FileTopBar onClose={handleBack} />
        <section className="file-workspace-empty">
          <p>{message}</p>
        </section>
      </section>
    );
  }
}

function isTextMeta(meta: WorkspaceFileMeta): boolean {
  return meta.editable
    || meta.kind === 'markdown'
    || meta.kind === 'text'
    || meta.kind === 'json'
    || meta.kind === 'code'
    || meta.kind === 'html'
    || meta.mime === 'image/svg+xml';
}

function isBlobMeta(meta: WorkspaceFileMeta): boolean {
  return meta.kind === 'image' || meta.kind === 'pdf';
}

function workspaceModeForMeta(meta?: WorkspaceFileMeta): FileEditorMode {
  return meta !== undefined && isPreviewable(meta) ? 'preview' : defaultModeForMeta(meta);
}

function resolveDirectoryFilePath(
  requestedPath: string,
  nodes: WorkspaceDirectoryResponse['nodes']
): string {
  const normalizedRequestedPath = requestedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const exactMatch = nodes.find(node => node.type === 'file' && node.path === normalizedRequestedPath);
  if (exactMatch !== undefined) return exactMatch.path;

  const requestedName = normalizedRequestedPath.split('/').at(-1);
  if (requestedName === undefined || requestedName.length === 0) return normalizedRequestedPath;
  const nameMatches = nodes.filter(node => node.type === 'file' && node.name === requestedName);
  return nameMatches.length === 1 ? nameMatches[0]!.path : normalizedRequestedPath;
}

function humanizeError(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(value, min), max));
}

function readRecentPath(storageKey: string): string | undefined {
  const value = window.localStorage.getItem(storageKey);
  return value === null || value.length === 0 ? undefined : value;
}

function writeRecentPath(storageKey: string, path: string) {
  window.localStorage.setItem(storageKey, path);
}
