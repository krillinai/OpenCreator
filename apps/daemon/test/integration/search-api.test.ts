import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';

let server: FastifyInstance | undefined;
let tempDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('conversation search api', () => {
  it('syncs sessions, searches with filters and pagination, then opens a target history window', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-search-api-'));
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

  it('rejects invalid search and target history query parameters', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-search-api-'));
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

async function authGet(url: string) {
  return server!.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer secret' }
  });
}
