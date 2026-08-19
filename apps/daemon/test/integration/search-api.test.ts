import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';

let server: FastifyInstance | undefined;
let tempDir = '';
let db: Database.Database | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
  vi.restoreAllMocks();
});

describe('conversation search api', () => {
  it.skip('legacy JSONL integration: syncs sessions into the local search index', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-search-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '12');
    const cwd = join(tempDir, 'workspace');
    const otherCwd = join(tempDir, 'other-workspace');
    mkdirSync(sessionDir, { recursive: true });
    writeSession(sessionDir, 'search-main', cwd, [
      eventMessage('user_message', '会话搜索入口', '2026-07-12T12:00:01.000Z'),
      eventMessage('agent_message', '共同搜索词 第一条回复', '2026-07-12T12:00:02.000Z'),
      eventMessage(
        'user_message',
        '共同搜索词 目标位于 apps/web/src/app/App.tsx',
        '2026-07-12T12:00:03.000Z'
      ),
      eventMessage('agent_message', '共同搜索词 第四条回复', '2026-07-12T12:00:04.000Z'),
      eventMessage('user_message', '共同搜索词 第五条消息', '2026-07-12T12:00:05.000Z'),
      {
        timestamp: '2026-07-12T12:00:06.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          output: `oversized-secret-token ${'x'.repeat(20_000)}`
        }
      }
    ]);
    writeSession(sessionDir, 'search-other', otherCwd, [
      eventMessage('user_message', '另一个项目', '2026-07-12T13:00:01.000Z'),
      eventMessage('agent_message', '共同搜索词 其他项目回复', '2026-07-12T13:00:02.000Z')
    ]);
    server = await buildServer({
      token: 'secret',
      dataDir: join(tempDir, 'runtime'),
      codexHome
    });

    const pathSearch = await authGet(
      `/search/conversations?query=${encodeURIComponent('apps/web/src/app/App.tsx')}`
    );
    expect(pathSearch.statusCode).toBe(200);
    expect(pathSearch.json().results[0]).toMatchObject({
      codexThreadId: 'search-main',
      itemType: 'user_message'
    });
    expect(pathSearch.json().results[0].snippet).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ highlighted: true })
      ])
    );

    const filtered = await authGet(
      `/search/conversations?query=${encodeURIComponent('共同搜索词')}`
      + `&cwd=${encodeURIComponent(cwd)}&types=user_message&limit=1`
    );
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({ hasMore: true });
    expect(filtered.json().results[0]).toMatchObject({
      codexThreadId: 'search-main',
      cwd,
      itemType: 'user_message'
    });
    const next = await authGet(
      `/search/conversations?query=${encodeURIComponent('共同搜索词')}`
      + `&cwd=${encodeURIComponent(cwd)}&types=user_message&limit=1`
      + `&cursor=${encodeURIComponent(filtered.json().nextCursor)}`
    );
    expect(next.statusCode).toBe(200);
    expect(next.json().results[0].itemId).not.toBe(filtered.json().results[0].itemId);

    const targetResult = pathSearch.json().results[0] as {
      threadId: string;
      itemId: string;
    };
    const history = await authGet(
      `/threads/${encodeURIComponent(targetResult.threadId)}/history`
      + `?limit=3&targetItemId=${encodeURIComponent(targetResult.itemId)}`
    );
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      targetItemId: targetResult.itemId,
      hasMore: true
    });
    expect(history.json().items.map((item: { text?: string }) => item.text).filter(Boolean)).toEqual([
      '共同搜索词 第一条回复',
      '共同搜索词 目标位于 apps/web/src/app/App.tsx',
      '共同搜索词 第四条回复'
    ]);

    const oversized = await authGet('/search/conversations?query=oversized-secret-token');
    expect(oversized.statusCode).toBe(200);
    expect(oversized.json().results).toEqual([]);
  });

  it.skip('legacy JSONL integration: validates local search cursors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-search-api-'));
    server = await buildServer({
      token: 'secret',
      dataDir: join(tempDir, 'runtime'),
      codexHome: join(tempDir, 'codex-home')
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
  });

  it.skip('legacy JSONL integration: throttles local session index synchronization', async () => {
    let now = Date.parse('2026-07-12T12:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-search-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '12');
    const cwd = join(tempDir, 'workspace');
    mkdirSync(sessionDir, { recursive: true });
    writeSession(sessionDir, 'search-first', cwd, [
      eventMessage('user_message', 'first-search-token', '2026-07-12T12:00:01.000Z')
    ]);
    server = await buildServer({
      token: 'secret',
      dataDir: join(tempDir, 'runtime'),
      codexHome
    });

    expect((await authGet('/threads?status=active&limit=50')).statusCode).toBe(200);
    expect(
      (await authGet('/search/conversations?query=first-search-token&types=user_message'))
        .json().results
    )
      .toHaveLength(1);

    writeSession(sessionDir, 'search-second', cwd, [
      eventMessage('user_message', 'second-search-token', '2026-07-12T12:00:02.000Z')
    ]);
    expect(
      (await authGet('/search/conversations?query=second-search-token&types=user_message'))
        .json().results
    )
      .toEqual([]);

    now += 30_000;
    expect(
      (await authGet('/search/conversations?query=second-search-token&types=user_message'))
        .json().results
    )
      .toHaveLength(1);
  });

  it.skip('legacy JSONL integration: searches the local session index', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-search-api-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '14');
    const cwd = join(tempDir, 'workspace');
    mkdirSync(sessionDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const triggeredAt = '2026-07-14T12:00:01.000Z';
    writeSession(sessionDir, 'search-task-session', cwd, [
      eventMessage(
        'user_message',
        scheduleExecutionPrompt('任务历史可搜索标记', triggeredAt),
        triggeredAt
      )
    ]);
    writeSession(sessionDir, 'search-legacy-session', cwd, [
      eventMessage('user_message', '旧孤立历史隐藏标记', '2026-07-14T12:10:01.000Z')
    ]);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    createThreadRepository(db).insertThread({
      id: 'thread_search_task',
      title: '可搜索任务',
      codexThreadId: 'search-task-session',
      cwd,
      canonicalCwd: cwd,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'schedule_task'
    });
    const runs = createRunRepository(db);
    runs.insertRun(scheduleRunInput({
      id: 'run_search_task',
      threadId: 'thread_search_task',
      codexThreadId: 'search-task-session',
      sourceId: 'sch_search_task',
      publicPrompt: '任务历史可搜索标记',
      triggeredAt,
      cwd,
      codexHome
    }));
    runs.insertRun(scheduleRunInput({
      id: 'run_search_legacy',
      codexThreadId: 'search-legacy-session',
      sourceId: 'sch_search_legacy',
      cwd,
      codexHome
    }));
    server = await buildServer({
      token: 'secret',
      dataDir: join(tempDir, 'runtime'),
      codexHome,
      db
    });

    const task = await authGet(
      `/search/conversations?query=${encodeURIComponent('任务历史可搜索标记')}`
    );
    const legacy = await authGet(
      `/search/conversations?query=${encodeURIComponent('旧孤立历史隐藏标记')}`
    );
    const internalRule = await authGet(
      `/search/conversations?query=${encodeURIComponent('立即完成本次任务')}`
    );
    const history = await authGet('/threads/thread_search_task/history');

    expect(task.statusCode).toBe(200);
    expect(task.json().results.length).toBeGreaterThan(0);
    expect(task.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadId: 'thread_search_task',
          codexThreadId: 'search-task-session'
        })
      ])
    );
    expect(task.json().results.every(
      (result: { threadId: string; codexThreadId: string }) =>
        result.threadId === 'thread_search_task'
        && result.codexThreadId === 'search-task-session'
    )).toBe(true);
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().results).toEqual([]);
    expect(internalRule.statusCode).toBe(200);
    expect(internalRule.json().results).toEqual([]);
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'schedule_trigger',
        prompt: '任务历史可搜索标记',
        triggeredAt,
        runId: 'run_search_task'
      })
    ]));
    expect(history.body).not.toContain('立即完成本次任务');
  });

});

