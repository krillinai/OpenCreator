import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreatorPresetSummary } from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import {
  CreatorDashboard,
  getCreatorSkillPromptHint
} from './CreatorDashboard.js';

const presets: CreatorPresetSummary[] = [{
  module: 'video-translation',
  id: 'bilibili-bilingual',
  version: 1,
  title: 'B站双语精翻',
  description: '英文视频翻译为简体中文。',
  coverUrl: `/creator-presets/${'d'.repeat(64)}.webp`,
  tags: ['translation'],
  featured: true,
  sortOrder: 5,
  requirements: null,
  highlights: [
    { text: '英语 → 简体中文', colors: [] },
    { text: '双语字幕 · 顶部', colors: [] }
  ]
}, {
  module: 'image-generation',
  id: 'ecommerce-product-alt',
  version: 3,
  title: '电商商品主图增强版',
  description: '从 Daemon catalog 动态加载的商品视觉模板。',
  coverUrl: `/creator-presets/${'a'.repeat(64)}.webp`,
  tags: ['ecommerce', 'product'],
  featured: true,
  sortOrder: 10,
  requirements: null,
  highlights: [{ text: '1536 × 1024', colors: [] }]
}, {
  module: 'image-generation',
  id: 'social-poster',
  version: 1,
  title: '社交媒体海报',
  description: '生成醒目的社交媒体海报。',
  coverUrl: `/creator-presets/${'e'.repeat(64)}.webp`,
  tags: ['poster'],
  featured: false,
  sortOrder: 15,
  requirements: null,
  highlights: [{ text: '1024 × 1536', colors: [] }]
}, {
  module: 'video-download',
  id: 'audio-download',
  version: 1,
  title: '音频下载',
  description: '下载视频中的音频。',
  coverUrl: `/creator-presets/${'b'.repeat(64)}.webp`,
  tags: ['audio'],
  featured: true,
  sortOrder: 20,
  requirements: null,
  highlights: [{ text: '提取 MP3 音频', colors: [] }]
}, {
  module: 'cover-generator',
  id: 'personal-growth',
  version: 1,
  title: '个人成长封面',
  description: '生成个人成长主题封面。',
  coverUrl: `/creator-presets/${'c'.repeat(64)}.webp`,
  tags: ['growth'],
  featured: false,
  sortOrder: 30,
  requirements: null,
  highlights: [{ text: '16:9', colors: [] }]
}];

describe('CreatorDashboard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('opens on recommended templates and keeps the compact card hierarchy', () => {
    render(<CreatorDashboard presets={presets} />);

    expect(screen.getByRole('heading', { name: '创作模板' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: '推荐' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '使用B站双语精翻模板' }))
      .toHaveAttribute('data-preset-id', 'video-translation/bilibili-bilingual/1');
    expect(screen.getByRole('button', { name: '使用B站双语精翻模板' }).querySelector('img'))
      .toHaveAttribute('src', `/creator-presets/${'d'.repeat(64)}.webp`);
    expect(screen.queryByText('英文视频翻译为简体中文。')).not.toBeInTheDocument();
    expect(screen.queryByText('英语 → 简体中文')).not.toBeInTheDocument();
    expect(screen.queryByText('社交媒体海报')).not.toBeInTheDocument();
  });

  it('groups every preset into the video and image categories', () => {
    render(<CreatorDashboard presets={presets} />);

    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    expect(screen.getByRole('button', { name: '使用B站双语精翻模板' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用音频下载模板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用电商商品主图增强版模板' }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '使用电商商品主图增强版模板' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用社交媒体海报模板' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用个人成长封面模板' }))
      .toBeInTheDocument();
  });

  it('opens, filters and closes template search', async () => {
    render(<CreatorDashboard presets={presets} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索模板' }));
    const searchbox = screen.getByRole('searchbox', { name: '搜索模板' });
    await waitFor(() => expect(searchbox).toHaveFocus());
    fireEvent.change(searchbox, { target: { value: '商品' } });
    expect(screen.getByRole('button', { name: '使用电商商品主图增强版模板' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用B站双语精翻模板' }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(searchbox, { key: 'Escape' });
    expect(screen.queryByRole('searchbox', { name: '搜索模板' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用B站双语精翻模板' }))
      .toBeInTheDocument();
  });

  it('persists successfully used templates in recent order', async () => {
    const firstRender = render(
      <CreatorDashboard presets={presets} onSelectPreset={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: '使用B站双语精翻模板' }));
    await waitFor(() => expect(window.localStorage.getItem(
      'opencreator.creator-presets.recent.v1'
    )).toContain('video-translation/bilibili-bilingual/1'));
    firstRender.unmount();

    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByRole('button', { name: '使用B站双语精翻模板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用电商商品主图增强版模板' }))
      .not.toBeInTheDocument();
  });

  it('shows a useful empty state when no recent template exists', () => {
    render(<CreatorDashboard presets={presets} />);

    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByText('还没有使用过模板。')).toBeInTheDocument();
  });

  it('deduplicates a rapid double click for the same preset', async () => {
    let resolveSelection: (() => void) | undefined;
    const onSelectPreset = vi.fn(() => new Promise<void>(resolve => {
      resolveSelection = resolve;
    }));
    render(<CreatorDashboard presets={presets} onSelectPreset={onSelectPreset} />);
    const card = screen.getByRole('button', {
      name: '使用电商商品主图增强版模板'
    });

    fireEvent.click(card);
    fireEvent.click(card);

    expect(onSelectPreset).toHaveBeenCalledTimes(1);
    expect(card).toBeDisabled();
    resolveSelection?.();
    await waitFor(() => expect(card).not.toBeDisabled());
  });

  it('keeps other cards operable while one preset is busy and recovers from failure', async () => {
    let rejectSelection: ((error: Error) => void) | undefined;
    const onSelectPreset = vi.fn((preset: CreatorPresetSummary) => (
      preset.id === 'ecommerce-product-alt'
        ? new Promise<void>((_resolve, reject) => {
            rejectSelection = reject;
          })
        : Promise.resolve()
    ));
    render(<CreatorDashboard presets={presets} onSelectPreset={onSelectPreset} />);
    const imageCard = screen.getByRole('button', {
      name: '使用电商商品主图增强版模板'
    });
    const videoCard = screen.getByRole('button', {
      name: '使用B站双语精翻模板'
    });

    fireEvent.click(imageCard);
    expect(imageCard).toBeDisabled();
    expect(videoCard).toBeEnabled();
    fireEvent.click(videoCard);
    expect(onSelectPreset).toHaveBeenCalledTimes(2);

    rejectSelection?.(new Error('创建模板任务失败'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('创建模板任务失败'));
    expect(imageCard).toBeEnabled();
  });

  it('renders loading and retry states without shifting the card grid', () => {
    const onRetry = vi.fn();
    const view = render(<CreatorDashboard loading onRetry={onRetry} />);

    expect(screen.getByRole('status', { name: '正在加载模板' })).toBeInTheDocument();
    expect(document.querySelectorAll('.creator-template-skeleton')).toHaveLength(4);

    view.rerender(<CreatorDashboard error="模板服务暂不可用" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses the selected interface language for labels and prompt hints', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard presets={[{
          ...presets[1]!,
          title: 'Enhanced Product Hero',
          description: 'Loaded from the localized catalog.'
        }]} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Creation Templates' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recommended' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Video Creation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Image Design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Enhanced Product Hero preset' }))
      .toBeInTheDocument();
    expect(getCreatorSkillPromptHint({
      id: 'image',
      title: 'Image',
      category: 'Image',
      image: ''
    }, 'en-US')).toContain('Describe what you want to create');
  });
});
