import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';

export function ConversationHeader(props: {
  title: string;
  projectName: string;
  statusLabel?: string;
  taskToolbar?: ReactNode;
  fileWorkspaceOpen?: boolean;
  onOpenLocation(): void;
}) {
  return (
    <header className={`conversation-header${props.taskToolbar ? ' conversation-header--task' : ''}`}>
      <div className="conversation-title">
        <div className="conversation-title-row">
          <h1>{props.title}</h1>
          {props.statusLabel ? (
            <span className="connection-pill" role="status">
              {props.statusLabel}
            </span>
          ) : null}
        </div>
        <span className="conversation-project">{props.projectName}</span>
      </div>
      <div className="conversation-actions">
        <button
          className="toolbar-button"
          type="button"
          aria-pressed={props.fileWorkspaceOpen === true}
          title={props.fileWorkspaceOpen ? '收起文件工作区' : '打开文件工作区'}
          onClick={props.onOpenLocation}
        >
          <MapPin aria-hidden="true" size={16} />
          <span>文件</span>
        </button>
      </div>
      {props.taskToolbar ? (
        <div className="conversation-task-strip">{props.taskToolbar}</div>
      ) : null}
    </header>
  );
}
