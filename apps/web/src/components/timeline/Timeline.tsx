import { ArrowDown, ArrowUp, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer.js';
import { isWorkspaceFilePath } from '../markdown/markdown-inline.js';
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

type ChangeBlock = {
  type: 'changes';
  key: string;
  runId: string;
  items: Array<Extract<TimelineItem, { kind: 'change_card' }>>;
};

type TimelineRenderItem = { type: 'item'; item: TimelineItem } | ProcessBlock | ChangeBlock;

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

function renderTimelineAvatar(item: TimelineItem) {
  if (item.kind === 'assistant_message') {
    return <img className="timeline-avatar-logo" src="/logo-cor.png" alt="" />;
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
  onOpenFile?: (path: string) => void
) {
  const canOpenWorkspaceFiles = item.kind === 'assistant_message' && onOpenFile !== undefined;
  return (
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
  );
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

function renderTimelineItemContent(item: TimelineItem, onOpenFile?: (path: string) => void) {
  switch (item.kind) {
    case 'user_message':
    case 'assistant_message':
      return renderMessageContent(item, onOpenFile);
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

function ProcessBlockView(props: {
  process: ProcessBlock;
  targeted?: boolean;
  onOpenRunDetail?: (runId: string) => void;
}) {
  const { process, onOpenRunDetail } = props;
  const complete = isProcessComplete(process);
  const shouldOpen = !complete || hasFailedOrCanceledDone(process);
  const [expanded, setExpanded] = useState(shouldOpen);
  const visibleItemCount = countVisibleProcessItems(process);
  const emptyCopy = complete ? '本次没有可展示的中间过程。' : '等待 Clawee 返回过程...';

  useEffect(() => {
    setExpanded(shouldOpen);
  }, [shouldOpen]);

  const steps = expanded ? visibleProcessItems(process) : [];
  const toolNameByCallId = expanded ? buildToolNameByCallId(process.items) : new Map<string, string>();

  return (
    <article
      className="timeline-item timeline-process"
      data-search-target={props.targeted ? 'true' : undefined}
    >
      <details
        open={expanded}
        onToggle={event => setExpanded(event.currentTarget.open)}
      >
        <summary>
          <span className="process-caret" aria-hidden="true">
            &gt;
          </span>
          <span className="process-summary-label">{complete ? '思考过程' : '正在思考'}</span>
          {visibleItemCount > 0 ? <span className="process-summary-count">{visibleItemCount} 条记录</span> : null}
        </summary>
        {expanded ? (
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
        ) : null}
      </details>
    </article>
  );
}

export function Timeline(props: {
  items: TimelineItem[];
  targetItemId?: string;
  hasMore?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?(): Promise<void> | void;
  onOpenRunDetail?(runId: string): void;
  onOpenFile?(path: string): void;
}) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const userInteractedRef = useRef(false);
  const previousItemIdsRef = useRef<string[]>([]);
  const previousRenderItemCountRef = useRef(0);
  const firstItemIndexRef = useRef(100_000);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNewContent, setHasNewContent] = useState(false);
  const renderItems = useMemo(
    () => buildTimelineRenderItems(props.items).filter(item => (
      item.type !== 'process' || shouldRenderProcess(item)
    )),
    [props.items]
  );
  const targetRenderItemIndex = useMemo(
    () => props.targetItemId === undefined
      ? -1
      : renderItems.findIndex(item => renderItemContainsId(item, props.targetItemId!)),
    [props.targetItemId, renderItems]
  );
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
  }, [props.targetItemId, targetRenderItemIndex]);

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
              )
            }}
            itemContent={(_index, renderItem) => (
              <div className="timeline-virtual-item">
                {renderTimelineRenderItem(
                  renderItem,
                  props.targetItemId,
                  props.onOpenRunDetail,
                  props.onOpenFile
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
}

function renderTimelineRenderItem(
  renderItem: TimelineRenderItem,
  targetItemId?: string,
  onOpenRunDetail?: (runId: string) => void,
  onOpenFile?: (path: string) => void
) {
  if (renderItem.type === 'process') {
    return (
      <ProcessBlockView
        process={renderItem}
        targeted={targetItemId !== undefined && renderItemContainsId(renderItem, targetItemId)}
        onOpenRunDetail={onOpenRunDetail}
      />
    );
  }

  if (renderItem.type === 'changes') {
    return (
      <article
        className="timeline-item timeline-change_card"
        data-search-target={targetItemId !== undefined && renderItemContainsId(renderItem, targetItemId) ? 'true' : undefined}
      >
        <div className="timeline-bubble">{renderChangeBlock(renderItem, onOpenFile)}</div>
      </article>
    );
  }

  const item = renderItem.item;
  return (
    <article
      className={`timeline-item timeline-${item.kind}`}
      data-search-target={item.id === targetItemId ? 'true' : undefined}
    >
      {shouldRenderTimelineHeader(item) ? (
        <div className="timeline-item-header">
          <span className="timeline-avatar">{renderTimelineAvatar(item)}</span>
          <span className="timeline-kind">{getTimelineTitle(item)}</span>
        </div>
      ) : null}
      <div className="timeline-bubble">{renderTimelineItemContent(item, onOpenFile)}</div>
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

function hasSuffix(values: string[], suffix: string[]): boolean {
  const offset = values.length - suffix.length;
  if (offset < 0) return false;
  return suffix.every((value, index) => values[offset + index] === value);
}

function hasPrefix(values: string[], prefix: string[]): boolean {
  if (values.length < prefix.length) return false;
  return prefix.every((value, index) => values[index] === value);
}
