import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import type { TimelineItem } from './timeline-model.js';

type ProcessTimelineItem = Extract<
  TimelineItem,
  { kind: 'reasoning_summary' | 'assistant_message' | 'run_status' | 'tool_step' | 'diagnostic' | 'done' }
>;
type VisibleProcessItem = Extract<
  ProcessTimelineItem,
  { kind: 'reasoning_summary' | 'assistant_message' | 'tool_step' | 'diagnostic' | 'done' }
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

  if (item.kind === 'diagnostic') return hasRunId(item);

  return item.kind === 'reasoning_summary'
    || item.kind === 'run_status'
    || item.kind === 'tool_step'
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

function hasFailedOrCanceledDone(process: ProcessBlock): boolean {
  return process.items.some(item => item.kind === 'done' && item.status !== 'succeeded');
}

function visibleProcessItems(process: ProcessBlock): VisibleProcessItem[] {
  return process.items.filter((item): item is VisibleProcessItem => {
    if (item.kind === 'done') return item.status !== 'succeeded';
    return item.kind === 'reasoning_summary'
      || item.kind === 'assistant_message'
      || item.kind === 'tool_step'
      || item.kind === 'diagnostic';
  });
}

function hasVisibleProcessContent(process: ProcessBlock): boolean {
  return visibleProcessItems(process).length > 0;
}

function hasStartedRun(process: ProcessBlock): boolean {
  return process.runId !== undefined
    && process.items.some(item => item.kind === 'run_status' && item.label !== 'queued');
}

