type FileTopBarProps = {
  fileName?: string;
  dirty?: boolean;
  onBack(): void;
};

export function FileTopBar(props: FileTopBarProps) {
  return (
    <header className="file-top-bar">
      <div className="file-top-bar-leading">
        <button className="toolbar-button" type="button" onClick={props.onBack}>
          返回对话
        </button>
        <div className="file-top-bar-title">
          <strong>打开文件</strong>
        </div>
      </div>

      {props.fileName ? (
        <div className="file-tab" aria-current="page">
          <span>{props.fileName}</span>
          {props.dirty ? <span className="file-tab-dirty" aria-label="未保存">*</span> : null}
        </div>
      ) : null}
    </header>
  );
}
