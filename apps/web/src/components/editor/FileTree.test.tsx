import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileTree } from './FileTree.js';

describe('FileTree', () => {
  it('uses navigation/list semantics and marks the selected file as current', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <FileTree
        nodes={[
          { type: 'folder', name: 'docs', path: 'docs', depth: 0 },
          { type: 'file', name: 'readme.md', path: 'docs/readme.md', depth: 1, language: 'markdown' },
          { type: 'file', name: 'notes.txt', path: 'docs/notes.txt', depth: 1, language: 'text' }
        ]}
        selectedPath="docs/readme.md"
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('navigation', { name: '项目文件' })).toBeInTheDocument();
    expect(screen.getByText('docs')).not.toHaveAttribute('role', 'treeitem');
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
    expect(screen.queryByRole('treeitem')).not.toBeInTheDocument();

    const selectedFile = screen.getByRole('button', { name: 'readme.md' });
    expect(selectedFile).toHaveAttribute('aria-current', 'page');

    await user.click(screen.getByRole('button', { name: 'notes.txt' }));

    expect(onSelect).toHaveBeenCalledWith('docs/notes.txt');
  });
});
