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
    expect(screen.getByText('Skill 使用分布')).toBeInTheDocument();
    expect(screen.getByText('MCP 使用分布')).toBeInTheDocument();
    expect(screen.getByText('网页检索').closest('p')).toHaveTextContent('18 次 · 38%');

    await user.click(screen.getByRole('button', { name: '员工视图' }));
    expect(screen.getByText('我的 Token')).toBeInTheDocument();
    expect(screen.getByText('模型分布')).toBeInTheDocument();
    expect(screen.getByText('Agent 分布')).toBeInTheDocument();
    expect(screen.getByText('代码审查', { selector: '.activity-distribution--usage span' }).closest('p')).toHaveTextContent('12 次 · 40%');
    expect(screen.getByText('filesystem').closest('p')).toHaveTextContent('21 次 · 48%');
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

  it('changes employee distributions and recent rows with the selected range', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ActivityPage route={{ view: 'activity', range: 'today' }} onNavigate={vi.fn()} />
    );
    await user.click(screen.getByRole('button', { name: '员工视图' }));
    expect(screen.getByText('快速资料核验')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.3-codex 74%')).toBeInTheDocument();
    expect(screen.getByText('资料检索').closest('p')).toHaveTextContent('4 次 · 50%');

    rerender(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={vi.fn()} />);
    expect(screen.getByText('汇总竞品发布动态')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.3-codex 62%')).toBeInTheDocument();
    expect(screen.getByText('代码审查', { selector: '.activity-distribution--usage span' }).closest('p')).toHaveTextContent('12 次 · 40%');
    expect(screen.queryByText('快速资料核验')).not.toBeInTheDocument();
  });

  it('maps each recent turn to its own route-specific Agent detail', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<ActivityPage route={{ view: 'activity', range: '7d' }} onNavigate={onNavigate} />);
    await user.click(screen.getByRole('button', { name: '员工视图' }));
    await user.click(screen.getByRole('button', { name: '查看代码审查详情' }));
    expect(onNavigate).toHaveBeenCalledWith({
      view: 'activity-agent',
      collectorId: 'collector-shanghai',
      agentId: 'agent-code-review',
      range: '7d'
    });
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
    expect(screen.getByRole('button', { name: '返回 Agent 活动' })).toBeInTheDocument();
    expect(screen.getByText('静态示例数据，非实时遥测')).toBeInTheDocument();
  });
});
