import type { TimelineItem } from './timeline-model.js';

function renderTimelineItemContent(item: TimelineItem) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return <p>{item.text}</p>;
    case 'tool_step':
      return (
        <>
          <p>{item.name}</p>
          <pre>{item.content}</pre>
        </>
      );
    case 'change_card':
      return (
        <>
          <p>{item.title}</p>
          <p>
            {item.path} {item.delta}
          </p>
        </>
      );
    case 'diagnostic':
      return (
        <>
          <p>{item.severity}</p>
          <p>{item.message}</p>
        </>
      );
    case 'run_status':
      return (
        <>
          <p>{item.label}</p>
          {item.content ? <pre>{item.content}</pre> : null}
        </>
      );
    case 'done':
      return <p>{item.status}</p>;
    default:
      return null;
  }
}

export function Timeline(props: { items: TimelineItem[] }) {
  return (
    <div className="panel-scroll timeline-list">
      {props.items.length === 0 ? (
        <p className="empty-state">还没有任务记录</p>
      ) : (
        props.items.map((item) => (
          <article key={item.id} className={`timeline-item timeline-${item.kind}`}>
            <strong>{item.kind}</strong>
            {renderTimelineItemContent(item)}
          </article>
        ))
      )}
    </div>
  );
}
