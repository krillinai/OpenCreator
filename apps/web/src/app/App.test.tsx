import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import type { FileTreeNode, WorkspaceFile } from '../services/file-service.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });

  return { promise, resolve };
}

describe('App', () => {
  it('keeps edits made while a save is pending marked as unsaved', async () => {
    const user = userEvent.setup();
    const filePath = 'docs/design/enterprise-agent-workbench.md';
    const initialContent = '# Workbench';
    const savedSnapshotContent = '# Workbench\nfirst edit';
    const continuedEditContent = '# Workbench\nfirst edit\nsecond edit';
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
    expect(editor).toHaveValue(initialContent);

    await user.clear(editor);
    await user.type(editor, savedSnapshotContent);
    await user.click(screen.getByRole('button', { name: '保存到本地草稿' }));

    await user.clear(editor);
    await user.type(editor, continuedEditContent);

    await act(async () => {
      saveDeferred.resolve(createWorkspaceFile(filePath, savedSnapshotContent));
      await saveDeferred.promise;
    });

    await waitFor(() => {
      expect(editor).toHaveValue(continuedEditContent);
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
