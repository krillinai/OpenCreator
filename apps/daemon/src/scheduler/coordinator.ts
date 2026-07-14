import type { CreateScheduleRequest, ScheduleResponse } from '@clawee/protocol';
import type Database from 'better-sqlite3';
import type { ThreadManager } from '../threads/types.js';
import type { ScheduleRepository } from './repository.js';
import { SchedulerError, toScheduleResponse } from './service.js';
import type {
  BoundScheduleRecord,
  ProfileValidator,
  ScheduleRecord,
  SchedulerClock
} from './types.js';
import { parseCreateScheduleRequest } from './validator.js';

export type ScheduleCoordinator = {
  createManual(input: CreateScheduleRequest): ScheduleResponse;
};

export type ScheduleCoordinatorOptions = {
  db: Database.Database;
  repository: ScheduleRepository;
  threadManager: Pick<ThreadManager, 'createThread'>;
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

      const thread = options.threadManager.createThread({
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
      });
      return toScheduleResponse(schedule);
    }
  );

  return {
    createManual(input: CreateScheduleRequest): ScheduleResponse {
      const schedule = createManualTransaction(input);
      options.onSchedulesChanged?.();
      return schedule;
    }
  };
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
