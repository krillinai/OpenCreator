import { readdirSync, statSync, realpathSync } from 'node:fs';
import type { WorkspaceDirectoryResponse, WorkspaceFileMetaSummary, WorkspaceFileNode } from '@opencreator/protocol';
import { kindFor, mimeFor, isEditable, isPreviewable, isSensitivePath, reasonForUnavailable } from './mime.js';
import { assertInsideRoot, isIgnoredDir } from './paths.js';
import { MAX_DIRECTORY_CHILDREN } from './types.js';

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function buildDirectoryResponse(input: {
  threadId: string;
  rootName: string;
  rootPathLabel: string;
  path: string;
  absolutePath: string;
  rootReal: string;
  readonly: boolean;
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
  let skippedSensitive = false;
  const nodes: WorkspaceFileNode[] = [];

  for (const entry of limited) {
    const childPath = input.path ? `${input.path}/${entry.name}` : entry.name;
    const childAbsolutePath = `${input.absolutePath}/${entry.name}`;

    try {
      const childReal = realpathSync(childAbsolutePath);
      assertInsideRoot(input.rootReal, childReal);
      if (isSensitivePath(childPath)) {
        skippedSensitive = true;
        continue;
      }

      if (entry.isDirectory()) {
        nodes.push({
          path: childPath,
          name: entry.name,
          depth: childPath.split('/').length - 1,
          type: 'directory',
          hasChildren: directoryHasChildren(childAbsolutePath, input.rootReal),
          childrenLoaded: false,
          meta: {
            kind: 'directory',
            mime: 'inode/directory',
            size: 0,
            mtimeMs: 0,
            previewable: false,
            editable: false,
            readonly: input.readonly
          }
        } satisfies WorkspaceFileNode);
        continue;
      }

      const stats = statSync(childAbsolutePath);
      nodes.push({
        path: childPath,
        name: entry.name,
        depth: childPath.split('/').length - 1,
        type: 'file',
        meta: summarizeMeta(childPath, stats.size, stats.mtimeMs, input.readonly)
      } satisfies WorkspaceFileNode);
    } catch {
      warnings.push('Skipped path outside workspace root.');
    }
  }

  if (skippedSensitive) {
    warnings.push('Skipped sensitive files.');
  }

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

function summarizeMeta(path: string, size: number, mtimeMs: number, readonly: boolean): WorkspaceFileMetaSummary {
  const kind = kindFor(path);
  return {
    kind,
    mime: mimeFor(path),
    size,
    mtimeMs,
    previewable: isPreviewable(kind, path, size),
    editable: isEditable(kind, path, size),
    readonly,
    reason: reasonForUnavailable(kind, path, size)
  };
}

function directoryHasChildren(path: string, rootReal: string): boolean {
  return readdirSync(path, { withFileTypes: true }).some((entry) => {
    if (isIgnoredDir(entry.name)) return false;
    try {
      assertInsideRoot(rootReal, realpathSync(`${path}/${entry.name}`));
      return true;
    } catch {
      return false;
    }
  });
}

function suggestOpenPath(nodes: WorkspaceFileNode[]): string | undefined {
  const readme = nodes.find((node) => node.type === 'file' && node.name.toLowerCase() === 'readme.md');
  return readme?.path;
}
