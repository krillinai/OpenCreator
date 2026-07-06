import type { TimelineItem } from './timeline-model.js';

export function Timeline(props: { items: TimelineItem[] }) {
  return (
    <div className="panel-scroll timeline-list">
      {props.items.length === 0 ? (
        <p className="empty-state">还没有任务记录</p>
      ) : (
        props.items.map((item) => (
          <article key={item.id} className={`timeline-item timeline-${item.kind}`}>
            <strong>{item.kind}</strong>
            {'text' in item ? <p>{item.text}</p> : null}
            {'message' in item ? <p>{item.message}</p> : null}
            {'content' in item ? <pre>{item.content}</pre> : null}
            {item.kind === 'change_card' ? (
              <p>
                {item.path} {item.delta}
              </p>
            ) : null}
          </article>
        ))
      )}
    </div>
  );
}
