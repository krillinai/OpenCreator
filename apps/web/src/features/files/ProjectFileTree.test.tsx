import type { WorkspaceFileNode } from '@clawee/protocol';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectFileTree } from './ProjectFileTree.js';

describe('ProjectFileTree', () => {
  it('渲染搜索框、目录、文件和当前文件高亮', () => {
    renderTree();

    expect(screen.getByRole('searchbox', { name: '筛选文件' })).toHaveAttribute('placeholder', '筛选文件...');
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'docs' })).toBeInTheDocument();

    const currentFile = screen.getByRole('treeitem', { name: 'README.md' });
    expect(currentFile).toHaveAttribute('aria-current', 'page');
  });

  it('点击目录触发 onToggleDirectory(path)', async () => {
    const user = userEvent.setup();
    const onToggleDirectory = vi.fn();

    renderTree({ onToggleDirectory });

    await user.click(screen.getByRole('treeitem', { name: 'docs' }));

    expect(onToggleDirectory).toHaveBeenCalledWith('docs');
  });

  it('点击文件触发 onSelectFile(path)', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();

    renderTree({ onSelectFile });

    await user.click(screen.getByRole('treeitem', { name: 'README.md' }));

    expect(onSelectFile).toHaveBeenCalledWith('docs/README.md');
  });

  it('搜索 readme 时只显示匹配文件和必要父级', () => {
    renderTree({ search: 'readme' });

    const tree = screen.getByRole('tree');

    expect(within(tree).getByRole('treeitem', { name: 'docs' })).toBeInTheDocument();
    expect(within(tree).getByRole('treeitem', { name: 'README.md' })).toBeInTheDocument();
    expect(within(tree).queryByRole('treeitem', { name: 'guide.md' })).not.toBeInTheDocument();
    expect(within(tree).queryByRole('treeitem', { name: 'src' })).not.toBeInTheDocument();
  });

  it('渲染截断目录提示', () => {
    renderTree({ truncatedPaths: ['docs'] });

    expect(screen.getByText('当前目录文件较多，仅显示前 500 项')).toBeInTheDocument();
  });
});

type RenderOverrides = {
  nodes?: WorkspaceFileNode[];
  selectedPath?: string;
  expandedPaths?: string[];
  search?: string;
  truncatedPaths?: string[];
  onToggleDirectory?: (path: string) => void;
  onSelectFile?: (path: string) => void;
  onSearchChange?: (value: string) => void;
};

function renderTree(overrides: RenderOverrides = {}) {
  return render(
    <ProjectFileTree
      nodes={overrides.nodes ?? createNodes()}
      selectedPath={overrides.selectedPath ?? 'docs/README.md'}
      expandedPaths={overrides.expandedPaths ?? ['docs']}
      search={overrides.search ?? ''}
      truncatedPaths={overrides.truncatedPaths ?? []}
      onToggleDirectory={overrides.onToggleDirectory ?? vi.fn()}
      onSelectFile={overrides.onSelectFile ?? vi.fn()}
      onSearchChange={overrides.onSearchChange ?? vi.fn()}
    />
  );
}

function createNodes(): WorkspaceFileNode[] {
  return [
    directoryNode('docs', 0),
    fileNode('docs/README.md', 1),
    fileNode('docs/guide.md', 1),
    directoryNode('src', 0),
    fileNode('src/main.ts', 1),
    fileNode('notes.txt', 0)
  ];
}

function fileNode(path: string, depth: number): WorkspaceFileNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'file',
    meta: {
      kind: path.endsWith('.md') ? 'markdown' : 'text',
      mime: 'text/plain',
      size: 1,
      mtimeMs: 1,
      previewable: true,
      editable: true,
      readonly: false
    }
  };
}

function directoryNode(path: string, depth: number): WorkspaceFileNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'directory',
    hasChildren: true
  };
}
