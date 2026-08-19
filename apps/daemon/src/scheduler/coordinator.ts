import type {
  CreateScheduleRequest,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import type { RunManager } from '../runs/manager.js';
import type { RuntimeThread, ThreadManager } from '../threads/types.js';
import { computeNextRunAt } from './cron.js';
import type { ScheduleRepository } from './repository.js';
import { SchedulerError, toScheduleResponse } from './service.js';
import type {
  BoundScheduleRecord,
  ProfileValidator,
  ScheduleRecord,
  SchedulerClock,
  ScheduleOperationActor
} from './types.js';
import { scheduleOperationActors } from './types.js';
import {
  parseCreateScheduleRequest,
  parseUpdateScheduleRequest,
  type NormalizedUpdateScheduleInput
} from './validator.js';

export type ScheduleCoordinator = {
  createManual(input: CreateScheduleRequest): ScheduleResponse;
  createFromAgent(
    input: CreateScheduleRequest | Record<string, unknown>,
    actor: ScheduleAgentActor
  ): ScheduleResponse;
  update(id: string, input: UpdateScheduleRequest): ScheduleResponse;
  updateFromAgent(
    id: string,
    input: UpdateScheduleRequest,
    actor: ScheduleAgentActor
  ): ScheduleResponse;
  delete(id: string): void;
  ensureBindings(): ScheduleBindingRepairResult;
};

export type ScheduleAgentActor = {
  runId: string;
  threadId: string;
  createdBy: 'api' | 'schedule';
};

export type ScheduleBindingRepairResult = {
  scanned: number;
  repaired: number;
  failed: number;
  unchanged: number;
};

export type ScheduleCoordinatorOptions = {
  db: Database.Database;
  repository: ScheduleRepository;
  threadManager: Pick<
    ThreadManager,
    | 'createScheduleThread'
    | 'getThread'
    | 'updateScheduleThread'
    | 'setPurpose'
    | 'archiveScheduleThread'
  >;
  runManager: Pick<RunManager, 'hasActiveRunForThread'>;
  defaultCwd: string;
  profileValidator: ProfileValidator;
  clock?: SchedulerClock;
  onSchedulesChanged?(): void;
};

const systemClock: SchedulerClock = {
  now: () => new Date()
};

export function createScheduleCoordinator(
  options: ScheduleCoordinatorOptions
): ScheduleCoordinator {
  const clock = options.clock ?? systemClock;
  const createManualTransaction = options.db.transaction(
    (input: CreateScheduleRequest): ScheduleResponse => {
      const parsed = parseCreateScheduleRequest(input, {
        now: clock.now().toISOString(),
        defaultCwd: options.defaultCwd,
        profileValidator: options.profileValidator
      });
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);

      const thread = options.threadManager.createScheduleThread({
        purpose: 'schedule_task',
        title: parsed.value.name,
        cwd: parsed.value.cwd,
        workspaceMode: 'external',
        profile: parsed.value.profile,
        model: parsed.value.model ?? undefined,
        reasoning: parsed.value.reasoning ?? undefined,
        sandbox: parsed.value.sandbox
      });
      const schedule = requireBoundSchedule(options.repository.create({
        ...parsed.value,
        threadId: thread.id
      }));
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation: 'create',
        status: 'succeeded'
      }, scheduleOperationActors.user);
      return toScheduleResponse(schedule);
    }
  );
  const createFromAgentTransaction = options.db.transaction(
    (
      input: CreateScheduleRequest | Record<string, unknown>,
      actor: ScheduleAgentActor
    ): ScheduleResponse => {
      const actorThread = requireAgentCreationThread(actor, options.threadManager);
      const parsed = parseCreateScheduleRequest(
        agentCreateRequest(input, actorThread),
        {
          now: clock.now().toISOString(),
          defaultCwd: actorThread.cwd,
          profileValidator: options.profileValidator
        }
      );
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);

      if (actorThread.purpose === 'schedule_draft') {
        const created = requireBoundSchedule(options.repository.create({
          ...parsed.value,
          threadId: actorThread.id
        }));
        options.threadManager.setPurpose(actorThread.id, 'schedule_task');
        options.threadManager.updateScheduleThread(actorThread.id, {
          title: parsed.value.name,
          cwd: parsed.value.cwd,
          profile: parsed.value.profile,
          model: parsed.value.model,
          reasoning: parsed.value.reasoning,
          sandbox: parsed.value.sandbox
        });
        options.repository.insertOperation({
          scheduleId: created.id,
          operation: 'create',
          status: 'succeeded'
        }, scheduleOperationActors.agent(actor.runId));
        return toScheduleResponse(created);
      }

      const thread = options.threadManager.createScheduleThread({
        purpose: 'schedule_task',
        title: parsed.value.name,
        cwd: parsed.value.cwd,
        workspaceMode: 'external',
        profile: parsed.value.profile,
        model: parsed.value.model ?? undefined,
        reasoning: parsed.value.reasoning ?? undefined,
        sandbox: parsed.value.sandbox
      });
      const schedule = requireBoundSchedule(options.repository.create({
        ...parsed.value,
        threadId: thread.id
      }));
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation: 'create',
        status: 'succeeded'
      }, scheduleOperationActors.agent(actor.runId));
      return toScheduleResponse(schedule);
    }
  );
  const updateTransaction = options.db.transaction(
    (
      id: string,
      input: UpdateScheduleRequest,
      actor: ScheduleOperationActor
    ): ScheduleResponse => {
      const existing = requireSchedule(options.repository, id);
      const thread = requireScheduleThread(existing, options.threadManager);
      const parsed = parseUpdateScheduleRequest(input, {
        now: clock.now().toISOString(),
        defaultCwd: existing.cwd,
        profileValidator: options.profileValidator
      });
      if (!parsed.ok) throw new SchedulerError(parsed.code, parsed.message);
      if (
        touchesExecutionConfiguration(parsed.value)
        && options.runManager.hasActiveRunForThread(thread.id)
      ) {
        throw new SchedulerError(
          'SCHEDULE_HAS_ACTIVE_RUN',
          'Schedule has an active run'
        );
      }

      const nextInput = { ...parsed.value };
      if (requiresNextRunRecompute(parsed.value)) {
        const mergedEnabled = parsed.value.enabled ?? existing.enabled;
        const mergedCron = parsed.value.cron ?? existing.cron;
        const mergedTimezone = parsed.value.timezone ?? existing.timezone;
        nextInput.nextRunAt = mergedEnabled
          ? computeNextRunAt({
              cron: mergedCron,
              timezone: mergedTimezone,
              from: clock.now()
            })
          : null;
      }

      const updated = options.repository.update(id, nextInput);
      if (updated === null) throw notFound();
      const bound = requireBoundSchedule(updated);
      if (touchesThreadConfiguration(parsed.value)) {
        options.threadManager.updateScheduleThread(bound.threadId, {
          title: bound.name,
          cwd: bound.cwd,
          profile: bound.profile,
          model: bound.model,
          reasoning: bound.reasoning,
          sandbox: bound.sandbox
        });
      }
      options.repository.insertOperation({
        scheduleId: id,
        operation: 'update',
        status: 'succeeded'
      }, actor);
      return toScheduleResponse(bound);
    }
  );
  const deleteTransaction = options.db.transaction((id: string): void => {
    const existing = requireSchedule(options.repository, id);
    const thread = requireScheduleThread(existing, options.threadManager);
    if (options.runManager.hasActiveRunForThread(thread.id)) {
      throw new SchedulerError(
        'SCHEDULE_HAS_ACTIVE_RUN',
        'Schedule has an active run'
      );
    }

    const disabled = options.repository.update(id, {
      enabled: false,
      nextRunAt: null
    });
    if (disabled === null) throw notFound();
    if (!options.repository.softDelete(id)) throw notFound();
    options.threadManager.archiveScheduleThread(thread.id);
    options.repository.insertOperation({
      scheduleId: id,
      operation: 'delete',
      status: 'succeeded'
    }, scheduleOperationActors.user);
  });
  const repairBindingTransaction = options.db.transaction((schedule: ScheduleRecord): void => {
    const thread = options.threadManager.createScheduleThread({
      purpose: 'schedule_task',
      title: schedule.name,
      cwd: schedule.cwd,
      workspaceMode: 'external',
      profile: schedule.profile,
      model: schedule.model ?? undefined,
      reasoning: schedule.reasoning ?? undefined,
      sandbox: schedule.sandbox
    });
    const updated = options.repository.update(schedule.id, { threadId: thread.id });
    if (updated === null) throw notFound();
    options.repository.insertOperation({
      scheduleId: schedule.id,
      operation: 'binding_repair',
      status: 'succeeded'
    }, scheduleOperationActors.migration);
  });
  const recordBindingRepairFailureTransaction = options.db.transaction(
    (schedule: ScheduleRecord, error: unknown): void => {
      const updated = options.repository.update(schedule.id, {
        enabled: false,
        nextRunAt: null
      });
      if (updated === null) throw notFound();
      options.repository.insertOperation({
        scheduleId: schedule.id,
        operation: 'binding_repair_failed',
        status: 'failed',
        errorCode: bindingRepairErrorCode(error),
        errorMessage: formatError(error)
      }, scheduleOperationActors.migration);
    }
  );

  return {
    createManual(input: CreateScheduleRequest): ScheduleResponse {
      const schedule = createManualTransaction(input);
      options.onSchedulesChanged?.();
      return schedule;
    },

    createFromAgent(
      input: CreateScheduleRequest | Record<string, unknown>,
      actor: ScheduleAgentActor
    ): ScheduleResponse {
      const schedule = createFromAgentTransaction(input, actor);
      options.onSchedulesChanged?.();
      return schedule;
    },

    update(id: string, input: UpdateScheduleRequest): ScheduleResponse {
      const schedule = updateTransaction(id, input, scheduleOperationActors.user);
      options.onSchedulesChanged?.();
      return schedule;
    },

    updateFromAgent(
      id: string,
      input: UpdateScheduleRequest,
      actor: ScheduleAgentActor
    ): ScheduleResponse {
      const schedule = updateTransaction(
        id,
        input,
        scheduleOperationActors.agent(actor.runId)
      );
      options.onSchedulesChanged?.();
      return schedule;
    },

    delete(id: string): void {
      deleteTransaction(id);
      options.onSchedulesChanged?.();
    },

    ensureBindings(): ScheduleBindingRepairResult {
      const schedules = options.repository.list();
      const result: ScheduleBindingRepairResult = {
        scanned: schedules.length,
        repaired: 0,
        failed: 0,
        unchanged: 0
      };

      for (const schedule of schedules) {
        if (hasValidScheduleThread(schedule, options.threadManager)) {
          result.unchanged += 1;
          continue;
        }
        try {
          repairBindingTransaction(schedule);
          result.repaired += 1;
        } catch (error) {
          recordBindingRepairFailureTransaction(schedule, error);
          result.failed += 1;
        }
      }

      if (result.repaired > 0 || result.failed > 0) options.onSchedulesChanged?.();
      return result;
    }
  };
}

