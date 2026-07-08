import type {
  ThreadResponse,
  WorkspaceDirectoryResponse,
  WorkspaceFileContentResponse,
  WorkspaceFileMeta,
  WorkspaceFileRevealRequest,
  WorkspaceFileSaveRequest
} from '@clawee/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../../runtime/errors.js';
import { FileEditorPane } from './FileEditorPane.js';
import { FilePathBar } from './FilePathBar.js';
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
  workspaceFileService?: WorkspaceFileService | null;
  onBack(): void;
  onSelectPath?(path: string): void;
};

const RECENT_PATH_STORAGE_PREFIX = 'clawee.file-workspace.recent.';

export function FileWorkspaceView(props: FileWorkspaceViewProps) {
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
  const objectUrlRef = useRef<string>();
  const loadedPathsRef = useRef(new Set<string>());
  const openRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

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

        loadedPathsRef.current.add('');
        setRootName(directory.rootName);
        setRootPathLabel(directory.rootPathLabel);
        setNodes(directory.nodes);
        setTruncatedPaths(directory.truncated ? [''] : []);
        setWorkspaceMessage(directory.warnings[0]);

        const recentPath = recentPathStorageKey ? readRecentPath(recentPathStorageKey) : undefined;
        const nextPath = recentPath ?? chooseSuggestedPath(directory);
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
  }, [thread?.id, service, recentPathStorageKey]);

  async function openFilePath(path: string, options?: { skipDirtyConfirm?: boolean }) {
    if (!thread || !service) {
      return;
    }

    if (!options?.skipDirtyConfirm && dirty && !window.confirm('当前文件有未保存修改，确定放弃并切换吗？')) {
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

  async function handleRevealDirectory() {
    if (!thread || !service || !activePath) {
      return;
    }

    setWorkspaceMessage(undefined);
    try {
      await service.reveal({ threadId: thread.id, path: activePath, mode: 'directory' });
    } catch (error) {
      setWorkspaceMessage(humanizeError(error, '无法打开所在目录'));
    }
  }

  async function handleCopyPath() {
    if (!activePath) {
      return;
    }

    const absolutePath = joinPath(rootPathLabel, activePath);
    if (!navigator.clipboard?.writeText) {
      setWorkspaceMessage('当前环境不支持复制路径');
      return;
    }

    try {
      await navigator.clipboard.writeText(absolutePath);
      setWorkspaceMessage('已复制文件路径');
    } catch (error) {
      setWorkspaceMessage(humanizeError(error, '复制路径失败'));
    }
  }

  function handleBack() {
    if (dirty && !window.confirm('当前文件有未保存修改，确定返回对话吗？')) {
      return;
    }

    props.onBack();
  }

  if (!thread) {
    return (
      <section className="file-workspace-empty">
        <p>请选择或创建一个会话后查看文件</p>
      </section>
    );
  }

  if (!service) {
    return (
      <section className="file-workspace-empty">
        <p>本地文件服务暂不可用</p>
      </section>
    );
  }

  return (
    <section className="file-workspace-view">
      <FileTopBar fileName={effectiveMeta?.name} dirty={dirty} onBack={handleBack} />
      <FilePathBar
        rootName={rootName}
        path={activePath}
        onRevealDirectory={handleRevealDirectory}
        onCopyPath={handleCopyPath}
      />

      <div className="file-workspace-body">
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
            dirty={dirty}
            saving={saving}
            loadError={loading ? '正在加载文件...' : loadError}
            saveError={saveError}
            onChange={setDraftContent}
            onSave={() => void handleSave(false)}
          />
        </div>
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

function readRecentPath(storageKey: string): string | undefined {
  const value = window.localStorage.getItem(storageKey);
  return value === null || value.length === 0 ? undefined : value;
}

function writeRecentPath(storageKey: string, path: string) {
  window.localStorage.setItem(storageKey, path);
}

function joinPath(rootPathLabel: string, path: string): string {
  if (rootPathLabel.length === 0) {
    return path;
  }

  return `${rootPathLabel.replace(/\/+$/, '')}/${path}`;
}
