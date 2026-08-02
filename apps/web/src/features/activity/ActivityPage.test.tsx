import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPage } from './ActivityPage.js';

describe('ActivityPage static prototype', () => {
  it('switches between complete administrator and employee workbench views', async () => {
    const user = userEvent.setup();
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Agent 活动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '管理员视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('活跃员工')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '员工用量' })).toBeInTheDocument();
    expect(screen.getByText('输入 Token')).toBeInTheDocument();
    expect(screen.getByText('缓存输入')).toBeInTheDocument();
    expect(screen.getByText('推理输出')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '员工视图' }));
    expect(screen.getByText('我的 Token')).toBeInTheDocument();
    expect(screen.getByText('模型分布')).toBeInTheDocument();
    expect(screen.getByText('Agent 分布')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '最近轮次' })).toBeInTheDocument();
  });

  it('searches employees and navigates rows to representative agent details', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={onNavigate} />);

    await user.type(screen.getByRole('searchbox', { name: '搜索员工' }), '林夏');
    const table = screen.getByRole('table', { name: '员工用量' });
    expect(within(table).getByText('林夏')).toBeInTheDocument();
    expect(within(table).queryByText('周宁')).not.toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: /查看林夏的 Agent/ }));
    expect(onNavigate).toHaveBeenCalledWith({
      view: 'activity-agent',
      collectorId: 'collector-shanghai',
      agentId: 'agent-research',
      range: '7d'
    });
  });

  it('renders partial and missing usage explicitly', () => {
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);
    expect(screen.getByText('部分数据')).toBeInTheDocument();
    expect(screen.getByText('暂无用量数据')).toBeInTheDocument();
  });

  it('shows detail activity while exposing only sanitized tool metadata', () => {
    render(<ActivityPage route={{ view: 'activity-agent', collectorId: 'collector-shanghai', agentId: 'agent-research', range: '7d' }} onNavigate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '研究助理' })).toBeInTheDocument();
    expect(screen.getByText('会话与轮次')).toBeInTheDocument();
    expect(screen.getByText('活动记录')).toBeInTheDocument();
    expect(screen.getByText('子 Agent')).toBeInTheDocument();
    expect(screen.getByText('WebSearch')).toBeInTheDocument();
    expect(screen.getByText('工具调用')).toBeInTheDocument();
    expect(screen.getByText('1.8 秒')).toBeInTheDocument();
    expect(screen.queryByText(/private customer query/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw tool response/i)).not.toBeInTheDocument();
  });
});
