import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConversationEmptyState } from './ConversationEmptyState.js';

describe('ConversationEmptyState', () => {
  it('asks what to do in the selected project', () => {
    render(<ConversationEmptyState projectName="content-design" />);

    expect(screen.getByRole('heading', { name: '要在 content-design 中处理什么？' })).toBeInTheDocument();
  });

  it('uses the default Clawee prompt when no project is selected', () => {
    render(<ConversationEmptyState />);

    expect(screen.getByRole('heading', { name: '今天要让 Clawee 处理什么？' })).toBeInTheDocument();
  });
});
