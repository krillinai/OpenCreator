import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApprovalManager } from '../../src/approvals/manager.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import {
  createRunRepository,
  createThreadRepository
} from '../../src/storage/repositories.js';
import {
  createTaskService,
  TaskCursorError
} from '../../src/tasks/service.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('task service', () => {
  it('paginates runs with stable cursors and aggregates pending approvals', () => {
    const fixture = setup();
    insertRun(fixture.runs, 'run_old', 'succeeded');
    insertRun(fixture.runs, 'run_pending', 'running');
    fixture.db.prepare(`
      UPDATE runs
      SET created_at = CASE id
        WHEN 'run_pending' THEN '2026-07-12T10:01:00.000Z'
        ELSE '2026-07-12T10:00:00.000Z'
      END
    `).run();
    fixture.approvals.request({
      runId: 'run_pending',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'request_1',
      kind: 'command_execution',
      risk: 'high',
      title: '允许执行命令',
      summary: 'rm -rf build',
      details: { command: 'rm -rf build' }
    });

    const first = fixture.service.list({ limit: 1 });
    const second = fixture.service.list({ limit: 1, cursor: first.nextCursor });

    expect(first).toMatchObject({
      hasMore: true,
      tasks: [{
        id: 'run_pending',
        title: '任务线程',
        status: 'waiting_approval',
        pendingApproval: { status: 'pending' }
      }]
    });
    expect(second).toMatchObject({
      hasMore: false,
      tasks: [{ id: 'run_old', status: 'succeeded' }]
    });
  });

  it('filters active, terminal, and waiting approval tasks', () => {
    const fixture = setup();
    insertRun(fixture.runs, 'run_running', 'running');
    insertRun(fixture.runs, 'run_failed', 'failed');
    fixture.approvals.request({
      runId: 'run_running',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'request_1',
      kind: 'file_change',
      risk: 'medium',
      title: '允许修改文件',
      summary: '/workspace/a.ts',
      details: { grantRoot: '/workspace' }
    });

    expect(fixture.service.list({ status: 'active' }).tasks.map(item => item.id))
      .toEqual(['run_running']);
    expect(fixture.service.list({ status: 'terminal' }).tasks.map(item => item.id))
      .toEqual(['run_failed']);
    expect(fixture.service.list({ status: 'waiting_approval' }).tasks.map(item => item.id))
      .toEqual(['run_running']);
    expect(fixture.service.list({ status: 'running' }).tasks).toEqual([]);
  });

  it('uses the schedule name for scheduled runs without a conversation thread', () => {
    const fixture = setup();
    fixture.db.prepare(`
      INSERT INTO schedules (
        id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
        profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
      ) VALUES (
        'sch_reminder', '起来活动提醒', '*/5 8-17 * * *', 'Asia/Shanghai', 1,
        '提醒我起来活动', 'hash', '提醒我起来活动',
        'default', @cwd, @cwd, 'read-only', 'skip', 'skip'
      )
    `).run({ cwd: tempDir });
    fixture.runs.insertRun({
      id: 'run_reminder',
      publicStatus: 'succeeded',
      internalStatus: 'succeeded',
      createdBy: 'schedule',
      sourceId: 'sch_reminder',
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

    expect(fixture.service.list().tasks[0]).toMatchObject({
      id: 'run_reminder',
      title: '起来活动提醒',
      createdBy: 'schedule'
    });
  });

  it('rejects malformed cursors', () => {
    const fixture = setup();
    expect(() => fixture.service.list({ cursor: 'not-a-cursor' }))
      .toThrow(TaskCursorError);
  });
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-task-service-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const threads = createThreadRepository(db);
  threads.insertThread({
    id: 'thread_1',
    title: '任务线程',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    status: 'active'
  });
  const runs = createRunRepository(db);
  const approvals = createApprovalManager({ db });
  const service = createTaskService({
    db,
    approvals,
    runs: {
      getRun(id) {
        const row = runs.getRun(id);
        return row === undefined
          ? undefined
          : {
              id: row.id,
              threadId: row.thread_id ?? undefined,
              status: row.public_status as 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled',
              submissionMode: row.submission_mode,
              cwd: row.cwd,
              profile: row.profile,
              sandbox: row.sandbox,
              createdBy: row.created_by,
              timeoutMs: row.timeout_ms,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
              exitCode: row.exit_code,
              signal: row.signal
            };
      }
    }
  });
  return { db, runs, approvals, service };
}

function insertRun(
  runs: ReturnType<typeof createRunRepository>,
  id: string,
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
) {
  runs.insertRun({
    id,
    threadId: 'thread_1',
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
