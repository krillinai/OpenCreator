import type { FileTreeNode } from '../../services/file-service.js';

export type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect(path: string): void;
};

export function FileTree(props: FileTreeProps) {
  return (
    <nav className="panel-scroll" aria-label="项目文件">
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {props.nodes.map(node => (
          <li key={node.path}>
            {node.type === 'folder' ? (
              <div
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
                type="button"
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
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
