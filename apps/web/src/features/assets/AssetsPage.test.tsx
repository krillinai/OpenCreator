import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AssetsPage, { type AssetsPageProps } from './AssetsPage.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';

describe('AssetsPage', () => {
  it('localizes the asset tabs and knowledge gate in English', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <AssetsPage {...createProps()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('region', { name: 'My Assets' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Knowledge' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Media Library' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting for the local runtime' })).toBeInTheDocument();
    expect(screen.queryByText('知识库')).not.toBeInTheDocument();
  });

  it('defaults to the knowledge base and exposes the material center tab', () => {
    render(<AssetsPage {...createProps()} />);

    expect(screen.getByRole('region', { name: '我的资产' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '知识库' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '素材中心' }))
      .toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { level: 1, name: '知识库' })).toBeInTheDocument();
  });

  it('requests and renders the material center tab', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const props = createProps({ onTabChange });
    const { rerender } = render(<AssetsPage {...props} />);

    await user.click(screen.getByRole('tab', { name: '素材中心' }));
    expect(onTabChange).toHaveBeenCalledWith('materials');

    rerender(<AssetsPage {...props} activeTab="materials" />);
    expect(screen.getByRole('tab', { name: '素材中心' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('素材中心');
    expect(screen.getByRole('heading', { level: 1, name: '素材中心' })).toBeInTheDocument();
  });
});

function createProps(overrides: Partial<AssetsPageProps> = {}): AssetsPageProps {
  return {
    knowledge: {
      connected: false,
      knowledgeBasesLoading: false,
      documentsLoading: false,
      onRefresh: vi.fn(),
      onSelectKnowledgeBase: vi.fn(),
      onUpload: vi.fn()
    },
    materials: {
      connected: false,
      spacesLoading: false,
      spacesHasNext: false,
      filesLoading: false,
      filesHasNext: false,
      query: '',
      maxFileSizeBytes: 50 * 1024 * 1024,
      currentProjectName: '默认项目',
      onRefresh: vi.fn(),
      onLoadMoreSpaces: vi.fn(),
      onSelectSpace: vi.fn(),
      onSearch: vi.fn(),
      onLoadMoreFiles: vi.fn(),
      onUpload: vi.fn(),
      onReplace: vi.fn(),
      onDownload: vi.fn()
    },
    ...overrides
  };
}
