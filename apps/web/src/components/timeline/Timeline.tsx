import type { TimelineItem } from './timeline-model.js';

type ProcessTimelineItem = Extract<
  TimelineItem,
  { kind: 'reasoning_summary' | 'assistant_message' | 'run_status' | 'tool_step' | 'diagnostic' | 'done' }
>;
type VisibleProcessItem = Extract<
  ProcessTimelineItem,
  { kind: 'reasoning_summary' | 'assistant_message' | 'tool_step' | 'diagnostic' }
>;

type ProcessBlock = {
  type: 'process';
  key: string;
  runId?: string;
  items: ProcessTimelineItem[];
};

type TimelineRenderItem = { type: 'item'; item: TimelineItem } | ProcessBlock;

function isProcessTimelineItem(item: TimelineItem, finalAssistantMessageIds: ReadonlySet<string>): item is ProcessTimelineItem {
  if (item.kind === 'assistant_message') {
    return typeof item.runId === 'string' && item.runId.length > 0 && !finalAssistantMessageIds.has(item.id);
  }

  return item.kind === 'reasoning_summary'
    || item.kind === 'run_status'
    || item.kind === 'tool_step'
    || item.kind === 'diagnostic'
    || item.kind === 'done';
}

function canOpenRunDetail(process: ProcessBlock): process is ProcessBlock & { runId: string } {
  return typeof process.runId === 'string' && process.runId.length > 0;
}

