import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { ConversationEmptyState } from './ConversationEmptyState.js';

describe('ConversationEmptyState', () => {
  it('greets the creator without decorative controls or a brand character', () => {
    const { container } = render(<ConversationEmptyState now={new Date(2026, 6, 29, 9)} />);

    const heading = screen.getByRole('heading', { name: '上午好，创作者' });
    const brandMark = container.querySelector<HTMLImageElement>('.conversation-empty-logo-bg');

    expect(heading).toBeInTheDocument();
    expect(screen.getByText('需要帮你做点什么')).toBeInTheDocument();
    expect(brandMark).toBeNull();
    expect(screen.queryByText('日常办公')).not.toBeInTheDocument();
    expect(screen.queryByText('代码开发')).not.toBeInTheDocument();
  });

  it.each([
    [8, '上午好，创作者'],
    [14, '下午好，创作者'],
    [20, '晚上好，创作者']
  ])('uses the local time period at %i:00', (hour, expected) => {
    render(<ConversationEmptyState now={new Date(2026, 6, 29, hour)} />);

    expect(screen.getByRole('heading', { name: expected })).toBeInTheDocument();
  });

  it('uses the selected English display language', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <ConversationEmptyState now={new Date(2026, 7, 18, 14)} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Good afternoon, creator' })).toBeInTheDocument();
    expect(screen.getByText('What would you like to create?')).toBeInTheDocument();
  });
});
