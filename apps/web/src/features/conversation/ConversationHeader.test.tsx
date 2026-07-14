import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationHeader } from './ConversationHeader.js';

describe('ConversationHeader', () => {
  it('renders the title, project name, and actions', () => {
    render(
      <ConversationHeader
        title="整理本周项目进展"
        projectName="content-design"
        statusLabel="正在等待本地服务"
        onOpenLocation={vi.fn()}
        onToggleDetail={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: '整理本周项目进展' })).toBeInTheDocument();
    expect(screen.getByText('content-design')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在等待本地服务');
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument();
  });

  it('calls the action handlers', async () => {
    const user = userEvent.setup();
    const onOpenLocation = vi.fn();
    const onToggleDetail = vi.fn();

    render(
      <ConversationHeader
        title="整理本周项目进展"
        projectName="content-design"
        onOpenLocation={onOpenLocation}
        onToggleDetail={onToggleDetail}
      />
    );

    await user.click(screen.getByRole('button', { name: '文件' }));
    await user.click(screen.getByRole('button', { name: '详情' }));

    expect(onOpenLocation).toHaveBeenCalledTimes(1);
    expect(onToggleDetail).toHaveBeenCalledTimes(1);
  });

  it('creates a visible conversation summary when a thread is selected', async () => {
    const user = userEvent.setup();
    const onCreateSummary = vi.fn();

    render(
      <ConversationHeader
        title="整理本周项目进展"
        projectName="content-design"
        summaryStatus="已生成摘要 v2"
        onCreateSummary={onCreateSummary}
        onOpenLocation={vi.fn()}
        onToggleDetail={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: '生成摘要' }));
    expect(onCreateSummary).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status', { name: '摘要状态' })).toHaveTextContent('已生成摘要 v2');
  });

  it('renders an optional task toolbar without changing ordinary conversations', () => {
    const { rerender } = render(
      <ConversationHeader
        title="普通会话"
        projectName="content-design"
        onOpenLocation={vi.fn()}
        onToggleDetail={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('任务管理')).not.toBeInTheDocument();

    rerender(
      <ConversationHeader
        title="每日总结"
        projectName="content-design"
        taskToolbar={<div aria-label="任务管理">任务工具栏</div>}
        onOpenLocation={vi.fn()}
        onToggleDetail={vi.fn()}
      />
    );

    expect(screen.getByLabelText('任务管理')).toHaveTextContent('任务工具栏');
  });
});
