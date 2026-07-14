import type { TaskItem } from '@clawee/protocol';
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

export function createTaskNotification(task: TaskItem): {
  title: HostNotification['title'];
  body: HostNotification['body'];
  target?: HostNotification['target'];
} {
  if (task.createdBy === 'schedule' && task.status === 'succeeded') {
    return {
      title: '已安排提醒',
      body: task.title,
      target: 'schedules'
    };
  }

  const title = task.status === 'waiting_approval'
    ? '任务等待审批'
    : task.status === 'succeeded'
      ? '任务已完成'
      : task.status === 'canceled'
        ? '任务已取消'
        : '任务失败';
  const detail = task.errorMessage
    ?? (task.status === 'waiting_approval' ? task.pendingApproval?.summary : undefined)
    ?? task.cwd;
  return {
    title,
    body: `${task.title}：${detail}`
  };
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
