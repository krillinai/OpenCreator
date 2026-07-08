type FilePathBarProps = {
  rootName: string;
  path?: string;
  onRevealDirectory(): void;
  onCopyPath(): void;
};

export function FilePathBar(props: FilePathBarProps) {
  const segments = props.path?.split('/').filter(Boolean) ?? [];

  return (
    <div className="file-path-bar">
      <nav className="file-path-breadcrumbs" aria-label="文件路径">
        <span>{props.rootName}</span>
        {segments.map((segment) => (
          <span key={`${props.path ?? ''}:${segment}`}>{segment}</span>
        ))}
      </nav>

      <div className="file-path-actions">
        <button className="toolbar-button" type="button" onClick={props.onRevealDirectory} disabled={!props.path}>
          打开所在目录
        </button>
        <button className="toolbar-button" type="button" onClick={props.onCopyPath} disabled={!props.path}>
          复制路径
        </button>
      </div>
    </div>
  );
}
