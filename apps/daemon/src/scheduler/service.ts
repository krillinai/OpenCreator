import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import type { RunManager } from '../runs/manager.js';
import { computeNextRunAt } from './cron.js';
import type { ScheduleRepository } from './repository.js';
import type { ProfileValidator, ScheduleOperationRecord, ScheduleRecord, SchedulerClock } from './types.js';
import {
  parseCreateScheduleRequest,
  parseUpdateScheduleRequest,
  type ScheduleValidationErrorCode
} from './validator.js';

export type SchedulerErrorCode = ScheduleValidationErrorCode | 'SCHEDULE_NOT_FOUND' | 'INTERNAL_ERROR';

export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;

  constructor(code: SchedulerErrorCode, message: string) {
    super(message);
    this.name = 'SchedulerError';
    this.code = code;
  }
}

export type SchedulerService = {
  createSchedule(input: CreateScheduleRequest): ScheduleResponse;
  listSchedules(): ScheduleListResponse;
  getSchedule(id: string): ScheduleDetailResponse | undefined;
  updateSchedule(id: string, input: UpdateScheduleRequest): ScheduleResponse;
  deleteSchedule(id: string): void;
  runNow(id: string): RunScheduleNowResponse;
  listOperations(id: string, limit?: number): ScheduleOperationListResponse;
  start(): void;
  stop(): void;
  refreshTimer(): void;
  processDueSchedulesForTest?(): void;
  processPendingTriggersForTest?(): void;
};

type TimerHandle = ReturnType<typeof setTimeout>;
type SchedulerTimers = {
  setTimeout(callback: () => void, ms: number): TimerHandle | unknown;
  clearTimeout(handle: TimerHandle | unknown): void;
};

export type SchedulerServiceOptions = {
  repository: ScheduleRepository;
  runManager: RunManager;
  defaultCwd: string;
  profileValidator: ProfileValidator;
  clock?: SchedulerClock;
  timers?: SchedulerTimers;
  triggerGraceMs?: number;
  autostart?: boolean;
};

const DEFAULT_TRIGGER_GRACE_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const QUEUE_CHECK_INTERVAL_MS = 5_000;

const systemClock: SchedulerClock = {
  now: () => new Date()
};

