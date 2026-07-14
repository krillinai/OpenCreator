import type { TaskItem } from '@clawee/protocol';
import type { ScheduleTaskSummary } from '../schedules/schedule-task-model.js';

export type SidebarTaskStatus =
  | 'idle'
  | 'running'
  | 'queued'
  | 'waiting_approval'
  | 'failed'
  | 'paused'
  | 'repair_required';

export type SidebarTaskSummary = {
  id: string;
  threadId?: string;
  name: string;
  status: SidebarTaskStatus;
  nextRunLabel?: string;
  unread: boolean;
};

export function createSidebarTaskSummaries(
  schedules: ScheduleTaskSummary[],
  runtimeTasks: TaskItem[],
  unreadTaskIds: ReadonlySet<string>
): SidebarTaskSummary[] {
  const runtimeTasksByThreadId = new Map<string, TaskItem[]>();
  for (const task of runtimeTasks) {
    if (task.threadId === undefined) continue;
    const threadTasks = runtimeTasksByThreadId.get(task.threadId) ?? [];
    threadTasks.push(task);
    runtimeTasksByThreadId.set(task.threadId, threadTasks);
  }

  return schedules.map(schedule => {
    const threadId = schedule.threadId ?? undefined;
    const threadTasks = threadId === undefined
      ? []
      : runtimeTasksByThreadId.get(threadId) ?? [];
    const nextRunLabel = formatNextRunLabel(schedule.nextRunAt);
    return {
      id: schedule.scheduleId,
      ...(threadId === undefined ? {} : { threadId }),
      name: schedule.name,
      status: resolveSidebarTaskStatus(schedule, threadTasks),
      ...(nextRunLabel === undefined ? {} : { nextRunLabel }),
      unread: threadTasks.some(task => unreadTaskIds.has(task.id))
    };
  });
}

function resolveSidebarTaskStatus(
  schedule: ScheduleTaskSummary,
  runtimeTasks: TaskItem[]
): SidebarTaskStatus {
  if (schedule.bindingStatus === 'repair_required') return 'repair_required';
  if (runtimeTasks.some(task => task.status === 'waiting_approval')) return 'waiting_approval';
  if (
    schedule.currentRunStatus === 'running'
    || runtimeTasks.some(task => task.status === 'running')
  ) {
    return 'running';
  }
  if (
    schedule.currentRunStatus === 'queued'
    || runtimeTasks.some(task => task.status === 'queued')
    || schedule.pendingTrigger
  ) {
    return 'queued';
  }
  if (schedule.lastStatus === 'failed') return 'failed';
  if (!schedule.enabled) return 'paused';
  return 'idle';
}

function formatNextRunLabel(value: string | null): string | undefined {
  if (value === null) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return `下次 ${new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)}`;
}
