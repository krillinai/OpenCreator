import type { ThreadHistoryItem } from '@opencreator/protocol';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_SESSION_INDEX_VERSION,
  createCodexSessionIndexRepository,
  type CodexSessionIndexRepository
} from '../../src/codex/sessions/index-repository.js';
import { createConversationSearchService } from '../../src/search/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadRepository } from '../../src/storage/repositories.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('conversation search service', () => {
  it('searches titles and normalized message content in Chinese, English, and paths', () => {
    const setup = createSetup();
    indexSession(setup.repository, {
      codexThreadId: 'codex-search-a',
      sourcePath: join(tempDir, 'search-a.jsonl'),
      title: '请帮我重新详细分析下刷新后页面卡住的问题，确认原因并完成修复',
      cwd: setup.cwd,
      items: [
        message('user-1', 'user_message', '请分析 refresh race condition', '2026-07-12T08:00:01.000Z'),
        message('assistant-1', 'assistant_message', '问题位于 apps/web/src/app/App.tsx', '2026-07-12T08:00:02.000Z')
      ]
    });
    insertThread(
      setup.db,
      'thread-a',
      'codex-search-a',
      setup.cwd,
      '请帮我重新详细分析下刷新后页面卡住的问题，确认原因并完成修复'
    );

    const service = createConversationSearchService(setup.db);

    expect(service.search({ query: '页面卡住' }).results[0]).toMatchObject({
      threadId: 'thread-a',
      codexThreadId: 'codex-search-a',
      title: '分析刷新后页面卡住的问题',
      itemType: 'title'
    });
    expect(service.search({ query: 'race condition' }).results[0]).toMatchObject({
      itemId: 'user-1',
      itemType: 'user_message'
    });
    const pathResult = service.search({ query: 'apps/web/src/app/App.tsx' }).results[0];
    expect(pathResult).toBeDefined();
    expect(pathResult).toMatchObject({
      itemId: 'assistant-1',
      itemType: 'assistant_message'
    });
    expect(pathResult!.snippet.some(segment => segment.highlighted)).toBe(true);
  });

  it('supports cwd, item type, time filters, and opaque pagination', () => {
    const setup = createSetup();
    const otherCwd = join(tempDir, 'other');
    indexSession(setup.repository, {
      codexThreadId: 'codex-filter-a',
      sourcePath: join(tempDir, 'filter-a.jsonl'),
      title: '搜索筛选 A',
      cwd: setup.cwd,
      items: [
        message('user-a', 'user_message', '共同关键词 alpha', '2026-07-12T09:00:01.000Z'),
        message('assistant-a', 'assistant_message', '共同关键词 beta', '2026-07-12T09:00:02.000Z')
      ]
    });
    indexSession(setup.repository, {
      codexThreadId: 'codex-filter-b',
      sourcePath: join(tempDir, 'filter-b.jsonl'),
      title: '搜索筛选 B',
      cwd: otherCwd,
      items: [
        message('user-b', 'user_message', '共同关键词 gamma', '2026-07-12T10:00:01.000Z')
      ]
    });
    insertThread(setup.db, 'thread-a', 'codex-filter-a', setup.cwd, '搜索筛选 A');
    insertThread(setup.db, 'thread-b', 'codex-filter-b', otherCwd, '搜索筛选 B');
    const service = createConversationSearchService(setup.db);

    const filtered = service.search({
      query: '共同关键词',
      cwd: setup.cwd,
      itemTypes: ['assistant_message'],
      createdAfter: '2026-07-12T09:00:01.500Z',
      createdBefore: '2026-07-12T09:00:03.000Z'
    });
    expect(filtered.results).toEqual([
      expect.objectContaining({ threadId: 'thread-a', itemId: 'assistant-a' })
    ]);

    const first = service.search({ query: '共同关键词', limit: 1 });
    const second = service.search({
      query: '共同关键词',
      limit: 1,
      cursor: first.nextCursor
    });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.results[0]?.itemId).not.toBe(first.results[0]?.itemId);
  });

  it('keeps full-text rows synchronized and excludes oversized tool output', () => {
    const setup = createSetup();
    const sourcePath = join(tempDir, 'replace.jsonl');
    indexSession(setup.repository, {
      codexThreadId: 'codex-replace',
      sourcePath,
      title: '旧标题',
      cwd: setup.cwd,
      items: [
        message('old-item', 'user_message', '旧内容 unique-old-token', '2026-07-12T11:00:01.000Z'),
        {
          id: 'large-output',
          type: 'tool_result',
          name: 'exec',
          output: `oversized-secret-token ${'x'.repeat(20_000)}`,
          isError: false,
          createdAt: '2026-07-12T11:00:02.000Z'
        }
      ]
    });
    insertThread(setup.db, 'thread-replace', 'codex-replace', setup.cwd, '旧标题');
    const service = createConversationSearchService(setup.db);

    expect(service.search({ query: 'unique-old-token' }).results).toHaveLength(1);
    expect(service.search({ query: 'oversized-secret-token' }).results).toEqual([]);

    setup.db.prepare('DELETE FROM codex_session_search').run();
    setup.db.prepare('DELETE FROM codex_session_search_state').run();
    setup.repository.ensureSearchIndex();
    expect(service.search({ query: 'unique-old-token' }).results).toHaveLength(1);
    expect(service.search({ query: 'oversized-secret-token' }).results).toEqual([]);

    indexSession(setup.repository, {
      codexThreadId: 'codex-replace',
      sourcePath,
      title: '新标题',
      cwd: setup.cwd,
      rebuild: true,
      items: [
        message('new-item', 'assistant_message', '新内容 unique-new-token', '2026-07-12T11:10:01.000Z')
      ]
    });

    expect(service.search({ query: 'unique-old-token' }).results).toEqual([]);
    expect(service.search({ query: 'unique-new-token' }).results).toHaveLength(1);

    setup.repository.removeMissingSources([]);
    expect(service.search({ query: 'unique-new-token' }).results).toEqual([]);
  });
});

