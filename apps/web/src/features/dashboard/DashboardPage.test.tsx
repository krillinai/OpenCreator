import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from './DashboardPage.js';

describe('DashboardPage', () => {
  it('summarizes static Agent and knowledge data', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { name: '数据看板' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '业务洞察' })).toBeInTheDocument();
    for (const name of ['竞品洞察', '客户管理', '小红书运营', '抖音投放']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /^编辑/ })).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('暂未连接企业服务');
    expect(screen.queryByText('总 Token')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agent 运行' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '知识资产' })).not.toBeInTheDocument();
  });

  it('opens the Xiaohongshu detail dashboard and returns to the overview', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole('button', { name: '打开小红书运营详情看板' }));
    expect(screen.getByRole('heading', { name: '小红书运营' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '热门笔记表现' })).toBeInTheDocument();
    expect(screen.getByText('286.4 万')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回数据看板' }));
    expect(screen.getByRole('heading', { name: '业务洞察' })).toBeInTheDocument();
  });

  it('opens the Douyin campaign detail dashboard', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole('button', { name: '打开抖音投放详情看板' }));
    expect(screen.getByRole('heading', { name: '抖音投放' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '投放计划表现' })).toBeInTheDocument();
    expect(screen.getByText('¥386,400')).toBeInTheDocument();
  });

  it('creates a personal dashboard in the employee view', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole('button', { name: '员工' }));
    await user.click(screen.getByRole('button', { name: '创建看板' }));
    await user.type(screen.getByPlaceholderText('例如：销售日报'), '我的销售日报');
    await user.type(screen.getByPlaceholderText('这个看板用于查看什么'), '跟踪个人销售目标');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('heading', { name: '我的销售日报' })).toBeInTheDocument();
    expect(screen.getByText('个人看板')).toBeInTheDocument();
  });
});
