import type {
  ConversationSearchQuery,
  ConversationSearchResponse
} from '@clawee/protocol';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type {
  CodexSessionProvider,
  CodexThreadHistoryPage
} from '../../src/codex/sessions/app-server-provider.js';
import { CodexAppServerResponseError } from '../../src/codex/app-server-client.js';
import { SearchCursorError } from '../../src/search/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadRepository } from '../../src/storage/repositories.js';
import type { RuntimeThread } from '../../src/threads/types.js';

let server: FastifyInstance | undefined;
let db: Database.Database | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('app-server session API', () => {
  it('uses the provider for recent threads and excludes stale Codex mappings outside its page', async () => {
    const setup = createSetup();
    const recent = runtimeThread({
      id: 'thread-recent',
      codexThreadId: 'codex-recent',
      title: '最近会话',
      updatedAt: '2026-07-15T03:00:00.000Z'
    });
    const provider = fakeProvider({
      listRecent: vi.fn(async () => ({ threads: [recent] }))
    });
    createThreadRepository(setup.db).insertThread({
      id: 'thread-stale',
      title: '旧映射不应出现',
      codexThreadId: 'codex-stale',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z'
    });
    createThreadRepository(setup.db).insertThread({
      id: 'thread-local-draft',
      title: '本地草稿',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'schedule_draft',
      createdAt: '2026-07-15T02:00:00.000Z',
      updatedAt: '2026-07-15T02:00:00.000Z'
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: setup.db,
      codexSessionProvider: provider
    });

    const response = await authGet('/threads?status=active&excludePurpose=schedule_task&limit=50');

    expect(response.statusCode).toBe(200);
    expect(provider.listRecent).toHaveBeenCalledWith({ limit: 50 });
    expect(response.json().threads.map((thread: { id: string }) => thread.id)).toEqual([
      'thread-recent',
      'thread-local-draft'
    ]);
    expect(response.body).not.toContain('thread-stale');
    expect(
      setup.db.prepare('SELECT COUNT(*) AS count FROM codex_session_sources').get()
    ).toEqual({ count: 0 });
  });

  it('uses provider cursors for history and provider search results without item targets', async () => {
    const setup = createSetup();
    createThreadRepository(setup.db).insertThread({
      id: 'thread-recent',
      title: '最近会话',
      codexThreadId: 'codex-recent',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T02:00:00.000Z'
    });
    const history: CodexThreadHistoryPage = {
      items: [{
        id: 'user-1',
        type: 'user_message',
        text: '历史消息',
        createdAt: '2026-07-15T00:00:00.000Z',
        turnId: 'turn-1'
      }],
      hasMore: true,
      nextCursor: 'older-cursor',
      oldestItemAt: '2026-07-15T00:00:00.000Z'
    };
    const search: ConversationSearchResponse = {
      results: [{
        threadId: 'thread-recent',
        codexThreadId: 'codex-recent',
        title: '最近会话',
        cwd: tempDir,
        itemType: 'title',
        createdAt: '2026-07-15T02:00:00.000Z',
        snippet: [{ text: '历史消息', highlighted: true }]
      }],
      hasMore: false
    };
    const provider = fakeProvider({
      listTurns: vi.fn(async () => history),
      search: vi.fn(async () => search)
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: setup.db,
      codexSessionProvider: provider
    });

    const historyResponse = await authGet(
      '/threads/thread-recent/history?limit=20&before=app-server-cursor'
    );
    const searchResponse = await authGet(
      `/search/conversations?query=${encodeURIComponent('历史消息')}&limit=20`
    );

    expect(historyResponse.statusCode).toBe(200);
    expect(provider.listTurns).toHaveBeenCalledWith({
      codexThreadId: 'codex-recent',
      limit: 20,
      cursor: 'app-server-cursor'
    });
    expect(historyResponse.json()).toMatchObject({
      threadId: 'thread-recent',
      codexThreadId: 'codex-recent',
      ...history
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(provider.search).toHaveBeenCalledWith({
      query: '历史消息',
      limit: 20
    });
    expect(searchResponse.json()).toEqual(search);
    expect(searchResponse.json().results[0]).not.toHaveProperty('itemId');
  });

  it('validates search queries and rejects unsupported target history windows', async () => {
    const setup = createSetup();
    createThreadRepository(setup.db).insertThread({
      id: 'thread-recent',
      title: '最近会话',
      codexThreadId: 'codex-recent',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T02:00:00.000Z'
    });
    const provider = fakeProvider({
      search: vi.fn(async query => {
        if (query.cursor !== undefined) throw new SearchCursorError('invalid cursor');
        return { results: [], hasMore: false };
      })
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: setup.db,
      codexSessionProvider: provider
    });

    for (const url of [
      '/search/conversations',
      '/search/conversations?query=test&limit=0',
      '/search/conversations?query=test&types=unknown',
      '/search/conversations?query=test&cursor=not-a-cursor'
    ]) {
      const response = await authGet(url);
      expect(response.statusCode).toBe(400);
    }

    const target = await authGet(
      '/threads/thread-recent/history?limit=20&targetItemId=message-id'
    );
    expect(target.statusCode).toBe(400);
    expect(target.json().error.code).toBe('VALIDATION_FAILED');
    expect(provider.listTurns).not.toHaveBeenCalled();
  });

  it('maps app-server cursor errors to stable API errors', async () => {
    const setup = createSetup();
    createThreadRepository(setup.db).insertThread({
      id: 'thread-recent',
      title: '最近会话',
      codexThreadId: 'codex-recent',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T02:00:00.000Z'
    });
    const provider = fakeProvider({
      listTurns: vi.fn(async input => {
        if (input.cursor !== undefined) {
          throw new CodexAppServerResponseError('invalid history cursor', -32602);
        }
        return { items: [], hasMore: false };
      }),
      search: vi.fn(async query => {
        if (query.cursor !== undefined) {
          throw new CodexAppServerResponseError('invalid search cursor', -32602);
        }
        return { results: [], hasMore: false };
      })
    });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db: setup.db,
      codexSessionProvider: provider
    });

    const history = await authGet(
      '/threads/thread-recent/history?limit=20&before=invalid-cursor'
    );
    const search = await authGet(
      '/search/conversations?query=test&limit=20&cursor=invalid-cursor'
    );

    expect(history.statusCode).toBe(400);
    expect(history.json().error.code).toBe('THREAD_HISTORY_CURSOR_INVALID');
    expect(search.statusCode).toBe(400);
    expect(search.json().error.code).toBe('SEARCH_CURSOR_INVALID');
  });
});

function createSetup() {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-app-server-sessions-api-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  return { db };
}

function fakeProvider(
  overrides: Partial<CodexSessionProvider> = {}
): CodexSessionProvider {
  return {
    listRecent: vi.fn(async () => ({ threads: [] })),
    listTurns: vi.fn(async () => ({ items: [], hasMore: false })),
    search: vi.fn(async (_query: ConversationSearchQuery) => ({
      results: [],
      hasMore: false
    })),
    close: vi.fn(async () => undefined),
    ...overrides
  };
}

function runtimeThread(overrides: Partial<RuntimeThread> = {}): RuntimeThread {
  return {
    id: 'thread-runtime',
    title: '会话',
    codexThreadId: 'codex-thread',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'read-only',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T01:00:00.000Z',
    archivedAt: null,
    ...overrides
  };
}

async function authGet(url: string) {
  return server!.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer secret' }
  });
}
