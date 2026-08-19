import type {
  ConversationSearchItemType,
  ConversationSearchQuery,
  ConversationSearchResponse,
  ConversationSearchResult,
  ConversationSearchSnippetSegment
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createConversationTitle } from '../threads/conversation-title.js';

export class SearchCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchCursorError';
  }
}

export type ConversationSearchService = {
  search(query: ConversationSearchQuery): ConversationSearchResponse;
};

type SearchCursor = {
  v: 1;
  offset: number;
  signature: string;
};

type SearchRow = {
  row_id: number;
  thread_id: string;
  project_id: string;
  codex_thread_id: string;
  session_title: string;
  session_cwd: string;
  item_id: string;
  item_type: ConversationSearchItemType;
  created_at: string;
  indexed_title: string;
  indexed_cwd: string;
  indexed_content: string;
};

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const TITLE_ITEM_ID = '__title__';

export function createConversationSearchService(
  db: Database.Database
): ConversationSearchService {
  return {
    search(input): ConversationSearchResponse {
      const query = normalizeSearchText(input.query);
      if (query.length === 0) return { results: [], hasMore: false };
      const limit = clampSearchLimit(input.limit);
      const normalizedInput = normalizeSearchInput(input, query);
      const signature = createSearchSignature(normalizedInput);
      const cursor = input.cursor === undefined
        ? undefined
        : decodeSearchCursor(input.cursor, signature);
      const offset = cursor?.offset ?? 0;
      const useFullTextIndex = Array.from(query).length >= 3;
      const where = [
        useFullTextIndex
          ? 'codex_session_search MATCH @matchQuery'
          : `instr(
              lower(
                coalesce(codex_session_search.title, '')
                || ' '
                || coalesce(codex_session_search.cwd, '')
                || ' '
                || coalesce(codex_session_search.content, '')
              ),
              lower(@query)
            ) > 0`,
        "session.kind = 'user'",
        "thread.status = 'active'"
      ];
      const parameters: Record<string, string | number> = {
        query,
        limit: limit + 1,
        offset
      };
      if (useFullTextIndex) parameters.matchQuery = toFtsPhrase(query);
      if (normalizedInput.cwd !== undefined) {
        where.push('session.cwd = @cwd');
        parameters.cwd = normalizedInput.cwd;
      }
      if (normalizedInput.createdAfter !== undefined) {
        where.push('codex_session_search.created_at >= @createdAfter');
        parameters.createdAfter = normalizedInput.createdAfter;
      }
      if (normalizedInput.createdBefore !== undefined) {
        where.push('codex_session_search.created_at <= @createdBefore');
        parameters.createdBefore = normalizedInput.createdBefore;
      }
      if (normalizedInput.itemTypes !== undefined && normalizedInput.itemTypes.length > 0) {
        const placeholders = normalizedInput.itemTypes.map((itemType, index) => {
          const key = `itemType${index}`;
          parameters[key] = itemType;
          return `@${key}`;
        });
        where.push(`codex_session_search.item_type IN (${placeholders.join(', ')})`);
      }

      const orderBy = useFullTextIndex
        ? 'bm25(codex_session_search) ASC, codex_session_search.created_at DESC, codex_session_search.rowid DESC'
        : 'codex_session_search.created_at DESC, codex_session_search.rowid DESC';
      const rows = db.prepare(`
        SELECT
          codex_session_search.rowid AS row_id,
          thread.id AS thread_id,
          COALESCE(thread.project_id, '') AS project_id,
          codex_session_search.codex_thread_id,
          session.title AS session_title,
          session.cwd AS session_cwd,
          codex_session_search.item_id,
          codex_session_search.item_type,
          codex_session_search.created_at,
          codex_session_search.title AS indexed_title,
          codex_session_search.cwd AS indexed_cwd,
          codex_session_search.content AS indexed_content
        FROM codex_session_search
        INNER JOIN codex_sessions session
          ON session.codex_thread_id = codex_session_search.codex_thread_id
        INNER JOIN threads thread
          ON thread.codex_thread_id = codex_session_search.codex_thread_id
        WHERE ${where.join('\n          AND ')}
        ORDER BY ${orderBy}
        LIMIT @limit OFFSET @offset
      `).all(parameters) as SearchRow[];
      const selected = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const results = selected.map(row => mapSearchRow(row, query));

      return {
        results,
        hasMore,
        ...(hasMore
          ? {
              nextCursor: encodeSearchCursor({
                v: 1,
                offset: offset + selected.length,
                signature
              })
            }
          : {})
      };
    }
  };
}

function normalizeSearchInput(
  input: ConversationSearchQuery,
  query: string
): ConversationSearchQuery {
  const itemTypes = input.itemTypes === undefined
    ? undefined
    : [...new Set(input.itemTypes)].sort();
  return {
    query,
    ...(input.cwd === undefined ? {} : { cwd: normalizeSearchText(input.cwd) }),
    ...(itemTypes === undefined || itemTypes.length === 0 ? {} : { itemTypes }),
    ...(input.createdAfter === undefined ? {} : { createdAfter: input.createdAfter }),
    ...(input.createdBefore === undefined ? {} : { createdBefore: input.createdBefore })
  };
}

function createSearchSignature(input: ConversationSearchQuery): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('base64url')
    .slice(0, 20);
}

function clampSearchLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SEARCH_LIMIT;
  return Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(limit)));
}

function toFtsPhrase(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function mapSearchRow(row: SearchRow, query: string): ConversationSearchResult {
  const source = row.item_type === 'title'
    ? row.indexed_title
    : row.indexed_content || row.indexed_cwd || row.indexed_title;
  return {
    threadId: row.thread_id,
    projectId: row.project_id,
    codexThreadId: row.codex_thread_id,
    title: createConversationTitle(row.session_title, '未命名对话'),
    cwd: row.session_cwd,
    ...(row.item_id === TITLE_ITEM_ID ? {} : { itemId: row.item_id }),
    itemType: row.item_type,
    createdAt: row.created_at,
    snippet: buildSnippet(source, query)
  };
}

function buildSnippet(source: string, query: string): ConversationSearchSnippetSegment[] {
  const normalizedSource = normalizeSearchText(source);
  const index = normalizedSource.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) {
    return [{
      text: normalizedSource.slice(0, 160),
      highlighted: false
    }];
  }

  const start = Math.max(0, index - 72);
  const end = Math.min(normalizedSource.length, index + query.length + 72);
  const segments: ConversationSearchSnippetSegment[] = [];
  if (start > 0) segments.push({ text: '…', highlighted: false });
  if (index > start) {
    segments.push({
      text: normalizedSource.slice(start, index),
      highlighted: false
    });
  }
  segments.push({
    text: normalizedSource.slice(index, index + query.length),
    highlighted: true
  });
  if (index + query.length < end) {
    segments.push({
      text: normalizedSource.slice(index + query.length, end),
      highlighted: false
    });
  }
  if (end < normalizedSource.length) segments.push({ text: '…', highlighted: false });
  return segments;
}

function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeSearchCursor(value: string, signature: string): SearchCursor {
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
      || !Number.isSafeInteger((parsed as Record<string, unknown>).offset)
      || ((parsed as Record<string, unknown>).offset as number) < 0
      || (parsed as Record<string, unknown>).signature !== signature
    ) {
      throw new Error('invalid payload');
    }
    return parsed as SearchCursor;
  } catch {
    throw new SearchCursorError('Search cursor is invalid');
  }
}
