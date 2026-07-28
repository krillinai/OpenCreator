import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock3,
  Copy,
  LoaderCircle,
  Pencil
} from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { copyToClipboard } from '../markdown/clipboard.js';
import { isWorkspaceFilePath } from '../markdown/markdown-inline.js';
import { ApprovalPanel } from '../../features/approvals/ApprovalPanel.js';
import type { TimelineItem } from './timeline-model.js';

type ProcessTimelineItem = Extract<
  TimelineItem,
  { kind: 'reasoning_summary' | 'assistant_message' | 'run_status' | 'tool_step' | 'diagnostic' | 'done' }
>;
type VisibleProcessItem = Extract<
  ProcessTimelineItem,
  { kind: 'reasoning_summary' | 'assistant_message' | 'tool_step' | 'diagnostic' | 'done' }
>;
type ProcessDisplayStep = {
  key: string;
  item: VisibleProcessItem;
  title?: string;
  repeatCount: number;
  mergeKey?: string;
};

type ProcessBlock = {
  type: 'process';
  key: string;
  runId?: string;
  items: ProcessTimelineItem[];
};

type ChangeBlock = {
  type: 'changes';
  key: string;
  runId: string;
  items: Array<Extract<TimelineItem, { kind: 'change_card' }>>;
};

type TimelineRenderItem = { type: 'item'; item: TimelineItem } | ProcessBlock | ChangeBlock;
const APPROVAL_BOTTOM_VISIBILITY_GAP = 96;

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

