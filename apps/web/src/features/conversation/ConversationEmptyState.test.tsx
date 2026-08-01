import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationEmptyState, ConversationStarterTags } from './ConversationEmptyState.js';

describe('ConversationEmptyState', () => {
  it('greets the user by nickname without decorative controls or a brand character', () => {
    const { container } = render(
      <ConversationEmptyState nickname="Joshua" now={new Date(2026, 6, 29, 9)} />
    );

    const heading = screen.getByRole('heading', { name: '上午好，Joshua' });
    const brandMark = container.querySelector<HTMLImageElement>('.conversation-empty-logo-bg');

    expect(heading).toBeInTheDocument();
    expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
    expect(brandMark).toBeNull();
    expect(screen.queryByText('日常办公')).not.toBeInTheDocument();
    expect(screen.queryByText('代码开发')).not.toBeInTheDocument();
  });

  it.each([
    [8, '上午好，朋友'],
    [14, '下午好，朋友'],
    [20, '晚上好，朋友']
  ])('uses the local time period at %i:00', (hour, expected) => {
    render(<ConversationEmptyState now={new Date(2026, 6, 29, hour)} />);

    expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument();
  });
});

describe('ConversationStarterTags', () => {
  it('renders the four common scenarios', () => {
    render(<ConversationStarterTags />);

    expect(screen.getByLabelText('常用场景')).toBeInTheDocument();
    expect(screen.getByText('数据分析')).toBeInTheDocument();
    expect(screen.getByText('获客转化')).toBeInTheDocument();
    expect(screen.getByText('内容创意生成')).toBeInTheDocument();
    expect(screen.getByText('广告投放')).toBeInTheDocument();
  });
});
