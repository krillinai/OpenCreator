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
      return 'Clawee';
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

function renderTimelineItemContent(item: TimelineItem, onOpenChange?: (changeId: string) => void) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return (
        <>
          <p>{item.text}</p>
        </>
      );
    case 'tool_step':
      return (
        <>
          <p>{item.name}</p>
        </>
      );
    case 'change_card':
      return (
        <div className="change-card-content">
          <strong>{item.title}</strong>
          <span>{item.path}</span>
          <code>{item.delta}</code>
          {onOpenChange ? (
            <button
              type="button"
              className="inline-action"
              aria-label={`审查 ${item.title} ${item.path}`}
              onClick={() => onOpenChange(item.id)}
            >
              审查
            </button>
          ) : null}
        </div>
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
        </>
      );
    case 'done':
      return (
        <>
          <p>{item.status}</p>
          {item.terminationReason ? <p>{item.terminationReason}</p> : null}
        </>
      );
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

export function Timeline(props: {
  items: TimelineItem[];
  onOpenRunDetail?(runId: string): void;
  onOpenChange?(changeId: string): void;
}) {
  return (
    <div className="timeline-list">
      {props.items.length === 0 ? (
        <div className="timeline-empty">
          <strong>暂无任务记录</strong>
          <span>发送任务后，Clawee 会在这里展示处理过程和结果。</span>
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
                {renderTimelineItemContent(item, props.onOpenChange)}
                {props.onOpenRunDetail && canOpenRunDetail(item) ? (
                  <button
                    type="button"
                    className="inline-action"
                    aria-label={item.runId ? `查看运行详情 ${item.runId}` : '查看运行详情'}
                    onClick={() => props.onOpenRunDetail?.(item.runId)}
                  >
                    查看运行详情
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
