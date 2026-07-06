import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import { FileEditor } from '../components/editor/FileEditor.js';
import { FileTree } from '../components/editor/FileTree.js';
import { ConnectionPanel } from '../features/connection/ConnectionPanel.js';
import { Composer } from '../features/runs/Composer.js';
import { ThreadList } from '../features/threads/ThreadList.js';
import { createMockFileService } from '../services/file-service.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import { initialAppState, reduceAppState } from './app-state.js';

type AppFileService = {
  listTree(): Promise<FileTreeNode[]>;
  openFile(path: string): Promise<WorkspaceFile>;
  saveFile(path: string, content: string): Promise<WorkspaceFile>;
};

export type AppProps = {
  fileService?: AppFileService;
};

export function App(props: AppProps = {}) {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const defaultFileService = useMemo(() => createMockFileService(), []);
  const fileService = props.fileService ?? defaultFileService;
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [treeLoadError, setTreeLoadError] = useState<string>();
  const [savedFileByPath, setSavedFileByPath] = useState<Record<string, WorkspaceFile>>({});
  const [draftContentByPath, setDraftContentByPath] = useState<Record<string, string>>({});
  const [loadingFilePath, setLoadingFilePath] = useState<string>(state.selectedFilePath);
  const [loadErrorByPath, setLoadErrorByPath] = useState<Record<string, string | undefined>>({});
  const [saveErrorByPath, setSaveErrorByPath] = useState<Record<string, string | undefined>>({});
  const [savingFilePaths, setSavingFilePaths] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const selectedFilePathRef = useRef(state.selectedFilePath);
  const savedFileByPathRef = useRef<Record<string, WorkspaceFile>>({});
  const draftContentByPathRef = useRef<Record<string, string>>({});
  const openRequestByPathRef = useRef<Record<string, number>>({});
  const fileRevisionByPathRef = useRef<Record<string, number>>({});
  const savingFilePathsRef = useRef(new Set<string>());

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    selectedFilePathRef.current = state.selectedFilePath;
  }, [state.selectedFilePath]);

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
          <ConnectionPanel status="disconnected" />
          <ThreadList threads={[]} onSelect={() => {}} onNewThread={() => {}} />
        </div>
      }
      timeline={
        <>
          <div className="panel-header">Agent 对话</div>
          <Composer onSubmit={() => {}} />
        </>
      }
      rightPanel={
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
      }
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
