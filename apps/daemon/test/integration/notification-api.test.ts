import type {
  NotificationAcknowledgeResponse,
  NotificationOutboxListResponse
} from '@opencreator/protocol';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import {
  createApprovalManager,
  type ApprovalManager
} from '../../src/approvals/manager.js';
import { createNotificationService } from '../../src/notifications/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository } from '../../src/storage/repositories.js';

let server: FastifyInstance | undefined;
let db: Database.Database | undefined;
let approvalManager: ApprovalManager | undefined;
let tempDir = '';
type TestInjectPayload = string | object;

afterEach(async () => {
  await server?.close();
  server = undefined;
  approvalManager?.cancelRun('run_approval', 'test_cleanup');
  approvalManager = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('notification outbox api', () => {
  it('persists scheduled terminal notifications until a host acknowledges them', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-notification-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      db
    });

    const created = await authPost('/schedules', {
      name: '项目日报 TOKEN=sk-title-secret',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: '生成项目日报',
      cwd: tempDir,
      sandbox: 'read-only'
    });
    expect(created.statusCode).toBe(201);
    const schedule = created.json<{ id: string; threadId: string }>();
    const runId = 'run_terminal';
    createRunRepository(db).insertRun({
      id: runId,
      threadId: schedule.threadId,
      publicStatus: 'succeeded',
      internalStatus: 'succeeded',
      createdBy: 'schedule',
      sourceId: schedule.id,
      publicPrompt: '生成项目日报',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      sandbox: 'read-only',
      codexVersion: 'test',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });
    db.prepare(`
      INSERT INTO run_events (id, run_id, seq, type, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'event_terminal_result',
      runId,
      1,
      'assistant_message',
      JSON.stringify({
        type: 'assistant_message',
        text: '日报已生成，API_KEY=sk-notification-secret'
      })
    );
    createNotificationService({ db }).enqueueRunTerminal(runId);

    const first = await authGet('/notifications?after=0&limit=10');
    expect(first.statusCode).toBe(200);
    const firstPage = first.json<NotificationOutboxListResponse>();
    expect(firstPage.notifications).toHaveLength(1);
    expect(firstPage.notifications[0]).toMatchObject({
      kind: 'schedule_succeeded',
      runId,
      threadId: schedule.threadId
    });
    expect(firstPage.notifications[0]?.title).not.toContain('sk-title-secret');
    expect(firstPage.notifications[0]?.body).toContain('日报已生成');
    expect(firstPage.notifications[0]?.body).not.toContain('sk-notification-secret');

    await server.close();
    server = undefined;
    db.close();
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      db
    });

    const afterRestart = await authGet('/notifications?after=0&limit=10');
    expect(afterRestart.json<NotificationOutboxListResponse>().notifications).toEqual(
      firstPage.notifications
    );

    const acknowledged = await authPost('/notifications/acknowledge', {
      ids: [firstPage.notifications[0]!.id]
    });
    expect(acknowledged.json<NotificationAcknowledgeResponse>()).toEqual({
      acknowledged: 1
    });
    expect(
      (await authGet('/notifications?after=0&limit=10'))
        .json<NotificationOutboxListResponse>()
        .notifications
    ).toEqual([]);
    expect(
      (await authPost('/notifications/acknowledge', {
        ids: [firstPage.notifications[0]!.id]
      })).json<NotificationAcknowledgeResponse>()
    ).toEqual({ acknowledged: 0 });
  });

  it('creates a redacted approval notification for a scheduled run', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-notification-approval-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    approvalManager = createApprovalManager({ db });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      db,
      approvalManager
    });

    const created = await authPost('/schedules', {
      name: '发布日报',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: '发布日报',
      cwd: tempDir,
      sandbox: 'workspace-write'
    });
    const schedule = created.json<{ id: string; threadId: string }>();
    createRunRepository(db).insertRun({
      id: 'run_approval',
      threadId: schedule.threadId,
      publicStatus: 'running',
      internalStatus: 'running',
      createdBy: 'schedule',
      sourceId: schedule.id,
      publicPrompt: '发布日报',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      sandbox: 'workspace-write',
      codexVersion: 'test',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const pending = approvalManager.request({
      runId: 'run_approval',
      threadId: schedule.threadId,
      turnId: 'turn_approval',
      itemId: 'item_approval',
      requestId: 'request_approval',
      kind: 'file_change',
      risk: 'medium',
      title: '允许修改文件',
      summary: '写入发布目录，token: sk-approval-secret',
      details: {}
    });

    const response = await authGet('/notifications?after=0&limit=10');
    expect(response.statusCode).toBe(200);
    const page = response.json<NotificationOutboxListResponse>();
    expect(page.notifications).toEqual([
      expect.objectContaining({
        kind: 'schedule_waiting_approval',
        title: '发布日报等待审批',
        body: expect.stringContaining('写入发布目录'),
        threadId: schedule.threadId,
        runId: 'run_approval',
        approvalId: pending.approval.id
      })
    ]);
    expect(page.notifications[0]?.body).not.toContain('sk-approval-secret');
  });
});

function authGet(url: string) {
  return server!.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer secret' }
  });
}

function authPost(url: string, payload: TestInjectPayload) {
  return server!.inject({
    method: 'POST',
    url,
    headers: { authorization: 'Bearer secret' },
    payload
  });
}
