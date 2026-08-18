import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalPanel } from './ApprovalPanel.js';

const approval = {
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
  details: {
    command: 'rm -rf build',
    cwd: '/workspace'
  },
  requestedAt: '2026-07-12T10:00:00.000Z',
  expiresAt: '2026-07-12T10:10:00.000Z'
};

describe('ApprovalPanel', () => {
  it('shows decision context and invokes approve or reject', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ApprovalPanel
        approval={approval}
        onApprove={onApprove}
        onReject={onReject}
      />
    );

    expect(screen.getByText('终端')).toBeInTheDocument();
    expect(screen.getByText('允许 OpenCreator 执行这条命令？')).toBeInTheDocument();
    expect(screen.getByText('仅本次')).toBeInTheDocument();
    expect(screen.getByText('查看操作详情')).toBeInTheDocument();
    expect(screen.getByText('rm -rf build')).toBeInTheDocument();
    expect(screen.getByText('/workspace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '允许一次' }));
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));

    expect(onApprove).toHaveBeenCalledWith('approval_1');
    expect(onReject).toHaveBeenCalledWith('approval_1');
  });

  it('renders a terminal decision without action buttons', () => {
    render(
      <ApprovalPanel
        approval={{ ...approval, status: 'rejected', resolvedAt: '2026-07-12T10:01:00.000Z' }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('已拒绝')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '允许一次' })).not.toBeInTheDocument();
  });

  it('explains an expired approval without exposing technical codes', () => {
    render(
      <ApprovalPanel
        approval={{
          ...approval,
          status: 'expired',
          resolvedAt: '2026-07-12T10:10:00.000Z',
          resolutionReason: 'approval_timeout'
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('审批已过期，本次任务不会继续执行。')).toBeInTheDocument();
    expect(screen.queryByText('approval_timeout')).not.toBeInTheDocument();
  });
});