export function createSchedulerService(options: SchedulerServiceOptions): SchedulerService {
  const clock = options.clock ?? systemClock;
  const timers = options.timers ?? {
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimeout: (handle: TimerHandle | unknown) => clearTimeout(handle as TimerHandle)
  };
  const triggerGraceMs = options.triggerGraceMs ?? DEFAULT_TRIGGER_GRACE_MS;
  let timer: TimerHandle | unknown;
  let queueTimer: TimerHandle | unknown;
  let started = false;

  function handleTrigger(
    schedule: ScheduleRecord,
    operation: 'run_now' | 'timer_trigger' | 'run_queued',
    ranAt: string
  ): RunScheduleNowResponse {
    if (operation !== 'run_queued' && schedule.concurrencyPolicy !== 'parallel') {
      const active = options.repository.hasActiveRunForSource('schedule', schedule.id);
      if (active && schedule.concurrencyPolicy === 'skip') {
        const skipped = options.repository.recordSkipped({ id: schedule.id, status: 'skipped' });
        if (skipped === null) throw notFound();
        options.repository.insertOperation({
          scheduleId: schedule.id,
          operation: 'skip_concurrency',
          status: 'skipped'
        });
        return {
          run: null,
          schedule: toScheduleResponse(skipped),
          skipped: true,
          queued: false
        };
      }
      if (active && schedule.concurrencyPolicy === 'queue') {
        const queued = options.repository.setPendingTrigger(schedule.id, true);
        if (queued === null) throw notFound();
        const updated = options.repository.recordSkipped({ id: schedule.id, status: 'queued' });
        if (updated === null) throw notFound();
        options.repository.insertOperation({
          scheduleId: schedule.id,
          operation: 'queue_trigger',
          status: 'queued'
        });
        refreshQueueTimerIfStarted();
        return {
          run: null,
          schedule: toScheduleResponse(updated),
          skipped: false,
          queued: true
        };
      }
    }

    return triggerSchedule(schedule, operation, ranAt);
  }

  function triggerSchedule(
    schedule: ScheduleRecord,
    operation: 'run_now' | 'timer_trigger' | 'run_queued',
    ranAt: string
  ): RunScheduleNowResponse {
    let run;
    try {
      run = options.runManager.startRun({
        prompt: schedule.prompt,
        executionPrompt: createScheduleExecutionPrompt(schedule.prompt),
        cwd: schedule.cwd,
        profile: schedule.profile,
        sandbox: schedule.sandbox,
        model: schedule.model ?? undefined,
        reasoning: schedule.reasoning ?? undefined,
        createdBy: 'schedule',
        sourceId: schedule.id,
        timeoutMs: schedule.timeoutMs ?? undefined
      });
    } catch (error) {
      const message = formatError(error);
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation,
        status: 'failed',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: message
      });
      throw new SchedulerError('INTERNAL_ERROR', message);
    }
    const updated = options.repository.recordRun({
      id: schedule.id,
      runId: run.id,
      ranAt,
      status: run.status
    });
    if (updated === null) throw notFound();
    options.repository.insertOperation({
      scheduleId: schedule.id,
      operation,
      status: 'succeeded',
      runId: run.id
    });
    return {
      run,
      schedule: toScheduleResponse(updated),
      skipped: false,
      queued: false
    };
  }

  function processDueSchedules(): void {
    const now = clock.now().toISOString();
    try {
      for (const schedule of options.repository.listDue(now)) {
        try {
          processDueSchedule(schedule, now);
        } catch (error) {
          recordUnexpectedTimerFailure(schedule, error);
        }
      }
    } finally {
      refreshTimerIfStarted();
    }
  }

  function processDueSchedule(schedule: ScheduleRecord, now: string): void {
    if (schedule.nextRunAt === null || schedule.nextRunAt === undefined) return;

    const nextRunAt = computeNextRunAt({ cron: schedule.cron, timezone: schedule.timezone, from: now });
    const ageMs = new Date(now).getTime() - new Date(schedule.nextRunAt).getTime();
    if (ageMs > triggerGraceMs) {
      const updated = options.repository.update(schedule.id, { nextRunAt });
      if (updated === null) throw notFound();
      const skipped = options.repository.recordSkipped({ id: schedule.id, status: 'skipped' });
      if (skipped === null) throw notFound();
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation: 'skip_misfire',
        status: 'skipped'
      });
      return;
    }

    const updated = options.repository.update(schedule.id, { nextRunAt });
    if (updated === null) throw notFound();
    handleTrigger(updated, 'timer_trigger', now);
  }

  function recordUnexpectedTimerFailure(schedule: ScheduleRecord, error: unknown): void {
    if (error instanceof SchedulerError) return;

    options.repository.insertOperation({
      scheduleId: schedule.id,
      operation: 'timer_trigger',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: formatError(error)
    });
  }

  function refreshTimerIfStarted(): void {
    if (started) refreshTimers();
  }

  function refreshQueueTimerIfStarted(): void {
    if (started) refreshQueueTimer();
  }

  function refreshTimers(): void {
    service.refreshTimer();
    refreshQueueTimer();
  }

  function clearQueueTimer(): void {
    if (queueTimer !== undefined) {
      timers.clearTimeout(queueTimer);
      queueTimer = undefined;
    }
  }

  function refreshQueueTimer(): void {
    clearQueueTimer();
    if (!started) return;
    if (options.repository.listPendingTriggers().length === 0) return;

    queueTimer = timers.setTimeout(() => {
      queueTimer = undefined;
      processPendingTriggers();
    }, QUEUE_CHECK_INTERVAL_MS);
  }

  function processPendingTriggers(): void {
    try {
      for (const schedule of options.repository.listPendingTriggers()) {
        if (options.repository.hasActiveRunForSource('schedule', schedule.id)) continue;
        try {
          handleTrigger(schedule, 'run_queued', clock.now().toISOString());
        } catch (error) {
          recordQueuedTriggerFailure(schedule, error);
        }
      }
    } finally {
      refreshQueueTimerIfStarted();
    }
  }

  function recordQueuedTriggerFailure(schedule: ScheduleRecord, error: unknown): void {
    const pending = options.repository.setPendingTrigger(schedule.id, false);
    if (pending === null) throw notFound();
    const failed = options.repository.recordSkipped({ id: schedule.id, status: 'failed' });
    if (failed === null) throw notFound();
    if (error instanceof SchedulerError && error.code === 'INTERNAL_ERROR') return;

    options.repository.insertOperation({
      scheduleId: schedule.id,
      operation: 'run_queued',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: formatError(error)
    });
  }

  const service: SchedulerService = {
    createSchedule(input) {
      const parsed = parseCreateScheduleRequest(input, {
        now: clock.now().toISOString(),
        defaultCwd: options.defaultCwd,
        profileValidator: options.profileValidator
      });
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);

      const schedule = options.repository.create(parsed.value);
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation: 'create',
        status: 'succeeded'
      });
      refreshTimerIfStarted();
      return toScheduleResponse(schedule);
    },

    listSchedules() {
      options.repository.reconcileLastRunStatuses();
      return { schedules: options.repository.list().map(toScheduleResponse) };
    },

    getSchedule(id) {
      options.repository.reconcileLastRunStatuses();
      const schedule = options.repository.getById(id);
      return schedule === null ? undefined : toScheduleDetailResponse(schedule);
    },

    updateSchedule(id, input) {
      const existing = requireSchedule(options.repository, id);
      const parsed = parseUpdateScheduleRequest(input, {
        now: clock.now().toISOString(),
        defaultCwd: existing.cwd,
        profileValidator: options.profileValidator
      });
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);

      const nextInput = { ...parsed.value };
      if (requiresNextRunRecompute(parsed.value)) {
        const mergedEnabled = parsed.value.enabled ?? existing.enabled;
        const mergedCron = parsed.value.cron ?? existing.cron;
        const mergedTimezone = parsed.value.timezone ?? existing.timezone;
        nextInput.nextRunAt = mergedEnabled
          ? computeNextRunAt({ cron: mergedCron, timezone: mergedTimezone, from: clock.now() })
          : null;
      }

      const updated = options.repository.update(id, nextInput);
      if (updated === null) throw notFound();
      options.repository.insertOperation({
        scheduleId: id,
        operation: 'update',
        status: 'succeeded'
      });
      refreshTimerIfStarted();
      return toScheduleResponse(updated);
    },

    deleteSchedule(id) {
      requireSchedule(options.repository, id);
      const deleted = options.repository.softDelete(id);
      if (!deleted) throw notFound();
      options.repository.insertOperation({
        scheduleId: id,
        operation: 'delete',
        status: 'succeeded'
      });
      refreshTimerIfStarted();
    },

    runNow(id) {
      const schedule = requireSchedule(options.repository, id);
      const response = handleTrigger(schedule, 'run_now', clock.now().toISOString());
      refreshTimerIfStarted();
      return response;
    },

    listOperations(id, limit) {
      requireSchedule(options.repository, id);
      return {
        operations: options.repository.listOperations(id, limit).map(toScheduleOperationResponse)
      };
    },

    start() {
      started = true;
      refreshTimers();
    },

    stop() {
      started = false;
      if (timer !== undefined) {
        timers.clearTimeout(timer);
        timer = undefined;
      }
      clearQueueTimer();
    },

    refreshTimer() {
      if (timer !== undefined) {
        timers.clearTimeout(timer);
        timer = undefined;
      }
      if (!started) return;

      const next = options.repository.getNextEnabled();
      if (next?.nextRunAt === null || next?.nextRunAt === undefined) return;

      const delayMs = Math.max(
        0,
        Math.min(MAX_TIMER_DELAY_MS, new Date(next.nextRunAt).getTime() - clock.now().getTime())
      );
      timer = timers.setTimeout(() => {
        timer = undefined;
        processDueSchedules();
      }, delayMs);
    },

    processDueSchedulesForTest() {
      processDueSchedules();
    },

    processPendingTriggersForTest() {
      processPendingTriggers();
    }
  };

  if (options.autostart === true) service.start();
  return service;
}

