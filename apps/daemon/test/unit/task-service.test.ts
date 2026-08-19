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
        pendingApproval: {
          id: expect.any(String),
          runId: 'run_pending',
          threadId: 'thread_1',
          status: 'pending'
        }
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

  it('uses the schedule name and persisted final assistant message for scheduled runs', () => {
    const fixture = setup();
    fixture.db.prepare(`
      INSERT INTO schedules (
        id, thread_id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
        profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
      ) VALUES (
        'sch_reminder', 'thread_1', '起来活动提醒', '*/5 8-17 * * *', 'Asia/Shanghai', 1,
        '提醒我起来活动', 'hash', '提醒我起来活动',
        'default', @cwd, @cwd, 'read-only', 'skip', 'skip'
      )
    `).run({ cwd: tempDir });
    fixture.runs.insertRun({
      id: 'run_reminder',
      threadId: 'thread_1',
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
    insertAssistantMessage(
      fixture.runs,
      'run_reminder',
      1,
      '旧结果不应进入通知。'
    );
    insertAssistantMessage(
      fixture.runs,
      'run_reminder',
      2,
      `已完成今日活动提醒。 API_TOKEN=private clwcap_sensitive ${'后续内容'.repeat(40)}`
    );
    fixture.runs.insertRunEvent({
      id: 'event_diagnostic',
      runId: 'run_reminder',
      seq: 3,
      ts: '2026-07-14T10:00:03.000Z',
      type: 'diagnostic',
      payload: {
        type: 'diagnostic',
        code: 'INTERNAL_PROMPT',
        severity: 'warning',
        message: '这是 OpenCreator 已经触发的一次计划任务执行。',
        details: { token: 'clwcap_diagnostic' }
      },
      normalizerVersion: 1
    });

    const task = fixture.service.list().tasks[0];
    expect(task).toMatchObject({
      id: 'run_reminder',
      title: '起来活动提醒',
      createdBy: 'schedule',
      resultSummary: expect.stringContaining('已完成今日活动提醒。')
    });
    expect(task?.resultSummary).toHaveLength(120);
    expect(task?.resultSummary).toContain('API_TOKEN=[REDACTED]');
    expect(task?.resultSummary).toContain('[REDACTED]');
    expect(task?.resultSummary).not.toContain('private');
    expect(task?.resultSummary).not.toContain('clwcap_sensitive');
    expect(task?.resultSummary).not.toContain('OpenCreator 已经触发');
  });

  it('omits result summaries when no final assistant message was persisted', () => {
    const fixture = setup();
    insertRun(fixture.runs, 'run_failed', 'failed');

    expect(fixture.service.list().tasks[0]).not.toHaveProperty('resultSummary');
  });

  it('classifies consecutive project directory failures without disabling the schedule', () => {
    const fixture = setup();
    fixture.db.prepare(`
      INSERT INTO schedules (
        id, thread_id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
        profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
      ) VALUES (
        'sch_missing_project', 'thread_1', '目录检查', '0 9 * * *', 'Asia/Shanghai', 1,
        '检查项目状态', 'hash', '检查项目状态',
        'default', '/missing/project', '/missing/project', 'read-only', 'skip', 'skip'
      )
    `).run();

    insertScheduledFailure(
      fixture.runs,
      'run_directory_1',
      'sch_missing_project',
      '2026-07-14T10:00:00.000Z'
    );
    insertScheduledFailure(
      fixture.runs,
      'run_directory_2',
      'sch_missing_project',
      '2026-07-14T10:01:00.000Z'
    );
    insertScheduledFailure(
      fixture.runs,
      'run_directory_3',
      'sch_missing_project',
      '2026-07-14T10:02:00.000Z'
    );

    expect(fixture.service.list().tasks[0]).toMatchObject({
      id: 'run_directory_3',
      scheduleId: 'sch_missing_project',
      failureKind: 'project_directory',
      failureSummary: '项目目录不存在或无法访问，请编辑项目后重试。',
      consecutiveFailureCount: 3,
      suggestPause: true
    });
    expect(
      fixture.db.prepare(`SELECT enabled FROM schedules WHERE id = 'sch_missing_project'`).get()
    ).toEqual({ enabled: 1 });
  });

  it('rejects malformed cursors', () => {
    const fixture = setup();
    expect(() => fixture.service.list({ cursor: 'not-a-cursor' }))
      .toThrow(TaskCursorError);
  });
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-task-service-'));
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

function insertAssistantMessage(
  runs: ReturnType<typeof createRunRepository>,
  runId: string,
  seq: number,
  text: string
) {
  runs.insertRunEvent({
    id: `event_assistant_${seq}`,
    runId,
    seq,
    ts: `2026-07-14T10:00:0${seq}.000Z`,
    type: 'assistant_message',
    payload: {
      type: 'assistant_message',
      text,
      format: 'plain_text',
      delivery: 'message'
    },
    normalizerVersion: 1
  });
}

function insertScheduledFailure(
  runs: ReturnType<typeof createRunRepository>,
  id: string,
  sourceId: string,
  createdAt: string
) {
  runs.insertRun({
    id,
    threadId: 'thread_1',
    publicStatus: 'failed',
    internalStatus: 'failed',
    createdBy: 'schedule',
    sourceId,
    profile: 'default',
    cwd: '/missing/project',
    canonicalCwd: '/missing/project',
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: tempDir,
    normalizerVersion: 1
  });
  runs.updateRunStatus({
    id,
    publicStatus: 'failed',
    internalStatus: 'failed',
    terminationReason: 'spawn_failed',
    errorCode: 'SPAWN_FAILED',
    errorMessage: 'spawn codex ENOENT: no such file or directory, chdir /missing/project',
    endedAt: createdAt
  });
  db?.prepare(`
    UPDATE runs
    SET created_at = @createdAt,
        updated_at = @createdAt
    WHERE id = @id
  `).run({ id, createdAt });
}
