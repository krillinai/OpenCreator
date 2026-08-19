import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScheduleCoordinator } from '../../src/scheduler/coordinator.js';
import { ScheduleRepository } from '../../src/scheduler/repository.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadManager } from '../../src/threads/manager.js';
import type { ThreadManager } from '../../src/threads/types.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('schedule coordinator', () => {
  it('atomically binds an agent-created schedule to the current draft thread', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const draft = threadManager.createThread({
      purpose: 'schedule_draft',
      title: '任务草稿',
      cwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'read-only'
    });

    const schedule = coordinator.createFromAgent({
      ...scheduleRequest(),
      cwd: join(tempDir, 'forged-cwd'),
      profile: 'forged-profile',
      model: 'forged-model',
      reasoning: 'low',
      sandbox: 'danger-full-access'
    }, {
      runId: 'run-agent-create',
      threadId: draft.id,
      createdBy: 'api'
    });

    expect(schedule).toMatchObject({
      id: 'sch_one',
      threadId: draft.id,
      cwd: draft.cwd,
      canonicalCwd: draft.canonicalCwd,
      profile: draft.profile,
      model: draft.model,
      reasoning: draft.reasoning,
      sandbox: draft.sandbox
    });
    expect(threadManager.getThread(draft.id)).toMatchObject({
      id: draft.id,
      scheduleId: schedule.id,
      purpose: 'schedule_task',
      title: schedule.name,
      cwd: draft.cwd,
      profile: draft.profile,
      model: draft.model,
      reasoning: draft.reasoning,
      sandbox: draft.sandbox
    });
    expect(repository.listOperations(schedule.id)[0]).toMatchObject({
      operation: 'create',
      status: 'succeeded',
      runId: null,
      actorType: 'agent',
      actorRunId: 'run-agent-create'
    });
  });

  it('creates a new task thread for an agent request from a conversation', () => {
    const { coordinator, threadManager } = createFixture();
    const conversation = threadManager.createThread({
      purpose: 'conversation',
      title: '普通对话',
      cwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      model: 'gpt-5',
      reasoning: 'medium',
      sandbox: 'workspace-write'
    });

    const schedule = coordinator.createFromAgent(scheduleRequest(), {
      runId: 'run-agent-create',
      threadId: conversation.id,
      createdBy: 'api'
    });

    expect(schedule.threadId).not.toBe(conversation.id);
    expect(threadManager.getThread(conversation.id)?.purpose).toBe('conversation');
    expect(threadManager.getThread(schedule.threadId)).toMatchObject({
      purpose: 'schedule_task',
      title: schedule.name,
      cwd: conversation.cwd,
      canonicalCwd: conversation.canonicalCwd,
      profile: conversation.profile,
      model: conversation.model,
      reasoning: conversation.reasoning,
      sandbox: conversation.sandbox
    });
  });

  it('rolls back an agent draft binding when thread synchronization fails', () => {
    const { coordinator, threadManager } = createFixture();
    const draft = threadManager.createThread({
      purpose: 'schedule_draft',
      cwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write'
    });
    vi.spyOn(threadManager, 'updateScheduleThread').mockImplementationOnce(() => {
      throw new Error('thread synchronization failed');
    });

    expect(() => coordinator.createFromAgent(scheduleRequest(), {
      runId: 'run-agent-create',
      threadId: draft.id,
      createdBy: 'api'
    })).toThrow('thread synchronization failed');
    expect(threadManager.getThread(draft.id)).toMatchObject({
      purpose: 'schedule_draft'
    });
    expect(threadManager.getThread(draft.id)).not.toHaveProperty('scheduleId');
    expect(countRows('schedules')).toBe(0);
    expect(countRows('schedule_operations')).toBe(0);
  });

  it('atomically creates a bound schedule and dedicated task thread with matching configuration', () => {
    const { coordinator, repository, threadManager } = createFixture();

    const schedule = coordinator.createManual({
      name: 'Daily report',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'Summarize project status',
      cwd: tempDir,
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'workspace-write',
      concurrencyPolicy: 'queue'
    });

    expect(schedule).toMatchObject({
      id: 'sch_one',
      threadId: expect.stringMatching(/^thread_/),
      name: 'Daily report',
      cwd: tempDir,
      canonicalCwd: realpathSync(tempDir),
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'workspace-write'
    });
    expect(repository.getById(schedule.id)?.threadId).toBe(schedule.threadId);
    expect(threadManager.getThread(schedule.threadId)).toMatchObject({
      id: schedule.threadId,
      scheduleId: schedule.id,
      title: 'Daily report',
      cwd: tempDir,
      canonicalCwd: realpathSync(tempDir),
      workspaceMode: 'external',
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'workspace-write',
      purpose: 'schedule_task'
    });
    expect(repository.listOperations(schedule.id)).toEqual([
      expect.objectContaining({
        scheduleId: schedule.id,
        operation: 'create',
        status: 'succeeded',
        actorType: 'user',
        actorRunId: null
      })
    ]);
  });

  it('does not leave a schedule when task thread creation fails', () => {
    const threadManager = {
      createScheduleThread: vi.fn(() => {
        throw new Error('thread write failed');
      })
    } as unknown as ThreadManager;
    const { coordinator } = createFixture({ threadManager });

    expect(() => coordinator.createManual(scheduleRequest())).toThrow('thread write failed');
    expect(countRows('schedules')).toBe(0);
    expect(countRows('threads')).toBe(0);
    expect(countRows('schedule_operations')).toBe(0);
  });

  it('rolls back the task thread when schedule persistence fails', () => {
    const { coordinator } = createFixture();
    db?.exec(`
      CREATE TRIGGER fail_schedule_insert
      BEFORE INSERT ON schedules
      BEGIN
        SELECT RAISE(ABORT, 'schedule write failed');
      END;
    `);

    expect(() => coordinator.createManual(scheduleRequest())).toThrow('schedule write failed');
    expect(countRows('schedules')).toBe(0);
    expect(countRows('threads')).toBe(0);
    expect(countRows('schedule_operations')).toBe(0);
  });

  it('notifies the scheduler only after the transaction commits', () => {
    const onSchedulesChanged = vi.fn((database: Database.Database) => {
      expect(database.inTransaction).toBe(false);
      expect(countRows('schedules')).toBe(1);
      expect(countRows('threads')).toBe(1);
      expect(countRows('schedule_operations')).toBe(1);
    });
    const { coordinator } = createFixture({ onSchedulesChanged });

    const schedule = coordinator.createManual(scheduleRequest());

    expect(schedule.threadId).toMatch(/^thread_/);
    expect(onSchedulesChanged).toHaveBeenCalledOnce();
  });

  it('atomically updates schedule execution configuration and its task thread', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const created = coordinator.createManual(scheduleRequest());
    const nextCwd = join(tempDir, 'next-project');
    mkdirSync(nextCwd);

    const updated = coordinator.update(created.id, {
      name: 'Weekly report',
      cwd: nextCwd,
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'danger-full-access'
    });

    expect(updated).toMatchObject({
      name: 'Weekly report',
      cwd: nextCwd,
      canonicalCwd: realpathSync(nextCwd),
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'danger-full-access'
    });
    expect(repository.getById(created.id)).toMatchObject(updated);
    expect(threadManager.getThread(created.threadId)).toMatchObject({
      title: 'Weekly report',
      cwd: nextCwd,
      canonicalCwd: realpathSync(nextCwd),
      profile: 'review',
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'danger-full-access',
      purpose: 'schedule_task'
    });
  });

  it('pauses and resumes without archiving or replacing the task thread', () => {
    const { coordinator, threadManager } = createFixture();
    const created = coordinator.createManual(scheduleRequest());

    const paused = coordinator.update(created.id, { enabled: false });
    const resumed = coordinator.update(created.id, { enabled: true });

    expect(paused).toMatchObject({
      threadId: created.threadId,
      enabled: false,
      nextRunAt: null
    });
    expect(resumed.threadId).toBe(created.threadId);
    expect(resumed.enabled).toBe(true);
    expect(resumed.nextRunAt).not.toBeNull();
    expect(threadManager.getThread(created.threadId)).toMatchObject({
      id: created.threadId,
      status: 'active',
      purpose: 'schedule_task'
    });
  });

  it('rolls back schedule changes when task thread synchronization fails', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const created = coordinator.createManual(scheduleRequest());
    vi.spyOn(threadManager, 'updateScheduleThread').mockImplementationOnce(() => {
      throw new Error('thread update failed');
    });

    expect(() => coordinator.update(created.id, { name: 'Changed title' }))
      .toThrow('thread update failed');
    expect(repository.getById(created.id)?.name).toBe('Daily report');
    expect(threadManager.getThread(created.threadId)?.title).toBe('Daily report');
  });

  it('leaves the task thread unchanged when schedule persistence fails', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const created = coordinator.createManual(scheduleRequest());
    db?.exec(`
      CREATE TRIGGER fail_schedule_update
      BEFORE UPDATE ON schedules
      WHEN NEW.name = 'Changed title'
      BEGIN
        SELECT RAISE(ABORT, 'schedule update failed');
      END;
    `);

    expect(() => coordinator.update(created.id, { name: 'Changed title' }))
      .toThrow('schedule update failed');
    expect(repository.getById(created.id)?.name).toBe('Daily report');
    expect(threadManager.getThread(created.threadId)?.title).toBe('Daily report');
  });

  it('allows metadata changes but blocks execution configuration and deletion during active runs', () => {
    const hasActiveRunForThread = vi.fn(() => true);
    const { coordinator } = createFixture({ hasActiveRunForThread });
    const created = coordinator.createManual(scheduleRequest());

    expect(coordinator.update(created.id, {
      name: 'Renamed report',
      prompt: 'Use the new instructions',
      enabled: false
    })).toMatchObject({
      name: 'Renamed report',
      enabled: false
    });
    expect(() => coordinator.update(created.id, { sandbox: 'danger-full-access' })).toThrow(
      expect.objectContaining({ code: 'SCHEDULE_HAS_ACTIVE_RUN' })
    );
    expect(() => coordinator.delete(created.id)).toThrow(
      expect.objectContaining({ code: 'SCHEDULE_HAS_ACTIVE_RUN' })
    );
    expect(hasActiveRunForThread).toHaveBeenCalledWith(created.threadId);
  });

  it('records the actor run for agent updates and preserves active-run conflict protection', () => {
    let active = false;
    const { coordinator, repository, threadManager } = createFixture({
      hasActiveRunForThread: () => active
    });
    const created = coordinator.createManual(scheduleRequest());

    const updated = coordinator.updateFromAgent(created.id, {
      name: 'Agent renamed report'
    }, {
      runId: 'run-agent-update',
      threadId: created.threadId,
      createdBy: 'api'
    });

    expect(updated.name).toBe('Agent renamed report');
    expect(repository.listOperations(created.id)[0]).toMatchObject({
      operation: 'update',
      runId: null,
      actorType: 'agent',
      actorRunId: 'run-agent-update'
    });

    active = true;
    expect(() => coordinator.updateFromAgent(created.id, {
      sandbox: 'danger-full-access'
    }, {
      runId: 'run-agent-update-active',
      threadId: created.threadId,
      createdBy: 'api'
    })).toThrow(expect.objectContaining({ code: 'SCHEDULE_HAS_ACTIVE_RUN' }));
    expect(threadManager.getThread(created.threadId)?.sandbox).toBe('workspace-write');
    expect(repository.listOperations(created.id)).toHaveLength(2);
  });

  it('soft deletes the schedule and archives its task thread while preserving the binding', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const created = coordinator.createManual(scheduleRequest());

    coordinator.delete(created.id);

    const deleted = db?.prepare(`
      SELECT thread_id, enabled, next_run_at, deleted_at
      FROM schedules
      WHERE id = ?
    `).get(created.id) as {
      thread_id: string;
      enabled: number;
      next_run_at: string | null;
      deleted_at: string | null;
    };
    expect(repository.getById(created.id)).toBeNull();
    expect(deleted).toMatchObject({
      thread_id: created.threadId,
      enabled: 0,
      next_run_at: null,
      deleted_at: expect.any(String)
    });
    expect(threadManager.getThread(created.threadId)).toMatchObject({
      id: created.threadId,
      status: 'archived',
      purpose: 'schedule_task'
    });
    expect(repository.listOperations(created.id)[0]).toMatchObject({
      operation: 'delete',
      status: 'succeeded',
      actorType: 'user',
      actorRunId: null
    });
  });

  it('returns a stable error when the bound task thread is missing', () => {
    const { coordinator } = createFixture();
    const missing = coordinator.createManual(scheduleRequest());
    db?.prepare('DELETE FROM threads WHERE id = ?').run(missing.threadId);

    expect(() => coordinator.update(missing.id, { name: 'Missing thread' })).toThrow(
      expect.objectContaining({ code: 'SCHEDULE_THREAD_MISSING' })
    );
  });

  it('returns a stable error when the bound task thread is unexpectedly archived', () => {
    const { coordinator, threadManager } = createFixture();
    const archived = coordinator.createManual(scheduleRequest());
    threadManager.archiveScheduleThread(archived.threadId);

    expect(() => coordinator.update(archived.id, { name: 'Archived thread' })).toThrow(
      expect.objectContaining({ code: 'SCHEDULE_THREAD_ARCHIVED' })
    );
  });
});

function createFixture(options: {
  threadManager?: ThreadManager;
  hasActiveRunForThread?(threadId: string): boolean;
  onSchedulesChanged?(database: Database.Database): void;
} = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-coordinator-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  let operationId = 0;
  const repository = new ScheduleRepository(db, {
    idFactory: () => 'sch_one',
    operationIdFactory: () => `schop_${operationId++}`,
    now: () => '2026-07-14T00:00:00.000Z'
  });
  const threadManager = options.threadManager ?? createThreadManager({ db, dataDir: tempDir });
  const coordinator = createScheduleCoordinator({
    db,
    repository,
    threadManager,
    runManager: {
      hasActiveRunForThread: options.hasActiveRunForThread ?? (() => false)
    },
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date('2026-07-14T00:00:00.000Z') },
    onSchedulesChanged: () => options.onSchedulesChanged?.(db!)
  });
  return { coordinator, repository, threadManager };
}

function scheduleRequest() {
  return {
    name: 'Daily report',
    cron: '0 9 * * *',
    timezone: 'UTC',
    prompt: 'Summarize project status',
    cwd: tempDir
  };
}

function countRows(table: 'schedules' | 'threads' | 'schedule_operations'): number {
  const row = db?.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}
