import type {
  PublicRunStatus,
  ScheduleLastStatus,
  ScheduleResponse,
  ThreadResponse
} from '@opencreator/protocol';
import {
  getThreadActiveRun,
  type RunRegistryState
} from '../runs/run-registry.js';

export type ScheduleTaskBindingIssue =
  | 'missing_thread_id'
  | 'thread_not_found'
  | 'thread_purpose_mismatch'
  | 'schedule_mismatch';

type ScheduleTaskSummaryBase = {
  scheduleId: string;
  name: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastStatus: ScheduleLastStatus | null;
  pendingTrigger: boolean;
};

export type ScheduleTaskSummary =
  | (ScheduleTaskSummaryBase & {
      threadId: string;
      bindingStatus: 'ready';
      currentRunStatus: PublicRunStatus | null;
    })
  | (ScheduleTaskSummaryBase & {
      threadId: string | null;
      bindingStatus: 'repair_required';
      bindingIssue: ScheduleTaskBindingIssue;
      statusMessage: '任务会话需要修复';
      currentRunStatus: null;
    });

export function createScheduleTaskSummaries(
  schedules: ScheduleResponse[],
  threads: ThreadResponse[],
  runRegistry: RunRegistryState
): ScheduleTaskSummary[] {
  const threadById = new Map(threads.map(thread => [thread.id, thread]));

  return schedules.map(schedule => {
    const base = createSummaryBase(schedule);
    const threadId = readScheduleThreadId(schedule);
    if (threadId === null) {
      return repairSummary(base, null, 'missing_thread_id');
    }

    const thread = threadById.get(threadId);
    if (thread === undefined) {
      return repairSummary(base, threadId, 'thread_not_found');
    }
    if (thread.purpose !== 'schedule_task') {
      return repairSummary(base, threadId, 'thread_purpose_mismatch');
    }
    if (thread.scheduleId !== schedule.id) {
      return repairSummary(base, threadId, 'schedule_mismatch');
    }

    return {
      ...base,
      threadId,
      bindingStatus: 'ready',
      currentRunStatus: getThreadActiveRun(runRegistry, threadId)?.status ?? null
    };
  });
}

function createSummaryBase(schedule: ScheduleResponse): ScheduleTaskSummaryBase {
  return {
    scheduleId: schedule.id,
    name: schedule.name,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt ?? null,
    lastStatus: schedule.lastStatus ?? null,
    pendingTrigger: schedule.pendingTrigger
  };
}

function readScheduleThreadId(schedule: ScheduleResponse): string | null {
  const threadId = (schedule as { threadId?: unknown }).threadId;
  return typeof threadId === 'string' && threadId.trim().length > 0
    ? threadId
    : null;
}

function repairSummary(
  base: ScheduleTaskSummaryBase,
  threadId: string | null,
  bindingIssue: ScheduleTaskBindingIssue
): ScheduleTaskSummary {
  return {
    ...base,
    threadId,
    bindingStatus: 'repair_required',
    bindingIssue,
    statusMessage: '任务会话需要修复',
    currentRunStatus: null
  };
}
