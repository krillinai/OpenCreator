import type { FileTreeNode } from '../../services/file-service.js';

export type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedPath: string;
  onSelect(path: string): void;
};

const languageLabels: Partial<Record<NonNullable<FileTreeNode['language']>, string>> = {
  markdown: 'MD',
  text: 'TXT',
  html: 'HTML',
  srt: 'SRT',
  json: 'JSON',
  unknown: ''
};

export function FileTree(props: FileTreeProps) {
  return (
    <nav className="tree-list" aria-label="项目文件">
      {props.nodes.length === 0 ? (
        <p className="empty-state compact">暂无项目文件</p>
      ) : (
        <ul>
          {props.nodes.map(node => (
            <li key={node.path}>
              {node.type === 'folder' ? (
                <div className="tree-folder" style={{ paddingLeft: 8 + node.depth * 14 }}>
                  <span className="tree-icon">▾</span>
                  <span className="tree-name">{node.name}</span>
                </div>
              ) : (
                <button
                  className="tree-file"
                  type="button"
                  aria-label={node.name}
                  aria-current={node.path === props.selectedPath ? 'page' : undefined}
                  onClick={() => props.onSelect(node.path)}
                  style={{ paddingLeft: 8 + node.depth * 14 }}
                >
                  <span className="tree-icon">•</span>
                  <span className="tree-name">{node.name}</span>
                  {node.language ? <span className="tree-kind">{languageLabels[node.language]}</span> : null}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
