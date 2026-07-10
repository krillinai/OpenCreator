import { Copy, FolderOpen, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import type { FileEditorMode } from './FileEditorPane.js';

type FileTopBarProps = {
  fileName?: string;
  rootName?: string;
  path?: string;
  dirty?: boolean;
  treeCollapsed?: boolean;
  mode?: FileEditorMode;
  canToggleMode?: boolean;
  canSave?: boolean;
  saveDisabled?: boolean;
  copyToastMessage?: string;
  onModeChange?(mode: FileEditorMode): void;
  onSave?(): void;
  onRevealDirectory?(): void;
  onCopyPath?(): void;
  onToggleTree?(): void;
  onClose(): void;
};

export function FileTopBar(props: FileTopBarProps) {
  const title = props.fileName ?? '文件工作区';
  const segments = props.path?.split('/').filter(Boolean) ?? [];

  return (
    <header className="file-top-bar">
      <div className="file-top-bar-main">
        <div className="file-top-bar-title">
          <strong>{title}</strong>
          {props.dirty ? <span className="dirty-indicator" aria-label="未保存">未保存</span> : null}
        </div>
        <nav className="file-top-bar-path" aria-label="文件路径">
          <span>{props.rootName ?? '工作区'}</span>
          {segments.flatMap((segment, index) => [
            <span className="file-top-bar-path-separator" key={`${props.path ?? ''}:separator:${index}`}>/</span>,
            <span key={`${props.path ?? ''}:${index}`}>{segment}</span>
          ])}
          {props.onCopyPath && props.path ? (
            <button
              className="file-path-copy-button"
              type="button"
              aria-label="复制路径"
              title="复制路径"
              onClick={props.onCopyPath}
            >
              <Copy aria-hidden="true" size={14} />
            </button>
          ) : null}
          {props.copyToastMessage ? (
            <span className="file-workspace-toast" role="status">
              {props.copyToastMessage}
            </span>
          ) : null}
        </nav>
      </div>

      <div className="file-top-bar-actions">
        {props.canToggleMode && props.mode && props.onModeChange ? (
          <div className="file-editor-mode-toggle" aria-label="文件视图模式">
            <button
              type="button"
              aria-pressed={props.mode === 'edit'}
              onClick={() => props.onModeChange?.('edit')}
            >
              编辑
            </button>
            <button
              type="button"
              aria-pressed={props.mode === 'preview'}
              onClick={() => props.onModeChange?.('preview')}
            >
              预览
            </button>
          </div>
        ) : null}
        {props.canSave ? (
          <button
            className="editor-save-button file-top-save-button"
            type="button"
            disabled={props.saveDisabled}
            onClick={() => props.onSave?.()}
          >
            保存
          </button>
        ) : null}
        {props.onRevealDirectory ? (
          <button
            className="icon-button file-toolbar-icon-button"
            type="button"
            aria-label="打开所在目录"
            title="打开所在目录"
            disabled={!props.path}
            onClick={props.onRevealDirectory}
          >
            <FolderOpen aria-hidden="true" size={16} />
          </button>
        ) : null}
        {props.onToggleTree ? (
          <button
            className="icon-button file-toolbar-icon-button"
            type="button"
            aria-label={props.treeCollapsed ? '展开目录树' : '收起目录树'}
            aria-pressed={props.treeCollapsed}
            title={props.treeCollapsed ? '展开目录树' : '收起目录树'}
            onClick={props.onToggleTree}
          >
            {props.treeCollapsed ? (
              <PanelRightOpen aria-hidden="true" size={16} />
            ) : (
              <PanelRightClose aria-hidden="true" size={16} />
            )}
          </button>
        ) : null}
        <button
          className="icon-button file-toolbar-icon-button"
          type="button"
          aria-label="关闭文件工作区"
          title="关闭文件工作区"
          onClick={props.onClose}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </header>
  );
}