function requireAgentCreationThread(
  actor: ScheduleAgentActor,
  threadManager: Pick<ThreadManager, 'getThread'>
): RuntimeThread {
  const thread = threadManager.getThread(actor.threadId);
  if (thread === undefined) {
    throw new SchedulerError(
      'SCHEDULE_THREAD_MISSING',
      `Agent thread is missing: ${actor.threadId}`
    );
  }
  if (thread.status === 'archived') {
    throw new SchedulerError(
      'SCHEDULE_THREAD_ARCHIVED',
      `Agent thread is archived: ${actor.threadId}`
    );
  }
  if (thread.purpose === 'schedule_task') {
    throw new SchedulerError(
      'VALIDATION_FAILED',
      'A schedule task thread cannot create another schedule'
    );
  }
  return thread;
}

function agentCreateRequest(
  input: CreateScheduleRequest | Record<string, unknown>,
  thread: RuntimeThread
): Record<string, unknown> {
  if (!isPlainObject(input)) return {};
  return {
    name: input.name,
    cron: input.cron,
    timezone: input.timezone,
    enabled: input.enabled,
    prompt: input.prompt,
    concurrencyPolicy: input.concurrencyPolicy,
    cwd: thread.cwd,
    profile: thread.profile,
    model: thread.model ?? null,
    reasoning: thread.reasoning ?? null,
    sandbox: thread.sandbox
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function requireSchedule(repository: ScheduleRepository, id: string): ScheduleRecord {
  const schedule = repository.getById(id);
  if (schedule === null) throw notFound();
  return schedule;
}

function requireScheduleThread(
  schedule: ScheduleRecord,
  threadManager: Pick<ThreadManager, 'getThread'>
) {
  if (schedule.threadId === null) {
    throw new SchedulerError(
      'SCHEDULE_THREAD_MISSING',
      `Schedule thread binding is missing: ${schedule.id}`
    );
  }
  const thread = threadManager.getThread(schedule.threadId);
  if (thread === undefined || thread.purpose !== 'schedule_task') {
    throw new SchedulerError(
      'SCHEDULE_THREAD_MISSING',
      `Schedule thread is missing: ${schedule.id}`
    );
  }
  if (thread.status === 'archived') {
    throw new SchedulerError(
      'SCHEDULE_THREAD_ARCHIVED',
      `Schedule thread is archived: ${schedule.id}`
    );
  }
  return thread;
}

function hasValidScheduleThread(
  schedule: ScheduleRecord,
  threadManager: Pick<ThreadManager, 'getThread'>
): boolean {
  if (schedule.threadId === null) return false;
  const thread = threadManager.getThread(schedule.threadId);
  return thread !== undefined
    && thread.purpose === 'schedule_task'
    && thread.status === 'active';
}

function touchesExecutionConfiguration(input: NormalizedUpdateScheduleInput): boolean {
  return hasAnyOwnProperty(input, [
    'cwd',
    'profile',
    'model',
    'reasoning',
    'sandbox'
  ]);
}

function touchesThreadConfiguration(input: NormalizedUpdateScheduleInput): boolean {
  return hasAnyOwnProperty(input, [
    'name',
    'cwd',
    'profile',
    'model',
    'reasoning',
    'sandbox'
  ]);
}

function hasAnyOwnProperty(
  input: NormalizedUpdateScheduleInput,
  keys: Array<keyof NormalizedUpdateScheduleInput>
): boolean {
  return keys.some(key => Object.prototype.hasOwnProperty.call(input, key));
}

function requiresNextRunRecompute(input: NormalizedUpdateScheduleInput): boolean {
  return input.cron !== undefined || input.timezone !== undefined || input.enabled !== undefined;
}

function notFound(): SchedulerError {
  return new SchedulerError('SCHEDULE_NOT_FOUND', 'Schedule not found');
}

function bindingRepairErrorCode(error: unknown): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'INTERNAL_ERROR';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