function createSetup() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-search-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const cwd = join(tempDir, 'workspace');
  db = openRuntimeDatabase(dbPath);
  return {
    db,
    cwd,
    repository: createCodexSessionIndexRepository(db)
  };
}

function insertThread(
  database: Database.Database,
  id: string,
  codexThreadId: string,
  cwd: string,
  title: string
): void {
  createThreadRepository(database).insertThread({
    id,
    title,
    codexThreadId,
    cwd,
    canonicalCwd: cwd,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    status: 'active',
    createdAt: '2026-07-12T08:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z'
  });
}

function indexSession(
  repository: CodexSessionIndexRepository,
  input: {
    codexThreadId: string;
    sourcePath: string;
    title: string;
    cwd: string;
    items: ThreadHistoryItem[];
    rebuild?: boolean;
  }
): void {
  repository.applyFileIndex({
    path: input.sourcePath,
    fileId: input.sourcePath,
    fileSize: 1,
    mtimeMs: 1,
    parsedOffset: 1,
    parsedLineCount: input.items.length,
    parserState: {
      codexThreadId: input.codexThreadId,
      cwd: input.cwd,
      createdAt: '2026-07-12T08:00:00.000Z',
      updatedAt: input.items.at(-1)?.createdAt,
      title: input.title,
      kind: 'user',
      callNameById: {}
    },
    headSize: 1,
    headHash: 'hash',
    lastError: null,
    indexVersion: CODEX_SESSION_INDEX_VERSION,
    rebuild: input.rebuild ?? false,
    session: {
      codexThreadId: input.codexThreadId,
      sourcePath: input.sourcePath,
      kind: 'user',
      title: input.title,
      cwd: input.cwd,
      createdAt: '2026-07-12T08:00:00.000Z',
      updatedAt: input.items.at(-1)?.createdAt ?? '2026-07-12T08:00:00.000Z'
    },
    items: input.items.map((item, index) => ({
      sourceOffset: index + 1,
      lineNumber: index + 1,
      item
    }))
  });
}

function message(
  id: string,
  type: 'user_message' | 'assistant_message',
  text: string,
  createdAt: string
): ThreadHistoryItem {
  return { id, type, text, createdAt };
}
