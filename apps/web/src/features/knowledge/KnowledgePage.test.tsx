import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { KnowledgePage } from './KnowledgePage.js';

describe('KnowledgePage static enterprise conversation', () => {
  it('renders a conversation workbench without document browsing controls', () => {
    render(<KnowledgePage />);

    expect(screen.getByRole('heading', { name: '企业知识库' })).toBeInTheDocument();
    expect(screen.getByText('静态示例数据，未连接企业知识服务')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '询问企业知识' })).toBeInTheDocument();
    expect(screen.getByText('小林')).toBeInTheDocument();
    const permissions = screen.getByRole('complementary', { name: '当前知识权限' });
    expect(within(permissions).getByText('公司制度')).toBeInTheDocument();
    expect(within(permissions).getByText('产品资料')).toBeInTheDocument();
    expect(within(permissions).getByText('客户成功')).toBeInTheDocument();
    expect(screen.queryByText('研发知识')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: '知识文档' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('sends a question and renders non-interactive evidence', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);

    const textbox = screen.getByRole('textbox', { name: '询问企业知识' });
    await user.type(textbox, '客户退款需要谁审批？');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(screen.getByText('客户退款需要谁审批？', { selector: '.knowledge-message__text' })).toBeInTheDocument();
    expect(screen.getByText(/客户成功负责人/)).toBeInTheDocument();
    const evidence = screen.getByText('客户成功知识域 · 2 条依据');
    expect(evidence).toHaveProperty('tagName', 'SPAN');
    expect(evidence.closest('a, button')).toBeNull();
    expect(textbox).toHaveValue('');
  });

  it('switches identities and clears answers that exceed the new permission scope', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);

    await user.click(screen.getByRole('button', { name: '管理员视图' }));
    expect(screen.getByText('企业管理员')).toBeInTheDocument();
    expect(screen.getByText('研发知识')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Runtime 和 Desktop 如何通信？' }));
    expect(screen.getByText('研发知识域 · 2 条依据')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '员工视图' }));
    expect(screen.getByText('小林')).toBeInTheDocument();
    expect(screen.queryByText('研发知识')).not.toBeInTheDocument();
    expect(screen.queryByText('研发知识域 · 2 条依据')).not.toBeInTheDocument();
    expect(screen.queryByText(/Web 与 Desktop 的通用业务/)).not.toBeInTheDocument();
  });

  it('disables empty submissions and supports Enter or Shift+Enter', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);

    const textbox = screen.getByRole('textbox', { name: '询问企业知识' });
    const send = screen.getByRole('button', { name: '发送' });
    expect(send).toBeDisabled();

    await user.type(textbox, '报销材料{Shift>}{Enter}{/Shift}多久提交');
    expect(textbox).toHaveValue('报销材料\n多久提交');
    expect(screen.queryByText('报销材料\n多久提交', { selector: '.knowledge-message__text' })).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(
      Array.from(screen.getByRole('log').querySelectorAll('.knowledge-message__text'))
        .some(element => element.textContent === '报销材料\n多久提交')
    ).toBe(true);
    expect(screen.getByText(/10 个工作日/)).toBeInTheDocument();
  });
});
