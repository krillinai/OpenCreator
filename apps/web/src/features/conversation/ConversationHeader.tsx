import { FileText, Info, MapPin } from 'lucide-react';

export function ConversationHeader(props: {
  title: string;
  projectName: string;
  statusLabel?: string;
  summaryStatus?: string;
  summaryLoading?: boolean;
  onCreateSummary?(): void;
  onOpenLocation(): void;
  onToggleDetail(): void;
}) {
  return (
    <header className="conversation-header">
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
        {props.onCreateSummary ? (
          <button
            className="toolbar-button"
            type="button"
            disabled={props.summaryLoading}
            onClick={props.onCreateSummary}
          >
            <FileText aria-hidden="true" size={16} />
            <span>{props.summaryLoading ? '生成中' : '生成摘要'}</span>
          </button>
        ) : null}
        {props.summaryStatus ? (
          <span className="conversation-summary-status" role="status" aria-label="摘要状态">
            {props.summaryStatus}
          </span>
        ) : null}
        <button className="toolbar-button" type="button" onClick={props.onOpenLocation}>
          <MapPin aria-hidden="true" size={16} />
          <span>文件</span>
        </button>
        <button className="icon-button" type="button" aria-label="详情" onClick={props.onToggleDetail}>
          <Info aria-hidden="true" size={16} />
        </button>
      </div>
    </header>
  );
}
