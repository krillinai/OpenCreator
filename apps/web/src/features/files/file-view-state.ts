import type { WorkspaceDirectoryResponse, WorkspaceFileNode } from '@opencreator/protocol';

export function workspaceKey(canonicalCwd: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(canonicalCwd);
  let hash = 0xcbf29ce484222325n;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return `cwd_${hash.toString(16).padStart(16, '0')}`;
}

export function chooseSuggestedPath(directory: WorkspaceDirectoryResponse): string | undefined {
  if (directory.suggestedOpenPath !== undefined && directory.suggestedOpenPath.length > 0) {
    return directory.suggestedOpenPath;
  }

  const files = directory.nodes.filter((node): node is Extract<WorkspaceFileNode, { type: 'file' }> => node.type === 'file');

  return (
    findByName(files, 'README.md')?.path ??
    findByName(files, 'readme.md')?.path ??
    findByName(files, 'package.json')?.path ??
    files.find((node) => node.meta?.kind === 'markdown')?.path ??
    files.find((node) => node.meta?.previewable)?.path
  );
}

export function mergeDirectoryNodes(
  existing: WorkspaceFileNode[],
  directoryPath: string,
  nodes: WorkspaceFileNode[]
): WorkspaceFileNode[] {
  const childPaths = new Set(nodes.map((node) => node.path));
  const next: WorkspaceFileNode[] = [];
  let inserted = false;

  for (const node of existing) {
    if (isTargetDirectoryNode(node, directoryPath)) {
      next.push(node);
      next.push(...nodes);
      inserted = true;
      continue;
    }

    const directChild = directChildPath(directoryPath, node.path);
    if (directChild !== undefined) {
      if (childPaths.has(directChild)) {
        if (directChild === node.path) {
          continue;
        }
        next.push(node);
      }
      continue;
    }

    next.push(node);
  }

  if (!inserted) {
    return directoryPath.length === 0 ? [...nodes, ...next] : [...next, ...nodes];
  }

  return next;
}

export function parentDirectories(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const parents: string[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    parents.push(segments.slice(0, index).join('/'));
  }

  return parents;
}

function findByName(
  nodes: Array<Extract<WorkspaceFileNode, { type: 'file' }>>,
  name: string
): Extract<WorkspaceFileNode, { type: 'file' }> | undefined {
  return nodes.find((node) => node.name === name);
}

function isTargetDirectoryNode(node: WorkspaceFileNode, directoryPath: string): boolean {
  return node.type === 'directory' && node.path === directoryPath;
}

function directChildPath(directoryPath: string, path: string): string | undefined {
  const parentPath = parentPathOf(path);
  if (parentPath === directoryPath) {
    return path;
  }

  if (directoryPath.length === 0) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length > 1) {
      return segments[0] ?? undefined;
    }
    if (segments.length === 1) {
      return path;
    }
  }

  if (directoryPath.length === 0 || !path.startsWith(`${directoryPath}/`)) {
    return undefined;
  }

  const suffix = path.slice(directoryPath.length + 1);
  const childName = suffix.split('/')[0];
  return childName === undefined ? undefined : `${directoryPath}/${childName}`;
}

function parentPathOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}
