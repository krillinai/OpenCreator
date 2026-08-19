import type { ThreadHistoryItem } from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import type { CodexSessionSummary } from './scanner.js';
import {
  materializeCodexSessionHistory,
  type CodexSessionKind,
  type CodexSessionParserState
} from './parser.js';

export const CODEX_SESSION_INDEX_VERSION = 2;
const CODEX_SESSION_SEARCH_INDEX_VERSION = 1;

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

export type ThreadHistoryPageOptions = {
  limit: number;
  before?: string;
  targetItemId?: string;
};

export type ThreadHistoryPage = {
  items: ThreadHistoryItem[];
  hasMore: boolean;
  nextCursor?: string;
  oldestItemAt?: string;
  targetItemId?: string;
};

export type ThreadHistoryCursorErrorCode =
  | 'THREAD_HISTORY_CURSOR_INVALID'
  | 'THREAD_HISTORY_CURSOR_EXPIRED'
  | 'THREAD_HISTORY_CURSOR_MISMATCH'
  | 'THREAD_HISTORY_TARGET_NOT_FOUND';

export class ThreadHistoryCursorError extends Error {
  constructor(
    readonly code: ThreadHistoryCursorErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ThreadHistoryCursorError';
  }
}

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
  getSessionSource(codexThreadId: string): CodexSessionSourceRow | undefined;
  applyFileIndex(input: ApplyCodexSessionFileIndexInput): void;
  ensureSearchIndex(): void;
  removeMissingSources(paths: string[]): void;
  classifyScheduledSessions(): void;
  listSessions(limit?: number): CodexSessionSummary[];
  listExcludedSubagentThreadIds(): string[];
  listHistory(codexThreadId: string): ThreadHistoryItem[];
  listHistoryPage(codexThreadId: string, options: ThreadHistoryPageOptions): ThreadHistoryPage;
};

type HistoryCursor = {
  v: 1;
  codexThreadId: string;
  lineNumber: number;
  sourceOffset: number;
  itemId: string;
};

type IndexedHistoryRow = {
  line_number: number;
  source_offset: number;
  item_id: string;
  item_json: string;
};

