import type { TaskItem, ThreadResponse } from '@opencreator/protocol';
import type { ScheduleTaskSummary } from '../schedules/schedule-task-model.js';

export type SidebarTaskStatus =
  | 'draft'
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

export type ScheduleSidebarTaskStatus = Exclude<SidebarTaskStatus, 'draft'>;

export type ScheduleSidebarTaskSummary = Omit<SidebarTaskSummary, 'status'> & {
  status: ScheduleSidebarTaskStatus;
};

export function createSidebarTaskSummaries(
  schedules: ScheduleTaskSummary[],
  runtimeTasks: TaskItem[],
  unreadTaskIds: ReadonlySet<string>
): ScheduleSidebarTaskSummary[] {
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

export function createScheduleDraftSidebarSummaries(
  drafts: ThreadResponse[],
  runtimeTasks: TaskItem[],
  unreadTaskIds: ReadonlySet<string>,
  runningThreadIds: ReadonlySet<string>
): SidebarTaskSummary[] {
  const runtimeTasksByThreadId = new Map<string, TaskItem[]>();
  for (const task of runtimeTasks) {
    if (task.threadId === undefined) continue;
    const threadTasks = runtimeTasksByThreadId.get(task.threadId) ?? [];
    threadTasks.push(task);
    runtimeTasksByThreadId.set(task.threadId, threadTasks);
  }

  return drafts.map(draft => {
    const threadTasks = runtimeTasksByThreadId.get(draft.id) ?? [];
    return {
      id: `draft:${draft.id}`,
      threadId: draft.id,
      name: draft.title?.trim() || '任务草稿',
      status: resolveScheduleDraftStatus(
        threadTasks,
        runningThreadIds.has(draft.id)
      ),
      unread: threadTasks.some(task => unreadTaskIds.has(task.id))
    };
  });
}

function resolveScheduleDraftStatus(
  runtimeTasks: TaskItem[],
  hasActiveRun: boolean
): SidebarTaskStatus {
  if (runtimeTasks.some(task => task.status === 'waiting_approval')) {
    return 'waiting_approval';
  }
  if (hasActiveRun || runtimeTasks.some(task => task.status === 'running')) {
    return 'running';
  }
  if (runtimeTasks.some(task => task.status === 'queued')) return 'queued';
  if (runtimeTasks[0]?.status === 'failed') return 'failed';
  return 'draft';
}

function resolveSidebarTaskStatus(
  schedule: ScheduleTaskSummary,
  runtimeTasks: TaskItem[]
): ScheduleSidebarTaskStatus {
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
