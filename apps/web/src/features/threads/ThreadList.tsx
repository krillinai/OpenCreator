import type { ThreadResponse } from '@opencreator/protocol';

export function ThreadList(props: {
  threads: ThreadResponse[];
  selectedThreadId?: string;
  onSelect(threadId: string): void;
  onNewThread(): void;
}) {
  return (
    <div className="thread-list">
      <div className="panel-header">
        <button className="thread-new-button" type="button" onClick={props.onNewThread}>
          新对话
        </button>
      </div>
      <div className="thread-list-scroll">
        {props.threads.length === 0 ? (
          <p className="empty-state compact">暂无真实会话</p>
        ) : (
          props.threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className="session-row"
              aria-current={thread.id === props.selectedThreadId ? 'page' : undefined}
              onClick={() => props.onSelect(thread.id)}
            >
              <strong>{thread.title ?? thread.id}</strong>
              <span>
                {thread.profile} · {thread.sandbox}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
