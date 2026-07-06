import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });

  return { promise, resolve, reject };
}

describe('App', () => {
  it('preserves edits made during a pending save when switching away and back', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench';
    const contentB = '# Notes';
    const savedSnapshotContentA = '# Workbench\nfirst edit';
    const continuedEditContentA = '# Workbench\nfirst edit\nsecond edit';
    const saveDeferred = createDeferred<WorkspaceFile>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, path === filePathA ? initialContentA : contentB);
      },
      saveFile() {
        return saveDeferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });
    expect(editorA).toHaveValue(initialContentA);

    await user.clear(editorA);
    await user.type(editorA, savedSnapshotContentA);
    await user.click(screen.getByRole('button', { name: '保存到本地草稿' }));

    await user.clear(editorA);
    await user.type(editorA, continuedEditContentA);

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));
    const returnedEditorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });

    await act(async () => {
      saveDeferred.resolve(createWorkspaceFile(filePathA, savedSnapshotContentA));
      await saveDeferred.promise;
    });

    await waitFor(() => {
      expect(returnedEditorA).toHaveValue(continuedEditContentA);
      expect(screen.getByText('未保存')).toBeInTheDocument();
    });
  });

  it('does not start a second save for the same file while one is pending', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const initialContent = '# Workbench';
    const firstEditContent = '# Workbench\nfirst edit';
    const latestContent = '# Workbench\nfirst edit\nsecond edit';
    const firstSave = createDeferred<WorkspaceFile>();
    const secondSave = createDeferred<WorkspaceFile>();
    const saveDeferreds = [firstSave, secondSave];
    const saveCalls: Array<{ path: string; content: string }> = [];
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, initialContent);
      },
      saveFile(path: string, content: string) {
        saveCalls.push({ path, content });
        const deferred = saveDeferreds[saveCalls.length - 1];
        if (deferred === undefined) throw new Error(`Unexpected save call ${saveCalls.length}`);
        return deferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editor = await screen.findByRole('textbox', { name: `${filePath} 编辑器` });
    const saveButton = screen.getByRole('button', { name: '保存到本地草稿' });

    await user.clear(editor);
    await user.type(editor, firstEditContent);
    await user.click(saveButton);
    expect(saveCalls).toEqual([{ path: filePath, content: firstEditContent }]);

    await user.clear(editor);
    await user.type(editor, latestContent);
    await user.click(saveButton);
    expect(saveCalls).toHaveLength(1);

    await act(async () => {
      firstSave.resolve(createWorkspaceFile(filePath, firstEditContent));
      await firstSave.promise;
    });

    await waitFor(() => {
      expect(editor).toHaveValue(latestContent);
      expect(screen.getByText('未保存')).toBeInTheDocument();
    });

    await user.click(saveButton);
    expect(saveCalls).toEqual([
      { path: filePath, content: firstEditContent },
      { path: filePath, content: latestContent }
    ]);
  });

  it('keeps the draft and clears pending state when saving fails', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const initialContent = '# Workbench';
    const draftContent = '# Workbench\nunsaved edit';
    const saveDeferred = createDeferred<WorkspaceFile>();
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, initialContent);
      },
      saveFile() {
        return saveDeferred.promise;
      }
    };

    render(<App fileService={fileService} />);

    const editor = await screen.findByRole('textbox', { name: `${filePath} 编辑器` });
    const saveButton = screen.getByRole('button', { name: '保存到本地草稿' });

    await user.clear(editor);
    await user.type(editor, draftContent);
    await user.click(saveButton);
    expect(saveButton).toBeDisabled();

    await act(async () => {
      saveDeferred.reject(new Error('disk unavailable'));
      await saveDeferred.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(editor).toHaveValue(draftContent);
      expect(saveButton).not.toBeDisabled();
      expect(screen.getByText('保存到本地草稿失败')).toBeInTheDocument();
      expect(screen.getByText('未保存')).toBeInTheDocument();
    });
  });

  it('shows a file loading failure when openFile rejects', async () => {
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const treeNodes: FileTreeNode[] = [{ type: 'file', name: 'enterprise-agent-workbench.md', path: filePath, depth: 0 }];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile() {
        throw new Error('missing file');
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    expect(await screen.findByText('无法加载文件')).toBeInTheDocument();
    expect(screen.queryByText('正在加载文件...')).not.toBeInTheDocument();
  });

  it('surfaces reload failures while preserving an existing file draft', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench';
    const draftContentA = '# Workbench\nunsaved edit';
    const contentB = '# Notes';
    const openCallsByPath = new Map<string, number>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        openCallsByPath.set(path, (openCallsByPath.get(path) ?? 0) + 1);
        if (path === filePathA && openCallsByPath.get(path) === 2) {
          throw new Error('file unavailable');
        }
        return createWorkspaceFile(path, path === filePathA ? initialContentA : contentB);
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    const editorA = await screen.findByRole('textbox', { name: `${filePathA} 编辑器` });
    expect(editorA).toHaveValue(initialContentA);

    await user.clear(editorA);
    await user.type(editorA, draftContentA);
    expect(editorA).toHaveValue(draftContentA);

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(draftContentA);
      expect(screen.getByText('无法加载文件')).toBeInTheDocument();
    });
  });

  it('refreshes a clean draft when a file reload returns newer content', async () => {
    const user = userEvent.setup();
    const filePathA = 'docs/design/enterprise-agent-workbench.md';
    const filePathB = 'docs/notes.md';
    const initialContentA = '# Workbench v1';
    const reloadedContentA = '# Workbench v2';
    const contentB = '# Notes';
    const openCallsByPath = new Map<string, number>();
    const treeNodes: FileTreeNode[] = [
      { type: 'file', name: 'enterprise-agent-workbench.md', path: filePathA, depth: 0 },
      { type: 'file', name: 'notes.md', path: filePathB, depth: 0 }
    ];

    const fileService = {
      async listTree() {
        return treeNodes;
      },
      async openFile(path: string) {
        openCallsByPath.set(path, (openCallsByPath.get(path) ?? 0) + 1);
        if (path === filePathA) {
          return createWorkspaceFile(path, openCallsByPath.get(path) === 1 ? initialContentA : reloadedContentA);
        }
        return createWorkspaceFile(path, contentB);
      },
      async saveFile(path: string, content: string) {
        return createWorkspaceFile(path, content);
      }
    };

    render(<App fileService={fileService} />);

    expect(await screen.findByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(initialContentA);
    expect(screen.getByText('已保存到本地草稿')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'notes.md' }));
    expect(await screen.findByRole('textbox', { name: `${filePathB} 编辑器` })).toHaveValue(contentB);

    await user.click(screen.getByRole('button', { name: 'enterprise-agent-workbench.md' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: `${filePathA} 编辑器` })).toHaveValue(reloadedContentA);
      expect(screen.getByText('已保存到本地草稿')).toBeInTheDocument();
      expect(screen.queryByText('未保存')).not.toBeInTheDocument();
    });
  });

  it('shows the editor when loading the project tree fails', async () => {
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const content = '# Workbench';

    const fileService = {
      async listTree() {
        throw new Error('tree unavailable');
      },
      async openFile(path: string) {
        return createWorkspaceFile(path, content);
      },
      async saveFile(path: string, nextContent: string) {
        return createWorkspaceFile(path, nextContent);
      }
    };

    render(<App fileService={fileService} />);

    expect(await screen.findByText('无法加载项目文件')).toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: `${filePath} 编辑器` })).toHaveValue(content);
  });
});

function createWorkspaceFile(path: string, content: string): WorkspaceFile {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    language: 'markdown',
    content,
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  };
}