function getTimelineTitle(item: TimelineItem): string {
  switch (item.kind) {
    case 'user_message':
      return '你';
    case 'assistant_message':
      return 'Clawee';
    case 'change_card':
      return '文件变更';
    case 'reasoning_summary':
    case 'tool_step':
    case 'diagnostic':
    case 'run_status':
    case 'done':
      return '处理过程';
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function getTimelineAvatar(item: TimelineItem): string {
  if (item.kind === 'user_message') return '你';
  if (item.kind === 'change_card') return 'Δ';
  if (item.kind === 'assistant_message') return 'C';
  return '·';
}

function isProcessComplete(process: ProcessBlock): boolean {
  return process.items.some(item => item.kind === 'done');
}

function visibleProcessItems(process: ProcessBlock): VisibleProcessItem[] {
  return process.items.filter((item): item is VisibleProcessItem =>
    item.kind === 'reasoning_summary'
    || item.kind === 'assistant_message'
    || item.kind === 'tool_step'
    || item.kind === 'diagnostic'
  );
}

function hasVisibleProcessContent(process: ProcessBlock): boolean {
  return visibleProcessItems(process).length > 0;
}

function shouldRenderProcess(process: ProcessBlock): boolean {
  return hasVisibleProcessContent(process) || !isProcessComplete(process);
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function getPayloadType(item: ProcessTimelineItem): string | undefined {
  if (!('content' in item) || typeof item.content !== 'string') return undefined;
  const payload = safeParseJson(item.content);
  if (typeof payload !== 'object' || payload === null || !('type' in payload)) return undefined;
  const type = (payload as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function getProcessStepTitle(item: ProcessTimelineItem): string {
  switch (item.kind) {
    case 'reasoning_summary':
    case 'assistant_message':
      return item.text;
    case 'tool_step':
      return getPayloadType(item) === 'tool_result' ? `工具完成 ${item.name}` : `使用工具 ${item.name}`;
    case 'diagnostic':
      return item.message;
    case 'run_status':
    case 'done':
      return '';
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function hasRunId(item: ProcessTimelineItem): item is ProcessTimelineItem & { runId: string } {
  return typeof item.runId === 'string' && item.runId.length > 0;
}

function getRunId(item: TimelineItem): string | undefined {
  if (!('runId' in item)) return undefined;
  return typeof item.runId === 'string' && item.runId.length > 0 ? item.runId : undefined;
}

function collectFinalAssistantMessageIds(items: TimelineItem[]): Set<string> {
  const runStates = new Map<string, { doneStatus?: string; lastAssistantMessageId?: string }>();

  for (const item of items) {
    const runId = getRunId(item);
    if (runId === undefined) continue;

    const state = runStates.get(runId) ?? {};
    if (item.kind === 'assistant_message') state.lastAssistantMessageId = item.id;
    if (item.kind === 'done') state.doneStatus = item.status;
    runStates.set(runId, state);
  }

  const finalAssistantMessageIds = new Set<string>();
  for (const state of runStates.values()) {
    if (state.doneStatus === 'succeeded' && state.lastAssistantMessageId !== undefined) {
      finalAssistantMessageIds.add(state.lastAssistantMessageId);
    }
  }

  return finalAssistantMessageIds;
}

function buildTimelineRenderItems(items: TimelineItem[]): TimelineRenderItem[] {
  const renderItems: TimelineRenderItem[] = [];
  const processByKey = new Map<string, ProcessBlock>();
  let currentProcessKey: string | undefined;
  const finalAssistantMessageIds = collectFinalAssistantMessageIds(items);

  function getCurrentProcess(): ProcessBlock | undefined {
    if (currentProcessKey === undefined) return undefined;
    return processByKey.get(currentProcessKey);
  }

  function createProcess(key: string, runId?: string): ProcessBlock {
    const process: ProcessBlock = { type: 'process', key, runId, items: [] };
    processByKey.set(key, process);
    renderItems.push(process);
    return process;
  }

  function renameCurrentOrphanProcess(nextKey: string, runId: string): ProcessBlock | undefined {
    const current = getCurrentProcess();
    if (current === undefined || current.runId !== undefined || isProcessComplete(current)) return undefined;
    processByKey.delete(current.key);
    current.key = nextKey;
    current.runId = runId;
    processByKey.set(nextKey, current);
    currentProcessKey = nextKey;
    return current;
  }

  for (const item of items) {
    if (!isProcessTimelineItem(item, finalAssistantMessageIds)) {
      renderItems.push({ type: 'item', item });
      continue;
    }

    let key: string;
    let process: ProcessBlock | undefined;

    if (hasRunId(item)) {
      key = `run:${item.runId}`;
      process = processByKey.get(key) ?? renameCurrentOrphanProcess(key, item.runId);
      if (process === undefined) process = createProcess(key, item.runId);
    } else {
      const current = getCurrentProcess();
      if (current !== undefined && !isProcessComplete(current)) {
        key = current.key;
        process = current;
      } else {
        key = `process:${item.id}`;
        process = createProcess(key);
      }
    }

    process.items.push(item);
    currentProcessKey = item.kind === 'done' ? undefined : key;
  }

  return renderItems;
}

function renderMessageContent(item: Extract<TimelineItem, { kind: 'user_message' | 'assistant_message' }>) {
  return <p>{item.text}</p>;
}

function renderChangeCard(item: Extract<TimelineItem, { kind: 'change_card' }>, onOpenChange?: (changeId: string) => void) {
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
}

function renderTimelineItemContent(item: TimelineItem, onOpenChange?: (changeId: string) => void) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return renderMessageContent(item);
    case 'change_card':
      return renderChangeCard(item, onOpenChange);
    case 'reasoning_summary':
    case 'tool_step':
    case 'diagnostic':
    case 'run_status':
    case 'done':
      return null;
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function renderProcessStep(item: VisibleProcessItem) {
  if (item.kind === 'reasoning_summary' || item.kind === 'assistant_message') {
    return (
      <li key={item.id} className={`process-step process-step-${item.kind}`}>
        <div className="process-reasoning-text">
          {splitSummaryParagraphs(item.text).map((paragraph, index) => (
            <p key={`${item.id}_${index}`}>{paragraph}</p>
          ))}
        </div>
      </li>
    );
  }

  return (
    <li key={item.id} className={`process-step process-step-${item.kind}`}>
      <div className="process-step-row">
        {item.kind === 'diagnostic' ? <span className={`process-step-severity ${item.severity}`}>{item.severity}</span> : null}
        <span className="process-step-title">{getProcessStepTitle(item)}</span>
      </div>
      {item.kind === 'diagnostic' ? <pre>{item.content}</pre> : null}
    </li>
  );
}

function splitSummaryParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0);
  return paragraphs.length === 0 ? [text] : paragraphs;
}

function renderProcessBlock(process: ProcessBlock, onOpenRunDetail?: (runId: string) => void) {
  const complete = isProcessComplete(process);
  const steps = visibleProcessItems(process);

  return (
    <article key={process.key} className="timeline-item timeline-process">
      <details open={!complete}>
        <summary>
          <span className="process-caret" aria-hidden="true">
            &gt;
          </span>
          <span className="process-summary-label">{complete ? '思考过程' : '正在思考'}</span>
          {steps.length > 0 ? <span className="process-summary-count">{steps.length} 条记录</span> : null}
        </summary>
        <div className="process-detail">
          {steps.length > 0 ? (
            <ol className="process-steps">{steps.map(renderProcessStep)}</ol>
          ) : (
            <div className="process-waiting" role="status">等待 Clawee 返回结果...</div>
          )}
          {onOpenRunDetail && canOpenRunDetail(process) ? (
            <button
              type="button"
              className="inline-action"
              aria-label={`查看运行详情 ${process.runId}`}
              onClick={() => onOpenRunDetail(process.runId)}
            >
              运行详情
            </button>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export function Timeline(props: {
  items: TimelineItem[];
  onOpenRunDetail?(runId: string): void;
  onOpenChange?(changeId: string): void;
}) {
  const renderItems = buildTimelineRenderItems(props.items);

  return (
    <div className="timeline-list">
      {props.items.length === 0 ? (
        <div className="timeline-empty">
          <strong>暂无任务记录</strong>
          <span>发送任务后，Clawee 会在这里展示处理过程和结果。</span>
        </div>
      ) : (
        <div className="timeline-stack">
          {renderItems.map(renderItem => {
            if (renderItem.type === 'process') {
              if (!shouldRenderProcess(renderItem)) return null;
              return renderProcessBlock(renderItem, props.onOpenRunDetail);
            }

            const item = renderItem.item;
            return (
              <article key={item.id} className={`timeline-item timeline-${item.kind}`}>
                <div className="timeline-item-header">
                  <span className="timeline-avatar">{getTimelineAvatar(item)}</span>
                  <span className="timeline-kind">{getTimelineTitle(item)}</span>
                </div>
                <div className="timeline-bubble">{renderTimelineItemContent(item, props.onOpenChange)}</div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
