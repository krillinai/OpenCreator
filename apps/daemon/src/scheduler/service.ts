import type {
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleResponse
} from '@opencreator/protocol';
import type { RunManager } from '../runs/manager.js';
import { computeNextRunAt } from './cron.js';
import type { ScheduleRepository } from './repository.js';
import type {
  BoundScheduleRecord,
  ScheduleOperationActor,
  ScheduleOperationRecord,
  ScheduleRecord,
  SchedulerClock
} from './types.js';
import { scheduleOperationActors } from './types.js';
import type { ScheduleValidationErrorCode } from './validator.js';

export type SchedulerErrorCode =
  | ScheduleValidationErrorCode
  | 'SCHEDULE_NOT_FOUND'
  | 'SCHEDULE_HAS_ACTIVE_RUN'
  | 'SCHEDULE_THREAD_MISSING'
  | 'SCHEDULE_THREAD_ARCHIVED'
  | 'INTERNAL_ERROR';

export class SchedulerError extends Error {
  readonly code: SchedulerErrorCode;

  constructor(code: SchedulerErrorCode, message: string) {
    super(message);
    this.name = 'SchedulerError';
    this.code = code;
  }
}

export type SchedulerService = {
  listSchedules(): ScheduleListResponse;
  getSchedule(id: string): ScheduleDetailResponse | undefined;
  runNow(id: string, actor?: ScheduleOperationActor): RunScheduleNowResponse;
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
  clock?: SchedulerClock;
  timers?: SchedulerTimers;
  triggerGraceMs?: number;
  autostart?: boolean;
  warn?(message: string): void;
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
  const warn = options.warn ?? (message => console.warn(message));
  let timer: TimerHandle | unknown;
  let queueTimer: TimerHandle | unknown;
  let started = false;

  function handleTrigger(
    schedule: ScheduleRecord,
    operation: 'run_now' | 'timer_trigger' | 'run_queued',
    ranAt: string,
    actor: ScheduleOperationActor
  ): RunScheduleNowResponse {
    const bound = requireBoundSchedule(schedule);
    const concurrencyPolicy = resolveConcurrencyPolicy(bound);
    if (operation !== 'run_queued') {
      const active = options.runManager.hasActiveRunForThread(bound.threadId);
      if (active && concurrencyPolicy === 'skip') {
        const skipped = options.repository.recordSkipped({ id: schedule.id, status: 'skipped' });
        if (skipped === null) throw notFound();
        options.repository.insertOperation({
          scheduleId: schedule.id,
          operation: 'skip_concurrency',
          status: 'skipped'
        }, actor);
        return {
          run: null,
          schedule: toScheduleResponse(requireBoundSchedule(skipped)),
          skipped: true,
          queued: false
        };
      }
      if (active && concurrencyPolicy === 'queue') {
        const queued = options.repository.setPendingTrigger(schedule.id, true);
        if (queued === null) throw notFound();
        const updated = options.repository.recordSkipped({ id: schedule.id, status: 'queued' });
        if (updated === null) throw notFound();
        options.repository.insertOperation({
          scheduleId: schedule.id,
          operation: 'queue_trigger',
          status: 'queued'
        }, actor);
        refreshQueueTimerIfStarted();
        return {
          run: null,
          schedule: toScheduleResponse(requireBoundSchedule(updated)),
          skipped: false,
          queued: true
        };
      }
    }

    return triggerSchedule(bound, operation, ranAt, actor);
  }

  function triggerSchedule(
    schedule: BoundScheduleRecord,
    operation: 'run_now' | 'timer_trigger' | 'run_queued',
    ranAt: string,
    actor: ScheduleOperationActor
  ): RunScheduleNowResponse {
    let run;
    try {
      run = options.runManager.startRun({
        threadId: schedule.threadId,
        prompt: schedule.prompt,
        executionPrompt: createScheduleExecutionPrompt(schedule, ranAt),
        publicPrompt: schedule.prompt,
        triggeredAt: ranAt,
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
      }, actor);
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
    }, actor);
    return {
      run,
      schedule: toScheduleResponse(requireBoundSchedule(updated)),
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
      }, scheduleOperationActors.timer);
      return;
    }

    const updated = options.repository.update(schedule.id, { nextRunAt });
    if (updated === null) throw notFound();
    handleTrigger(updated, 'timer_trigger', now, scheduleOperationActors.timer);
  }

  function recordUnexpectedTimerFailure(schedule: ScheduleRecord, error: unknown): void {
    if (error instanceof SchedulerError) return;

    options.repository.insertOperation({
      scheduleId: schedule.id,
      operation: 'timer_trigger',
      status: 'failed',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: formatError(error)
    }, scheduleOperationActors.timer);
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
        try {
          const bound = requireBoundSchedule(schedule);
          if (options.runManager.hasActiveRunForThread(bound.threadId)) continue;
          handleTrigger(
            schedule,
            'run_queued',
            clock.now().toISOString(),
            scheduleOperationActors.timer
          );
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
    }, scheduleOperationActors.timer);
  }

  function resolveConcurrencyPolicy(schedule: BoundScheduleRecord): 'skip' | 'queue' {
    if (schedule.concurrencyPolicy !== 'parallel') return schedule.concurrencyPolicy;
    warn(
      `Schedule ${schedule.id} still uses legacy parallel concurrency; treating it as queue`
    );
    return 'queue';
  }

  const service: SchedulerService = {
    listSchedules() {
      options.repository.reconcileLastRunStatuses();
      return {
        schedules: options.repository
          .list()
          .map(schedule => toScheduleResponse(requireBoundSchedule(schedule)))
      };
    },

    getSchedule(id) {
      options.repository.reconcileLastRunStatuses();
      const schedule = options.repository.getById(id);
      return schedule === null
        ? undefined
        : toScheduleDetailResponse(requireBoundSchedule(schedule));
    },

    runNow(id, actor = scheduleOperationActors.user) {
      const schedule = requireSchedule(options.repository, id);
      const response = handleTrigger(
        schedule,
        'run_now',
        clock.now().toISOString(),
        actor
      );
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

export function toScheduleResponse(schedule: BoundScheduleRecord): ScheduleResponse {
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

function toScheduleDetailResponse(schedule: BoundScheduleRecord): ScheduleDetailResponse {
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

function requireBoundSchedule(schedule: ScheduleRecord): BoundScheduleRecord {
  if (schedule.threadId === null) {
    throw new SchedulerError(
      'INTERNAL_ERROR',
      `Schedule thread binding is missing: ${schedule.id}`
    );
  }
  return schedule as BoundScheduleRecord;
}

function notFound(): SchedulerError {
  return new SchedulerError('SCHEDULE_NOT_FOUND', 'Schedule not found');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createScheduleExecutionPrompt(
  schedule: Pick<BoundScheduleRecord, 'name' | 'prompt'>,
  ranAt: string
): string {
  return [
    '这是 OpenCreator 已经触发的一次计划任务执行。',
    '',
    '执行规则：',
    '1. 立即完成本次任务，不要重新创建或修改计划任务。',
    '2. 不要询问执行时间，也不要只解释如何完成。',
    '3. 可以使用当前会话可用的文件、Shell、Skills 和 MCP。',
    '4. 如果需要用户审批，正常发起审批并等待。',
    '5. 完成后直接给出本次结果；如果生成了文件，给出可点击的文件路径。',
    '',
    `任务名称：${schedule.name}`,
    `本次触发时间：${ranAt}`,
    '任务内容：',
    schedule.prompt
  ].join('\n');
}
