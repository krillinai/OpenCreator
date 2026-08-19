import type {
  ConversationSummary,
  MemoryEntry,
  MemoryListQuery,
  MemoryScope,
  RunContextItem
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';

type MemoryRow = {
  id: string;
  content: string;
  scope: MemoryScope;
  scope_key: string | null;
  source: MemoryEntry['source'];
  enabled: number;
  sensitive: number;
  user_confirmed_at: string;
  created_at: string;
  updated_at: string;
};

type SummaryRow = {
  id: string;
  thread_id: string;
  content: string;
  covered_from_cursor: string;
  covered_to_cursor: string;
  item_count: number;
  version: number;
  created_at: string;
  updated_at: string;
};

type RunContextRow = {
  run_id: string;
  item_order: number;
  kind: RunContextItem['kind'];
  source_id: string;
  content_snapshot: string;
  scope: MemoryScope | null;
  scope_key: string | null;
  summary_version: number | null;
};

export function createMemoryRepository(db: Database.Database) {
  const insertMemory = db.prepare(`
    INSERT INTO memories (
      id, content, scope, scope_key, source, enabled, sensitive,
      user_confirmed_at, created_at, updated_at
    ) VALUES (
      @id, @content, @scope, @scopeKey, @source, @enabled, @sensitive,
      @userConfirmedAt, @createdAt, @updatedAt
    )
  `);
  const getMemory = db.prepare<string>('SELECT * FROM memories WHERE id = ?');
  const listMemories = db.prepare<{
    query: string;
    pattern: string;
    scope: MemoryScope | 'all';
    scopeKey: string | null;
    enabled: 'all' | 0 | 1;
    limit: number;
  }>(`
    SELECT *
    FROM memories
    WHERE (@query = '' OR lower(content) LIKE lower(@pattern) ESCAPE '\\')
      AND (@scope = 'all' OR scope = @scope)
      AND (@scopeKey IS NULL OR scope_key = @scopeKey)
      AND (@enabled = 'all' OR enabled = @enabled)
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const updateMemory = db.prepare(`
    UPDATE memories
    SET content = @content,
        enabled = @enabled,
        sensitive = @sensitive,
        user_confirmed_at = @userConfirmedAt,
        updated_at = @updatedAt
    WHERE id = @id
  `);
  const deleteMemory = db.prepare<string>('DELETE FROM memories WHERE id = ?');
  const disableAll = db.prepare(`
    UPDATE memories
    SET enabled = 0, updated_at = @updatedAt
    WHERE enabled = 1
  `);
  const selectContextMemories = db.prepare<{
    threadId: string;
    projectKey: string;
    limit: number;
  }>(`
    SELECT *
    FROM memories
    WHERE enabled = 1
      AND (
        scope = 'global'
        OR (scope = 'project' AND scope_key = @projectKey)
        OR (scope = 'thread' AND scope_key = @threadId)
      )
    ORDER BY
      CASE scope WHEN 'thread' THEN 0 WHEN 'project' THEN 1 ELSE 2 END,
      updated_at DESC,
      id DESC
    LIMIT @limit
  `);
  const nextSummaryVersion = db.prepare<string>(`
    SELECT COALESCE(MAX(version), 0) + 1 AS version
    FROM conversation_summaries
    WHERE thread_id = ?
  `);
  const insertSummary = db.prepare(`
    INSERT INTO conversation_summaries (
      id, thread_id, content, covered_from_cursor, covered_to_cursor,
      item_count, version, created_at, updated_at
    ) VALUES (
      @id, @threadId, @content, @coveredFromCursor, @coveredToCursor,
      @itemCount, @version, @createdAt, @updatedAt
    )
  `);
  const listSummaries = db.prepare<{ threadId: string | null; limit: number }>(`
    SELECT *
    FROM conversation_summaries
    WHERE (@threadId IS NULL OR thread_id = @threadId)
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const latestSummary = db.prepare<string>(`
    SELECT *
    FROM conversation_summaries
    WHERE thread_id = ?
    ORDER BY version DESC
    LIMIT 1
  `);
  const deleteSummary = db.prepare<string>('DELETE FROM conversation_summaries WHERE id = ?');
  const clearRunContext = db.prepare<string>('DELETE FROM run_context_items WHERE run_id = ?');
  const insertRunContext = db.prepare(`
    INSERT INTO run_context_items (
      run_id, item_order, kind, source_id, content_snapshot,
      scope, scope_key, summary_version, created_at
    ) VALUES (
      @runId, @order, @kind, @sourceId, @content,
      @scope, @scopeKey, @summaryVersion, @createdAt
    )
  `);
  const listRunContext = db.prepare<string>(`
    SELECT *
    FROM run_context_items
    WHERE run_id = ?
    ORDER BY item_order ASC
  `);
  const replaceRunContext = db.transaction((runId: string, items: RunContextItem[]) => {
    clearRunContext.run(runId);
    const createdAt = new Date().toISOString();
    for (const item of items) {
      insertRunContext.run({
        runId,
        order: item.order,
        kind: item.kind,
        sourceId: item.sourceId,
        content: item.content,
        scope: item.scope ?? null,
        scopeKey: item.scopeKey ?? null,
        summaryVersion: item.summaryVersion ?? null,
        createdAt
      });
    }
  });

  return {
    insertMemory(memory: MemoryEntry): void {
      insertMemory.run({
        ...memory,
        scopeKey: memory.scopeKey ?? null,
        enabled: memory.enabled ? 1 : 0,
        sensitive: memory.sensitive ? 1 : 0
      });
    },
    getMemory(id: string): MemoryEntry | undefined {
      const row = getMemory.get(id) as MemoryRow | undefined;
      return row === undefined ? undefined : mapMemory(row);
    },
    listMemories(query: MemoryListQuery = {}): MemoryEntry[] {
      const search = query.query?.trim() ?? '';
      return (listMemories.all({
        query: search,
        pattern: `%${escapeLike(search)}%`,
        scope: query.scope ?? 'all',
        scopeKey: query.scopeKey ?? null,
        enabled: query.enabled === undefined || query.enabled === 'all'
          ? 'all'
          : query.enabled ? 1 : 0,
        limit: Math.min(Math.max(query.limit ?? 100, 1), 100)
      }) as MemoryRow[]).map(mapMemory);
    },
    updateMemory(memory: MemoryEntry): void {
      updateMemory.run({
        id: memory.id,
        content: memory.content,
        enabled: memory.enabled ? 1 : 0,
        sensitive: memory.sensitive ? 1 : 0,
        userConfirmedAt: memory.userConfirmedAt,
        updatedAt: memory.updatedAt
      });
    },
    deleteMemory(id: string): boolean {
      return deleteMemory.run(id).changes > 0;
    },
    disableAll(updatedAt: string): number {
      return disableAll.run({ updatedAt }).changes;
    },
    selectContextMemories(threadId: string, projectKey: string, limit: number): MemoryEntry[] {
      return (selectContextMemories.all({ threadId, projectKey, limit }) as MemoryRow[]).map(mapMemory);
    },
    nextSummaryVersion(threadId: string): number {
      return (nextSummaryVersion.get(threadId) as { version: number }).version;
    },
    insertSummary(summary: ConversationSummary): void {
      insertSummary.run(summary);
    },
    listSummaries(threadId?: string, limit = 100): ConversationSummary[] {
      return (listSummaries.all({
        threadId: threadId ?? null,
        limit: Math.min(Math.max(limit, 1), 100)
      }) as SummaryRow[]).map(mapSummary);
    },
    latestSummary(threadId: string): ConversationSummary | undefined {
      const row = latestSummary.get(threadId) as SummaryRow | undefined;
      return row === undefined ? undefined : mapSummary(row);
    },
    deleteSummary(id: string): boolean {
      return deleteSummary.run(id).changes > 0;
    },
    replaceRunContext(runId: string, items: RunContextItem[]): void {
      replaceRunContext(runId, items);
    },
    listRunContext(runId: string): RunContextItem[] {
      return (listRunContext.all(runId) as RunContextRow[]).map(row => ({
        kind: row.kind,
        sourceId: row.source_id,
        content: row.content_snapshot,
        order: row.item_order,
        ...(row.scope === null ? {} : { scope: row.scope }),
        ...(row.scope_key === null ? {} : { scopeKey: row.scope_key }),
        ...(row.summary_version === null ? {} : { summaryVersion: row.summary_version })
      }));
    }
  };
}

function mapMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    scope: row.scope,
    ...(row.scope_key === null ? {} : { scopeKey: row.scope_key }),
    source: row.source,
    enabled: row.enabled === 1,
    sensitive: row.sensitive === 1,
    userConfirmedAt: row.user_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSummary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id,
    threadId: row.thread_id,
    content: row.content,
    coveredFromCursor: row.covered_from_cursor,
    coveredToCursor: row.covered_to_cursor,
    itemCount: row.item_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}
