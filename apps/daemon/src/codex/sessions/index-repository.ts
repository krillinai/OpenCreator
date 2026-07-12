import type { ThreadHistoryItem } from '@clawee/protocol';
import type Database from 'better-sqlite3';
import type { CodexSessionSummary } from './scanner.js';
import {
  materializeCodexSessionHistory,
  type CodexSessionKind,
  type CodexSessionParserState
} from './parser.js';

export const CODEX_SESSION_INDEX_VERSION = 1;

export type CodexSessionSourceRow = {
  path: string;
  file_id: string;
  file_size: number;
  mtime_ms: number;
  parsed_offset: number;
  parsed_line_count: number;
  parser_state_json: string;
  head_size: number;
  head_hash: string;
  last_error: string | null;
  index_version: number;
  indexed_at: string;
};

export type IndexedCodexSession = {
  codexThreadId: string;
  sourcePath: string;
  kind: CodexSessionKind;
  title: string;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IndexedCodexSessionItem = {
  sourceOffset: number;
  lineNumber: number;
  item: ThreadHistoryItem;
};

export type ApplyCodexSessionFileIndexInput = {
  path: string;
  fileId: string;
  fileSize: number;
  mtimeMs: number;
  parsedOffset: number;
  parsedLineCount: number;
  parserState: CodexSessionParserState;
  headSize: number;
  headHash: string;
  lastError: string | null;
  indexVersion: number;
  rebuild: boolean;
  session?: IndexedCodexSession;
  items: IndexedCodexSessionItem[];
};

export type CodexSessionIndexRepository = {
  getSource(path: string): CodexSessionSourceRow | undefined;
  applyFileIndex(input: ApplyCodexSessionFileIndexInput): void;
  removeMissingSources(paths: string[]): void;
  listSessions(limit?: number): CodexSessionSummary[];
  listExcludedSubagentThreadIds(): string[];
  listHistory(codexThreadId: string): ThreadHistoryItem[];
};

export function createCodexSessionIndexRepository(
  db: Database.Database
): CodexSessionIndexRepository {
  const getSource = db.prepare<string>('SELECT * FROM codex_session_sources WHERE path = ?');
  const listSourcePaths = db.prepare('SELECT path FROM codex_session_sources');
  const deleteSource = db.prepare<string>('DELETE FROM codex_session_sources WHERE path = ?');
  const insertSource = db.prepare(`
    INSERT INTO codex_session_sources (
      path, file_id, file_size, mtime_ms, parsed_offset, parsed_line_count,
      parser_state_json, head_size, head_hash, last_error, index_version, indexed_at
    ) VALUES (
      @path, @fileId, @fileSize, @mtimeMs, @parsedOffset, @parsedLineCount,
      @parserStateJson, @headSize, @headHash, @lastError, @indexVersion, CURRENT_TIMESTAMP
    )
    ON CONFLICT(path) DO UPDATE SET
      file_id = excluded.file_id,
      file_size = excluded.file_size,
      mtime_ms = excluded.mtime_ms,
      parsed_offset = excluded.parsed_offset,
      parsed_line_count = excluded.parsed_line_count,
      parser_state_json = excluded.parser_state_json,
      head_size = excluded.head_size,
      head_hash = excluded.head_hash,
      last_error = excluded.last_error,
      index_version = excluded.index_version,
      indexed_at = CURRENT_TIMESTAMP
  `);
  const deleteOtherSessionForSource = db.prepare(`
    DELETE FROM codex_sessions
    WHERE source_path = @sourcePath AND codex_thread_id <> @codexThreadId
  `);
  const insertSession = db.prepare(`
    INSERT INTO codex_sessions (
      codex_thread_id, source_path, kind, title, cwd, created_at, updated_at, indexed_at
    ) VALUES (
      @codexThreadId, @sourcePath, @kind, @title, @cwd, @createdAt, @updatedAt,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(codex_thread_id) DO UPDATE SET
      source_path = excluded.source_path,
      kind = excluded.kind,
      title = excluded.title,
      cwd = excluded.cwd,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      indexed_at = CURRENT_TIMESTAMP
  `);
  const insertItem = db.prepare(`
    INSERT INTO codex_session_items (
      source_path, source_offset, line_number, item_id, item_json, created_at
    ) VALUES (
      @sourcePath, @sourceOffset, @lineNumber, @itemId, @itemJson, @createdAt
    )
    ON CONFLICT(source_path, source_offset) DO UPDATE SET
      line_number = excluded.line_number,
      item_id = excluded.item_id,
      item_json = excluded.item_json,
      created_at = excluded.created_at
  `);
  const listSessions = db.prepare<{ limit: number }>(`
    SELECT codex_thread_id, title, cwd, created_at, updated_at, source_path
    FROM codex_sessions
    WHERE kind = 'user' AND cwd IS NOT NULL
    ORDER BY updated_at DESC, codex_thread_id DESC
    LIMIT @limit
  `);
  const listSubagentIds = db.prepare(`
    SELECT codex_thread_id
    FROM codex_sessions
    WHERE kind = 'subagent'
    ORDER BY updated_at DESC, codex_thread_id DESC
  `);
  const listHistoryItems = db.prepare<string>(`
    SELECT item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = ?
    ORDER BY item.line_number ASC, item.source_offset ASC
  `);

  const applyFileIndex = db.transaction((input: ApplyCodexSessionFileIndexInput) => {
    if (input.rebuild) deleteSource.run(input.path);

    insertSource.run({
      path: input.path,
      fileId: input.fileId,
      fileSize: input.fileSize,
      mtimeMs: input.mtimeMs,
      parsedOffset: input.parsedOffset,
      parsedLineCount: input.parsedLineCount,
      parserStateJson: JSON.stringify(input.parserState),
      headSize: input.headSize,
      headHash: input.headHash,
      lastError: input.lastError,
      indexVersion: input.indexVersion
    });

    if (input.session !== undefined) {
      deleteOtherSessionForSource.run({
        sourcePath: input.path,
        codexThreadId: input.session.codexThreadId
      });
      insertSession.run(input.session);
    }

    for (const indexed of input.items) {
      insertItem.run({
        sourcePath: input.path,
        sourceOffset: indexed.sourceOffset,
        lineNumber: indexed.lineNumber,
        itemId: indexed.item.id,
        itemJson: JSON.stringify(indexed.item),
        createdAt: indexed.item.createdAt
      });
    }
  });

  const removeMissingSources = db.transaction((paths: string[]) => {
    const existingPaths = listSourcePaths.all() as Array<{ path: string }>;
    const present = new Set(paths);
    for (const row of existingPaths) {
      if (!present.has(row.path)) deleteSource.run(row.path);
    }
  });

  return {
    getSource(path: string): CodexSessionSourceRow | undefined {
      return getSource.get(path) as CodexSessionSourceRow | undefined;
    },
    applyFileIndex(input: ApplyCodexSessionFileIndexInput): void {
      applyFileIndex(input);
    },
    removeMissingSources(paths: string[]): void {
      removeMissingSources(paths);
    },
    listSessions(limit = 50): CodexSessionSummary[] {
      const rows = listSessions.all({ limit }) as Array<{
        codex_thread_id: string;
        title: string;
        cwd: string;
        created_at: string;
        updated_at: string;
        source_path: string;
      }>;
      return rows.map(row => ({
        codexThreadId: row.codex_thread_id,
        title: row.title,
        cwd: row.cwd,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        path: row.source_path
      }));
    },
    listExcludedSubagentThreadIds(): string[] {
      const rows = listSubagentIds.all() as Array<{ codex_thread_id: string }>;
      return rows.map(row => row.codex_thread_id);
    },
    listHistory(codexThreadId: string): ThreadHistoryItem[] {
      const rows = listHistoryItems.all(codexThreadId) as Array<{ item_json: string }>;
      const items = rows.flatMap(row => {
        try {
          return [JSON.parse(row.item_json) as ThreadHistoryItem];
        } catch {
          return [];
        }
      });
      return materializeCodexSessionHistory(items);
    }
  };
}
