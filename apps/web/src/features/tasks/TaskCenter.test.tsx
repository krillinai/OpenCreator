import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskCenter } from './TaskCenter.js';

const pendingTask = {
  id: 'run_1',
  runId: 'run_1',
  threadId: 'thread_1',
  title: '构建任务',
  status: 'waiting_approval' as const,
  runStatus: 'running' as const,
  cwd: '/workspace',
  profile: 'default',
  createdBy: 'api',
  submissionMode: 'enqueue' as const,
  createdAt: '2026-07-12T10:00:00.000Z',
  updatedAt: '2026-07-12T10:01:00.000Z',
  pendingApproval: {
    id: 'approval_1',
    runId: 'run_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    itemId: 'item_1',
    requestId: 'rpc_1',
    kind: 'command_execution' as const,
    status: 'pending' as const,
    risk: 'high' as const,
    title: '允许执行命令',
    summary: 'rm -rf build',
    details: { command: 'rm -rf build' },
    requestedAt: '2026-07-12T10:00:00.000Z',
    expiresAt: '2026-07-12T10:10:00.000Z'
  }
};

describe('TaskCenter', () => {
  it('loads tasks, opens the selected run, and clears unread state', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    const onMarkRead = vi.fn();
    const onClearUnread = vi.fn();
    render(
      <TaskCenter
        service={{ list: vi.fn(async () => ({ tasks: [pendingTask], hasMore: false })) }}
        approvalService={null}
        notificationSettings={{ enabled: false, permission: 'default' }}
        unreadIds={new Set(['run_1'])}
        onEnableNotifications={vi.fn()}
        onDisableNotifications={vi.fn()}
        onClearUnread={onClearUnread}
        onOpenTask={onOpenTask}
        onMarkRead={onMarkRead}
      />
    );

    await user.click(await screen.findByRole('button', { name: /构建任务/ }));
    expect(onMarkRead).toHaveBeenCalledWith('run_1');
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'run_1' }));

    await user.click(screen.getByRole('button', { name: '全部已读' }));
    expect(onClearUnread).toHaveBeenCalledTimes(1);
  });

  it('filters tasks and resolves pending approvals', async () => {
    const user = userEvent.setup();
    const list = vi.fn(async () => ({ tasks: [pendingTask], hasMore: false }));
    const approve = vi.fn(async () => ({
      approval: {
        ...pendingTask.pendingApproval,
        status: 'approved' as const
      },
      changed: true
    }));
    render(
      <TaskCenter
        service={{ list }}
        approvalService={{ approve, reject: vi.fn() }}
        notificationSettings={{ enabled: true, permission: 'granted' }}
        unreadIds={new Set()}
        onEnableNotifications={vi.fn()}
        onDisableNotifications={vi.fn()}
        onClearUnread={vi.fn()}
        onOpenTask={vi.fn()}
        onMarkRead={vi.fn()}
      />
    );

    await user.click(await screen.findByRole('tab', { name: '待审批' }));
    expect(list).toHaveBeenLastCalledWith({
      status: 'waiting_approval',
      limit: 20
    });

    await user.click(await screen.findByRole('button', { name: '批准' }));
    expect(approve).toHaveBeenCalledWith('approval_1');
  });

  it('shows actionable guidance after three project directory failures', async () => {
    const user = userEvent.setup();
    const onEditSchedule = vi.fn();
    const onPauseSchedule = vi.fn(async () => undefined);
    render(
      <TaskCenter
        service={{
          list: vi.fn(async () => ({
            tasks: [{
              ...pendingTask,
              id: 'run_failed',
              runId: 'run_failed',
              status: 'failed' as const,
              runStatus: 'failed' as const,
              createdBy: 'schedule',
              scheduleId: 'schedule_1',
              pendingApproval: undefined,
              failureKind: 'project_directory' as const,
              failureSummary: '项目目录不存在或无法访问，请编辑项目后重试。',
              consecutiveFailureCount: 3,
              suggestPause: true
            }],
            hasMore: false
          }))
        }}
        approvalService={null}
        notificationSettings={{ enabled: false, permission: 'default' }}
        unreadIds={new Set()}
        onEnableNotifications={vi.fn()}
        onDisableNotifications={vi.fn()}
        onClearUnread={vi.fn()}
        onOpenTask={vi.fn()}
        onMarkRead={vi.fn()}
        onEditSchedule={onEditSchedule}
        onPauseSchedule={onPauseSchedule}
      />
    );

    expect(await screen.findByText('项目目录不存在或无法访问，请编辑项目后重试。'))
      .toBeInTheDocument();
    expect(screen.queryByText('/workspace')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑项目' }));
    await user.click(screen.getByRole('button', { name: '暂停任务' }));

    expect(onEditSchedule).toHaveBeenCalledWith('schedule_1');
    expect(onPauseSchedule).toHaveBeenCalledWith('schedule_1');
  });
});