function shouldRenderProcess(process: ProcessBlock): boolean {
  return hasVisibleProcessContent(process) || !isProcessComplete(process) || hasStartedRun(process);
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPayload(content: string): string {
  const parsed = safeParseJson(content);
  if (parsed === null) return content;
  return JSON.stringify(parsed, null, 2);
}

function CodePayloadBlock(props: { content: string }) {
  return (
    <pre className="process-code-payload">
      <code>{formatPayload(props.content)}</code>
    </pre>
  );
}

function shouldRenderDiagnosticPayload(item: Extract<TimelineItem, { kind: 'diagnostic' }>): boolean {
  const content = item.content.trim();
  if (content.length === 0) return false;
  return content !== item.message.trim();
}

function getPayloadType(item: ProcessTimelineItem): string | undefined {
  if (!('content' in item) || typeof item.content !== 'string') return undefined;
  const payload = safeParseJson(item.content);
  if (!isRecord(payload)) return undefined;
  const type = payload.type;
  return typeof type === 'string' ? type : undefined;
}

function getToolCallId(item: ProcessTimelineItem): string | undefined {
  if (item.kind !== 'tool_step') return undefined;
  const payload = safeParseJson(item.content);
  if (!isRecord(payload)) return undefined;
  const toolCallId = payload.toolCallId;
  return typeof toolCallId === 'string' && toolCallId.length > 0 ? toolCallId : undefined;
}

function getStringField(record: Record<string, unknown>, fieldNames: string[]): string | undefined {
  for (const fieldName of fieldNames) {
    const value = record[fieldName];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

function getStringArgs(record: Record<string, unknown>): string[] {
  const args = record.args;
  if (!Array.isArray(args)) return [];
  return args.filter((arg): arg is string => typeof arg === 'string' && arg.length > 0);
}

function formatCommandArg(arg: string): string {
  if (arg.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

function formatCommandFromInput(input: Record<string, unknown>): string | undefined {
  const command = getStringField(input, ['command', 'cmd']);
  const args = getStringArgs(input);
  const argsText = args.map(formatCommandArg).join(' ');

  if (command !== undefined && argsText.length > 0) return `${command} ${argsText}`;
  if (command !== undefined) return command;
  if (argsText.length > 0) return argsText;

  const raw = input.raw;
  if (!isRecord(raw)) return undefined;
  return formatCommandFromInput(raw);
}

function getToolCommand(item: Extract<ProcessTimelineItem, { kind: 'tool_step' }>): string | undefined {
  const payload = safeParseJson(item.content);
  if (!isRecord(payload) || payload.type !== 'tool_use' || !isRecord(payload.input)) return undefined;
  return formatCommandFromInput(payload.input);
}

function buildToolNameByCallId(items: ProcessTimelineItem[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== 'tool_step') continue;
    if (getPayloadType(item) !== 'tool_use') continue;
    const toolCallId = getToolCallId(item);
    if (toolCallId !== undefined) names.set(toolCallId, item.name);
  }
  return names;
}

function formatTerminationReason(reason: string | undefined): string {
  switch (reason) {
    case 'timeout':
      return '任务运行时间过长，已自动停止';
    case 'inactivity_timeout':
      return '任务长时间无响应，已自动停止';
    case 'spawn_timeout':
      return 'Codex 启动超时';
    case 'user_canceled':
      return '用户已取消';
    case 'daemon_restart':
      return '服务重启，任务已中断';
    case 'codex_exit_non_zero':
      return 'Codex 执行失败';
    case 'spawn_failed':
      return 'Codex 启动失败';
    case 'stream_error':
      return 'Codex 输出异常';
    case undefined:
      return '未知原因';
    default:
      return reason;
  }
}

function getProcessStepTitle(item: ProcessTimelineItem, toolNameByCallId = new Map<string, string>()): string {
  switch (item.kind) {
    case 'reasoning_summary':
    case 'assistant_message':
      return item.text;
    case 'tool_step': {
      if (getPayloadType(item) !== 'tool_result') return `使用工具 ${item.name}`;
      const toolCallId = getToolCallId(item);
      const readableName = toolCallId !== undefined ? toolNameByCallId.get(toolCallId) : undefined;
      return readableName !== undefined ? `工具完成 ${readableName}` : '工具完成';
    }
    case 'diagnostic':
      return item.message;
    case 'done':
      return item.status === 'canceled'
        ? `运行已取消：${formatTerminationReason(item.terminationReason ?? 'user_canceled')}`
        : item.status === 'failed'
          ? formatTerminationReason(item.terminationReason)
          : '';
    case 'run_status':
      return '';
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function getProcessStepCommand(item: ProcessTimelineItem): string | undefined {
  if (item.kind !== 'tool_step') return undefined;
  if (getPayloadType(item) !== 'tool_use') return undefined;
  return getToolCommand(item);
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
  return <MarkdownRenderer text={item.text} variant={item.kind === 'user_message' ? 'user' : 'assistant'} />;
}

function renderChangeCard(item: Extract<TimelineItem, { kind: 'change_card' }>, onOpenFile?: (path: string) => void) {
  const content = (
    <>
      <strong>{item.title}</strong>
      <span>{item.path}</span>
      <code>{item.delta}</code>
      {onOpenFile ? <span className="change-card-action">打开</span> : null}
    </>
  );

  if (onOpenFile) {
    return (
      <button
        type="button"
        className="change-card-content change-card-button"
        aria-label={`打开文件 ${item.path}`}
        onClick={() => onOpenFile(item.path)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="change-card-content">
      {content}
    </div>
  );
}

function renderTimelineItemContent(item: TimelineItem, onOpenFile?: (path: string) => void) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return renderMessageContent(item);
    case 'change_card':
      return renderChangeCard(item, onOpenFile);
    case 'diagnostic':
      return (
        <div className="timeline-diagnostic-content">
          <div className="process-step-row">
            <span className={`process-step-severity ${item.severity}`}>{item.severity}</span>
            <span className="process-step-title">{item.message}</span>
          </div>
          {shouldRenderDiagnosticPayload(item) ? <CodePayloadBlock content={item.content} /> : null}
        </div>
      );
    case 'reasoning_summary':
    case 'tool_step':
    case 'run_status':
    case 'done':
      return null;
    default:
      const _exhaustive: never = item;
      return _exhaustive;
  }
}

function renderProcessStep(item: VisibleProcessItem, toolNameByCallId: Map<string, string>) {
  if (item.kind === 'reasoning_summary' || item.kind === 'assistant_message') {
    return (
      <li key={item.id} className={`process-step process-step-${item.kind}`}>
        <div className="process-reasoning-text">
          <MarkdownRenderer text={item.text} variant="process" />
        </div>
      </li>
    );
  }

  const command = getProcessStepCommand(item);

  return (
    <li key={item.id} className={`process-step process-step-${item.kind}`}>
      <div className="process-step-row">
        {item.kind === 'diagnostic' ? <span className={`process-step-severity ${item.severity}`}>{item.severity}</span> : null}
        {item.kind === 'done' ? <span className="process-step-severity error">{item.status}</span> : null}
        <span className="process-step-title">{getProcessStepTitle(item, toolNameByCallId)}</span>
      </div>
      {command !== undefined ? <code className="process-step-command">{command}</code> : null}
      {item.kind === 'diagnostic' && shouldRenderDiagnosticPayload(item) ? <CodePayloadBlock content={item.content} /> : null}
      {item.kind === 'done' ? <CodePayloadBlock content={item.content} /> : null}
    </li>
  );
}

function renderProcessBlock(process: ProcessBlock, onOpenRunDetail?: (runId: string) => void) {
  const complete = isProcessComplete(process);
  const shouldOpen = !complete || hasFailedOrCanceledDone(process);
  const steps = visibleProcessItems(process);
  const emptyCopy = complete ? '本次没有可展示的中间过程。' : '等待 Clawee 返回过程...';
  const toolNameByCallId = buildToolNameByCallId(process.items);

  return (
    <article key={process.key} className="timeline-item timeline-process">
      <details open={shouldOpen}>
        <summary>
          <span className="process-caret" aria-hidden="true">
            &gt;
          </span>
          <span className="process-summary-label">{complete ? '思考过程' : '正在思考'}</span>
          {steps.length > 0 ? <span className="process-summary-count">{steps.length} 条记录</span> : null}
        </summary>
        <div className="process-detail">
          {steps.length > 0 ? (
            <ol className="process-steps">{steps.map(item => renderProcessStep(item, toolNameByCallId))}</ol>
          ) : (
            <div className="process-waiting" role="status">{emptyCopy}</div>
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
  onOpenFile?(path: string): void;
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
                <div className="timeline-bubble">{renderTimelineItemContent(item, props.onOpenFile)}</div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
