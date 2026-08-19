import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunManager } from '../../src/runs/manager.js';
import type { CreateRunInput } from '../../src/runs/types.js';
import { createScheduleCoordinator } from '../../src/scheduler/coordinator.js';
import { ScheduleRepository } from '../../src/scheduler/repository.js';
import { createSchedulerService, SchedulerError } from '../../src/scheduler/service.js';
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

  it('rejects exposing migration records without a dedicated thread binding', () => {
    const { repository, service } = createFixture();
    const created = service.createSchedule({
      name: 'legacy status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status'
    });
    repository.update(created.id, { threadId: null });

    expect(() => service.getSchedule(created.id)).toThrow(
      expect.objectContaining({
        code: 'INTERNAL_ERROR',
        message: `Schedule thread binding is missing: ${created.id}`
      })
    );
    expect(() => service.listSchedules()).toThrow(
      expect.objectContaining({
        code: 'INTERNAL_ERROR',
        message: `Schedule thread binding is missing: ${created.id}`
      })
    );
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
      run: { id: 'run_0', threadId: schedule.threadId, status: 'running' },
      skipped: false,
      queued: false
    });
    expect(runManager.startRun).toHaveBeenCalledWith({
      threadId: schedule.threadId,
      prompt: 'Summarize project status',
      executionPrompt: expect.stringMatching(
        /OpenCreator 已经触发[\s\S]*任务名称：daily status[\s\S]*本次触发时间：2026-07-06T00:00:00.000Z[\s\S]*Summarize project status/
      ),
      publicPrompt: 'Summarize project status',
      triggeredAt: '2026-07-06T00:00:00.000Z',
      createdBy: 'schedule',
      sourceId: schedule.id,
      timeoutMs: 2500
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_now',
      status: 'succeeded',
      runId: 'run_0',
      actorType: 'user',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGERED'
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

  it('run-now leaves timeout unspecified when schedule uses the scheduler default', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status'
    });

    service.runNow(schedule.id);

    expect(runManager.startRun).toHaveBeenCalledWith({
      threadId: schedule.threadId,
      prompt: 'Summarize project status',
      executionPrompt: expect.stringContaining('Summarize project status'),
      publicPrompt: 'Summarize project status',
      triggeredAt: '2026-07-06T00:00:00.000Z',
      createdBy: 'schedule',
      sourceId: schedule.id,
      timeoutMs: undefined
    });
  });

  it('records the calling agent separately from the scheduled run it starts', () => {
    const { service } = createFixture();
    const schedule = service.createSchedule({
      name: 'agent requested run',
      cron: '0 9 * * *',
      prompt: 'Summarize project status'
    });

    const response = service.runNow(schedule.id, {
      type: 'agent',
      runId: 'run_agent_actor'
    });

    expect(response.run?.id).toBe('run_0');
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_now',
      status: 'succeeded',
      runId: 'run_0',
      actorType: 'agent',
      actorRunId: 'run_agent_actor',
      diagnosticEvent: 'SCHEDULE_TRIGGERED'
    });
  });

  it('reconciles the latest run terminal status when reading schedules', () => {
    const { service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status'
    });
    service.runNow(schedule.id);
    insertRun('run_0', {
      sourceId: schedule.id,
      publicStatus: 'succeeded',
      internalStatus: 'succeeded'
    });

    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastRunId: 'run_0',
      lastStatus: 'succeeded'
    });
    expect(service.listSchedules().schedules[0]).toMatchObject({
      lastRunId: 'run_0',
      lastStatus: 'succeeded'
    });
  });

  it('skips run-now when skip policy has an active run', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status',
      concurrencyPolicy: 'skip'
    });
    runManager.hasActiveRunForThread.mockReturnValue(true);

    const response = service.runNow(schedule.id);

    expect(response).toMatchObject({
      run: null,
      skipped: true,
      queued: false
    });
    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(runManager.hasActiveRunForThread).toHaveBeenCalledWith(schedule.threadId);
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'skip_concurrency',
      status: 'skipped',
      actorType: 'user',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGER_SKIPPED'
    });
    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastStatus: 'skipped'
    });
  });

  it('coalesces queue policy and runs one pending trigger after active run ends', () => {
    const { runManager, service } = createFixtureWithTimers('2026-07-06T00:00:00.000Z');
    service.start();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status',
      concurrencyPolicy: 'queue'
    });
    runManager.hasActiveRunForThread.mockReturnValue(true);

    const first = service.runNow(schedule.id);
    const second = service.runNow(schedule.id);

    expect(first).toMatchObject({ run: null, skipped: false, queued: true });
    expect(second).toMatchObject({ run: null, skipped: false, queued: true });
    expect(service.getSchedule(schedule.id)).toMatchObject({
      pendingTrigger: true,
      lastStatus: 'queued'
    });
    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(service.listOperations(schedule.id).operations.filter(operation => operation.operation === 'queue_trigger')).toHaveLength(
      2
    );
    expect(service.listOperations(schedule.id).operations.find(
      operation => operation.operation === 'queue_trigger'
    )).toMatchObject({
      actorType: 'user',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGER_QUEUED'
    });

    runManager.hasActiveRunForThread.mockReturnValue(false);
    service.processPendingTriggersForTest?.();

    expect(runManager.startRun).toHaveBeenCalledTimes(1);
    expect(runManager.startRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: schedule.threadId })
    );
    expect(service.getSchedule(schedule.id)).toMatchObject({
      pendingTrigger: false,
      lastStatus: 'running',
      lastRunId: 'run_0'
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'run_queued',
      status: 'succeeded',
      actorType: 'timer',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGERED'
    });
  });

  it('keeps a coalesced pending trigger while an interrupting user run still owns the thread', () => {
    const { runManager, service } = createFixture();
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status',
      concurrencyPolicy: 'queue'
    });
    runManager.hasActiveRunForThread.mockReturnValue(true);

    service.runNow(schedule.id);
    service.processPendingTriggersForTest?.();

    expect(runManager.hasActiveRunForThread).toHaveBeenLastCalledWith(schedule.threadId);
    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(service.getSchedule(schedule.id)).toMatchObject({
      pendingTrigger: true,
      lastStatus: 'queued'
    });
  });

  it('continues pending processing and clears failed pending trigger', () => {
    const { repository, runManager, service } = createFixtureWithTimers('2026-07-06T00:00:00.000Z');
    const first = service.createSchedule({
      name: 'first queued status',
      cron: '0 9 * * *',
      prompt: 'First pending run',
      concurrencyPolicy: 'queue'
    });
    const second = service.createSchedule({
      name: 'second queued status',
      cron: '0 9 * * *',
      prompt: 'Second pending run',
      concurrencyPolicy: 'queue'
    });
    repository.setPendingTrigger(first.id, true);
    repository.setPendingTrigger(second.id, true);
    runManager.startRun.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    expect(() => service.processPendingTriggersForTest?.()).not.toThrow();

    expect(runManager.startRun).toHaveBeenCalledTimes(2);
    expect(service.getSchedule(first.id)).toMatchObject({
      pendingTrigger: false,
      lastStatus: 'failed'
    });
    expect(service.listOperations(first.id).operations[0]).toMatchObject({
      operation: 'run_queued',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'boom'
    });
    expect(service.getSchedule(second.id)).toMatchObject({
      pendingTrigger: false,
      lastStatus: 'running',
      lastRunId: 'run_0'
    });
    expect(service.listOperations(second.id).operations[0]).toMatchObject({
      operation: 'run_queued',
      status: 'succeeded'
    });
  });

  it('start schedules queue timer for existing pending triggers', () => {
    const { repository, service, timers } = createFixtureWithTimers('2026-07-06T00:00:00.000Z');
    const schedule = service.createSchedule({
      name: 'queued status',
      cron: '0 9 * * *',
      prompt: 'Pending run',
      concurrencyPolicy: 'queue'
    });
    repository.setPendingTrigger(schedule.id, true);

    service.start();

    expect(timers.some(timer => timer.ms === 5_000)).toBe(true);
  });

  it('preserves and consumes one coalesced pending trigger after scheduler restart', () => {
    const first = createFixtureWithTimers('2026-07-06T00:00:00.000Z');
    first.service.start();
    const schedule = first.service.createSchedule({
      name: 'queued across restart',
      cron: '0 9 * * *',
      prompt: 'Run after restart',
      concurrencyPolicy: 'queue'
    });
    first.runManager.hasActiveRunForThread.mockReturnValue(true);

    first.service.runNow(schedule.id);
    first.service.runNow(schedule.id);
    first.service.stop();

    const restartedRepository = new ScheduleRepository(db!);
    const restartedRunManager = {
      ...first.runManager,
      startRun: vi.fn((input: CreateRunInput) => ({
        id: 'run_after_restart',
        threadId: input.threadId,
        status: 'running' as const,
        submissionMode: input.submissionMode ?? 'enqueue'
      })),
      hasActiveRunForThread: vi.fn(() => false)
    };
    const restartedTimers: Array<{ callback: () => void; ms: number }> = [];
    const restartedService = createSchedulerService({
      repository: restartedRepository,
      runManager: restartedRunManager as unknown as RunManager,
      clock: { now: () => new Date('2026-07-06T00:05:00.000Z') },
      timers: {
        setTimeout(callback, ms) {
          restartedTimers.push({ callback, ms });
          return { index: restartedTimers.length - 1 };
        },
        clearTimeout() {}
      },
      autostart: false
    });

    expect(restartedRepository.getById(schedule.id)).toMatchObject({
      threadId: schedule.threadId,
      pendingTrigger: true,
      lastStatus: 'queued'
    });

    restartedService.start();

    expect(restartedTimers.some(timer => timer.ms === 5_000)).toBe(true);
    restartedService.processPendingTriggersForTest?.();

    expect(restartedRunManager.startRun).toHaveBeenCalledTimes(1);
    expect(restartedRunManager.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: schedule.threadId,
        createdBy: 'schedule',
        sourceId: schedule.id
      })
    );
    expect(restartedRepository.getById(schedule.id)).toMatchObject({
      threadId: schedule.threadId,
      pendingTrigger: false,
      lastStatus: 'running',
      lastRunId: 'run_after_restart'
    });
    restartedService.stop();
  });

  it('stop clears queue timer', () => {
    const { repository, service, timers, cleared } = createFixtureWithTimers('2026-07-06T00:00:00.000Z');
    const schedule = service.createSchedule({
      name: 'queued status',
      cron: '0 9 * * *',
      prompt: 'Pending run',
      concurrencyPolicy: 'queue'
    });
    repository.setPendingTrigger(schedule.id, true);
    service.start();
    const queueTimer = timers.find(timer => timer.ms === 5_000);

    service.stop();

    expect(queueTimer).toBeDefined();
    expect(cleared).toContain(queueTimer?.handle);
  });

  it('treats a surviving legacy parallel policy as queue and records a diagnostic', () => {
    const warn = vi.fn();
    const { repository, runManager, service } = createFixture({ warn });
    const schedule = service.createSchedule({
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize project status',
      concurrencyPolicy: 'queue'
    });
    repository.update(schedule.id, { concurrencyPolicy: 'parallel' });
    runManager.hasActiveRunForThread.mockReturnValue(true);

    const response = service.runNow(schedule.id);

    expect(response).toMatchObject({
      run: null,
      skipped: false,
      queued: true
    });
    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      `Schedule ${schedule.id} still uses legacy parallel concurrency; treating it as queue`
    );
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
      actorType: 'user',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGERED',
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
    service.start();
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
      status: 'succeeded',
      actorType: 'timer',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGERED'
    });
  });

  it('timer trigger follows skip policy when active run exists', () => {
    const { runManager, service, timers, setNow } = createFixtureWithTimers('2026-07-06T08:59:45.000Z');
    service.start();
    const schedule = service.createSchedule({
      name: 'daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir,
      concurrencyPolicy: 'skip'
    });
    runManager.hasActiveRunForThread.mockReturnValue(true);

    setNow('2026-07-06T09:00:00.000Z');
    timers[0]?.callback();

    expect(runManager.startRun).not.toHaveBeenCalled();
    expect(service.getSchedule(schedule.id)).toMatchObject({
      lastStatus: 'skipped',
      nextRunAt: '2026-07-07T09:00:00.000Z'
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'skip_concurrency',
      status: 'skipped',
      actorType: 'timer',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGER_SKIPPED'
    });
  });

  it('skips missed triggers outside the grace window and advances nextRunAt', () => {
    const { runManager, service, setNow } = createFixtureWithTimers('2026-07-06T08:00:00.000Z');
    service.start();
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
      status: 'skipped',
      actorType: 'timer',
      actorRunId: null,
      diagnosticEvent: 'SCHEDULE_TRIGGER_SKIPPED'
    });
  });

  it('stop clears active timer', () => {
    const { service, timers, cleared } = createFixtureWithTimers('2026-07-06T08:59:45.000Z');
    service.start();

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

  it('stop prevents later mutations from scheduling timers', () => {
    const { service, timers, cleared } = createFixtureWithTimers('2026-07-06T08:59:45.000Z');
    service.start();
    const schedule = service.createSchedule({
      name: 'daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });

    expect(timers).toHaveLength(1);

    service.stop();
    expect(cleared).toEqual([timers[0]?.handle]);

    service.updateSchedule(schedule.id, { name: 'renamed daily run' });

    expect(timers).toHaveLength(1);
  });

  it('continues due processing and refreshes timer when one trigger fails', () => {
    const { runManager, service, timers, setNow } = createFixtureWithTimers('2026-07-06T08:00:00.000Z');
    service.start();
    const first = service.createSchedule({
      name: 'first daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'first run',
      cwd: tempDir
    });
    const second = service.createSchedule({
      name: 'second daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'second run',
      cwd: tempDir
    });
    runManager.startRun.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    setNow('2026-07-06T09:00:00.000Z');
    service.processDueSchedulesForTest?.();

    expect(runManager.startRun).toHaveBeenCalledTimes(2);
    expect(service.getSchedule(second.id)).toMatchObject({
      lastRunId: 'run_0',
      lastStatus: 'running'
    });
    expect(service.listOperations(first.id).operations[0]).toMatchObject({
      operation: 'timer_trigger',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'boom'
    });
    expect(timers.at(-1)?.ms).toBeGreaterThanOrEqual(0);
    expect(timers.length).toBeGreaterThan(2);
  });

  it('advances nextRunAt before timer run failure so failed trigger is not immediately due', () => {
    const { repository, runManager, service, setNow } = createFixtureWithTimers('2026-07-06T08:00:00.000Z');
    service.start();
    const schedule = service.createSchedule({
      name: 'daily run',
      cron: '0 9 * * *',
      timezone: 'UTC',
      prompt: 'run at nine',
      cwd: tempDir
    });
    runManager.startRun.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    setNow('2026-07-06T09:00:00.000Z');
    expect(() => service.processDueSchedulesForTest?.()).not.toThrow();

    expect(service.getSchedule(schedule.id)).toMatchObject({
      nextRunAt: '2026-07-07T09:00:00.000Z'
    });
    expect(service.listOperations(schedule.id).operations[0]).toMatchObject({
      operation: 'timer_trigger',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR'
    });
    expect(repository.listDue('2026-07-06T09:00:00.000Z').map(record => record.id)).not.toContain(schedule.id);
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

function createFixture(options: { autostart?: boolean; warn?(message: string): void } = {}) {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-scheduler-service-'));
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
    startRun: vi.fn((input: CreateRunInput) => ({
      id: `run_${runCount++}`,
      threadId: input.threadId,
      status: 'running' as const,
      submissionMode: input.submissionMode ?? 'enqueue'
    })),
    getRun: vi.fn(),
    hasActiveRunForThread: vi.fn(),
    createAndRun: vi.fn(),
    cancelRun: vi.fn(),
    listRuns: vi.fn(),
    listRunsByThread: vi.fn(),
    listEvents: vi.fn(),
    subscribe: vi.fn()
  };
  const scheduler = createSchedulerService({
    repository,
    runManager: runManager as unknown as RunManager,
    clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    autostart: options.autostart ?? false,
    warn: options.warn
  });
  const threadManager = createThreadManager({ db, dataDir: tempDir });
  const coordinator = createScheduleCoordinator({
    db,
    repository,
    threadManager,
    runManager: runManager as unknown as RunManager,
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date('2026-07-06T00:00:00.000Z') },
    onSchedulesChanged: () => scheduler.refreshTimer()
  });
  const service = Object.assign(scheduler, {
    createSchedule: coordinator.createManual,
    updateSchedule: coordinator.update,
    deleteSchedule: coordinator.delete
  });
  return { repository, runManager, threadManager, coordinator, service };
}

function createFixtureWithTimers(now: string) {
  const timers: Array<{ callback: () => void; ms: number; handle: object }> = [];
  const cleared: unknown[] = [];
  const fixture = createFixture({ autostart: false });
  let currentNow = now;
  const scheduler = createSchedulerService({
    repository: fixture.repository,
    runManager: fixture.runManager as unknown as RunManager,
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
  const coordinator = createScheduleCoordinator({
    db: db!,
    repository: fixture.repository,
    threadManager: fixture.threadManager,
    runManager: fixture.runManager as unknown as RunManager,
    defaultCwd: tempDir,
    profileValidator: { validateProfileForRun: () => ({ ok: true as const }) },
    clock: { now: () => new Date(currentNow) },
    onSchedulesChanged: () => scheduler.refreshTimer()
  });
  const service = Object.assign(scheduler, {
    createSchedule: coordinator.createManual,
    updateSchedule: coordinator.update,
    deleteSchedule: coordinator.delete
  });
  return {
    ...fixture,
    coordinator,
    service,
    timers,
    cleared,
    setNow(value: string) {
      currentNow = value;
    }
  };
}

function insertRun(
  id: string,
  input: { sourceId: string; publicStatus?: string; internalStatus?: string }
): void {
  db
    ?.prepare(
      `
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (
        @id, @publicStatus, @internalStatus, 'schedule', @sourceId, 'default', @cwd, @cwd,
        'external', 'read-only', 'test', 'codex', @codexHome, 1
      )
    `
    )
    .run({
      id,
      sourceId: input.sourceId,
      publicStatus: input.publicStatus ?? 'running',
      internalStatus: input.internalStatus ?? input.publicStatus ?? 'running',
      cwd: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });
}
