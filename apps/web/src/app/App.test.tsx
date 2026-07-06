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