export function toScheduleResponse(schedule: ScheduleRecord): ScheduleResponse {
  return {
    id: schedule.id,
    threadId: schedule.threadId,
    name: schedule.name,
    cron: schedule.cron,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    promptPreviewRedacted: schedule.promptPreviewRedacted,
    profile: schedule.profile,
    cwd: schedule.cwd,
    canonicalCwd: schedule.canonicalCwd,
    model: schedule.model,
    reasoning: schedule.reasoning,
    sandbox: schedule.sandbox,
    timeoutMs: schedule.timeoutMs,
    concurrencyPolicy: schedule.concurrencyPolicy,
    misfirePolicy: schedule.misfirePolicy,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    lastRunId: schedule.lastRunId,
    lastStatus: schedule.lastStatus,
    pendingTrigger: schedule.pendingTrigger,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt
  };
}

function toScheduleDetailResponse(schedule: ScheduleRecord): ScheduleDetailResponse {
  return {
    ...toScheduleResponse(schedule),
    prompt: schedule.prompt
  };
}

function toScheduleOperationResponse(operation: ScheduleOperationRecord) {
  return operation;
}

function requireSchedule(repository: ScheduleRepository, id: string): ScheduleRecord {
  const schedule = repository.getById(id);
  if (schedule === null) throw notFound();
  return schedule;
}

function notFound(): SchedulerError {
  return new SchedulerError('SCHEDULE_NOT_FOUND', 'Schedule not found');
}

function requiresNextRunRecompute(input: UpdateScheduleRequest): boolean {
  return input.cron !== undefined || input.timezone !== undefined || input.enabled !== undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createScheduleExecutionPrompt(prompt: string): string {
  return [
    '这是一个已经到达执行时间的计划任务。',
    '请立即执行任务，不要重新创建、修改计划任务，也不要询问执行时间。',
    '如果任务内容是提醒，请直接输出此刻应发给用户的简短提醒；如果是其他任务，请直接完成并返回结果。',
    '',
    '任务内容：',
    prompt
  ].join('\n');
}