function getTimelineTitle(item: TimelineItem): string {
  switch (item.kind) {
    case 'user_message':
      return '你';
    case 'schedule_trigger':
      return '定时执行';
    case 'assistant_message':
      return 'Clawee';
    case 'change_card':
      return '文件变更';
    case 'approval':
      return '需要确认';
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
  if (item.kind === 'schedule_trigger') return '定';
  if (item.kind === 'change_card') return 'Δ';
  if (item.kind === 'assistant_message') return 'C';
  return '·';
}

function renderTimelineAvatar(item: TimelineItem) {
  if (item.kind === 'assistant_message') {
    return <span className="timeline-avatar-logo" aria-hidden="true" />;
  }
  if (item.kind === 'schedule_trigger') {
    return <Clock3 aria-hidden="true" size={14} />;
  }

  return getTimelineAvatar(item);
}

function shouldRenderTimelineHeader(item: TimelineItem) {
  return item.kind !== 'user_message';
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

function countVisibleProcessItems(process: ProcessBlock): number {
  let count = 0;
  for (const item of process.items) {
    if (item.kind === 'done') {
      if (item.status !== 'succeeded') count += 1;
      continue;
    }
    if (
      item.kind === 'reasoning_summary'
      || item.kind === 'assistant_message'
      || item.kind === 'tool_step'
      || item.kind === 'diagnostic'
    ) {
      count += 1;
    }
  }
  return count;
}

function hasVisibleProcessContent(process: ProcessBlock): boolean {
  return countVisibleProcessItems(process) > 0;
}

function hasStartedRun(process: ProcessBlock): boolean {
  return process.runId !== undefined
    && process.items.some(item => item.kind === 'run_status' && item.label !== 'queued');
}

function shouldRenderProcess(process: ProcessBlock): boolean {
  if (process.items.every(item => item.kind === 'run_status' && item.label === 'queued')) {
    return false;
  }
  return hasVisibleProcessContent(process) || !isProcessComplete(process) || hasStartedRun(process);
}

function getProcessDuration(process: ProcessBlock): string | undefined {
  const timestamps = process.items.flatMap(item => {
    if (item.timestamp === undefined) return [];
    const value = Date.parse(item.timestamp);
    return Number.isFinite(value) ? [value] : [];
  });
  if (timestamps.length < 2 || !isProcessComplete(process)) return undefined;
  return formatDuration(Math.max(...timestamps) - Math.min(...timestamps));
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}分钟` : `${minutes}分${seconds}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}小时` : `${hours}小时${remainingMinutes}分钟`;
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

function getToolActivity(
  toolName: string,
  command?: string
): string {
  const normalizedName = toolName.toLocaleLowerCase().split(/[.:/]/u).at(-1) ?? toolName;
  if (
    normalizedName === 'exec_command'
    || normalizedName === 'command_execution'
    || normalizedName === 'shell'
    || normalizedName === 'bash'
  ) {
    return getCommandActivity(command);
  }
  if (
    normalizedName.includes('apply_patch')
    || normalizedName.includes('edit')
    || normalizedName.includes('write')
  ) return '修改项目文件';
  if (
    normalizedName.includes('read')
    || normalizedName.includes('open')
    || normalizedName.includes('find')
    || normalizedName.includes('search')
  ) return '查看项目内容';
  if (
    normalizedName.includes('image')
    || normalizedName.includes('screenshot')
  ) return '查看图片';
  if (
    normalizedName.includes('browser')
    || normalizedName.includes('chrome')
    || normalizedName.includes('playwright')
  ) return '操作浏览器';
  if (
    normalizedName.includes('web')
    || normalizedName.includes('query')
  ) return '查询资料';
  if (
    normalizedName.includes('lark')
    || normalizedName.includes('docs')
  ) return '处理飞书文档';
  return '执行开发操作';
}

function getCommandActivity(command: string | undefined): string {
  if (command === undefined) return '执行本地命令';
  const normalized = command.trim().toLocaleLowerCase();
  if (
    /\b(?:vitest|jest|pytest|go test|cargo test)\b/u.test(normalized)
    || /\b(?:pnpm|npm|yarn)\b[^\n]*\btest\b/u.test(normalized)
  ) return '运行测试';
  if (
    /\b(?:electron-builder|package-release)\b/u.test(normalized)
    || /\b(?:pnpm|npm|yarn)\b[^\n]*\bpackage\b/u.test(normalized)
  ) return '打包应用';
  if (
    /\b(?:vite build|tsc|electron-builder)\b/u.test(normalized)
    || /\b(?:pnpm|npm|yarn)\b[^\n]*\bbuild\b/u.test(normalized)
  ) return '构建应用';
  if (/^git\s+(?:status|diff|log|show)\b/u.test(normalized)) return '检查代码变更';
  if (/^git\s+/u.test(normalized)) return '更新代码';
  if (/^(?:rg|grep|sed|cat|ls|find|head|tail|wc|pwd)\b/u.test(normalized)) {
    return '查看项目内容';
  }
  return '执行本地命令';
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

function getProcessStepTitle(item: ProcessTimelineItem): string {
  switch (item.kind) {
    case 'reasoning_summary':
    case 'assistant_message':
      return item.text;
    case 'tool_step': {
      return getPayloadType(item) === 'tool_result'
        ? '操作已完成'
        : `正在${getToolActivity(item.name, getToolCommand(item))}`;
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

function buildVisibleProcessSteps(process: ProcessBlock): ProcessDisplayStep[] {
  const toolUseCallIds = new Set<string>();
  const completedToolCallIds = new Set<string>();

  for (const item of process.items) {
    if (item.kind !== 'tool_step') continue;
    const toolCallId = getToolCallId(item);
    if (toolCallId === undefined) continue;
    const payloadType = getPayloadType(item);
    if (payloadType === 'tool_use') toolUseCallIds.add(toolCallId);
    if (payloadType === 'tool_result') completedToolCallIds.add(toolCallId);
  }

  const steps: ProcessDisplayStep[] = [];
  for (const item of visibleProcessItems(process)) {
    if (item.kind !== 'tool_step') {
      steps.push({ key: item.id, item, repeatCount: 1 });
      continue;
    }

    const payloadType = getPayloadType(item);
    const toolCallId = getToolCallId(item);
    if (
      payloadType === 'tool_result'
      && toolCallId !== undefined
      && toolUseCallIds.has(toolCallId)
    ) {
      continue;
    }

    const title = payloadType === 'tool_result'
      ? '操作已完成'
      : `${toolCallId !== undefined && completedToolCallIds.has(toolCallId) ? '已完成：' : '正在'}${getToolActivity(
        item.name,
        getToolCommand(item)
      )}`;
    const mergeKey = `tool:${title}`;
    const previous = steps.at(-1);
    if (previous?.mergeKey === mergeKey) {
      previous.repeatCount += 1;
      continue;
    }

    steps.push({
      key: item.id,
      item,
      title,
      repeatCount: 1,
      mergeKey
    });
  }

  return steps;
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
      if (item.kind === 'change_card' && item.runId !== undefined) {
        const previous = renderItems.at(-1);
        if (previous?.type === 'changes' && previous.runId === item.runId) {
          previous.items.push(item);
          continue;
        }
        renderItems.push({
          type: 'changes',
          key: `changes:${item.runId}:${item.id}`,
          runId: item.runId,
          items: [item]
        });
        continue;
      }
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

function renderMessageContent(
  item: Extract<TimelineItem, { kind: 'user_message' | 'assistant_message' }>,
  onOpenFile?: (path: string) => void,
  onEditUserMessage?: (item: Extract<TimelineItem, { kind: 'user_message' }>) => void
) {
  const canOpenWorkspaceFiles = item.kind === 'assistant_message' && onOpenFile !== undefined;
  return (
    <>
      {item.kind === 'user_message' && (item.attachments?.length ?? 0) > 0 ? (
        <div className="timeline-message-attachments">
          {item.attachments?.map(attachment => {
            const previewUrl = item.attachmentPreviewUrls?.[attachment.id];
            return (
              <figure key={attachment.id}>
                {previewUrl ? <img src={previewUrl} alt={attachment.fileName} /> : null}
                <figcaption>
                  <strong>{attachment.fileName}</strong>
                  <span>{formatAttachmentSize(attachment.size)}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : null}
      <MarkdownRenderer
        text={item.text}
        variant={item.kind === 'user_message' ? 'user' : 'assistant'}
        linkifyWorkspaceFiles={canOpenWorkspaceFiles}
        onLinkClick={canOpenWorkspaceFiles
          ? (href, event) => {
              if (!isWorkspaceFilePath(href)) return;
              event.preventDefault();
              onOpenFile(href);
            }
          : undefined}
      />
    </>
  );
}

function MessageMeta(props: {
  item: Extract<TimelineItem, { kind: 'user_message' }>;
  onEdit?: (item: Extract<TimelineItem, { kind: 'user_message' }>) => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  return (
    <div className="timeline-message-meta">
      {props.item.timestamp ? (
        <time dateTime={props.item.timestamp}>{formatMessageTime(props.item.timestamp)}</time>
      ) : null}
      <button
        type="button"
        aria-label={
          copyState === 'copied'
            ? '已复制消息'
            : copyState === 'failed'
              ? '复制消息失败'
              : '复制消息'
        }
        title={copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制'}
        onClick={async () => {
          setCopyState(await copyToClipboard(props.item.text) ? 'copied' : 'failed');
        }}
      >
        {copyState === 'copied' ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
      </button>
      {props.onEdit ? (
        <button
          type="button"
          aria-label="编辑消息"
          title="编辑"
          onClick={() => props.onEdit?.(props.item)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function renderScheduleTrigger(
  item: Extract<TimelineItem, { kind: 'schedule_trigger' }>
) {
  return (
    <div className="timeline-schedule-trigger-content">
      <time dateTime={item.triggeredAt}>{formatScheduleTriggerTime(item.triggeredAt)}</time>
      <MarkdownRenderer text={item.prompt} variant="user" />
    </div>
  );
}

function formatScheduleTriggerTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
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

function renderChangeBlock(
  block: ChangeBlock,
  onOpenFile?: (path: string) => void
) {
  if (block.items.length === 1) {
    return renderChangeCard(block.items[0]!, onOpenFile);
  }

  const paths = [...new Set(block.items.map(item => item.path))];
  const visiblePaths = paths.slice(0, 3);
  const hiddenCount = paths.length - visiblePaths.length;

  return (
    <div className="change-card-content change-card-group">
      <strong>{block.items.length} 次连续文件变更</strong>
      <span>{paths.length} 个文件</span>
      <div className="change-card-paths">
        {visiblePaths.map(path => (
          onOpenFile ? (
            <button
              key={path}
              type="button"
              className="change-card-path-button"
              aria-label={`打开文件 ${path}`}
              onClick={() => onOpenFile(path)}
            >
              {path}
            </button>
          ) : (
            <code key={path}>{path}</code>
          )
        ))}
        {hiddenCount > 0 ? <span>另有 {hiddenCount} 个文件</span> : null}
      </div>
    </div>
  );
}

function renderTimelineItemContent(
  item: TimelineItem,
  onOpenFile?: (path: string) => void,
  onEditUserMessage?: (item: Extract<TimelineItem, { kind: 'user_message' }>) => void,
  approvalState?: {
    resolving?: boolean;
    error?: string;
    onApprove(id: string): void;
    onReject(id: string): void;
  }
) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return renderMessageContent(item, onOpenFile, onEditUserMessage);
    case 'schedule_trigger':
      return renderScheduleTrigger(item);
    case 'change_card':
      return renderChangeCard(item, onOpenFile);
    case 'approval':
      return approvalState === undefined ? null : (
        <ApprovalPanel
          approval={item.approval}
          resolving={approvalState.resolving}
          error={approvalState.error}
          onApprove={approvalState.onApprove}
          onReject={approvalState.onReject}
        />
      );
    case 'diagnostic':
      return (
        <div className="timeline-diagnostic-content">
          <div className="process-step-row">
            <span className={`process-step-severity ${item.severity}`}>{item.severity}</span>
            <span className="process-step-title">{item.message}</span>
          </div>
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

function renderProcessStep(step: ProcessDisplayStep) {
  const { item } = step;
  if (item.kind === 'reasoning_summary' || item.kind === 'assistant_message') {
    return (
      <li key={step.key} className={`process-step process-step-${item.kind}`}>
        <div className="process-reasoning-text">
          <MarkdownRenderer text={item.text} variant="process" />
        </div>
      </li>
    );
  }

  return (
    <li key={step.key} className={`process-step process-step-${item.kind}`}>
      <div className="process-step-row">
        {item.kind === 'diagnostic' ? <span className={`process-step-severity ${item.severity}`}>{item.severity}</span> : null}
        {item.kind === 'done' ? <span className="process-step-severity error">{item.status}</span> : null}
        <span className="process-step-title">
          {step.title ?? getProcessStepTitle(item)}
          {step.repeatCount > 1 ? `（${step.repeatCount} 次）` : null}
        </span>
      </div>
      {item.kind === 'done' ? <CodePayloadBlock content={item.content} /> : null}
    </li>
  );
}

function ProcessBlockView(props: {
  process: ProcessBlock;
  expanded: boolean;
  targeted?: boolean;
  onExpandedChange(expanded: boolean): void;
}) {
  const { process, expanded, onExpandedChange } = props;
  const complete = isProcessComplete(process);
  const duration = getProcessDuration(process);

  const steps = expanded ? buildVisibleProcessSteps(process) : [];

  return (
    <article
      className="timeline-item timeline-process"
      data-search-target={props.targeted ? 'true' : undefined}
    >
      <details
        open={expanded}
      >
        <summary
          onClick={event => {
            event.preventDefault();
            onExpandedChange(!expanded);
          }}
        >
          {!complete ? (
            <LoaderCircle className="process-summary-spinner" aria-hidden="true" size={14} />
          ) : null}
          <span className="process-summary-label">
            {complete ? duration === undefined ? '已完成' : `耗时 ${duration}` : '思考中'}
          </span>
        </summary>
        {expanded && steps.length > 0 ? (
          <div className="process-detail">
            <ol className="process-steps">{steps.map(renderProcessStep)}</ol>
          </div>
        ) : null}
      </details>
    </article>
  );
}

export type TimelineHandle = {
  scrollBy(deltaY: number): boolean;
};

type TimelineProps = {
  items: TimelineItem[];
  targetItemId?: string;
  targetRunId?: string;
  targetApprovalId?: string;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?(): Promise<void> | void;
  onOpenFile?(path: string): void;
  onEditUserMessage?(item: Extract<TimelineItem, { kind: 'user_message' }>): void;
  resolvingApprovalIds?: ReadonlySet<string>;
  approvalErrors?: Readonly<Record<string, string | undefined>>;
  onApproveApproval?(id: string): void;
  onRejectApproval?(id: string): void;
};

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(props, ref) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const userInteractedRef = useRef(false);
  const previousItemIdsRef = useRef<string[]>([]);
  const previousRenderItemCountRef = useRef(0);
  const firstItemIndexRef = useRef(100_000);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNewContent, setHasNewContent] = useState(false);
  const [processExpansionOverrides, setProcessExpansionOverrides] = useState<Record<string, boolean>>({});

  useImperativeHandle(ref, () => ({
    scrollBy(deltaY) {
      const virtuoso = virtuosoRef.current;
      if (virtuoso === null) return false;
      userInteractedRef.current = true;
      virtuoso.scrollBy({ top: deltaY, behavior: 'auto' });
      return true;
    }
  }), []);

  const renderItems = useMemo(
    () => buildTimelineRenderItems(props.items).filter(item => {
      if (item.type === 'process') return shouldRenderProcess(item);
      if (
        item.type === 'item'
        && item.item.kind === 'approval'
        && item.item.approval.status !== 'pending'
      ) return false;
      return !(
        item.type === 'item'
        && item.item.kind === 'user_message'
        && (
          item.item.runStatus === 'queued'
          || (item.item.runStatus === 'canceled' && item.item.wasQueued === true)
        )
      );
    }),
    [props.items]
  );
  const targetRenderItemIndex = useMemo(
    () => renderItems.findIndex(item => renderItemMatchesTarget(
      item,
      props.targetItemId,
      props.targetRunId,
      props.targetApprovalId
    )),
    [props.targetApprovalId, props.targetItemId, props.targetRunId, renderItems]
  );
  const pendingApprovalTarget = useMemo(() => {
    for (let index = renderItems.length - 1; index >= 0; index -= 1) {
      const renderItem = renderItems[index];
      if (
        renderItem?.type === 'item'
        && renderItem.item.kind === 'approval'
        && renderItem.item.approval.status === 'pending'
      ) {
        return {
          id: renderItem.item.approval.id,
          index
        };
      }
    }
    return undefined;
  }, [renderItems]);
  const itemIds = props.items.map(item => item.id);
  const previousItemIds = previousItemIdsRef.current;
  const previousRenderItemCount = previousRenderItemCountRef.current;
  if (
    previousItemIds.length > 0
    && itemIds.length > previousItemIds.length
    && hasSuffix(itemIds, previousItemIds)
  ) {
    const prependedRenderItemCount = renderItems.length - previousRenderItemCount;
    if (prependedRenderItemCount > 0) {
      firstItemIndexRef.current -= prependedRenderItemCount;
    }
  } else if (
    previousItemIds.length > 0
    && itemIds.length > 0
    && !hasPrefix(itemIds, previousItemIds)
  ) {
    firstItemIndexRef.current = 100_000;
  }
  previousItemIdsRef.current = itemIds;
  previousRenderItemCountRef.current = renderItems.length;

  useEffect(() => {
    const appended =
      previousItemIds.length > 0
      && itemIds.length > previousItemIds.length
      && hasPrefix(itemIds, previousItemIds);
    if (appended && !atBottomRef.current) setHasNewContent(true);
  }, [itemIds, previousItemIds]);

  useEffect(() => {
    if (targetRenderItemIndex < 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: targetRenderItemIndex,
      align: 'center',
      behavior: 'auto'
    });
  }, [
    props.targetApprovalId,
    props.targetItemId,
    props.targetRunId,
    targetRenderItemIndex
  ]);

  useEffect(() => {
    if (pendingApprovalTarget === undefined) return;
    let secondFrameId: number | undefined;
    const firstFrameId = window.requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({
        index: pendingApprovalTarget.index,
        align: 'end',
        behavior: 'auto'
      });
      secondFrameId = window.requestAnimationFrame(() => {
        virtuosoRef.current?.scrollBy({
          top: APPROVAL_BOTTOM_VISIBILITY_GAP,
          behavior: 'auto'
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== undefined) window.cancelAnimationFrame(secondFrameId);
    };
  }, [pendingApprovalTarget?.id, pendingApprovalTarget?.index]);

  function loadOlder() {
    if (!props.hasMore || props.loadingOlder || props.onLoadOlder === undefined) return;
    void props.onLoadOlder();
  }

  function scrollToLatest() {
    if (renderItems.length === 0) return;
    virtuosoRef.current?.scrollToIndex({
      index: renderItems.length - 1,
      align: 'end',
      behavior: 'smooth'
    });
    setHasNewContent(false);
  }

  return (
    <div className="timeline-list">
      {props.items.length === 0 ? (
        <div className="timeline-empty">
          <strong>暂无任务记录</strong>
          <span>发送任务后，Clawee 会在这里展示处理过程和结果。</span>
        </div>
      ) : (
        <div
          className="timeline-virtual-shell"
          onWheel={() => {
            userInteractedRef.current = true;
          }}
          onTouchMove={() => {
            userInteractedRef.current = true;
          }}
          onKeyDown={() => {
            userInteractedRef.current = true;
          }}
        >
          <Virtuoso
            ref={virtuosoRef}
            className="timeline-virtuoso"
            data={renderItems}
            firstItemIndex={firstItemIndexRef.current}
            defaultItemHeight={120}
            initialTopMostItemIndex={{
              index: targetRenderItemIndex < 0 ? 'LAST' : targetRenderItemIndex,
              align: targetRenderItemIndex < 0 ? 'end' : 'center'
            }}
            computeItemKey={(_index, item) => getRenderItemKey(item)}
            followOutput={isAtBottom => isAtBottom ? 'auto' : false}
            atBottomStateChange={nextAtBottom => {
              atBottomRef.current = nextAtBottom;
              setAtBottom(nextAtBottom);
              if (nextAtBottom) setHasNewContent(false);
            }}
            atTopStateChange={nextAtTop => {
              if (nextAtTop && userInteractedRef.current) loadOlder();
            }}
            components={{
              Header: () => (
                <div className="timeline-load-older">
                  {props.hasMore ? (
                    <button
                      type="button"
                      className="inline-action"
                      disabled={props.loadingOlder}
                      onClick={loadOlder}
                    >
                      {props.loadingOlder ? (
                        <LoaderCircle className="spin" aria-hidden="true" size={14} />
                      ) : (
                        <ArrowUp aria-hidden="true" size={14} />
                      )}
                      <span>{props.loadingOlder ? '正在加载更早记录' : '加载更早记录'}</span>
                    </button>
                  ) : null}
                </div>
              ),
              Footer: () => <div className="timeline-end-spacer" aria-hidden="true" />
            }}
            itemContent={(_index, renderItem) => (
              <div className="timeline-virtual-item">
                {renderTimelineRenderItem(
                  renderItem,
                  props.targetItemId,
                  props.targetRunId,
                  props.targetApprovalId,
                  props.onOpenFile,
                  props.onEditUserMessage,
                  props.resolvingApprovalIds,
                  props.approvalErrors,
                  props.onApproveApproval,
                  props.onRejectApproval,
                  renderItem.type === 'process'
                    ? processExpansionOverrides[renderItem.key]
                    : undefined,
                  (processKey, expanded) => {
                    setProcessExpansionOverrides(current => ({
                      ...current,
                      [processKey]: expanded
                    }));
                  }
                )}
              </div>
            )}
          />
          {!atBottom && hasNewContent ? (
            <button
              type="button"
              className="timeline-new-content"
              onClick={scrollToLatest}
            >
              <ArrowDown aria-hidden="true" size={15} />
              <span>有新内容</span>
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
});

function renderTimelineRenderItem(
  renderItem: TimelineRenderItem,
  targetItemId?: string,
  targetRunId?: string,
  targetApprovalId?: string,
  onOpenFile?: (path: string) => void,
  onEditUserMessage?: (item: Extract<TimelineItem, { kind: 'user_message' }>) => void,
  resolvingApprovalIds?: ReadonlySet<string>,
  approvalErrors?: Readonly<Record<string, string | undefined>>,
  onApproveApproval?: (id: string) => void,
  onRejectApproval?: (id: string) => void,
  processExpansionOverride?: boolean,
  onProcessExpandedChange?: (processKey: string, expanded: boolean) => void
) {
  if (renderItem.type === 'process') {
    const defaultExpanded = !isProcessComplete(renderItem) || hasFailedOrCanceledDone(renderItem);
    return (
      <ProcessBlockView
        process={renderItem}
        expanded={processExpansionOverride ?? defaultExpanded}
        targeted={renderItemMatchesTarget(
          renderItem,
          targetItemId,
          targetRunId,
          targetApprovalId
        )}
        onExpandedChange={expanded => onProcessExpandedChange?.(renderItem.key, expanded)}
      />
    );
  }

  if (renderItem.type === 'changes') {
    return (
      <article
        className="timeline-item timeline-change_card"
        data-search-target={renderItemMatchesTarget(
          renderItem,
          targetItemId,
          targetRunId,
          targetApprovalId
        ) ? 'true' : undefined}
      >
        <div className="timeline-bubble">{renderChangeBlock(renderItem, onOpenFile)}</div>
      </article>
    );
  }

  const item = renderItem.item;
  return (
    <article
      className={`timeline-item timeline-${item.kind}`}
      data-search-target={renderItemMatchesTarget(
        renderItem,
        targetItemId,
        targetRunId,
        targetApprovalId
      ) ? 'true' : undefined}
    >
      {shouldRenderTimelineHeader(item) ? (
        <div className="timeline-item-header">
          <span className="timeline-avatar">{renderTimelineAvatar(item)}</span>
          <span className="timeline-kind">{getTimelineTitle(item)}</span>
        </div>
      ) : null}
      <div className="timeline-bubble">
        {renderTimelineItemContent(
          item,
          onOpenFile,
          onEditUserMessage,
          item.kind === 'approval'
            && onApproveApproval !== undefined
            && onRejectApproval !== undefined
            ? {
                resolving: resolvingApprovalIds?.has(item.approval.id),
                error: approvalErrors?.[item.approval.id],
                onApprove: onApproveApproval,
                onReject: onRejectApproval
              }
            : undefined
        )}
      </div>
      {item.kind === 'user_message' ? (
        <MessageMeta item={item} onEdit={onEditUserMessage} />
      ) : null}
    </article>
  );
}

function getRenderItemKey(item: TimelineRenderItem): string {
  if (item.type === 'item') return `item:${item.item.id}`;
  return item.key;
}

function renderItemContainsId(item: TimelineRenderItem, itemId: string): boolean {
  if (item.type === 'item') return item.item.id === itemId;
  return item.items.some(child => child.id === itemId);
}

function renderItemContainsRunId(item: TimelineRenderItem, runId: string): boolean {
  if (item.type === 'item') return getRunId(item.item) === runId;
  if (item.runId === runId) return true;
  return item.items.some(child => getRunId(child) === runId);
}

function renderItemMatchesTarget(
  item: TimelineRenderItem,
  targetItemId?: string,
  targetRunId?: string,
  targetApprovalId?: string
): boolean {
  if (targetItemId !== undefined && renderItemContainsId(item, targetItemId)) return true;
  if (targetApprovalId !== undefined && renderItemContainsApprovalId(item, targetApprovalId)) {
    return true;
  }
  return targetRunId !== undefined && renderItemContainsRunId(item, targetRunId);
}

function renderItemContainsApprovalId(
  item: TimelineRenderItem,
  approvalId: string
): boolean {
  if (item.type !== 'item' || item.item.kind !== 'approval') return false;
  return item.item.approval.id === approvalId;
}

function hasSuffix(values: string[], suffix: string[]): boolean {
  const offset = values.length - suffix.length;
  if (offset < 0) return false;
  return suffix.every((value, index) => values[offset + index] === value);
}

function hasPrefix(values: string[], prefix: string[]): boolean {
  if (values.length < prefix.length) return false;
  return prefix.every((value, index) => values[index] === value);
}
