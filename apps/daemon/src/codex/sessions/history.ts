import type { ThreadHistoryItem } from '@clawee/protocol';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ReadCodexSessionHistoryInput = {
  codexHome: string;
  codexThreadId: string;
};

export function readCodexSessionHistory(input: ReadCodexSessionHistoryInput): ThreadHistoryItem[] {
  const sessionPath = findCodexSessionPath(input.codexHome, input.codexThreadId);
  if (sessionPath === undefined) return [];

  const content = safeReadFile(sessionPath);
  if (content === undefined) return [];

  const items: ThreadHistoryItem[] = [];
  const callNameById = new Map<string, string>();
  let fallbackSeq = 0;
  let currentTurnId: string | undefined;

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = parseJson(line);
    if (!isRecord(entry)) continue;

    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString();
    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    const turnId = getTurnId(payload) ?? currentTurnId;
    if (turnId !== undefined) currentTurnId = turnId;
    fallbackSeq += 1;

    if (entry.type === 'event_msg' && payload?.type === 'user_message') {
      const text = getString(payload, 'message');
      if (text !== undefined && !isInjectedUserMessage(text)) {
        items.push({
          id: createHistoryId('user', timestamp, fallbackSeq),
          type: 'user_message',
          text: text.trimEnd(),
          createdAt: timestamp,
          ...(turnId === undefined ? {} : { turnId })
        });
      }
      continue;
    }

    if (entry.type === 'event_msg' && payload?.type === 'agent_message') {
      const text = getString(payload, 'message');
      if (text !== undefined) {
        items.push({
          id: createHistoryId('assistant', timestamp, fallbackSeq),
          type: 'assistant_message',
          text: text.trimEnd(),
          createdAt: timestamp,
          ...(turnId === undefined ? {} : { turnId })
        });
      }
      continue;
    }

    if (entry.type === 'event_msg' && payload?.type === 'patch_apply_end') {
      items.push({
        id: createHistoryId('file_change', timestamp, fallbackSeq),
        type: 'file_change',
        changes: extractPatchApplyChanges(payload.changes),
        status: normalizePatchApplyStatus(payload),
        createdAt: timestamp,
        ...(turnId === undefined ? {} : { turnId })
      });
      continue;
    }

    if (entry.type !== 'response_item' || payload === undefined) continue;

    if (payload.type === 'reasoning') {
      const text = extractText(payload.summary ?? payload.summaries ?? payload.content ?? payload.text);
      if (text !== undefined) {
        items.push({
          id: createHistoryId('reasoning', timestamp, fallbackSeq),
          type: 'reasoning_summary',
          text,
          createdAt: timestamp,
          ...(turnId === undefined ? {} : { turnId })
        });
      }
      continue;
    }

    if (payload.type === 'function_call') {
      const callId = getString(payload, 'call_id') ?? getString(payload, 'id') ?? createHistoryId('tool', timestamp, fallbackSeq);
      const name = getString(payload, 'name') ?? 'tool';
      callNameById.set(callId, name);
      items.push({
        id: createHistoryId('tool_use', timestamp, fallbackSeq),
        type: 'tool_use',
        name,
        input: parseArguments(payload.arguments),
        createdAt: timestamp,
        ...(turnId === undefined ? {} : { turnId })
      });
      continue;
    }

    if (payload.type === 'function_call_output') {
      const callId = getString(payload, 'call_id') ?? getString(payload, 'id') ?? '';
      items.push({
        id: createHistoryId('tool_result', timestamp, fallbackSeq),
        type: 'tool_result',
        name: callNameById.get(callId) ?? (callId || 'tool'),
        output: getString(payload, 'output') ?? '',
        isError: false,
        createdAt: timestamp,
        ...(turnId === undefined ? {} : { turnId })
      });
    }
  }

  return addTurnCompletionItems(dedupeAdjacentMessages(items));
}

function findCodexSessionPath(codexHome: string, codexThreadId: string): string | undefined {
  const sessionsDir = join(codexHome, 'sessions');
  if (!existsSync(sessionsDir)) return undefined;

  for (const path of listJsonlFiles(sessionsDir)) {
    const content = safeReadFile(path);
    if (content === undefined) continue;
    for (const line of content.split('\n')) {
      if (line.trim().length === 0) continue;
      const entry = parseJson(line);
      if (!isRecord(entry) || entry.type !== 'session_meta') continue;
      const payload = isRecord(entry.payload) ? entry.payload : undefined;
      if (payload === undefined) break;
      const id = getString(payload, 'id') ?? getString(payload, 'session_id');
      if (id === codexThreadId) return path;
      break;
    }
  }

  return undefined;
}

function addTurnCompletionItems(items: ThreadHistoryItem[]): ThreadHistoryItem[] {
  const result: ThreadHistoryItem[] = [];
  for (const item of items) {
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

function dedupeAdjacentMessages(items: ThreadHistoryItem[]): ThreadHistoryItem[] {
  const result: ThreadHistoryItem[] = [];
  for (const item of items) {
    const previous = result.at(-1);
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
    result.push(item);
  }
  return result;
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

function extractPatchApplyChanges(value: unknown): Array<{ path: string; kind: 'add' | 'modify' | 'delete' | 'unknown' }> {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([path, change]) => {
    const record = isRecord(change) ? change : {};
    return {
      path,
      kind: normalizePatchApplyChangeKind(record.type)
    };
  });
}

function normalizePatchApplyChangeKind(value: unknown): 'add' | 'modify' | 'delete' | 'unknown' {
  if (value === 'add') return 'add';
  if (value === 'update' || value === 'modify') return 'modify';
  if (value === 'delete' || value === 'remove') return 'delete';
  return 'unknown';
}

function normalizePatchApplyStatus(payload: Record<string, unknown>): 'in_progress' | 'completed' | 'failed' | 'unknown' {
  if (payload.success === false) return 'failed';
  if (payload.status === 'in_progress' || payload.status === 'completed' || payload.status === 'failed') {
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

function createHistoryId(prefix: string, timestamp: string, seq: number): string {
  return `history_${prefix}_${timestamp.replace(/[^0-9a-zA-Z]/g, '')}_${seq}`;
}

function isInjectedUserMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('Another language model started to solve this problem');
}

function listJsonlFiles(dir: string): string[] {
  const entries = safeReadDir(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(path);
    }
  }

  return files.sort((left, right) => (safeStat(right)?.mtimeMs ?? 0) - (safeStat(left)?.mtimeMs ?? 0));
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function safeReadDir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
