import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CODEX_SESSION_INDEX_VERSION,
  type CodexSessionIndexRepository,
  type IndexedCodexSession,
  type IndexedCodexSessionItem
} from './index-repository.js';
import {
  createCodexSessionParserState,
  parseCodexSessionLine,
  restoreCodexSessionParserState,
  type CodexSessionParserState
} from './parser.js';
import type { CodexSessionScanResult } from './scanner.js';

export type CodexSessionIndexSyncResult = CodexSessionScanResult & {
  filesSeen: number;
  filesParsed: number;
  filesRebuilt: number;
  linesParsed: number;
  bytesRead: number;
};

export type CodexSessionIndexer = {
  sync(input?: { limit?: number }): CodexSessionIndexSyncResult;
  isHistoryCurrent(codexThreadId: string): boolean;
  readHistory(codexThreadId: string): ReturnType<CodexSessionIndexRepository['listHistory']>;
  readHistoryPage(
    codexThreadId: string,
    options: Parameters<CodexSessionIndexRepository['listHistoryPage']>[1]
  ): ReturnType<CodexSessionIndexRepository['listHistoryPage']>;
};

export type CreateCodexSessionIndexerInput = {
  codexHome: string;
  repository: CodexSessionIndexRepository;
  readChunkBytes?: number;
  maxLineBytes?: number;
  warn?: (message: string) => void;
};

const DEFAULT_READ_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_LINE_BYTES = 64 * 1024 * 1024;
const FILE_HEAD_FINGERPRINT_BYTES = 4 * 1024;

export function createCodexSessionIndexer(
  input: CreateCodexSessionIndexerInput
): CodexSessionIndexer {
  const readChunkBytes = input.readChunkBytes ?? DEFAULT_READ_CHUNK_BYTES;
  const maxLineBytes = input.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  const warn = input.warn ?? (message => console.warn(message));

  return {
    sync(options = {}): CodexSessionIndexSyncResult {
      const sessionsDir = join(input.codexHome, 'sessions');
      const files = existsSync(sessionsDir) ? listJsonlFiles(sessionsDir) : [];
      const paths = files.map(file => file.path);
      const totals = {
        filesSeen: files.length,
        filesParsed: 0,
        filesRebuilt: 0,
        linesParsed: 0,
        bytesRead: 0
      };

      for (const file of files) {
        const source = input.repository.getSource(file.path);
        const fileId = `${file.dev}:${file.ino}`;
        const restoredState =
          source === undefined
            ? undefined
            : restoreCodexSessionParserState(source.parser_state_json);
        const sourceHeadChanged =
          source !== undefined
          && source.head_size > 0
          && hashFilePrefix(file.path, source.head_size) !== source.head_hash;
        const rebuild =
          source === undefined
          || source.index_version < CODEX_SESSION_INDEX_VERSION
          || source.file_id !== fileId
          || file.size < source.parsed_offset
          || sourceHeadChanged
          || restoredState === undefined
          || (file.size === source.parsed_offset && file.mtimeMs !== source.mtime_ms);

        if (
          !rebuild
          && source !== undefined
          && file.size === source.parsed_offset
          && file.mtimeMs === source.mtime_ms
        ) {
          continue;
        }

        const parsed = readSessionFile({
          path: file.path,
          fileSize: file.size,
          startOffset: rebuild ? 0 : source?.parsed_offset ?? 0,
          startLineNumber: rebuild ? 0 : source?.parsed_line_count ?? 0,
          initialState: rebuild
            ? createCodexSessionParserState()
            : restoredState ?? createCodexSessionParserState(),
          readChunkBytes,
          maxLineBytes,
          warn
        });
        const session = toIndexedSession(parsed.state, file.path, file.mtimeMs);
        const headSize = rebuild || source === undefined
          ? Math.min(parsed.parsedOffset, FILE_HEAD_FINGERPRINT_BYTES)
          : source.head_size;
        const headHash = headSize === 0 ? '' : hashFilePrefix(file.path, headSize);

        input.repository.applyFileIndex({
          path: file.path,
          fileId,
          fileSize: file.size,
          mtimeMs: file.mtimeMs,
          parsedOffset: parsed.parsedOffset,
          parsedLineCount: parsed.parsedLineCount,
          parserState: parsed.state,
          headSize,
          headHash,
          lastError: parsed.lastError ?? (rebuild ? null : source?.last_error ?? null),
          indexVersion: CODEX_SESSION_INDEX_VERSION,
          rebuild,
          ...(session === undefined ? {} : { session }),
          items: parsed.items
        });

        totals.filesParsed += 1;
        totals.filesRebuilt += rebuild ? 1 : 0;
        totals.linesParsed += parsed.linesParsed;
        totals.bytesRead += parsed.bytesRead;
      }

      input.repository.removeMissingSources(paths);
      return {
        sessions: input.repository.listSessions(options.limit),
        excludedSubagentThreadIds: input.repository.listExcludedSubagentThreadIds(),
        ...totals
      };
    },
    isHistoryCurrent(codexThreadId): boolean {
      const source = input.repository.getSessionSource(codexThreadId);
      if (source === undefined || source.parsed_offset !== source.file_size) return false;
      try {
        const stat = statSync(source.path);
        return `${stat.dev}:${stat.ino}` === source.file_id
          && stat.size === source.file_size
          && stat.mtimeMs === source.mtime_ms;
      } catch {
        return false;
      }
    },
    readHistory(codexThreadId) {
      return input.repository.listHistory(codexThreadId);
    },
    readHistoryPage(codexThreadId, options) {
      return input.repository.listHistoryPage(codexThreadId, options);
    }
  };
}

