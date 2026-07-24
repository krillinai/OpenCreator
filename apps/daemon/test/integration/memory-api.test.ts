import type { RunManager } from '../../src/runs/manager.js';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe('memory API', () => {
  it('supports explicit memory CRUD, disable-all, and run context inspection', async () => {
    db = openRuntimeDatabase(':memory:');
    const runInputs: Array<Record<string, unknown>> = [];
    const server = await buildServer({
      token: 'test-token',
      db,
      dataDir: '.runtime-test-memory-api',
      runManager: createRunManager(runInputs)
    });

    const created = await server.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeaders(),
      payload: {
        content: '项目使用 pnpm',
        scope: 'project',
        scopeKey: process.cwd(),
        source: 'user'
      }
    });
    expect(created.statusCode).toBe(201);
    const memoryId = created.json().memory.id as string;

    const listed = await server.inject({
      method: 'GET',
      url: '/memories?query=pnpm&scope=project',
      headers: authHeaders()
    });
    expect(listed.json().memories).toHaveLength(1);

    const updated = await server.inject({
      method: 'PATCH',
      url: `/memories/${memoryId}`,
      headers: authHeaders(),
      payload: { enabled: false }
    });
    expect(updated.json().memory.enabled).toBe(false);

    const disabled = await server.inject({
      method: 'POST',
      url: '/memories/disable-all',
      headers: authHeaders()
    });
    expect(disabled.json()).toEqual({ disabledCount: 0 });

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/memories/${memoryId}`,
      headers: authHeaders()
    });
    expect(deleted.json()).toEqual({ deleted: true });
    await server.close();
  });

  it('injects matching memories into execution without replacing the original run prompt', async () => {
    db = openRuntimeDatabase(':memory:');
    const runInputs: Array<Record<string, unknown>> = [];
    const server = await buildServer({
      token: 'test-token',
      db,
      dataDir: '.runtime-test-memory-run',
      runManager: createRunManager(runInputs)
    });
    const projectResponse = await server.inject({
      method: 'POST',
      url: '/projects',
      headers: authHeaders(),
      payload: {
        cwd: process.cwd(),
        name: 'Memory project'
      }
    });
    expect(projectResponse.statusCode).toBe(201);
    const projectId = projectResponse.json().project.id as string;
    const threadResponse = await server.inject({
      method: 'POST',
      url: '/threads',
      headers: authHeaders(),
      payload: {
        projectId,
        sandbox: 'read-only'
      }
    });
    expect(threadResponse.statusCode).toBe(201);
    const thread = threadResponse.json().thread as {
      id: string;
      projectId: string;
    };
    await server.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeaders(),
      payload: {
        content: '提交前运行全部测试',
        scope: 'project',
        scopeKey: thread.projectId,
        source: 'user'
      }
    });

    const started = await server.inject({
      method: 'POST',
      url: '/runs',
      headers: authHeaders(),
      payload: {
        threadId: thread.id,
        prompt: '继续开发'
      }
    });

    expect(started.statusCode).toBe(202);
    expect(runInputs[0]).toMatchObject({
      prompt: '继续开发',
      executionPrompt: expect.stringContaining('提交前运行全部测试'),
      contextItems: [
        expect.objectContaining({ kind: 'memory', content: '提交前运行全部测试' })
      ]
    });
    await server.close();
  });

  it('generates thread summaries and rejects sensitive memory without confirmation', async () => {
    db = openRuntimeDatabase(':memory:');
    const server = await buildServer({
      token: 'test-token',
      db,
      dataDir: '.runtime-test-memory-summary',
      runManager: createRunManager([]),
      memoryHistoryReader: () => ({
        items: [
          {
            id: 'item_1',
            type: 'user_message',
            text: '记录项目发布要求。',
            createdAt: '2026-07-12T10:00:00.000Z'
          },
          {
            id: 'item_2',
            type: 'assistant_message',
            text: '发布前必须完成测试。',
            createdAt: '2026-07-12T10:01:00.000Z'
          }
        ]
      })
    });

    const sensitive = await server.inject({
      method: 'POST',
      url: '/memories',
      headers: authHeaders(),
      payload: {
        content: 'password=top-secret',
        scope: 'global',
        source: 'agent_suggestion'
      }
    });
    expect(sensitive.statusCode).toBe(409);
    expect(sensitive.json().error.code).toBe('MEMORY_SENSITIVE_CONFIRMATION_REQUIRED');

    const summary = await server.inject({
      method: 'POST',
      url: '/threads/thread_1/summaries',
      headers: authHeaders()
    });
    expect(summary.statusCode).toBe(201);
    expect(summary.json().summary).toMatchObject({
      threadId: 'thread_1',
      version: 1,
      coveredFromCursor: 'item_1',
      coveredToCursor: 'item_2'
    });

    const listed = await server.inject({
      method: 'GET',
      url: '/summaries?threadId=thread_1',
      headers: authHeaders()
    });
    expect(listed.json().summaries).toHaveLength(1);
    await server.close();
  });
});

function authHeaders() {
  return { authorization: 'Bearer test-token' };
}

function createRunManager(inputs: Array<Record<string, unknown>>): RunManager {
  return {
    startRun(input) {
      inputs.push(input);
      return {
        id: 'run_1',
        threadId: input.threadId,
        status: 'running',
        submissionMode: input.submissionMode ?? 'enqueue'
      };
    },
    async createAndRun(input) {
      return this.startRun(input);
    },
    cancelRun() {
      return false;
    },
    getRun() {
      return undefined;
    },
    hasActiveRunForThread() {
      return false;
    },
    hasActiveRunForProject() {
      return false;
    },
    listRuns() {
      return [];
    },
    listRunsByThread() {
      return [];
    },
    getLastEventSeq() {
      return 0;
    },
    listEvents() {
      return [];
    },
    subscribe() {
      return () => undefined;
    },
    async close() {
      return;
    }
  };
}
