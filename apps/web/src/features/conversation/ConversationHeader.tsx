import { Info, MapPin } from 'lucide-react';

export function ConversationHeader(props: {
  title: string;
  projectName: string;
  onOpenLocation(): void;
  onToggleDetail(): void;
}) {
  return (
    <header className="conversation-header">
      <div className="conversation-title">
        <h1>{props.title}</h1>
        <span className="conversation-project">{props.projectName}</span>
      </div>
      <div className="conversation-actions">
        <button className="toolbar-button" type="button" onClick={props.onOpenLocation}>
          <MapPin aria-hidden="true" size={16} />
          <span>打开位置</span>
        </button>
        <button className="icon-button" type="button" aria-label="详情" onClick={props.onToggleDetail}>
          <Info aria-hidden="true" size={16} />
        </button>
      </div>
    </header>
  );
}
