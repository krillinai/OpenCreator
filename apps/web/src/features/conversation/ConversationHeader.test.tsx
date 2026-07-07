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
    expect(screen.getByRole('button', { name: '打开位置' })).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: '打开位置' }));
    await user.click(screen.getByRole('button', { name: '详情' }));

    expect(onOpenLocation).toHaveBeenCalledTimes(1);
    expect(onToggleDetail).toHaveBeenCalledTimes(1);
  });
});
