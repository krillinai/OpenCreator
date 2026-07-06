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

type AppFileService = Pick<ReturnType<typeof createMockFileService>, 'listTree' | 'openFile' | 'saveFile'>;

export type AppProps = {
  fileService?: AppFileService;
};

export function App(props: AppProps = {}) {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const defaultFileService = useMemo(() => createMockFileService(), []);
  const fileService = props.fileService ?? defaultFileService;
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<WorkspaceFile>();
  const [editorContent, setEditorContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(true);
  const [savingFilePaths, setSavingFilePaths] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const selectedFilePathRef = useRef(state.selectedFilePath);
  const editorContentRef = useRef(editorContent);
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

    fileService.listTree().then(nodes => {
      if (!canceled) setTreeNodes(nodes);
    });

    return () => {
      canceled = true;
    };
  }, [fileService]);

  useEffect(() => {
    let canceled = false;

    setLoadingFile(true);
    fileService.openFile(state.selectedFilePath).then(file => {
      if (canceled) return;
      setCurrentFile(file);
      editorContentRef.current = file.content;
      setEditorContent(file.content);
      setLoadingFile(false);
    });

    return () => {
      canceled = true;
    };
  }, [fileService, state.selectedFilePath]);

  const dirty = currentFile !== undefined && editorContent !== currentFile.content;
  const savingCurrentFile = currentFile !== undefined && savingFilePaths.has(currentFile.path);

  function handleEditorContentChange(content: string) {
    editorContentRef.current = content;
    setEditorContent(content);
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

  async function saveCurrentFile() {
    if (currentFile === undefined) return;
    if (savingFilePathsRef.current.has(currentFile.path)) return;

    const saveSnapshot = { path: currentFile.path, content: editorContentRef.current };
    setFileSaving(saveSnapshot.path, true);

    try {
      const savedFile = await fileService.saveFile(saveSnapshot.path, saveSnapshot.content);

      if (!mountedRef.current || selectedFilePathRef.current !== saveSnapshot.path) return;

      setCurrentFile(savedFile);
      if (editorContentRef.current === saveSnapshot.content) {
        editorContentRef.current = savedFile.content;
        setEditorContent(savedFile.content);
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
        loadingFile || currentFile === undefined ? (
          <div className="panel-header">正在加载文件...</div>
        ) : (
          <FileEditor
            path={currentFile.path}
            content={editorContent}
            dirty={dirty}
            saving={savingCurrentFile}
            onChange={handleEditorContentChange}
            onSave={saveCurrentFile}
          />
        )
      }
      fileTree={
        <>
          <div className="panel-header">项目文件</div>
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
