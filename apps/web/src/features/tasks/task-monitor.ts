import type { TaskItem } from '@opencreator/protocol';
import type { ActiveView } from '../../app/app-state.js';
import type { HostNotification } from '../../host/bridge.js';

const NOTIFIABLE_STATUSES: ReadonlySet<TaskItem['status']> = new Set([
  'waiting_approval',
  'succeeded',
  'failed',
  'canceled'
]);

export function collectTaskTransitions(
  previous: ReadonlyMap<string, TaskItem['status']>,
  tasks: TaskItem[],
  baselineReady: boolean
): {
  statuses: Map<string, TaskItem['status']>;
  transitions: TaskItem[];
} {
  const statuses = new Map(tasks.map(task => [task.id, task.status]));
  if (!baselineReady) return { statuses, transitions: [] };

  return {
    statuses,
    transitions: tasks.filter(task => (
      NOTIFIABLE_STATUSES.has(task.status)
      && previous.get(task.id) !== task.status
    ))
  };
}

export function shouldAutoSubscribeTask(
  task: TaskItem,
  transitioned = false
): boolean {
  return task.status === 'queued'
    || task.status === 'running'
    || task.status === 'waiting_approval'
    || (transitioned && NOTIFIABLE_STATUSES.has(task.status));
}

export function createTaskNotification(task: TaskItem): {
  title: HostNotification['title'];
  body: HostNotification['body'];
  threadId?: HostNotification['threadId'];
  runId: HostNotification['runId'];
  approvalId?: HostNotification['approvalId'];
} {
  const target = {
    ...(task.threadId === undefined ? {} : { threadId: task.threadId }),
    runId: task.runId,
    ...(task.pendingApproval?.id === undefined
      ? {}
      : { approvalId: task.pendingApproval.id })
  };
  const detail = notificationDetail(task);

  if (task.createdBy === 'schedule') {
    return {
      title: task.status === 'waiting_approval'
        ? `${task.title}等待审批`
        : task.status === 'failed'
          ? `${task.title}失败`
          : task.status === 'canceled'
            ? `${task.title}已取消`
            : task.title,
      body: detail,
      ...target
    };
  }

  const title = task.status === 'waiting_approval'
    ? '任务等待审批'
    : task.status === 'succeeded'
      ? '任务已完成'
      : task.status === 'canceled'
        ? '任务已取消'
        : '任务失败';
  return {
    title,
    body: `${task.title}：${detail}`,
    ...target
  };
}

function notificationDetail(task: TaskItem): string {
  switch (task.status) {
    case 'waiting_approval':
      return task.pendingApproval?.summary ?? '需要你的审批。';
    case 'succeeded':
      return task.resultSummary ?? '任务已完成。';
    case 'failed':
      return task.failureSummary ?? '任务未完成，请打开会话查看详情。';
    case 'canceled':
      return '本次任务已取消。';
    case 'queued':
      return '任务正在排队。';
    case 'running':
      return '任务正在运行。';
  }
}

export function shouldSendSystemNotification(
  task: TaskItem,
  activeView: ActiveView,
  selectedThreadId?: string
): boolean {
  return task.threadId === undefined
    || activeView !== 'conversation'
    || selectedThreadId !== task.threadId;
}
