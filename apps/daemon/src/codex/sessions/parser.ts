import type { ThreadHistoryItem } from '@opencreator/protocol';
import {
  createConversationTitle,
  extractPublicConversationInput
} from '../../threads/conversation-title.js';

export type CodexSessionKind = 'user' | 'subagent';

export type CodexSessionParserState = {
  codexThreadId?: string;
  cwd?: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  kind?: CodexSessionKind;
  currentTurnId?: string;
  callNameById: Record<string, string>;
};

export type ParsedCodexSessionLine = {
  state: CodexSessionParserState;
  item?: ThreadHistoryItem;
  error?: 'invalid_json';
};

export function createCodexSessionParserState(): CodexSessionParserState {
  return { callNameById: {} };
}

export function parseCodexSessionLine(input: {
  line: string;
  lineNumber: number;
  state: CodexSessionParserState;
}): ParsedCodexSessionLine {
  const entry = parseJson(input.line);
  if (!isRecord(entry)) return { state: input.state, error: 'invalid_json' };

  const state: CodexSessionParserState = {
    ...input.state,
    callNameById: { ...input.state.callNameById }
  };
  const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
  if (state.createdAt === undefined && timestamp !== undefined) state.createdAt = timestamp;
  if (timestamp !== undefined) state.updatedAt = timestamp;

  const payload = isRecord(entry.payload) ? entry.payload : undefined;
  if (entry.type === 'session_meta' && payload !== undefined) {
    const codexThreadId = getString(payload, 'id') ?? getString(payload, 'session_id');
    if (codexThreadId !== undefined) state.codexThreadId = codexThreadId;
    state.cwd = getString(payload, 'cwd') ?? state.cwd;
    state.createdAt = getString(payload, 'timestamp') ?? state.createdAt;
    state.kind = isSubagentSession(payload) ? 'subagent' : (state.kind ?? 'user');
    return { state };
  }

  const turnId = getTurnId(payload) ?? state.currentTurnId;
  if (turnId !== undefined) state.currentTurnId = turnId;

  const rawUserMessage = extractUserMessage(entry, payload);
  const userMessage = rawUserMessage === undefined
    ? undefined
    : extractPublicConversationInput(rawUserMessage);
  const scheduleTrigger = userMessage === undefined
    ? undefined
    : parseScheduleExecutionPrompt(userMessage);
  if (
    state.title === undefined
    && userMessage !== undefined
  ) {
    state.title = createConversationTitle(scheduleTrigger?.prompt ?? userMessage, '未命名对话');
  }

  if (entry.type === 'event_msg' && payload?.type === 'user_message') {
    const text = userMessage;
    if (text !== undefined) {
      if (scheduleTrigger !== undefined) {
        return {
          state,
          item: {
            id: createHistoryId('schedule_trigger', timestamp, input.lineNumber),
            type: 'schedule_trigger',
            prompt: scheduleTrigger.prompt,
            triggeredAt: scheduleTrigger.triggeredAt,
            createdAt: timestamp ?? scheduleTrigger.triggeredAt,
            ...(turnId === undefined ? {} : { turnId })
          }
        };
      }
      return {
        state,
        item: {
          id: createHistoryId('user', timestamp, input.lineNumber),
          type: 'user_message',
          text: text.trimEnd(),
          createdAt: timestamp ?? new Date(0).toISOString(),
          ...(turnId === undefined ? {} : { turnId })
        }
      };
    }
    return { state };
  }

  if (entry.type === 'event_msg' && payload?.type === 'agent_message') {
    const text = getString(payload, 'message');
    if (text !== undefined) {
      return {
        state,
        item: {
          id: createHistoryId('assistant', timestamp, input.lineNumber),
          type: 'assistant_message',
          text: text.trimEnd(),
          createdAt: timestamp ?? new Date(0).toISOString(),
          ...(turnId === undefined ? {} : { turnId })
        }
      };
    }
    return { state };
  }

  if (entry.type === 'event_msg' && payload?.type === 'patch_apply_end') {
    return {
      state,
      item: {
        id: createHistoryId('file_change', timestamp, input.lineNumber),
        type: 'file_change',
        changes: extractPatchApplyChanges(payload.changes),
        status: normalizePatchApplyStatus(payload),
        createdAt: timestamp ?? new Date(0).toISOString(),
        ...(turnId === undefined ? {} : { turnId })
      }
    };
  }

  if (entry.type !== 'response_item' || payload === undefined) return { state };

  if (payload.type === 'reasoning') {
    const text = extractText(payload.summary ?? payload.summaries ?? payload.content ?? payload.text);
    if (text !== undefined) {
      return {
        state,
        item: {
          id: createHistoryId('reasoning', timestamp, input.lineNumber),
          type: 'reasoning_summary',
          text,
          createdAt: timestamp ?? new Date(0).toISOString(),
          ...(turnId === undefined ? {} : { turnId })
        }
      };
    }
    return { state };
  }

  if (payload.type === 'function_call') {
    const callId =
      getString(payload, 'call_id')
      ?? getString(payload, 'id')
      ?? createHistoryId('tool', timestamp, input.lineNumber);
    const name = getString(payload, 'name') ?? 'tool';
    state.callNameById[callId] = name;
    return {
      state,
      item: {
        id: createHistoryId('tool_use', timestamp, input.lineNumber),
        type: 'tool_use',
        name,
        input: parseArguments(payload.arguments),
        createdAt: timestamp ?? new Date(0).toISOString(),
        ...(turnId === undefined ? {} : { turnId })
      }
    };
  }

  if (payload.type === 'function_call_output') {
    const callId = getString(payload, 'call_id') ?? getString(payload, 'id') ?? '';
    const name = state.callNameById[callId] ?? (callId || 'tool');
    if (callId.length > 0) delete state.callNameById[callId];
    return {
      state,
      item: {
        id: createHistoryId('tool_result', timestamp, input.lineNumber),
        type: 'tool_result',
        name,
        output: getString(payload, 'output') ?? '',
        isError: false,
        createdAt: timestamp ?? new Date(0).toISOString(),
        ...(turnId === undefined ? {} : { turnId })
      }
    };
  }

  return { state };
}

