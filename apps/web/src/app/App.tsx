import { useEffect, useMemo, useReducer, useState } from 'react';
import { WorkbenchLayout } from '../components/layout/WorkbenchLayout.js';
import { FileEditor } from '../components/editor/FileEditor.js';
import { FileTree } from '../components/editor/FileTree.js';
import { ConnectionPanel } from '../features/connection/ConnectionPanel.js';
import { Composer } from '../features/runs/Composer.js';
import { ThreadList } from '../features/threads/ThreadList.js';
import { createMockFileService } from '../services/file-service.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';
import { initialAppState, reduceAppState } from './app-state.js';

export function App() {
  const [state, dispatch] = useReducer(reduceAppState, initialAppState);
  const fileService = useMemo(() => createMockFileService(), []);
  const [treeNodes, setTreeNodes] = useState<FileTreeNode[]>([]);
  const [currentFile, setCurrentFile] = useState<WorkspaceFile>();
  const [editorContent, setEditorContent] = useState('');
  const [loadingFile, setLoadingFile] = useState(true);

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
      setEditorContent(file.content);
      setLoadingFile(false);
    });

    return () => {
      canceled = true;
    };
  }, [fileService, state.selectedFilePath]);

  const dirty = currentFile !== undefined && editorContent !== currentFile.content;

  async function saveCurrentFile() {
    if (currentFile === undefined) return;

    const savedFile = await fileService.saveFile(currentFile.path, editorContent);
    setCurrentFile(savedFile);
    setEditorContent(savedFile.content);
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
            onChange={setEditorContent}
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
            onSelect={path => dispatch({ type: 'select_file', path })}
          />
        </>
      }
    />
  );
}
