import type {
  ApprovalDecisionResponse,
  TaskItem,
  TaskListResponse,
  TaskStatusFilter
} from '@opencreator/protocol';
import {
  Bell,
  BellOff,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FolderOpen,
  LoaderCircle,
  PauseCircle,
  RefreshCw,
  X
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NotificationSettings } from '../../services/notification-service.js';
import './task-center.css';

type TaskService = {
  list(query: {
    status: TaskStatusFilter;
    limit: number;
    cursor?: string;
  }): Promise<TaskListResponse>;
};

type ApprovalService = {
  approve(id: string): Promise<ApprovalDecisionResponse>;
  reject(id: string): Promise<ApprovalDecisionResponse>;
};

const FILTERS: Array<{ value: TaskStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'waiting_approval', label: '待审批' },
  { value: 'terminal', label: '已结束' },
  { value: 'failed', label: '失败' }
];

export function TaskCenter(props: {
  service: TaskService | null;
  approvalService: ApprovalService | null;
  notificationSettings: NotificationSettings;
  unreadIds: ReadonlySet<string>;
  onEnableNotifications(): Promise<void> | void;
  onDisableNotifications(): void;
  onClearUnread(): void;
  onOpenTask(task: TaskItem): void;
  onMarkRead(id: string): void;
  onEditSchedule?(scheduleId: string): void;
  onPauseSchedule?(scheduleId: string): Promise<void> | void;
}) {
  const [filter, setFilter] = useState<TaskStatusFilter>('all');
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void loadTasks(true);
  }, [filter, props.service]);

  async function loadTasks(reset: boolean) {
    if (props.service === null) {
      setTasks([]);
      setError('本地运行内核未连接');
      return;
    }
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setError(undefined);
    try {
      const response = await props.service.list({
        status: filter,
        limit: 20,
        ...(reset || cursor === undefined ? {} : { cursor })
      });
      setTasks(current => reset ? response.tasks : mergeTasks(current, response.tasks));
      setCursor(response.nextCursor);
      setHasMore(response.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法加载任务');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function resolveApproval(task: TaskItem, decision: 'approve' | 'reject') {
    const approval = task.pendingApproval;
    if (
      approval === undefined
      || props.approvalService === null
      || resolvingIds.has(task.id)
    ) {
      return;
    }
    setResolvingIds(current => new Set(current).add(task.id));
    setError(undefined);
    try {
      const response = decision === 'approve'
        ? await props.approvalService.approve(approval.id)
        : await props.approvalService.reject(approval.id);
      setTasks(current => current.map(item => (
        item.id === task.id
          ? {
              ...item,
              status: item.runStatus,
              pendingApproval: response.approval
            }
          : item
      )));
      await loadTasks(true);
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : '审批操作失败');
    } finally {
      setResolvingIds(current => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  async function pauseSchedule(scheduleId: string) {
    if (props.onPauseSchedule === undefined) return;
    setError(undefined);
    try {
      await props.onPauseSchedule(scheduleId);
      await loadTasks(true);
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : '无法暂停任务');
    }
  }

  return (
    <section className="task-center">
      <div className="task-center__inner">
        <header className="task-center__header">
          <div>
            <h1>任务中心</h1>
            <p>查看跨会话运行、待审批操作和最近结果。</p>
          </div>
          <div className="task-center__header-actions">
            {props.unreadIds.size > 0 ? (
              <button type="button" onClick={props.onClearUnread}>
                <Check size={15} aria-hidden="true" />
                全部已读
              </button>
            ) : null}
            {props.notificationSettings.enabled ? (
              <button type="button" onClick={props.onDisableNotifications}>
                <BellOff size={15} aria-hidden="true" />
                关闭通知
              </button>
            ) : (
              <button
                type="button"
                disabled={props.notificationSettings.permission === 'denied'}
                onClick={() => void props.onEnableNotifications()}
              >
                <Bell size={15} aria-hidden="true" />
                开启通知
              </button>
            )}
            <button
              type="button"
              aria-label="刷新任务"
              title="刷新任务"
              onClick={() => void loadTasks(true)}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="task-center__filters" role="tablist" aria-label="任务筛选">
          {FILTERS.map(item => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? <p className="task-center__error" role="alert">{error}</p> : null}
        {loading ? (
          <div className="task-center__state" role="status">
            <LoaderCircle className="task-center__spin" size={22} />
            正在加载任务
          </div>
        ) : tasks.length === 0 ? (
          <div className="task-center__state">
            <Clock3 size={22} />
            <strong>当前筛选下没有任务</strong>
          </div>
        ) : (
          <ul className="task-center__list">
            {tasks.map(task => (
              <TaskRow
                key={task.id}
                task={task}
                unread={props.unreadIds.has(task.id)}
                resolving={resolvingIds.has(task.id)}
                onOpen={() => {
                  props.onMarkRead(task.id);
                  props.onOpenTask(task);
                }}
                onApprove={() => void resolveApproval(task, 'approve')}
                onReject={() => void resolveApproval(task, 'reject')}
                onEditSchedule={
                  task.scheduleId === undefined || props.onEditSchedule === undefined
                    ? undefined
                    : () => props.onEditSchedule?.(task.scheduleId!)
                }
                onPauseSchedule={
                  task.scheduleId === undefined || props.onPauseSchedule === undefined
                    ? undefined
                    : () => pauseSchedule(task.scheduleId!)
                }
              />
            ))}
          </ul>
        )}

        {hasMore ? (
          <button
            className="task-center__load-more"
            type="button"
            disabled={loadingMore}
            onClick={() => void loadTasks(false)}
          >
            {loadingMore ? <LoaderCircle className="task-center__spin" size={15} /> : null}
            {loadingMore ? '正在加载' : '加载更多'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function TaskRow(props: {
  task: TaskItem;
  unread: boolean;
  resolving: boolean;
  onOpen(): void;
  onApprove(): void;
  onReject(): void;
  onEditSchedule?(): void;
  onPauseSchedule?(): Promise<void> | void;
}) {
  const approval = props.task.pendingApproval?.status === 'pending'
    ? props.task.pendingApproval
    : undefined;
  return (
    <li className="task-row" data-unread={props.unread ? 'true' : undefined}>
      <button className="task-row__main" type="button" onClick={props.onOpen}>
        <span className={`task-row__status task-row__status--${props.task.status}`}>
          {props.task.status === 'failed' ? <CircleAlert size={15} /> : null}
          {formatStatus(props.task.status)}
        </span>
        <span className="task-row__content">
          <strong>{props.task.title}</strong>
          <span>{taskSummary(props.task)}</span>
        </span>
        <span className="task-row__time">
          <span>{formatTime(props.task.startedAt ?? props.task.createdAt)}</span>
          <span>{formatDuration(props.task)}</span>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {approval ? (
        <div className="task-row__approval">
          <div>
            <strong>{approval.title}</strong>
            <code>{approval.summary}</code>
          </div>
          <div>
            <button type="button" disabled={props.resolving} onClick={props.onReject}>
              <X size={14} aria-hidden="true" />
              拒绝
            </button>
            <button
              className="task-row__approve"
              type="button"
              disabled={props.resolving}
              onClick={props.onApprove}
            >
              <Check size={14} aria-hidden="true" />
              批准
            </button>
          </div>
        </div>
      ) : null}
      {props.task.failureKind === 'project_directory' ? (
        <div className="task-row__failure-guidance">
          <div>
            <strong>
              {props.task.consecutiveFailureCount === undefined
                ? '项目目录需要更新'
                : `已连续失败 ${props.task.consecutiveFailureCount} 次`}
            </strong>
            <span>
              {props.task.suggestPause
                ? '建议先暂停任务，更新项目目录后再恢复。'
                : '更新项目目录后可以重新执行。'}
            </span>
          </div>
          <div>
            {props.onEditSchedule === undefined ? null : (
              <button type="button" onClick={props.onEditSchedule}>
                <FolderOpen size={14} aria-hidden="true" />
                编辑项目
              </button>
            )}
            {!props.task.suggestPause || props.onPauseSchedule === undefined ? null : (
              <button type="button" onClick={() => void props.onPauseSchedule?.()}>
                <PauseCircle size={14} aria-hidden="true" />
                暂停任务
              </button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function mergeTasks(current: TaskItem[], incoming: TaskItem[]): TaskItem[] {
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function formatStatus(status: TaskItem['status']): string {
  switch (status) {
    case 'waiting_approval':
      return '等待审批';
    case 'queued':
      return '排队中';
    case 'running':
      return '运行中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'canceled':
      return '已取消';
  }
}

function taskSummary(task: TaskItem): string {
  if (task.failureSummary) return task.failureSummary;
  if (task.status === 'waiting_approval' && task.pendingApproval !== undefined) {
    return task.pendingApproval.summary;
  }
  if (task.status === 'queued' && task.queuePosition !== undefined) {
    return `队列第 ${task.queuePosition} 位 · ${task.cwd}`;
  }
  if (task.status === 'failed') return '任务未完成，请打开会话查看详情。';
  return `${task.profile} · ${task.cwd}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatDuration(task: TaskItem): string {
  const start = new Date(task.startedAt ?? task.createdAt).getTime();
  const end = new Date(task.endedAt ?? task.updatedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '时长未知';
  const seconds = Math.max(0, Math.round((end - start) / 1_000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds === 0
    ? `${minutes} 分钟`
    : `${minutes} 分 ${remainingSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours} 小时` : `${hours} 小时 ${remainingMinutes} 分`;
}
