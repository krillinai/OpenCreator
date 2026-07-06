import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleListResponse,
  ScheduleOperationListResponse,
  ScheduleOperationResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import type { RunManager } from '../runs/manager.js';
import { computeNextRunAt } from './cron.js';
import type { ScheduleRepository } from './repository.js';
import type { ProfileValidator, ScheduleRecord, SchedulerClock } from './types.js';
import {
  parseCreateScheduleRequest,
  parseUpdateScheduleRequest,
  type ScheduleValidationErrorCode
} from './validator.js';

export type SchedulerErrorCode = ScheduleValidationErrorCode | 'SCHEDULE_NOT_FOUND';

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
};

export type SchedulerServiceOptions = {
  repository: ScheduleRepository;
  runManager: RunManager;
  defaultCwd: string;
  profileValidator: ProfileValidator;
  clock?: SchedulerClock;
  autostart?: boolean;
};

const systemClock: SchedulerClock = {
  now: () => new Date()
};

export function createSchedulerService(options: SchedulerServiceOptions): SchedulerService {
  const clock = options.clock ?? systemClock;

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
      return toScheduleResponse(schedule);
    },

    listSchedules() {
      return { schedules: options.repository.list().map(toScheduleResponse) };
    },

    getSchedule(id) {
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
        nextInput.nextRunAt = mergedEnabled || parsed.value.cron !== undefined || parsed.value.timezone !== undefined
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
    },

    runNow(id) {
      const schedule = requireSchedule(options.repository, id);
      const run = options.runManager.startRun({
        prompt: schedule.prompt,
        cwd: schedule.cwd,
        profile: schedule.profile,
        sandbox: schedule.sandbox,
        model: schedule.model ?? undefined,
        reasoning: schedule.reasoning ?? undefined,
        createdBy: 'schedule',
        sourceId: schedule.id,
        timeoutMs: schedule.timeoutMs ?? undefined
      });
      const updated = options.repository.recordRun({
        id: schedule.id,
        runId: run.id,
        ranAt: clock.now().toISOString(),
        status: run.status
      });
      if (updated === null) throw notFound();
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation: 'run_now',
        status: 'succeeded',
        runId: run.id
      });
      return {
        run,
        schedule: toScheduleResponse(updated),
        skipped: false,
        queued: false
      };
    },

    listOperations(id, limit) {
      requireSchedule(options.repository, id);
      return {
        operations: options.repository.listOperations(id, limit).map(toScheduleOperationResponse)
      };
    },

    start() {
      return;
    },

    stop() {
      return;
    },

    refreshTimer() {
      return;
    }
  };

  if (options.autostart === true) service.start();
  return service;
}

export function toScheduleResponse(schedule: ScheduleRecord): ScheduleResponse {
  return {
    id: schedule.id,
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

function toScheduleOperationResponse(
  operation: ScheduleOperationResponse
): ScheduleOperationResponse {
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
