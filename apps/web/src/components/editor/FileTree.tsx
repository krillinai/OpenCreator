import type { FileTreeNode } from '../../services/file-service.js';

export type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect(path: string): void;
};

export function FileTree(props: FileTreeProps) {
  return (
    <div className="panel-scroll" role="tree" aria-label="项目文件">
      {props.nodes.map(node =>
        node.type === 'folder' ? (
          <div
            key={node.path}
            role="treeitem"
            aria-expanded="true"
            style={{
              padding: '8px 12px',
              paddingLeft: 12 + node.depth * 16,
              color: 'var(--muted)',
              fontWeight: 600
            }}
          >
            {node.name}
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            role="treeitem"
            aria-current={node.path === props.selectedPath ? 'page' : undefined}
            onClick={() => props.onSelect(node.path)}
            style={{
              display: 'block',
              width: '100%',
              border: 0,
              padding: '8px 12px',
              paddingLeft: 12 + node.depth * 16,
              background: node.path === props.selectedPath ? '#eef6ff' : 'transparent',
              color: 'var(--text)',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            {node.name}
          </button>
        )
      )}
    </div>
  );
}
