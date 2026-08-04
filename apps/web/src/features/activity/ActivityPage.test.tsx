import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActivityPage } from './ActivityPage.js';

describe('ActivityPage static prototype', () => {
  it('renders the administrator workbench without an employee view switch', () => {
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Agent动态' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '管理员视图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '员工视图' })).not.toBeInTheDocument();
    expect(screen.getByText('活跃员工')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '员工用量' })).toBeInTheDocument();
    expect(screen.getByText('输入 Token')).toBeInTheDocument();
    expect(screen.getByText('缓存输入')).toBeInTheDocument();
    expect(screen.getByText('推理输出')).toBeInTheDocument();
    expect(screen.getByText('Skill 使用分布')).toBeInTheDocument();
    expect(screen.getByText('MCP 使用分布')).toBeInTheDocument();
    expect(screen.getByText('网页检索').closest('p')).toHaveTextContent('18 次 · 38%');
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

    await user.clear(screen.getByRole('searchbox', { name: '搜索员工' }));
    await user.type(screen.getByRole('searchbox', { name: '搜索员工' }), '陈默');
    await user.click(screen.getByRole('button', { name: /查看陈默的 Agent/ }));
    expect(onNavigate).toHaveBeenLastCalledWith({
      view: 'activity-agent',
      collectorId: 'collector-hangzhou',
      agentId: 'agent-analysis',
      range: '7d'
    });
  });

  it('renders partial and missing usage explicitly', () => {
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);
    expect(screen.getByText('部分数据')).toBeInTheDocument();
    expect(screen.getByText('暂无用量数据')).toBeInTheDocument();
  });

  it('switches to a static conversation and returns to the data view', async () => {
    const user = userEvent.setup();
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '对话分析' }));
    expect(screen.getByRole('region', { name: 'Agent动态对话' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '询问 Agent动态' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '员工用量' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '哪位员工的 Token 用量最高？' }));
    expect(screen.getByText(/Token 用量最高的是林夏/)).toBeInTheDocument();
    const evidence = screen.getByText('近 7 天 · 员工用量汇总');
    expect(evidence).toHaveProperty('tagName', 'SPAN');
    expect(evidence.closest('a, button')).toBeNull();

    await user.click(screen.getByRole('button', { name: '返回数据视图' }));
    expect(screen.getByRole('table', { name: '员工用量' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agent动态对话' })).not.toBeInTheDocument();
  });

  it('keeps conversations in the administrator data scope', async () => {
    const user = userEvent.setup();
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '对话分析' }));
    expect(screen.getByRole('button', { name: '哪位员工的 Token 用量最高？' })).toBeInTheDocument();
    expect(screen.queryByText('员工视图')).not.toBeInTheDocument();
    expect(screen.getByText('管理员视图')).toBeInTheDocument();
    expect(screen.getByText(/组织活动数据已准备好/)).toBeInTheDocument();
  });

  it('changes totals and trend granularity coherently across time ranges', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <ActivityPage route={{ view: 'activity', range: 'today' }} onNavigate={onNavigate} />
    );

    expect(screen.getByTestId('total-tokens')).toHaveTextContent('184,200');
    expect(screen.getByLabelText('Token 趋势')).toHaveAttribute('data-granularity', '小时');
    expect(screen.getByText('00:00')).toBeInTheDocument();

    rerender(<ActivityPage route={{ view: 'activity', range: '30d' }} onNavigate={onNavigate} />);
    expect(screen.getByTestId('total-tokens')).toHaveTextContent('8,742,600');
    expect(screen.getByLabelText('Token 趋势')).toHaveAttribute('data-granularity', '周');
    expect(screen.getByText('第 1 周')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
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
    expect(screen.getByText('静态示例数据，非实时遥测')).toBeInTheDocument();
  });

  it('uses route IDs for distinct employee and agent details', () => {
    const { rerender } = render(<ActivityPage route={{ view: 'activity-agent', collectorId: 'collector-shanghai', agentId: 'agent-research', range: '7d' }} onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '研究助理' })).toBeInTheDocument();
    expect(screen.getByText(/林夏 · collector-shanghai/)).toBeInTheDocument();

    rerender(<ActivityPage route={{ view: 'activity-agent', collectorId: 'collector-beijing', agentId: 'agent-customer', range: '7d' }} onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '客户洞察' })).toBeInTheDocument();
    expect(screen.getByText(/周宁 · collector-beijing/)).toBeInTheDocument();
    expect(screen.queryByText(/林夏 · collector-shanghai/)).not.toBeInTheDocument();
  });

  it('shows a recoverable empty state for an unknown agent route', () => {
    render(<ActivityPage route={{ view: 'activity-agent', collectorId: 'unknown', agentId: 'missing', range: '7d' }} onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '未找到 Agent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回 Agent动态' })).toBeInTheDocument();
    expect(screen.getByText('静态示例数据，非实时遥测')).toBeInTheDocument();
  });
});
