import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationEmptyState } from './ConversationEmptyState.js';

describe('ConversationEmptyState', () => {
  it('asks what to do in the selected project without a decorative brand mark', () => {
    const { container } = render(<ConversationEmptyState projectName="content-design" />);

    const heading = screen.getByRole('heading', { name: '要在 content-design 中处理什么？' });
    const brandMark = container.querySelector<HTMLImageElement>('.conversation-empty-logo-bg');

    expect(heading).toBeInTheDocument();
    expect(brandMark).toBeNull();
  });

  it('asks the user to add a project when none is selected', () => {
    render(<ConversationEmptyState />);

    expect(screen.getByRole('heading', { name: '先添加项目后开始对话' })).toBeInTheDocument();
  });
});
