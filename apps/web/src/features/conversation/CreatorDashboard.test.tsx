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
  prompt: null,
  tags: ['B站', '双语', '字幕', '翻译'],
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
  previewUrl: `/creator-presets/${'f'.repeat(64)}.webp`,
  author: {
    name: '@example_author',
    url: 'https://example.com/original',
    avatarUrl: `/creator-presets/${'9'.repeat(64)}.webp`
  },
  prompt: '专业电商商品主图，主体清晰，突出核心卖点。',
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
  prompt: '高对比方形海报：[插入国家/地区名称]，品牌为 {brandName}。\n[布局与输出的严格限制（强制执行）]',
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
  prompt: null,
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
  prompt: '个人成长主题，真实人物半身近景。',
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

  it('opens a template detail before creating a project', () => {
    const onSelectPreset = vi.fn();
    render(<CreatorDashboard presets={presets} onSelectPreset={onSelectPreset} />);

    expect(screen.getByRole('heading', { name: '精选模板' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: '推荐' }))
      .toHaveAttribute('aria-selected', 'true');
    const presetCard = screen.getByRole('button', { name: '查看B站双语精翻模板详情' });
    expect(presetCard)
      .toHaveAttribute('data-preset-id', 'video-translation/bilibili-bilingual/1');
    expect(presetCard.querySelector('img'))
      .toHaveAttribute('src', `/creator-presets/${'d'.repeat(64)}.webp`);
    expect(screen.queryByText('英文视频翻译为简体中文。')).not.toBeInTheDocument();
    expect(screen.queryByText('英语 → 简体中文')).not.toBeInTheDocument();
    expect(screen.queryByText('社交媒体海报')).not.toBeInTheDocument();

    fireEvent.click(presetCard);

    expect(onSelectPreset).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'B站双语精翻' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '成果预览' })).toBeInTheDocument();
    const previewTrigger = screen.getByRole('button', { name: '全屏查看B站双语精翻完整作品' });
    expect(previewTrigger.querySelector('img'))
      .toHaveAttribute('src', `/creator-presets/${'d'.repeat(64)}.webp`);
    expect(screen.getByText('英文视频翻译为简体中文。')).toBeInTheDocument();
    expect(screen.getByText('英语 → 简体中文')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '提示词' })).toBeInTheDocument();
    expect(screen.getByText('此模板使用固定配置，无需预设提示词。')).toBeInTheDocument();
    const detailPage = document.querySelector<HTMLElement>('.creator-template-detail-page');
    const detailLayout = document.querySelector<HTMLElement>('.creator-template-detail-layout');
    const promptSection = document.querySelector<HTMLElement>('.creator-template-prompt-section');
    expect(detailLayout).not.toContainElement(promptSection);
    expect(detailPage?.lastElementChild).toBe(promptSection);
    expect(screen.getByRole('list', { name: '模板标签' })).toHaveTextContent('B站双语字幕翻译');
    expect(screen.getByRole('button', { name: '使用此模板' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回模板列表' }));
    expect(screen.getByRole('heading', { name: '精选模板' })).toBeInTheDocument();
  });

  it('uses the complete preview and restores focus after closing it', async () => {
    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('button', {
      name: '查看电商商品主图增强版模板详情'
    }));

    const trigger = screen.getByRole('button', {
      name: '全屏查看电商商品主图增强版完整作品'
    });
    expect(screen.getByText('@example_author')).toBeInTheDocument();
    expect(document.querySelector('.creator-template-author-avatar img'))
      .toHaveAttribute('src', `/creator-presets/${'9'.repeat(64)}.webp`);
    const avatar = document.querySelector<HTMLImageElement>('.creator-template-author-avatar img');
    fireEvent.error(avatar!);
    expect(avatar).toHaveAttribute('hidden');
    expect(screen.getByRole('link', { name: '查看@example_author的原始来源' }))
      .toHaveAttribute('href', 'https://example.com/original');
    expect(screen.getByRole('link', { name: '查看@example_author的原始来源' }))
      .toHaveAttribute('rel', 'noreferrer');
    expect(document.querySelector('.creator-template-prompt-card'))
      .toContainElement(screen.getByText('专业电商商品主图，主体清晰，突出核心卖点。'));
    expect(trigger.querySelector('img'))
      .toHaveAttribute('src', `/creator-presets/${'f'.repeat(64)}.webp`);
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '电商商品主图增强版完整作品' });
    expect(dialog.querySelector('img'))
      .toHaveAttribute('src', `/creator-presets/${'f'.repeat(64)}.webp`);
    expect(screen.getByRole('button', { name: '关闭预览' })).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '电商商品主图增强版完整作品' }))
      .not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('groups every preset into the video and image categories', () => {
    render(<CreatorDashboard presets={presets} />);

    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    expect(screen.getByRole('button', { name: '查看B站双语精翻模板详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看音频下载模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看电商商品主图增强版模板详情' }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '查看电商商品主图增强版模板详情' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看社交媒体海报模板详情' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看个人成长封面模板详情' }))
      .toBeInTheDocument();
  });

  it('highlights replaceable prompt variables without styling section headings', () => {
    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    fireEvent.click(screen.getByRole('button', { name: '查看社交媒体海报模板详情' }));

    const variables = [...document.querySelectorAll('.creator-template-prompt-variable')];
    expect(variables.map(variable => variable.textContent)).toEqual([
      '[插入国家/地区名称]',
      '{brandName}'
    ]);
    expect(variables.every(variable => variable.getAttribute('title') === '可替换变量'))
      .toBe(true);
  });

  it('opens, filters and closes template search', async () => {
    render(<CreatorDashboard presets={presets} />);

    fireEvent.click(screen.getByRole('button', { name: '搜索模板' }));
    const searchbox = screen.getByRole('searchbox', { name: '搜索模板' });
    await waitFor(() => expect(searchbox).toHaveFocus());
    fireEvent.change(searchbox, { target: { value: '商品' } });
    expect(screen.getByRole('button', { name: '查看电商商品主图增强版模板详情' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看B站双语精翻模板详情' }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(searchbox, { key: 'Escape' });
    expect(screen.queryByRole('searchbox', { name: '搜索模板' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看B站双语精翻模板详情' }))
      .toBeInTheDocument();
  });

  it('persists successfully used templates in recent order', async () => {
    const firstRender = render(
      <CreatorDashboard presets={presets} onSelectPreset={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: '查看B站双语精翻模板详情' }));
    fireEvent.click(screen.getByRole('button', { name: '使用此模板' }));
    await waitFor(() => expect(window.localStorage.getItem(
      'opencreator.creator-presets.recent.v1'
    )).toContain('video-translation/bilibili-bilingual/1'));
    firstRender.unmount();

    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('tab', { name: '最近' }));
    expect(screen.getByRole('button', { name: '查看B站双语精翻模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看电商商品主图增强版模板详情' }))
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
    fireEvent.click(screen.getByRole('button', {
      name: '查看电商商品主图增强版模板详情'
    }));
    const useButton = screen.getByRole('button', { name: '使用此模板' });

    fireEvent.click(useButton);
    fireEvent.click(useButton);

    expect(onSelectPreset).toHaveBeenCalledTimes(1);
    expect(useButton).toBeDisabled();
    resolveSelection?.();
    await waitFor(() => expect(useButton).not.toBeDisabled());
  });

  it('recovers the detail action after preset creation fails', async () => {
    let rejectSelection: ((error: Error) => void) | undefined;
    const onSelectPreset = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectSelection = reject;
    }));
    render(<CreatorDashboard presets={presets} onSelectPreset={onSelectPreset} />);
    fireEvent.click(screen.getByRole('button', {
      name: '查看电商商品主图增强版模板详情'
    }));
    expect(screen.getByText('专业电商商品主图，主体清晰，突出核心卖点。'))
      .toBeInTheDocument();
    const useButton = screen.getByRole('button', { name: '使用此模板' });

    fireEvent.click(useButton);
    expect(useButton).toBeDisabled();
    expect(onSelectPreset).toHaveBeenCalledTimes(1);

    rejectSelection?.(new Error('创建模板任务失败'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('创建模板任务失败'));
    expect(useButton).toBeEnabled();
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
          description: 'Loaded from the localized catalog.',
          tags: ['E-commerce', 'Product']
        }]} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Featured Templates' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recommended' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Video Creation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Image Design' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Enhanced Product Hero template details' }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {
      name: 'View Enhanced Product Hero template details'
    }));
    expect(screen.getByRole('list', { name: 'Template tags' }))
      .toHaveTextContent('E-commerceProduct');
    expect(getCreatorSkillPromptHint({
      id: 'image',
      title: 'Image',
      category: 'Image',
      image: ''
    }, 'en-US')).toContain('Describe what you want to create');
  });
});
