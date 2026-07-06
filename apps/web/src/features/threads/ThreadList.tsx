import type { ThreadResponse } from '@clawee/protocol';

export function ThreadList(props: {
  threads: ThreadResponse[];
  selectedThreadId?: string;
  onSelect(threadId: string): void;
  onNewThread(): void;
}) {
  return (
    <div>
      <div className="panel-header">
        <button type="button" onClick={props.onNewThread}>
          新对话
        </button>
      </div>
      <div className="panel-scroll">
        {props.threads.length === 0 ? (
          <p className="empty-state">暂无真实会话</p>
        ) : (
          props.threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className="session-row"
              aria-current={thread.id === props.selectedThreadId}
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