function hashFilePrefix(path: string, bytesToHash: number): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(bytesToHash);
    const bytesRead = readSync(descriptor, buffer, 0, bytesToHash, 0);
    return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readSessionFile(input: {
  path: string;
  fileSize: number;
  startOffset: number;
  startLineNumber: number;
  initialState: CodexSessionParserState;
  readChunkBytes: number;
  maxLineBytes: number;
  warn: (message: string) => void;
}): {
  state: CodexSessionParserState;
  items: IndexedCodexSessionItem[];
  parsedOffset: number;
  parsedLineCount: number;
  linesParsed: number;
  bytesRead: number;
  lastError?: string;
} {
  let descriptor: number | undefined;
  let position = input.startOffset;
  let parsedOffset = input.startOffset;
  let lineNumber = input.startLineNumber;
  let state = input.initialState;
  let pendingParts: Buffer[] = [];
  let pendingLength = 0;
  let pendingStart = input.startOffset;
  let oversized = false;
  let bytesReadTotal = 0;
  let lastError: string | undefined;
  const items: IndexedCodexSessionItem[] = [];

  const consumeLine = (line: string, sourceOffset: number, newlineTerminated: boolean): boolean => {
    const nextLineNumber = lineNumber + 1;
    const parsed = parseCodexSessionLine({ line, lineNumber: nextLineNumber, state });
    if (parsed.error === 'invalid_json') {
      if (!newlineTerminated) return false;
      const message = `Codex session ${input.path} line ${nextLineNumber} is damaged JSON.`;
      input.warn(message);
      lastError = message;
    } else {
      state = parsed.state;
      if (parsed.item !== undefined) {
        items.push({
          sourceOffset,
          lineNumber: nextLineNumber,
          item: parsed.item
        });
      }
    }
    lineNumber = nextLineNumber;
    return true;
  };

  try {
    descriptor = openSync(input.path, 'r');
    const chunk = Buffer.allocUnsafe(input.readChunkBytes);

    while (position < input.fileSize) {
      const bytesToRead = Math.min(chunk.length, input.fileSize - position);
      const bytesRead = readSync(descriptor, chunk, 0, bytesToRead, position);
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
      let cursor = 0;

      while (cursor < bytesRead) {
        const newlineIndex = chunk.subarray(0, bytesRead).indexOf(0x0a, cursor);
        const segmentEnd = newlineIndex < 0 ? bytesRead : newlineIndex;
        const segment = chunk.subarray(cursor, segmentEnd);

        if (!oversized) {
          if (pendingLength + segment.length > input.maxLineBytes) {
            oversized = true;
            pendingParts = [];
            pendingLength = 0;
          } else if (segment.length > 0) {
            pendingParts.push(Buffer.from(segment));
            pendingLength += segment.length;
          }
        }

        if (newlineIndex < 0) break;

        const endOffset = position + newlineIndex + 1;
        if (oversized) {
          const nextLineNumber = lineNumber + 1;
          const message = `Codex session ${input.path} line ${nextLineNumber} is oversized.`;
          input.warn(message);
          lastError = message;
          lineNumber = nextLineNumber;
        } else if (pendingLength > 0) {
          consumeLine(Buffer.concat(pendingParts, pendingLength).toString('utf8'), pendingStart, true);
        }
        parsedOffset = endOffset;
        pendingParts = [];
        pendingLength = 0;
        oversized = false;
        pendingStart = endOffset;
        cursor = newlineIndex + 1;
      }

      position += bytesRead;
    }

    if (oversized) {
      const nextLineNumber = lineNumber + 1;
      const message = `Codex session ${input.path} line ${nextLineNumber} is oversized.`;
      input.warn(message);
      lastError = message;
      lineNumber = nextLineNumber;
      parsedOffset = input.fileSize;
    } else if (pendingLength > 0) {
      const consumed = consumeLine(
        Buffer.concat(pendingParts, pendingLength).toString('utf8'),
        pendingStart,
        false
      );
      if (consumed) parsedOffset = input.fileSize;
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  return {
    state,
    items,
    parsedOffset,
    parsedLineCount: lineNumber,
    linesParsed: lineNumber - input.startLineNumber,
    bytesRead: bytesReadTotal,
    ...(lastError === undefined ? {} : { lastError })
  };
}

function toIndexedSession(
  state: CodexSessionParserState,
  sourcePath: string,
  mtimeMs: number
): IndexedCodexSession | undefined {
  if (state.codexThreadId === undefined) return undefined;
  const kind = state.kind ?? 'user';
  if (kind === 'user' && state.cwd === undefined) return undefined;
  const fallbackTimestamp = new Date(mtimeMs).toISOString();

  return {
    codexThreadId: state.codexThreadId,
    sourcePath,
    kind,
    title: state.title ?? '未命名对话',
    cwd: state.cwd ?? null,
    createdAt: state.createdAt ?? state.updatedAt ?? fallbackTimestamp,
    updatedAt: state.updatedAt ?? fallbackTimestamp
  };
}

function listJsonlFiles(dir: string): Array<{
  path: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
}> {
  const files: Array<{
    path: string;
    size: number;
    mtimeMs: number;
    dev: number;
    ino: number;
  }> = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFiles(path));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

    try {
      const stat = statSync(path);
      files.push({
        path,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        dev: stat.dev,
        ino: stat.ino
      });
    } catch {
      // A disappearing file will be retried on the next sync.
    }
  }

  return files.sort((left, right) => right.mtimeMs - left.mtimeMs);
}