export function createCodexSessionIndexRepository(
  db: Database.Database
): CodexSessionIndexRepository {
  const getSource = db.prepare<string>('SELECT * FROM codex_session_sources WHERE path = ?');
  const getSessionSource = db.prepare<string>(`
    SELECT source.*
    FROM codex_session_sources source
    INNER JOIN codex_sessions session ON session.source_path = source.path
    WHERE session.codex_thread_id = ?
  `);
  const listSourcePaths = db.prepare('SELECT path FROM codex_session_sources');
  const deleteSource = db.prepare<string>('DELETE FROM codex_session_sources WHERE path = ?');
  const deleteSearchSource = db.prepare<string>(
    'DELETE FROM codex_session_search WHERE source_path = ?'
  );
  const deleteAllSearch = db.prepare('DELETE FROM codex_session_search');
  const countIndexedSessions = db.prepare(`
    SELECT COUNT(*) AS count
    FROM codex_sessions
  `);
  const countSearchTitleSources = db.prepare(`
    SELECT COUNT(DISTINCT source_path) AS count
    FROM codex_session_search
    WHERE item_type = 'title'
  `);
  const getSearchIndexState = db.prepare(`
    SELECT version
    FROM codex_session_search_state
    WHERE id = 1
  `);
  const markSearchIndexReady = db.prepare(`
    INSERT INTO codex_session_search_state (id, version, completed_at)
    VALUES (1, @version, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      version = excluded.version,
      completed_at = CURRENT_TIMESTAMP
  `);
  const listSearchSessions = db.prepare(`
    SELECT codex_thread_id, source_path, title, cwd, updated_at
    FROM codex_sessions
    ORDER BY source_path ASC
  `);
  const listSearchBackfillItems = db.prepare<{ maxItemJsonLength: number }>(`
    SELECT
      session.codex_thread_id,
      item.source_path,
      item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE length(item.item_json) <= @maxItemJsonLength
    ORDER BY item.source_path ASC, item.line_number ASC, item.source_offset ASC
  `);
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
  const deleteSearchItem = db.prepare(`
    DELETE FROM codex_session_search
    WHERE source_path = @sourcePath AND item_id = @itemId
  `);
  const insertSearchItem = db.prepare(`
    INSERT INTO codex_session_search (
      codex_thread_id, source_path, item_id, item_type, created_at, title, cwd, content
    ) VALUES (
      @codexThreadId, @sourcePath, @itemId, @itemType, @createdAt, @title, @cwd, @content
    )
  `);
  const listSessions = db.prepare<{ limit: number }>(`
    SELECT codex_thread_id, title, cwd, created_at, updated_at, source_path
    FROM codex_sessions
    WHERE kind = 'user' AND cwd IS NOT NULL
    ORDER BY updated_at DESC, codex_thread_id DESC
    LIMIT @limit
  `);
  const restoreBoundScheduledSessions = db.prepare(`
    UPDATE codex_sessions
    SET kind = 'user'
    WHERE kind = 'schedule'
      AND codex_thread_id IN (
        SELECT codex_thread_id
        FROM runs
        WHERE created_by = 'schedule'
          AND thread_id IS NOT NULL
          AND codex_thread_id IS NOT NULL
      )
      AND codex_thread_id NOT IN (
        SELECT codex_thread_id
        FROM runs
        WHERE created_by = 'schedule'
          AND thread_id IS NULL
          AND codex_thread_id IS NOT NULL
      )
  `);
  const markLegacyScheduledSessions = db.prepare(`
    UPDATE codex_sessions
    SET kind = 'schedule'
    WHERE kind = 'user'
      AND codex_thread_id IN (
        SELECT codex_thread_id
        FROM runs
        WHERE created_by = 'schedule'
          AND thread_id IS NULL
          AND codex_thread_id IS NOT NULL
      )
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
  const listLatestHistoryItems = db.prepare<{ codexThreadId: string; limit: number }>(`
    SELECT item.line_number, item.source_offset, item.item_id, item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = @codexThreadId
    ORDER BY item.line_number DESC, item.source_offset DESC, item.item_id DESC
    LIMIT @limit
  `);
  const listHistoryItemsBefore = db.prepare<{
    codexThreadId: string;
    lineNumber: number;
    sourceOffset: number;
    itemId: string;
    limit: number;
  }>(`
    SELECT item.line_number, item.source_offset, item.item_id, item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = @codexThreadId
      AND (
        item.line_number < @lineNumber
        OR (
          item.line_number = @lineNumber
          AND (
            item.source_offset < @sourceOffset
            OR (item.source_offset = @sourceOffset AND item.item_id < @itemId)
          )
        )
      )
    ORDER BY item.line_number DESC, item.source_offset DESC, item.item_id DESC
    LIMIT @limit
  `);
  const findHistoryCursorAnchor = db.prepare<{
    codexThreadId: string;
    lineNumber: number;
    sourceOffset: number;
    itemId: string;
  }>(`
    SELECT 1
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = @codexThreadId
      AND item.line_number = @lineNumber
      AND item.source_offset = @sourceOffset
      AND item.item_id = @itemId
    LIMIT 1
  `);
  const findHistoryTarget = db.prepare<{
    codexThreadId: string;
    itemId: string;
  }>(`
    SELECT item.line_number, item.source_offset, item.item_id, item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = @codexThreadId
      AND item.item_id = @itemId
    LIMIT 1
  `);
  const listHistoryItemsBeforeTarget = db.prepare<{
    codexThreadId: string;
    lineNumber: number;
    sourceOffset: number;
    itemId: string;
    limit: number;
  }>(`
    SELECT item.line_number, item.source_offset, item.item_id, item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = @codexThreadId
      AND (
        item.line_number < @lineNumber
        OR (
          item.line_number = @lineNumber
          AND (
            item.source_offset < @sourceOffset
            OR (item.source_offset = @sourceOffset AND item.item_id < @itemId)
          )
        )
      )
    ORDER BY item.line_number DESC, item.source_offset DESC, item.item_id DESC
    LIMIT @limit
  `);
  const listHistoryItemsAfterTarget = db.prepare<{
    codexThreadId: string;
    lineNumber: number;
    sourceOffset: number;
    itemId: string;
    limit: number;
  }>(`
    SELECT item.line_number, item.source_offset, item.item_id, item.item_json
    FROM codex_session_items item
    INNER JOIN codex_sessions session ON session.source_path = item.source_path
    WHERE session.codex_thread_id = @codexThreadId
      AND (
        item.line_number > @lineNumber
        OR (
          item.line_number = @lineNumber
          AND (
            item.source_offset > @sourceOffset
            OR (item.source_offset = @sourceOffset AND item.item_id > @itemId)
          )
        )
      )
    ORDER BY item.line_number ASC, item.source_offset ASC, item.item_id ASC
    LIMIT @limit
  `);

  const applyFileIndex = db.transaction((input: ApplyCodexSessionFileIndexInput) => {
    if (input.rebuild) {
      deleteSearchSource.run(input.path);
      deleteSource.run(input.path);
    }

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
      deleteSearchItem.run({
        sourcePath: input.path,
        itemId: SEARCH_TITLE_ITEM_ID
      });
      insertSearchItem.run({
        codexThreadId: input.session.codexThreadId,
        sourcePath: input.path,
        itemId: SEARCH_TITLE_ITEM_ID,
        itemType: 'title',
        createdAt: input.session.updatedAt,
        title: normalizeSearchText(input.session.title),
        cwd: normalizeSearchText(input.session.cwd ?? ''),
        content: ''
      });
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
      deleteSearchItem.run({
        sourcePath: input.path,
        itemId: indexed.item.id
      });
      const content = searchContentForHistoryItem(indexed.item);
      if (content !== undefined && input.session !== undefined) {
        insertSearchItem.run({
          codexThreadId: input.session.codexThreadId,
          sourcePath: input.path,
          itemId: indexed.item.id,
          itemType: searchItemTypeForHistoryItem(indexed.item),
          createdAt: indexed.item.createdAt,
          title: '',
          cwd: '',
          content
        });
      }
    }
  });

  const removeMissingSources = db.transaction((paths: string[]) => {
    const existingPaths = listSourcePaths.all() as Array<{ path: string }>;
    const present = new Set(paths);
    for (const row of existingPaths) {
      if (!present.has(row.path)) {
        deleteSearchSource.run(row.path);
        deleteSource.run(row.path);
      }
    }
  });
  const rebuildSearchIndex = db.transaction(() => {
    deleteAllSearch.run();
    const sessions = listSearchSessions.all() as Array<{
      codex_thread_id: string;
      source_path: string;
      title: string;
      cwd: string | null;
      updated_at: string;
    }>;
    for (const session of sessions) {
      insertSearchItem.run({
        codexThreadId: session.codex_thread_id,
        sourcePath: session.source_path,
        itemId: SEARCH_TITLE_ITEM_ID,
        itemType: 'title',
        createdAt: session.updated_at,
        title: normalizeSearchText(session.title),
        cwd: normalizeSearchText(session.cwd ?? ''),
        content: ''
      });
    }

    const rows = listSearchBackfillItems.all({
      maxItemJsonLength: MAX_SEARCH_BACKFILL_ITEM_JSON_LENGTH
    }) as Array<{
      codex_thread_id: string;
      source_path: string;
      item_json: string;
    }>;
    for (const row of rows) {
      const item = parseHistoryItem(row.item_json)[0];
      if (item === undefined) continue;
      const content = searchContentForHistoryItem(item);
      if (content === undefined) continue;
      insertSearchItem.run({
        codexThreadId: row.codex_thread_id,
        sourcePath: row.source_path,
        itemId: item.id,
        itemType: searchItemTypeForHistoryItem(item),
        createdAt: item.createdAt,
        title: '',
        cwd: '',
        content
      });
    }
    markSearchIndexReady.run({ version: CODEX_SESSION_SEARCH_INDEX_VERSION });
  });

  return {
    getSource(path: string): CodexSessionSourceRow | undefined {
      return getSource.get(path) as CodexSessionSourceRow | undefined;
    },
    getSessionSource(codexThreadId: string): CodexSessionSourceRow | undefined {
      return getSessionSource.get(codexThreadId) as CodexSessionSourceRow | undefined;
    },
    applyFileIndex(input: ApplyCodexSessionFileIndexInput): void {
      applyFileIndex(input);
    },
    ensureSearchIndex(): void {
      const state = getSearchIndexState.get() as { version: number } | undefined;
      if (state !== undefined && state.version >= CODEX_SESSION_SEARCH_INDEX_VERSION) return;
      if (state !== undefined) {
        rebuildSearchIndex();
        return;
      }

      const indexedSessionCount = (
        countIndexedSessions.get() as { count: number }
      ).count;
      const searchTitleSourceCount = (
        countSearchTitleSources.get() as { count: number }
      ).count;
      if (indexedSessionCount === searchTitleSourceCount) {
        markSearchIndexReady.run({ version: CODEX_SESSION_SEARCH_INDEX_VERSION });
        return;
      }
      rebuildSearchIndex();
    },
    removeMissingSources(paths: string[]): void {
      removeMissingSources(paths);
    },
    classifyScheduledSessions(): void {
      restoreBoundScheduledSessions.run();
      markLegacyScheduledSessions.run();
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
      const items = rows.flatMap(row => parseHistoryItem(row.item_json));
      return materializeCodexSessionHistory(items);
    },
    listHistoryPage(codexThreadId, options): ThreadHistoryPage {
      if (options.targetItemId !== undefined) {
        return listHistoryTargetWindow(codexThreadId, options.targetItemId, options.limit);
      }
      const cursor = options.before === undefined
        ? undefined
        : decodeHistoryCursor(options.before);
      if (cursor !== undefined && cursor.codexThreadId !== codexThreadId) {
        throw new ThreadHistoryCursorError(
          'THREAD_HISTORY_CURSOR_MISMATCH',
          'History cursor belongs to another thread'
        );
      }
      if (
        cursor !== undefined
        && findHistoryCursorAnchor.get({
          codexThreadId,
          lineNumber: cursor.lineNumber,
          sourceOffset: cursor.sourceOffset,
          itemId: cursor.itemId
        }) === undefined
      ) {
        throw new ThreadHistoryCursorError(
          'THREAD_HISTORY_CURSOR_EXPIRED',
          'History cursor is no longer available'
        );
      }

      const queryLimit = options.limit + 1;
      const rows = (
        cursor === undefined
          ? listLatestHistoryItems.all({ codexThreadId, limit: queryLimit })
          : listHistoryItemsBefore.all({
              codexThreadId,
              lineNumber: cursor.lineNumber,
              sourceOffset: cursor.sourceOffset,
              itemId: cursor.itemId,
              limit: queryLimit
            })
      ) as IndexedHistoryRow[];
      const selectedDescending = rows.slice(0, options.limit);
      const selectedAscending = [...selectedDescending].reverse();
      const boundary = rows[options.limit];
      const selectedItems = selectedAscending.flatMap(row => parseHistoryItem(row.item_json));
      const boundaryItem = boundary === undefined
        ? undefined
        : parseHistoryItem(boundary.item_json)[0];
      const items = materializeHistoryPage(selectedItems, boundaryItem);
      const hasMore = boundary !== undefined;
      const anchor = selectedDescending.at(-1);

      return {
        items,
        hasMore,
        ...(hasMore && anchor !== undefined
          ? {
              nextCursor: encodeHistoryCursor({
                v: 1,
                codexThreadId,
                lineNumber: anchor.line_number,
                sourceOffset: anchor.source_offset,
                itemId: anchor.item_id
              })
            }
          : {}),
        ...(items[0] === undefined ? {} : { oldestItemAt: items[0].createdAt })
      };
    }
  };

  function listHistoryTargetWindow(
    codexThreadId: string,
    targetItemId: string,
    limit: number
  ): ThreadHistoryPage {
    const target = findHistoryTarget.get({
      codexThreadId,
      itemId: targetItemId
    }) as IndexedHistoryRow | undefined;
    if (target === undefined) {
      throw new ThreadHistoryCursorError(
        'THREAD_HISTORY_TARGET_NOT_FOUND',
        'History target is no longer available'
      );
    }

    const beforeLimit = Math.floor((limit - 1) / 2);
    const afterLimit = Math.max(0, limit - beforeLimit - 1);
    const beforeRows = listHistoryItemsBeforeTarget.all({
      codexThreadId,
      lineNumber: target.line_number,
      sourceOffset: target.source_offset,
      itemId: target.item_id,
      limit: beforeLimit + 1
    }) as IndexedHistoryRow[];
    const selectedBeforeDescending = beforeRows.slice(0, beforeLimit);
    const selectedBefore = [...selectedBeforeDescending].reverse();
    const afterRows = listHistoryItemsAfterTarget.all({
      codexThreadId,
      lineNumber: target.line_number,
      sourceOffset: target.source_offset,
      itemId: target.item_id,
      limit: afterLimit
    }) as IndexedHistoryRow[];
    const selectedRows = [...selectedBefore, target, ...afterRows];
    const items = materializeCodexSessionHistory(
      selectedRows.flatMap(row => parseHistoryItem(row.item_json))
    );
    const hasMore = beforeRows.length > beforeLimit;
    const oldest = selectedRows[0];

    return {
      items,
      hasMore,
      targetItemId,
      ...(hasMore && oldest !== undefined
        ? {
            nextCursor: encodeHistoryCursor({
              v: 1,
              codexThreadId,
              lineNumber: oldest.line_number,
              sourceOffset: oldest.source_offset,
              itemId: oldest.item_id
            })
          }
        : {}),
      ...(items[0] === undefined ? {} : { oldestItemAt: items[0].createdAt })
    };
  }
}

const SEARCH_TITLE_ITEM_ID = '__title__';
const MAX_SEARCHABLE_TEXT_LENGTH = 128_000;
const MAX_SEARCHABLE_TOOL_OUTPUT_LENGTH = 8_192;
const MAX_SEARCH_BACKFILL_ITEM_JSON_LENGTH = MAX_SEARCHABLE_TEXT_LENGTH + 4_096;

function searchContentForHistoryItem(item: ThreadHistoryItem): string | undefined {
  let value: string | undefined;
  switch (item.type) {
    case 'user_message':
    case 'schedule_trigger':
    case 'assistant_message':
    case 'reasoning_summary':
      value = item.type === 'schedule_trigger' ? item.prompt : item.text;
      break;
    case 'tool_use':
      value = item.name;
      break;
    case 'tool_result':
      if (item.output.length > MAX_SEARCHABLE_TOOL_OUTPUT_LENGTH) return undefined;
      value = `${item.name} ${item.output}`;
      break;
    case 'file_change':
      value = item.changes.map(change => change.path).join(' ');
      break;
    case 'done':
      return undefined;
  }

  if (looksBinary(value) || value.length > MAX_SEARCHABLE_TEXT_LENGTH) return undefined;
  const normalized = normalizeSearchText(value);
  return normalized.length === 0 ? undefined : normalized;
}

function searchItemTypeForHistoryItem(
  item: ThreadHistoryItem
): Exclude<ThreadHistoryItem['type'], 'schedule_trigger'> {
  return item.type === 'schedule_trigger' ? 'user_message' : item.type;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function looksBinary(value: string): boolean {
  if (value.includes('\0')) return true;
  const sample = value.slice(0, 4_096);
  let controlCount = 0;
  for (const character of sample) {
    const code = character.charCodeAt(0);
    if (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') {
      controlCount += 1;
    }
  }
  return sample.length > 0 && controlCount / sample.length > 0.02;
}

function parseHistoryItem(value: string): ThreadHistoryItem[] {
  try {
    return [JSON.parse(value) as ThreadHistoryItem];
  } catch {
    return [];
  }
}

function materializeHistoryPage(
  items: ThreadHistoryItem[],
  boundaryItem?: ThreadHistoryItem
): ThreadHistoryItem[] {
  if (boundaryItem === undefined) return materializeCodexSessionHistory(items);
  const boundaryLength = materializeCodexSessionHistory([boundaryItem]).length;
  return materializeCodexSessionHistory([boundaryItem, ...items]).slice(boundaryLength);
}

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeHistoryCursor(value: string): HistoryCursor {
  try {
    if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error('invalid encoding');
    }
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object'
      || parsed === null
      || Array.isArray(parsed)
      || (parsed as Record<string, unknown>).v !== 1
      || typeof (parsed as Record<string, unknown>).codexThreadId !== 'string'
      || !Number.isSafeInteger((parsed as Record<string, unknown>).lineNumber)
      || !Number.isSafeInteger((parsed as Record<string, unknown>).sourceOffset)
      || typeof (parsed as Record<string, unknown>).itemId !== 'string'
      || ((parsed as Record<string, unknown>).codexThreadId as string).length === 0
      || ((parsed as Record<string, unknown>).itemId as string).length === 0
      || ((parsed as Record<string, unknown>).lineNumber as number) < 0
      || ((parsed as Record<string, unknown>).sourceOffset as number) < 0
    ) {
      throw new Error('invalid payload');
    }
    return parsed as HistoryCursor;
  } catch {
    throw new ThreadHistoryCursorError(
      'THREAD_HISTORY_CURSOR_INVALID',
      'History cursor is invalid'
    );
  }
}
