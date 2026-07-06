import type { TimelineItem } from './timeline-model.js';

function canOpenRunDetail(item: TimelineItem): item is TimelineItem & { runId: string } {
  if (!('runId' in item)) return false;
  return item.source === 'runtime' && typeof item.runId === 'string' && item.runId.length > 0;
}

function getTimelineTitle(item: TimelineItem): string {
  switch (item.kind) {
    case 'user_message':
      return '你';
    case 'assistant_message':
      return item.source === 'runtime' ? 'Codex' : 'Mock Agent';
    case 'tool_step':
      return `工具 ${item.name}`;
    case 'change_card':
      return '文件变更';
    case 'diagnostic':
      return item.severity === 'error' ? '错误' : '诊断';
    case 'run_status':
      return `运行 ${item.label}`;
    case 'done':
      return `完成 ${item.status}`;
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function getTimelineAvatar(item: TimelineItem): string {
  if (item.kind === 'user_message') return '你';
  if (item.kind === 'change_card') return 'Δ';
  if (item.kind === 'diagnostic') return '!';
  if (item.kind === 'run_status') return '●';
  if (item.kind === 'done') return '✓';
  return 'C';
}

function renderTimelineItemContent(item: TimelineItem) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return (
        <>
          <p>{item.text}</p>
          {item.content ? <pre>{item.content}</pre> : null}
        </>
      );
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
          <pre>{item.content}</pre>
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
      return (
        <>
          <p>{item.status}</p>
          {item.terminationReason ? <p>{item.terminationReason}</p> : null}
          <pre>{item.content}</pre>
        </>
      );
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

export function Timeline(props: { items: TimelineItem[]; onOpenRunDetail?(runId: string): void }) {
  return (
    <div className="timeline-list">
      {props.items.length === 0 ? (
        <div className="timeline-empty">
          <strong>还没有任务记录</strong>
          <span>连接 Runtime 后发送任务，或先用本地 mock workspace 记录一次 Agent 请求。</span>
        </div>
      ) : (
        <div className="timeline-stack">
          {props.items.map((item) => (
            <article key={item.id} className={`timeline-item timeline-${item.kind}`}>
              <div className="timeline-item-header">
                <span className="timeline-avatar">{getTimelineAvatar(item)}</span>
                <span className="timeline-kind">{getTimelineTitle(item)}</span>
              </div>
              <div className="timeline-bubble">
                {renderTimelineItemContent(item)}
                {props.onOpenRunDetail && canOpenRunDetail(item) ? (
                  <button type="button" className="inline-action" onClick={() => props.onOpenRunDetail?.(item.runId)}>
                    查看 Run 详情
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
