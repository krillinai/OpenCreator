import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type CodexSessionSummary = {
  codexThreadId: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  path: string;
};

export type CodexSessionScanResult = {
  sessions: CodexSessionSummary[];
  excludedSubagentThreadIds: string[];
};

export type ScanCodexSessionsInput = {
  codexHome: string;
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_TITLE_LENGTH = 80;
const SESSION_SUMMARY_READ_LIMIT_BYTES = 512 * 1024;

export function scanCodexSessions(input: ScanCodexSessionsInput): CodexSessionSummary[] {
  return scanCodexSessionsWithMetadata(input).sessions;
}

export function scanCodexSessionsWithMetadata(input: ScanCodexSessionsInput): CodexSessionScanResult {
  const sessionsDir = join(input.codexHome, 'sessions');
  if (!existsSync(sessionsDir)) return { sessions: [], excludedSubagentThreadIds: [] };

  const files = listJsonlFiles(sessionsDir)
    .map(path => ({ path, mtimeMs: safeStat(path)?.mtimeMs ?? 0 }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const sessions: CodexSessionSummary[] = [];
  const excludedSubagentThreadIds: string[] = [];
  for (const file of files) {
    const session = readCodexSession(file.path);
    if (session?.kind === 'subagent') {
      excludedSubagentThreadIds.push(session.codexThreadId);
      continue;
    }
    if (session?.kind === 'user') sessions.push(session.summary);
    if (sessions.length >= (input.limit ?? DEFAULT_LIMIT)) break;
  }
  return { sessions, excludedSubagentThreadIds };
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

  return files;
}

function readCodexSession(path: string): { kind: 'user'; summary: CodexSessionSummary } | { kind: 'subagent'; codexThreadId: string } | undefined {
  const stat = safeStat(path);
  if (stat === undefined) return undefined;

  const content = safeReadFilePrefix(path, stat.size);
  if (content === undefined) return undefined;

  let codexThreadId: string | undefined;
  let cwd: string | undefined;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;
  let title: string | undefined;

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    const entry = parseJson(line);
    if (!isRecord(entry)) continue;

    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
    if (createdAt === undefined && timestamp !== undefined) createdAt = timestamp;
    if (timestamp !== undefined) updatedAt = timestamp;

    const payload = isRecord(entry.payload) ? entry.payload : undefined;
    if (entry.type === 'session_meta' && payload !== undefined) {
      const metaCodexThreadId = getString(payload, 'id') ?? getString(payload, 'session_id') ?? codexThreadId;
      if (isSubagentSession(payload)) {
        return metaCodexThreadId === undefined ? undefined : { kind: 'subagent', codexThreadId: metaCodexThreadId };
      }
      codexThreadId = getString(payload, 'id') ?? getString(payload, 'session_id') ?? codexThreadId;
      cwd = getString(payload, 'cwd') ?? cwd;
      createdAt = getString(payload, 'timestamp') ?? createdAt;
      continue;
    }

    if (title === undefined) {
      const userMessage = extractUserMessage(entry, payload);
      if (userMessage !== undefined && !isInjectedUserMessage(userMessage)) {
        title = formatTitle(userMessage);
      }
    }
  }

  if (stat.size > SESSION_SUMMARY_READ_LIMIT_BYTES) {
    updatedAt = stat.mtime.toISOString();
  } else if (updatedAt === undefined) {
    updatedAt = stat.mtime.toISOString();
  }
  if (createdAt === undefined) createdAt = updatedAt;

  if (
    codexThreadId === undefined
    || cwd === undefined
    || createdAt === undefined
    || updatedAt === undefined
  ) {
    return undefined;
  }

  return {
    kind: 'user',
    summary: {
      codexThreadId,
      title: title ?? '未命名对话',
      cwd,
      createdAt,
      updatedAt,
      path
    }
  };
}

function extractUserMessage(entry: Record<string, unknown>, payload: Record<string, unknown> | undefined): string | undefined {
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

function isInjectedUserMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('# AGENTS.md instructions')
    || trimmed.startsWith('<environment_context>')
    || trimmed.startsWith('Another language model started to solve this problem');
}

function isSubagentSession(payload: Record<string, unknown>): boolean {
  if (getString(payload, 'thread_source') === 'subagent') return true;
  if (getString(payload, 'parent_thread_id') !== undefined) return true;

  const source = isRecord(payload.source) ? payload.source : undefined;
  return source !== undefined && isRecord(source.subagent);
}

function formatTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1)}…`;
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

function safeReadFilePrefix(path: string, fileSize: number): string | undefined {
  const bytesToRead = Math.min(fileSize, SESSION_SUMMARY_READ_LIMIT_BYTES);
  let descriptor: number | undefined;

  try {
    descriptor = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const bytesRead = readSync(descriptor, buffer, 0, bytesToRead, 0);
    const content = buffer.subarray(0, bytesRead).toString('utf8');
    if (fileSize <= bytesRead) return content;

    const lastLineBreak = content.lastIndexOf('\n');
    return lastLineBreak < 0 ? '' : content.slice(0, lastLineBreak);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Ignore close errors after the read result has already been determined.
      }
    }
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}
