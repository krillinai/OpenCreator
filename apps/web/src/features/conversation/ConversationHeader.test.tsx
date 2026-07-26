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
      />
    );

    expect(screen.getByRole('heading', { name: '整理本周项目进展' })).toBeInTheDocument();
    expect(screen.getByText('content-design')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在等待本地服务');
    expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument();
  });

  it('opens the file workspace without opening the summary dialog', async () => {
    const user = userEvent.setup();
    const onOpenLocation = vi.fn();

    render(
      <ConversationHeader
        title="整理本周项目进展"
        projectName="content-design"
        onOpenLocation={onOpenLocation}
      />
    );

    await user.click(screen.getByRole('button', { name: '文件' }));

    expect(onOpenLocation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes whether the file workspace is currently open', () => {
    render(
      <ConversationHeader
        title="整理本周项目进展"
        projectName="content-design"
        fileWorkspaceOpen
        onOpenLocation={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: '文件' })).toHaveAttribute(
      'title',
      '收起文件工作区'
    );
  });

  it('does not expose conversation summary actions', () => {
    render(
      <ConversationHeader
        title="整理本周项目进展"
        projectName="content-design"
        onOpenLocation={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /生成摘要|查看摘要/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /会话摘要/ })).not.toBeInTheDocument();
  });

  it('renders an optional task toolbar without changing ordinary conversations', () => {
    const { rerender } = render(
      <ConversationHeader
        title="普通会话"
        projectName="content-design"
        onOpenLocation={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('任务管理')).not.toBeInTheDocument();

    rerender(
      <ConversationHeader
        title="每日总结"
        projectName="content-design"
        taskToolbar={<div aria-label="任务管理">任务工具栏</div>}
        onOpenLocation={vi.fn()}
      />
    );

    expect(screen.getByLabelText('任务管理')).toHaveTextContent('任务工具栏');
  });
});
