import type { ScheduleResponse } from '@clawee/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SchedulesView } from './SchedulesView.js';

describe('SchedulesView', () => {
  it('shows workspace-write risk copy', () => {
    render(<SchedulesView connected schedules={[]} />);
    expect(screen.getByText('计划任务默认使用 workspace-write，可能在无人值守时修改工作区。')).toBeInTheDocument();
    expect(screen.getByText('暂无计划任务')).toBeInTheDocument();
  });

  it('shows disconnected copy when runtime is unavailable', () => {
    render(<SchedulesView connected={false} />);
    expect(screen.getByText('本机 Runtime 就绪后管理计划任务')).toBeInTheDocument();
  });

  it('renders schedule list items when schedules exist', () => {
    const schedule: ScheduleResponse = {
      id: 'schedule-1',
      name: '每日总结',
      cron: '0 18 * * *',
      timezone: 'Asia/Shanghai',
      enabled: true,
      promptPreviewRedacted: '总结今天的项目进展',
      profile: 'default',
      cwd: '/Users/wulien/develop/clawee/clawee-agent',
      canonicalCwd: '/Users/wulien/develop/clawee/clawee-agent',
      sandbox: 'workspace-write',
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip',
      pendingTrigger: false,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };

    render(<SchedulesView connected schedules={[schedule]} />);

    expect(screen.getByText('每日总结')).toBeInTheDocument();
    expect(screen.getByText('0 18 * * *')).toBeInTheDocument();
    expect(screen.queryByText('暂无计划任务')).not.toBeInTheDocument();
  });
});
