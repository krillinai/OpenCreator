import { readdirSync, statSync } from 'node:fs';
import type { WorkspaceDirectoryResponse, WorkspaceFileMetaSummary, WorkspaceFileNode } from '@clawee/protocol';
import { kindFor, mimeFor, isEditable, isPreviewable, reasonForUnavailable } from './mime.js';
import { isIgnoredDir } from './paths.js';
import { MAX_DIRECTORY_CHILDREN } from './types.js';

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function buildDirectoryResponse(input: {
  threadId: string;
  rootName: string;
  rootPathLabel: string;
  path: string;
  absolutePath: string;
}): WorkspaceDirectoryResponse {
  const entries = readdirSync(input.absolutePath, { withFileTypes: true })
    .filter((entry) => !isIgnoredDir(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return naturalCollator.compare(left.name, right.name);
    });

  const truncated = entries.length > MAX_DIRECTORY_CHILDREN;
  const limited = truncated ? entries.slice(0, MAX_DIRECTORY_CHILDREN) : entries;
  const warnings = truncated ? [`Directory truncated to ${MAX_DIRECTORY_CHILDREN} children.`] : [];
  const nodes = limited.map((entry) => {
    const childPath = input.path ? `${input.path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      return {
        path: childPath,
        name: entry.name,
        depth: childPath.split('/').length - 1,
        type: 'directory',
        hasChildren: directoryHasChildren(`${input.absolutePath}/${entry.name}`),
        childrenLoaded: false
      } satisfies WorkspaceFileNode;
    }

    const stats = statSync(`${input.absolutePath}/${entry.name}`);
    return {
      path: childPath,
      name: entry.name,
      depth: childPath.split('/').length - 1,
      type: 'file',
      meta: summarizeMeta(childPath, stats.size, stats.mtimeMs)
    } satisfies WorkspaceFileNode;
  });

  return {
    threadId: input.threadId,
    rootName: input.rootName,
    rootPathLabel: input.rootPathLabel,
    path: input.path,
    suggestedOpenPath: suggestOpenPath(nodes),
    truncated,
    warnings,
    nodes
  };
}

function summarizeMeta(path: string, size: number, mtimeMs: number): WorkspaceFileMetaSummary {
  const kind = kindFor(path);
  return {
    kind,
    mime: mimeFor(path),
    size,
    mtimeMs,
    previewable: isPreviewable(kind, path, size),
    editable: isEditable(kind, path, size),
    readonly: false,
    reason: reasonForUnavailable(kind, path, size)
  };
}

function directoryHasChildren(path: string): boolean {
  return readdirSync(path, { withFileTypes: true }).some((entry) => !isIgnoredDir(entry.name));
}

function suggestOpenPath(nodes: WorkspaceFileNode[]): string | undefined {
  const readme = nodes.find((node) => node.type === 'file' && node.name.toLowerCase() === 'readme.md');
  return readme?.path;
}
