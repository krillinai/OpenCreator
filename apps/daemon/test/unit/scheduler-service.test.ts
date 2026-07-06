import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunManager } from '../../src/runs/manager.js';
import { ScheduleRepository } from '../../src/scheduler/repository.js';
import { createSchedulerService, SchedulerError } from '../../src/scheduler/service.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('scheduler service', () => {
  it('creates, lists, gets, updates, and deletes schedules', () => {
    const { repository, service } = createFixture();
    const prompt = 'Post the project status with TOKEN=sk-secret';

    const created = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt
    });

    expect(created).toMatchObject({
      id: 'sch_0',
      name: 'daily status',
      cron: '0 9 * * *',
      enabled: true,
      promptPreviewRedacted: expect.any(String)
    });
    expect(created).not.toHaveProperty('prompt');
    expect(created.promptPreviewRedacted).not.toContain('sk-secret');
    expect(service.listSchedules().schedules).toHaveLength(1);
    expect(service.getSchedule(created.id)?.prompt).toBe(prompt);

    const updated = service.updateSchedule(created.id, {
      enabled: false,
      name: 'paused',
      cron: '30 9 * * *',
      timezone: 'UTC'
    });

    expect(updated).toMatchObject({
      enabled: false,
      name: 'paused',
      nextRunAt: null
    });

    service.deleteSchedule(created.id);

    expect(service.getSchedule(created.id)).toBeUndefined();
    expect(service.listSchedules().schedules).toEqual([]);
    expect(repository.listOperations(created.id).map(operation => operation.operation)).toEqual([
      'delete',
      'update',
      'create'
    ]);
  });

  it('creates disabled schedules without a next run', () => {
    const { service } = createFixture();

    const created = service.createSchedule({
      name: 'paused status',
      cron: '0 9 * * *',
      enabled: false,
      prompt: 'Summarize project status'
    });

    expect(created).toMatchObject({
      enabled: false,
      nextRunAt: null
    });
    expect(service.getSchedule(created.id)).toMatchObject({
      enabled: false,
      nextRunAt: null
    });
  });

  it('run-now creates a scheduled run with source metadata', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status',
      timeoutMs: 2500
    });

    const response = service.runNow(schedule.id);

    expect(response).toMatchObject({
      run: { id: 'run_0', status: 'running' },
      skipped: false,
      queued: false
    });
    expect(runManager.startRun).toHaveBeenCalledWith({
      prompt: 'Summarize project status',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      model: undefined,
      reasoning: undefined,
      createdBy: 'schedule',
      sourceId: schedule.id,
      timeoutMs: 2500
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_now',
      status: 'succeeded',
      runId: 'run_0'
    });
    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastRunId: 'run_0',
      lastStatus: 'running',
      lastRunAt: '2026-07-06T00:00:00.000Z'
    });
    expect(response.schedule).toMatchObject({
      lastRunId: 'run_0',
      lastStatus: 'running',
      lastRunAt: '2026-07-06T00:00:00.000Z'
    });
  });

  it('records failed run-now operations when run manager throws', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status'
    });
    runManager.startRun.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    expect(() => service.runNow(schedule.id)).toThrow(
      expect.objectContaining({
        code: 'INTERNAL_ERROR',
        message: 'boom'
      })
    );
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_now',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'boom'
    });
    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null
    });
  });

  it('creates a run for a due timer inside the grace window', () => {
    const { runManager, service, timers, setNow } = createFixtureWithTimers('2026-07-06T08:59:45.000Z');
    const schedule = service.createSchedule({
      name: 'daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });

    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(15_000);

    setNow('2026-07-06T09:00:00.000Z');
    timers[0]?.callback();

    expect(runManager.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'run at nine',
        createdBy: 'schedule'
      })
    );
    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastStatus: 'running',
      lastRunId: 'run_0',
      nextRunAt: '2026-07-07T09:00:00.000Z'
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'timer_trigger',
      status: 'succeeded'
    });
  });

  it('skips missed triggers outside the grace window and advances nextRunAt', () => {
    const { runManager, service, setNow } = createFixtureWithTimers('2026-07-06T08:00:00.000Z');
    const schedule = service.createSchedule({
      name: 'daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });

    setNow('2026-07-06T09:05:00.000Z');
    service.processDueSchedulesForTest?.();

    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastStatus: 'skipped',
      nextRunAt: '2026-07-07T09:00:00.000Z'
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'skip_misfire',
      status: 'skipped'
    });
  });

  it('stop clears active timer', () => {
    const { service, timers, cleared } = createFixtureWithTimers('2026-07-06T08:59:45.000Z');

    service.createSchedule({
      name: 'daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });

    expect(timers).toHaveLength(1);

    service.stop();

    expect(cleared).toEqual([timers[0]?.handle]);
    service.refreshTimer();
    expect(cleared).toHaveLength(1);
  });

  it('throws SCHEDULE_NOT_FOUND for missing schedule mutations', () => {
    const { service } = createFixture();

    expect(service.getSchedule('missing')).toBeUndefined();
    expect(() => service.updateSchedule('missing', { name: 'paused' })).toThrow(SchedulerError);
    expect(() => service.deleteSchedule('missing')).toThrow(SchedulerError);
    expect(() => service.runNow('missing')).toThrow(SchedulerError);
    expect(() => service.listOperations('missing')).toThrow(SchedulerError);

    for (const action of [
      () => service.updateSchedule('missing', { name: 'paused' }),
      () => service.deleteSchedule('missing'),
      () => service.runNow('missing'),
      () => service.listOperations('missing')
    ]) {
      expect(action).toThrow(expect.objectContaining({ code: 'SCHEDULE_NOT_FOUND' }));
    }
  });
});

function createFixture(options: { autostart?: boolean } = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-scheduler-service-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const repository = new ScheduleRepository(db, {
    idFactory: (() => {
      let i = 0;
      return () => `sch_${i++}`;
    })(),
    operationIdFactory: (() => {
      let i = 0;
      return () => `schop_${i++}`;
    })(),
    now: () => '2026-07-06T00:00:00.000Z'
  });
  let runCount = 0;
  const runManager = {
    startRun: vi.fn(() => ({ id: `run_${runCount++}`, status: 'running' as const })),
    getRun: vi.fn(),
    hasActiveRunForThread: vi.fn(),
    createAndRun: vi.fn(),
    cancelRun: vi.fn(),
    listRuns: vi.fn(),
    listRunsByThread: vi.fn(),
    listEvents: vi.fn(),
    subscribe: vi.fn()
  };
  const service = createSchedulerService({
    repository,
    runManager: runManager as unknown as RunManager,
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    autostart: options.autostart ?? false
  });
  return { repository, runManager, service };
}

function createFixtureWithTimers(now: string) {
  const timers: Array<{ callback: () => void; ms: number; handle: object }> = [];
  const cleared: unknown[] = [];
  const fixture = createFixture({ autostart: false });
  let currentNow = now;
  const service = createSchedulerService({
    repository: fixture.repository,
    runManager: fixture.runManager as unknown as RunManager,
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date(currentNow) },
    timers: {
      setTimeout(callback, ms) {
        const handle = { index: timers.length };
        timers.push({ callback, ms, handle });
        return handle;
      },
      clearTimeout(handle) {
        cleared.push(handle);
      }
    },
    autostart: false
  });
  return {
    ...fixture,
    service,
    timers,
    cleared,
    setNow(value: string) {
      currentNow = value;
    }
  };
}
