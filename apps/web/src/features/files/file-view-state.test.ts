import { describe, expect, it } from 'vitest';
import type { WorkspaceDirectoryResponse, WorkspaceFileNode } from '@opencreator/protocol';
import {
  chooseSuggestedPath,
  mergeDirectoryNodes,
  parentDirectories,
  workspaceKey
} from './file-view-state.js';

describe('file workspace state helpers', () => {
  it('workspaceKey is stable and uses the cwd_<16 hex> format', () => {
    const key = workspaceKey('/Users/a/repo');

    expect(key).toBe(workspaceKey('/Users/a/repo'));
    expect(key).toMatch(/^cwd_[0-9a-f]{16}$/);
  });

  it('chooseSuggestedPath prefers backend suggestedOpenPath', () => {
    const directory = createDirectory({
      suggestedOpenPath: 'docs/backend-picked.md',
      nodes: [
        fileNode('README.md', 'markdown'),
        fileNode('package.json', 'json')
      ]
    });

    expect(chooseSuggestedPath(directory)).toBe('docs/backend-picked.md');
  });

  it('mergeDirectoryNodes replaces one directory level without duplicating children', () => {
    const existing: WorkspaceFileNode[] = [
      directoryNode('docs', 0),
      fileNode('docs/intro.md', 'markdown', 1),
      fileNode('docs/old.md', 'markdown', 1),
      directoryNode('docs/nested', 1),
      fileNode('docs/nested/keep.md', 'markdown', 2),
      fileNode('package.json', 'json', 0)
    ];

    const merged = mergeDirectoryNodes(existing, 'docs', [
      fileNode('docs/intro.md', 'markdown', 1),
      fileNode('docs/new.md', 'markdown', 1),
      directoryNode('docs/nested', 1)
    ]);

    expect(merged).toEqual([
      directoryNode('docs', 0),
      fileNode('docs/intro.md', 'markdown', 1),
      fileNode('docs/new.md', 'markdown', 1),
      directoryNode('docs/nested', 1),
      fileNode('docs/nested/keep.md', 'markdown', 2),
      fileNode('package.json', 'json', 0)
    ]);
  });

  it('parentDirectories returns every parent directory except the leaf', () => {
    expect(parentDirectories('a/b/c.md')).toEqual(['a', 'a/b']);
  });
});

function createDirectory(input: Partial<WorkspaceDirectoryResponse>): WorkspaceDirectoryResponse {
  return {
    threadId: 'thread-1',
    rootName: 'repo',
    rootPathLabel: '/Users/a/repo',
    path: '',
    truncated: false,
    warnings: [],
    nodes: [],
    ...input
  };
}

function fileNode(path: string, kind: 'markdown' | 'json' | 'text' = 'text', depth = 0): WorkspaceFileNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'file',
    meta: {
      kind,
      mime: kind === 'json' ? 'application/json' : 'text/plain',
      size: 1,
      mtimeMs: 1,
      previewable: kind === 'markdown' || kind === 'text',
      editable: true,
      readonly: false
    }
  };
}

function directoryNode(path: string, depth = 0): WorkspaceFileNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'directory',
    hasChildren: true,
    childrenLoaded: false
  };
}