export function materializeCodexSessionHistory(items: ThreadHistoryItem[]): ThreadHistoryItem[] {
  const deduped: ThreadHistoryItem[] = [];
  for (const item of items) {
    const previous = deduped.at(-1);
    if (
      previous !== undefined
      && previous.type === item.type
      && 'text' in previous
      && 'text' in item
      && previous.text === item.text
      && previous.turnId === item.turnId
    ) {
      continue;
    }
    deduped.push(item);
  }

  const result: ThreadHistoryItem[] = [];
  for (const item of deduped) {
    result.push(item);
    if (item.type === 'assistant_message' && item.turnId !== undefined) {
      result.push({
        id: `history_done_${item.turnId}_${item.id}`,
        type: 'done',
        status: 'succeeded',
        createdAt: item.createdAt,
        turnId: item.turnId
      });
    }
  }
  return result;
}

export function restoreCodexSessionParserState(value: string): CodexSessionParserState | undefined {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return undefined;

  const callNameById = isRecord(parsed.callNameById)
    ? Object.fromEntries(
        Object.entries(parsed.callNameById)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : {};

  return {
    ...(getString(parsed, 'codexThreadId') === undefined
      ? {}
      : { codexThreadId: getString(parsed, 'codexThreadId') }),
    ...(getString(parsed, 'cwd') === undefined ? {} : { cwd: getString(parsed, 'cwd') }),
    ...(getString(parsed, 'createdAt') === undefined
      ? {}
      : { createdAt: getString(parsed, 'createdAt') }),
    ...(getString(parsed, 'updatedAt') === undefined
      ? {}
      : { updatedAt: getString(parsed, 'updatedAt') }),
    ...(getString(parsed, 'title') === undefined ? {} : { title: getString(parsed, 'title') }),
    ...(parsed.kind === 'user' || parsed.kind === 'subagent' ? { kind: parsed.kind } : {}),
    ...(getString(parsed, 'currentTurnId') === undefined
      ? {}
      : { currentTurnId: getString(parsed, 'currentTurnId') }),
    callNameById
  };
}

function extractUserMessage(
  entry: Record<string, unknown>,
  payload: Record<string, unknown> | undefined
): string | undefined {
  if (payload === undefined) return undefined;

  if (entry.type === 'event_msg' && payload.type === 'user_message') {
    return getString(payload, 'message');
  }

  if (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
    const content = payload.content;
    if (!Array.isArray(content)) return undefined;
    const parts = content
      .map(item => isRecord(item) ? getString(item, 'text') ?? getString(item, 'input_text') : undefined)
      .filter((part): part is string => part !== undefined && part.trim().length > 0);
    return parts.length === 0 ? undefined : parts.join('\n');
  }

  return undefined;
}

const SCHEDULE_EXECUTION_PREFIX = '这是 OpenCreator 已经触发的一次计划任务执行。';
const SCHEDULE_TRIGGER_MARKER = '\n本次触发时间：';
const SCHEDULE_CONTENT_MARKER = '\n任务内容：\n';

function parseScheduleExecutionPrompt(
  text: string
): { prompt: string; triggeredAt: string } | undefined {
  const normalized = text.trimEnd();
  if (!normalized.startsWith(`${SCHEDULE_EXECUTION_PREFIX}\n\n执行规则：\n`)) return undefined;

  const contentIndex = normalized.lastIndexOf(SCHEDULE_CONTENT_MARKER);
  if (contentIndex < 0) return undefined;
  const metadata = normalized.slice(0, contentIndex);
  const triggerIndex = metadata.lastIndexOf(SCHEDULE_TRIGGER_MARKER);
  if (triggerIndex < 0) return undefined;

  const triggeredAt = metadata
    .slice(triggerIndex + SCHEDULE_TRIGGER_MARKER.length)
    .trim();
  const prompt = normalized
    .slice(contentIndex + SCHEDULE_CONTENT_MARKER.length)
    .trimEnd();
  if (triggeredAt.length === 0 || prompt.trim().length === 0) return undefined;

  return { prompt, triggeredAt };
}

function isSubagentSession(payload: Record<string, unknown>): boolean {
  if (getString(payload, 'thread_source') === 'subagent') return true;
  if (getString(payload, 'parent_thread_id') !== undefined) return true;

  const source = isRecord(payload.source) ? payload.source : undefined;
  return source !== undefined && isRecord(source.subagent);
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(extractText)
      .filter((part): part is string => part !== undefined && part.length > 0);
    return parts.length === 0 ? undefined : parts.join('\n\n');
  }

  if (!isRecord(value)) return undefined;
  for (const key of ['text', 'summary_text', 'content', 'message']) {
    const text = getString(value, key);
    if (text !== undefined) return text.trim();
  }
  return extractText(value.summary ?? value.summaries ?? value.parts);
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || value.trim().length === 0) return {};
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : { raw: value };
}

