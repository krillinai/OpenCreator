import type Database from 'better-sqlite3';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';
let db: Database.Database | undefined;

function openTestDatabase(root: string): Database.Database {
  db = openRuntimeDatabase(join(root, 'app.sqlite'));
  return db;
}

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('thread manager', () => {
  it('creates a managed thread with fixed workspace', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const thread = manager.createThread({
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only'
    });
    expect(thread.workspaceMode).toBe('managed');
    expect(thread.purpose).toBe('conversation');
    expect(thread.id).toMatch(/^thread_/);
    expect(thread.cwd).toContain(join('workspaces', thread.id));
  });

  it('persists managed and external threads', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });

    const managed = manager.createThread({
      title: 'Managed',
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only'
    });
    expect(managed.cwd).toContain(join('workspaces', managed.id));
    expect(manager.getThread(managed.id)).toMatchObject({ id: managed.id, title: 'Managed' });

    const external = manager.createThread({
      title: 'External',
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    });
    expect(external.cwd).toBe(tempDir);
    expect(external.canonicalCwd).toBe(realpathSync(tempDir));

    db?.close();
    db = undefined;
    const reopenedDatabase = openTestDatabase(tempDir);
    const reopenedManager = createThreadManager({ db: reopenedDatabase, dataDir: tempDir });
    expect(reopenedManager.getThread(managed.id)).toMatchObject({
      id: managed.id,
      title: 'Managed'
    });
    expect(reopenedManager.getThread(external.id)).toMatchObject({
      id: external.id,
      title: 'External',
      cwd: tempDir
    });
  });

  it('creates schedule drafts and schedule tasks only through explicit internal purposes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });

    const draft = manager.createThread({
      title: 'Draft',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_draft'
    });
    const task = manager.createThread({
      title: 'Task',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_task'
    });

    expect(draft.purpose).toBe('schedule_draft');
    expect(task.purpose).toBe('schedule_task');
  });

  it('returns the active schedule binding with task thread queries', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const task = manager.createThread({
      title: 'Task',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_task'
    });
    insertScheduleBinding(database, 'sch_one', task.id, tempDir);

    expect(manager.getThread(task.id)?.scheduleId).toBe('sch_one');
    expect(manager.listThreads().find(thread => thread.id === task.id)?.scheduleId).toBe('sch_one');
  });

  it('filters bounded thread summaries by included or excluded purpose', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const conversation = manager.createThread({
      title: 'Conversation',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'conversation'
    });
    const draft = manager.createThread({
      title: 'Draft',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_draft'
    });
    const task = manager.createThread({
      title: 'Task',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_task'
    });

    expect(manager.listThreads({
      status: 'active',
      purpose: 'schedule_task',
      limit: 100
    }).map(thread => thread.id)).toEqual([task.id]);
    expect(manager.listThreads({
      status: 'active',
      excludePurpose: 'schedule_task',
      limit: 50
    }).map(thread => thread.id)).toEqual(
      expect.arrayContaining([conversation.id, draft.id])
    );
    expect(manager.listThreads({
      status: 'active',
      excludePurpose: 'schedule_task',
      limit: 50
    }).map(thread => thread.id)).not.toContain(task.id);
  });

  it('uses explicit internal methods to manage schedule task configuration and lifecycle', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const draft = manager.createThread({
      title: 'Draft',
      workspaceMode: 'external',
      cwd: tempDir,
      purpose: 'schedule_draft'
    });

    expect(manager.setPurpose(draft.id, 'schedule_task').purpose).toBe('schedule_task');
    expect(() => manager.updateThread(draft.id, { sandbox: 'danger-full-access' }))
      .toThrow(/THREAD_MANAGED_BY_SCHEDULE/);

    const nextCwd = join(tempDir, 'next-project');
    const updated = manager.updateScheduleThread(draft.id, {
      title: 'Daily report',
      cwd: nextCwd,
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'workspace-write'
    });

    expect(updated).toMatchObject({
      title: 'Daily report',
      cwd: nextCwd,
      canonicalCwd: realpathSync(nextCwd),
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'workspace-write',
      purpose: 'schedule_task'
    });
    expect(() => manager.archiveThread(draft.id)).toThrow(/THREAD_MANAGED_BY_SCHEDULE/);
    expect(manager.archiveScheduleThread(draft.id).status).toBe('archived');
  });

  it('expands home-relative cwd for external threads', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const testHome = join(tempDir, 'home');
    const manager = createThreadManager({ db: database, dataDir: tempDir, homeDir: testHome });

    const thread = manager.createThread({
      title: 'Playground',
      workspaceMode: 'external',
      cwd: '~/develop/clawee/playground',
      profile: 'default',
      sandbox: 'read-only'
    });

    expect(thread.cwd).toBe(join(testHome, 'develop/clawee/playground'));
    expect(thread.canonicalCwd).toBe(realpathSync(thread.cwd));
  });

  it('archives active threads and rejects missing threads', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const thread = manager.createThread({ workspaceMode: 'managed' });

    expect(manager.archiveThread(thread.id).status).toBe('archived');
    expect(() => manager.archiveThread('thread_missing')).toThrow(/THREAD_NOT_FOUND/);
  });

  it('imports Codex sessions with timestamps that sort correctly with runtime threads', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    manager.importCodexThread({
      codexThreadId: 'codex-old',
      title: 'Old Codex',
      cwd: tempDir,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z'
    });

    const runtime = manager.createThread({ title: 'Runtime', workspaceMode: 'external', cwd: tempDir });

    expect(manager.listThreads({ limit: 1 })[0]?.id).toBe(runtime.id);
  });

  it('refreshes imported Codex sessions when the source JSONL changes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const imported = manager.importCodexThread({
      codexThreadId: 'codex-existing',
      title: '旧标题',
      cwd: tempDir,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z'
    });

    const refreshed = manager.importCodexThread({
      codexThreadId: 'codex-existing',
      title: '新标题',
      cwd: tempDir,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T01:00:00.000Z'
    });

    expect(refreshed.id).toBe(imported.id);
    expect(refreshed.title).toBe('新标题');
    expect(refreshed.updatedAt).toBe('2026-07-07 01:00:00');
  });
});

function insertScheduleBinding(
  database: Database.Database,
  scheduleId: string,
  threadId: string,
  cwd: string
): void {
  database.prepare(`
    INSERT INTO schedules (
      id, thread_id, name, cron, timezone, prompt, prompt_hash, prompt_preview_redacted,
      profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scheduleId,
    threadId,
    'Daily report',
    '0 9 * * *',
    'Asia/Shanghai',
    'Summarize project status',
    'hash',
    'Summarize project status',
    'default',
    cwd,
    cwd,
    'workspace-write',
    'queue',
    'skip'
  );
}
