import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApprovalManager } from '../../src/approvals/manager.js';
import { buildServer } from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import {
  createRunRepository,
  createThreadRepository
} from '../../src/storage/repositories.js';

let tempDir = '';
let db: Database.Database | undefined;
let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('task API', () => {
  it('paginates and filters global tasks without scanning thread histories', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-task-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const approvals = createApprovalManager({ db });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db,
      approvalManager: approvals
    });
    createThreadRepository(db).insertThread({
      id: 'thread_task',
      title: '任务中心测试',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active'
    });
    const runs = createRunRepository(db);
    insertRun(runs, 'run_done', 'succeeded');
    insertRun(runs, 'run_pending', 'running');
    db.prepare(`
      UPDATE runs
      SET created_at = CASE id
        WHEN 'run_pending' THEN '2026-07-12T11:01:00.000Z'
        ELSE '2026-07-12T11:00:00.000Z'
      END
    `).run();
    approvals.request({
      runId: 'run_pending',
      threadId: 'thread_task',
      turnId: 'turn_task',
      itemId: 'item_task',
      requestId: 'rpc_task',
      kind: 'command_execution',
      risk: 'high',
      title: '允许执行命令',
      summary: 'rm -rf build',
      details: { command: 'rm -rf build' }
    });

    const first = await server.inject({
      method: 'GET',
      url: '/tasks?status=all&limit=1',
      headers: { authorization: 'Bearer secret' }
    });
    const firstPayload = first.json();
    const second = await server.inject({
      method: 'GET',
      url: `/tasks?status=all&limit=1&cursor=${encodeURIComponent(firstPayload.nextCursor)}`,
      headers: { authorization: 'Bearer secret' }
    });
    const approvalsOnly = await server.inject({
      method: 'GET',
      url: '/tasks?status=waiting_approval',
      headers: { authorization: 'Bearer secret' }
    });

    expect(first.statusCode).toBe(200);
    expect(firstPayload).toMatchObject({
      hasMore: true,
      tasks: [{
        id: 'run_pending',
        title: '任务中心测试',
        status: 'waiting_approval'
      }]
    });
    expect(second.json()).toMatchObject({
      hasMore: false,
      tasks: [{ id: 'run_done', status: 'succeeded' }]
    });
    expect(approvalsOnly.json()).toMatchObject({
      tasks: [{ id: 'run_pending', pendingApproval: { status: 'pending' } }]
    });
  });

  it('rejects invalid status, limits, and cursors', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-task-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db
    });

    for (const url of [
      '/tasks?status=unknown',
      '/tasks?limit=0',
      '/tasks?cursor=invalid'
    ]) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer secret' }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED' }
      });
    }
  });
});

function insertRun(
  runs: ReturnType<typeof createRunRepository>,
  id: string,
  status: 'running' | 'succeeded'
) {
  runs.insertRun({
    id,
    threadId: 'thread_task',
    publicStatus: status,
    internalStatus: status,
    createdBy: 'api',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: tempDir,
    normalizerVersion: 1
  });
}
