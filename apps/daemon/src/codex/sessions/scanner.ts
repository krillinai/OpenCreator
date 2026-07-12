import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCodexSessionParserState,
  parseCodexSessionLine
} from './parser.js';

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

  let state = createCodexSessionParserState();
  let lineNumber = 0;

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    lineNumber += 1;
    state = parseCodexSessionLine({ line, lineNumber, state }).state;
  }

  if (state.kind === 'subagent') {
    return state.codexThreadId === undefined
      ? undefined
      : { kind: 'subagent', codexThreadId: state.codexThreadId };
  }

  let updatedAt = state.updatedAt;
  if (stat.size > SESSION_SUMMARY_READ_LIMIT_BYTES) {
    updatedAt = stat.mtime.toISOString();
  } else if (updatedAt === undefined) {
    updatedAt = stat.mtime.toISOString();
  }
  const createdAt = state.createdAt ?? updatedAt;

  if (
    state.codexThreadId === undefined
    || state.cwd === undefined
  ) {
    return undefined;
  }

  return {
    kind: 'user',
    summary: {
      codexThreadId: state.codexThreadId,
      title: state.title ?? '未命名对话',
      cwd: state.cwd,
      createdAt,
      updatedAt,
      path
    }
  };
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