function extractPatchApplyChanges(
  value: unknown
): Array<{ path: string; kind: 'add' | 'modify' | 'delete' | 'unknown' }> {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([path, change]) => {
    const record = isRecord(change) ? change : {};
    return {
      path,
      kind: normalizePatchApplyChangeKind(record.type)
    };
  });
}

function normalizePatchApplyChangeKind(
  value: unknown
): 'add' | 'modify' | 'delete' | 'unknown' {
  if (value === 'add') return 'add';
  if (value === 'update' || value === 'modify') return 'modify';
  if (value === 'delete' || value === 'remove') return 'delete';
  return 'unknown';
}

function normalizePatchApplyStatus(
  payload: Record<string, unknown>
): 'in_progress' | 'completed' | 'failed' | 'unknown' {
  if (payload.success === false) return 'failed';
  if (
    payload.status === 'in_progress'
    || payload.status === 'completed'
    || payload.status === 'failed'
  ) {
    return payload.status;
  }
  if (payload.success === true) return 'completed';
  return 'unknown';
}

function getTurnId(payload: Record<string, unknown> | undefined): string | undefined {
  const metadata = isRecord(payload?.internal_chat_message_metadata_passthrough)
    ? payload.internal_chat_message_metadata_passthrough
    : undefined;
  return getString(payload ?? {}, 'turn_id') ?? getString(metadata ?? {}, 'turn_id');
}

function createHistoryId(prefix: string, timestamp: string | undefined, lineNumber: number): string {
  const stableTimestamp = timestamp ?? 'unknown';
  return `history_${prefix}_${stableTimestamp.replace(/[^0-9a-zA-Z]/g, '')}_${lineNumber}`;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
