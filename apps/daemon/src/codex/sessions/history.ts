import type { ThreadHistoryItem } from '@opencreator/protocol';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCodexSessionParserState,
  materializeCodexSessionHistory,
  parseCodexSessionLine
} from './parser.js';

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
  let state = createCodexSessionParserState();
  let lineNumber = 0;

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    lineNumber += 1;
    const parsed = parseCodexSessionLine({ line, lineNumber, state });
    state = parsed.state;
    if (parsed.item !== undefined) items.push(parsed.item);
  }

  return materializeCodexSessionHistory(items);
}

function findCodexSessionPath(codexHome: string, codexThreadId: string): string | undefined {
  const sessionsDir = join(codexHome, 'sessions');
  if (!existsSync(sessionsDir)) return undefined;

  for (const path of listJsonlFiles(sessionsDir)) {
    const content = safeReadFile(path);
    if (content === undefined) continue;
    let state = createCodexSessionParserState();
    let lineNumber = 0;
    for (const line of content.split('\n')) {
      if (line.trim().length === 0) continue;
      lineNumber += 1;
      state = parseCodexSessionLine({ line, lineNumber, state }).state;
      if (state.codexThreadId === codexThreadId) return path;
      if (state.codexThreadId !== undefined) break;
    }
  }

  return undefined;
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
