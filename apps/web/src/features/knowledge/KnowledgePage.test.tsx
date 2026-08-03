import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { KnowledgePage } from './KnowledgePage.js';

describe('KnowledgePage static enterprise prototype', () => {
  it('renders metrics, sample disclosure, document list and selected details', () => {
    render(<KnowledgePage />);
    expect(screen.getByRole('heading', { name: '企业知识库' })).toBeInTheDocument();
    expect(screen.getByText('静态示例数据，未连接企业知识服务')).toBeInTheDocument();
    expect(screen.getByText('知识条目')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '知识文档' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '员工差旅与报销制度' })).toBeInTheDocument();
    expect(screen.getByText('全体员工')).toBeInTheDocument();
  });

  it('combines search and category filters and updates document details', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);
    await user.click(screen.getByRole('button', { name: '客户案例' }));
    const list = screen.getByRole('list', { name: '知识文档' });
    expect(within(list).getByText('客户退款处理规范')).toBeInTheDocument();
    expect(within(list).queryByText('员工差旅与报销制度')).not.toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /客户退款处理规范/ }));
    expect(screen.getByRole('heading', { name: '客户退款处理规范' })).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: '搜索企业知识库' }), '不存在');
    expect(screen.getByText('没有匹配的知识条目')).toBeInTheDocument();
  });
});
