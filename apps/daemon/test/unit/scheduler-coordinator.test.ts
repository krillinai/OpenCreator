import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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
        status: 'succeeded'
      })
    ]);
  });

  it('does not leave a schedule when task thread creation fails', () => {
    const threadManager = {
      createThread: vi.fn(() => {
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
});

function createFixture(options: {
  threadManager?: ThreadManager;
  onSchedulesChanged?(database: Database.Database): void;
} = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-schedule-coordinator-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const repository = new ScheduleRepository(db, {
    idFactory: () => 'sch_one',
    operationIdFactory: () => 'schop_one',
    now: () => '2026-07-14T00:00:00.000Z'
  });
  const threadManager = options.threadManager ?? createThreadManager({ db, dataDir: tempDir });
  const coordinator = createScheduleCoordinator({
    db,
    repository,
    threadManager,
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
