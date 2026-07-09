import { PanelRightClose, PanelRightOpen, X } from 'lucide-react';

type FileTopBarProps = {
  fileName?: string;
  dirty?: boolean;
  treeCollapsed?: boolean;
  onToggleTree?(): void;
  onClose(): void;
};

export function FileTopBar(props: FileTopBarProps) {
  return (
    <header className="file-top-bar">
      <div className="file-top-bar-leading">
        <div className="file-top-bar-title">
          <strong>打开文件</strong>
        </div>
      </div>

      <div className="file-top-bar-actions">
        {props.fileName ? (
          <div className="file-tab" aria-current="page">
            <span>{props.fileName}</span>
            {props.dirty ? <span className="file-tab-dirty" aria-label="未保存">*</span> : null}
          </div>
        ) : null}
        {props.onToggleTree ? (
          <button
            className="icon-button"
            type="button"
            aria-label={props.treeCollapsed ? '展开目录树' : '收起目录树'}
            aria-pressed={props.treeCollapsed}
            onClick={props.onToggleTree}
          >
            {props.treeCollapsed ? (
              <PanelRightOpen aria-hidden="true" size={16} />
            ) : (
              <PanelRightClose aria-hidden="true" size={16} />
            )}
          </button>
        ) : null}
        <button className="icon-button" type="button" aria-label="关闭文件工作区" onClick={props.onClose}>
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </header>
  );
}