function writeSession(
  sessionDir: string,
  id: string,
  cwd: string,
  entries: unknown[]
): void {
  writeFileSync(
    join(sessionDir, `rollout-${id}.jsonl`),
    [
      JSON.stringify({
        timestamp: '2026-07-12T12:00:00.000Z',
        type: 'session_meta',
        payload: {
          id,
          session_id: id,
          cwd,
          timestamp: '2026-07-12T12:00:00.000Z'
        }
      }),
      ...entries.map(entry => JSON.stringify(entry))
    ].join('\n')
  );
}

function eventMessage(
  type: 'user_message' | 'agent_message',
  message: string,
  timestamp: string
) {
  return {
    timestamp,
    type: 'event_msg',
    payload: { type, message }
  };
}

function scheduleExecutionPrompt(prompt: string, triggeredAt: string): string {
  return [
    '这是 OpenCreator 已经触发的一次计划任务执行。',
    '',
    '执行规则：',
    '1. 立即完成本次任务，不要重新创建或修改计划任务。',
    '2. 只输出本次执行结果。',
    '',
    '任务名称：可搜索任务',
    `本次触发时间：${triggeredAt}`,
    '任务内容：',
    prompt
  ].join('\n');
}

async function authGet(url: string) {
  return server!.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer secret' }
  });
}

function scheduleRunInput(input: {
  id: string;
  threadId?: string;
  codexThreadId: string;
  sourceId: string;
  publicPrompt?: string;
  triggeredAt?: string;
  cwd: string;
  codexHome: string;
}) {
  return {
    publicStatus: 'succeeded',
    internalStatus: 'succeeded',
    createdBy: 'schedule',
    profile: 'default',
    canonicalCwd: input.cwd,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    normalizerVersion: 1,
    ...input
  };
}
