import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createScheduleCoordinator } from '../../src/scheduler/coordinator.js';
import { ScheduleRepository } from '../../src/scheduler/repository.js';
import type { InsertScheduleInput } from '../../src/scheduler/types.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('schedule binding repair', () => {
  it('repairs missing bindings once and leaves valid bindings unchanged', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const validThread = threadManager.createThread({
      purpose: 'schedule_task',
      title: 'Already bound',
      cwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'workspace-write'
    });
    const unbound = repository.create(scheduleInput({ name: 'Unbound task' }));
    const missing = repository.create(scheduleInput({
      name: 'Missing thread task',
      threadId: 'thread_missing'
    }));
    const valid = repository.create(scheduleInput({
      name: 'Already bound',
      threadId: validThread.id
    }));

    const first = coordinator.ensureBindings();
    const threadCountAfterFirstRepair = threadManager.listThreads({ status: 'all' }).length;
    const second = coordinator.ensureBindings();

    expect(first).toEqual({
      scanned: 3,
      repaired: 2,
      failed: 0,
      unchanged: 1
    });
    expect(second).toEqual({
      scanned: 3,
      repaired: 0,
      failed: 0,
      unchanged: 3
    });
    expect(threadManager.listThreads({ status: 'all' })).toHaveLength(threadCountAfterFirstRepair);

    for (const schedule of [unbound, missing]) {
      const repaired = repository.getById(schedule.id);
      expect(repaired?.threadId).toMatch(/^thread_/);
      expect(repaired?.threadId).not.toBe('thread_missing');
      expect(threadManager.getThread(repaired!.threadId!)).toMatchObject({
        title: schedule.name,
        cwd: schedule.cwd,
        canonicalCwd: schedule.canonicalCwd,
        workspaceMode: 'external',
        profile: schedule.profile,
        model: schedule.model,
        reasoning: schedule.reasoning,
        sandbox: schedule.sandbox,
        status: 'active',
        purpose: 'schedule_task'
      });
      expect(repository.listOperations(schedule.id)[0]).toMatchObject({
        operation: 'binding_repair',
        status: 'succeeded',
        actorType: 'migration',
        actorRunId: null,
        diagnosticEvent: 'SCHEDULE_THREAD_REPAIRED'
      });
    }
    expect(repository.listOperations(valid.id)).toEqual([]);
  });

  it('disables one failed schedule and continues repairing the remaining records', () => {
    const { coordinator, repository, threadManager } = createFixture();
    const bad = repository.create(scheduleInput({ name: 'Bad task' }));
    const good = repository.create(scheduleInput({ name: 'Good task' }));
    db?.exec(`
      CREATE TRIGGER fail_bad_schedule_binding
      BEFORE UPDATE OF thread_id ON schedules
      WHEN OLD.name = 'Bad task'
      BEGIN
        SELECT RAISE(ABORT, 'binding update failed');
      END;
    `);

    const result = coordinator.ensureBindings();

    expect(result).toEqual({
      scanned: 2,
      repaired: 1,
      failed: 1,
      unchanged: 0
    });
    expect(repository.getById(bad.id)).toMatchObject({
      threadId: null,
      enabled: false,
      nextRunAt: null
    });
    expect(repository.listOperations(bad.id)[0]).toMatchObject({
      operation: 'binding_repair_failed',
      status: 'failed',
      actorType: 'migration',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_THREAD_REPAIR_FAILED',
      errorCode: 'SQLITE_CONSTRAINT_TRIGGER',
      errorMessage: 'binding update failed'
    });
    expect(repository.getById(good.id)?.threadId).toMatch(/^thread_/);
    expect(repository.listOperations(good.id)[0]).toMatchObject({
      operation: 'binding_repair',
      status: 'succeeded',
      actorType: 'migration',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_THREAD_REPAIRED'
    });
    expect(threadManager.listThreads({ status: 'all' })).toHaveLength(1);
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-binding-repair-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  let scheduleId = 0;
  let operationId = 0;
  const repository = new ScheduleRepository(db, {
    idFactory: () => `sch_${scheduleId++}`,
    operationIdFactory: () => `schop_${operationId++}`,
    now: () => '2026-07-14T00:00:00.000Z'
  });
  const threadManager = createThreadManager({ db, dataDir: tempDir });
  const coordinator = createScheduleCoordinator({
    db,
    repository,
    threadManager,
    runManager: { hasActiveRunForThread: () => false },
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date('2026-07-14T00:00:00.000Z') }
  });
  return { coordinator, repository, threadManager };
}

function scheduleInput(overrides: Partial<InsertScheduleInput> = {}): InsertScheduleInput {
  return {
    name: 'Legacy task',
    cron: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    prompt: 'Summarize project status',
    promptHash: 'hash',
    promptPreviewRedacted: 'Summarize project status',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: realpathSync(tempDir),
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'queue',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-15T09:00:00.000Z',
    ...overrides
  };
}
