import type { WorkspaceFileNode } from '@opencreator/protocol';
import {
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Search
} from 'lucide-react';

export type ProjectFileTreeProps = {
  nodes: WorkspaceFileNode[];
  selectedPath: string;
  expandedPaths: string[];
  search: string;
  truncatedPaths: string[];
  onToggleDirectory(path: string): void;
  onSelectFile(path: string): void;
  onSearchChange(value: string): void;
};

type TreeEntry = {
  node: WorkspaceFileNode;
  children: TreeEntry[];
};

export function ProjectFileTree(props: ProjectFileTreeProps) {
  const query = props.search.trim().toLocaleLowerCase();
  const expanded = new Set(props.expandedPaths);
  const truncated = new Set(props.truncatedPaths);
  const tree = buildTree(props.nodes);
  const visibleEntries = filterEntries(tree, query);

  return (
    <section className="file-tree-panel" aria-label="项目文件树">
      <label className="file-search">
        <span className="file-search-icon" aria-hidden="true">
          <Search size={14} strokeWidth={2} />
        </span>
        <span className="file-search-label">筛选文件</span>
        <input
          type="search"
          role="searchbox"
          aria-label="筛选文件"
          placeholder="筛选文件..."
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
        />
      </label>

      {visibleEntries.length === 0 ? (
        <p className="file-tree-empty">当前工作区暂无可显示文件</p>
      ) : (
        <ul className="file-tree-list" role="tree" aria-label="项目文件">
          {visibleEntries.map((entry) => (
            <TreeNodeRow
              key={entry.node.path}
              entry={entry}
              expanded={expanded}
              selectedPath={props.selectedPath}
              truncated={truncated}
              searching={query.length > 0}
              onToggleDirectory={props.onToggleDirectory}
              onSelectFile={props.onSelectFile}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type TreeNodeRowProps = {
  entry: TreeEntry;
  expanded: Set<string>;
  selectedPath: string;
  truncated: Set<string>;
  searching: boolean;
  onToggleDirectory(path: string): void;
  onSelectFile(path: string): void;
};

function TreeNodeRow(props: TreeNodeRowProps) {
  const { entry } = props;
  const node = entry.node;

  if (node.type === 'directory') {
    const isExpanded = props.searching || props.expanded.has(node.path);
    const hasChildren = entry.children.length > 0;

    return (
      <li role="none">
        <button
          type="button"
          role="treeitem"
          aria-label={node.name}
          aria-expanded={hasChildren ? isExpanded : undefined}
          className="file-tree-row"
          style={{ paddingInlineStart: `${12 + node.depth * 16}px` }}
          onClick={() => props.onToggleDirectory(node.path)}
        >
          <span className="file-tree-row-leading" aria-hidden="true">
            <ChevronRight className={isExpanded ? 'is-expanded' : undefined} size={14} strokeWidth={2} />
            {isExpanded ? <FolderOpen size={14} strokeWidth={2} /> : <Folder size={14} strokeWidth={2} />}
          </span>
          <span className="file-tree-row-name">{node.name}</span>
        </button>

        {props.truncated.has(node.path) ? (
          <p className="file-tree-warning" style={{ paddingInlineStart: `${40 + node.depth * 16}px` }}>
            当前目录文件较多，仅显示前 500 项
          </p>
        ) : null}

        {isExpanded && hasChildren ? (
          <ul role="group">
            {entry.children.map((child) => (
              <TreeNodeRow
                key={child.node.path}
                entry={child}
                expanded={props.expanded}
                selectedPath={props.selectedPath}
                truncated={props.truncated}
                searching={props.searching}
                onToggleDirectory={props.onToggleDirectory}
                onSelectFile={props.onSelectFile}
              />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <li role="none">
      <button
        type="button"
        role="treeitem"
        aria-label={node.name}
        aria-current={node.path === props.selectedPath ? 'page' : undefined}
        className="file-tree-row"
        style={{ paddingInlineStart: `${12 + node.depth * 16}px` }}
        onClick={() => props.onSelectFile(node.path)}
      >
        <span className="file-tree-row-leading" aria-hidden="true">
          {iconForFile(node)}
        </span>
        <span className="file-tree-row-name">{node.name}</span>
      </button>
    </li>
  );
}

function buildTree(nodes: WorkspaceFileNode[]): TreeEntry[] {
  const entryByPath = new Map<string, TreeEntry>();
  const roots: TreeEntry[] = [];
  const rootPaths = new Set<string>();

  for (const node of nodes) {
    ensureEntry(entryByPath, node.path, node);
  }

  const sortedPaths = [...entryByPath.keys()].sort(comparePathsByDepthThenName);

  for (const path of sortedPaths) {
    const entry = entryByPath.get(path);
    if (!entry) {
      continue;
    }

    const parentPath = parentPathOf(path);
    if (parentPath.length === 0) {
      if (!rootPaths.has(path)) {
        roots.push(entry);
        rootPaths.add(path);
      }
      continue;
    }

    const parent = ensureEntry(entryByPath, parentPath);
    if (!parent.children.some((child) => child.node.path === path)) {
      parent.children.push(entry);
    }
  }

  return roots;
}

function filterEntries(entries: TreeEntry[], query: string): TreeEntry[] {
  if (query.length === 0) {
    return entries;
  }

  return entries.flatMap((entry) => {
    const children = filterEntries(entry.children, query);
    const matchesSelf = entry.node.name.toLocaleLowerCase().includes(query);

    if (!matchesSelf && children.length === 0) {
      return [];
    }

    return [{ node: entry.node, children }];
  });
}

function parentPathOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function ensureEntry(
  entryByPath: Map<string, TreeEntry>,
  path: string,
  node?: WorkspaceFileNode
): TreeEntry {
  const existing = entryByPath.get(path);
  if (existing) {
    if (node) {
      existing.node = node;
    }
    return existing;
  }

  const entry: TreeEntry = {
    node: node ?? syntheticDirectoryNode(path),
    children: []
  };
  entryByPath.set(path, entry);

  const parentPath = parentPathOf(path);
  if (parentPath.length > 0) {
    ensureEntry(entryByPath, parentPath);
  }

  return entry;
}

function syntheticDirectoryNode(path: string): WorkspaceFileNode {
  const depth = path.split('/').filter(Boolean).length - 1;
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    depth,
    type: 'directory',
    hasChildren: true
  };
}

function comparePathsByDepthThenName(left: string, right: string): number {
  const leftDepth = depthOf(left);
  const rightDepth = depthOf(right);

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return left.localeCompare(right);
}

function depthOf(path: string): number {
  return path.length === 0 ? 0 : path.split('/').filter(Boolean).length - 1;
}

function iconForFile(node: Extract<WorkspaceFileNode, { type: 'file' }>) {
  switch (node.meta?.kind) {
    case 'image':
      return <FileImage size={14} strokeWidth={2} />;
    case 'pdf':
      return <FileText size={14} strokeWidth={2} />;
    case 'json':
    case 'code':
      return <FileCode2 size={14} strokeWidth={2} />;
    case 'markdown':
    case 'text':
      return <FileText size={14} strokeWidth={2} />;
    default:
      return <File size={14} strokeWidth={2} />;
  }
}
