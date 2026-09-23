import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorPresetSummary } from '@opencreator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  module: 'video-generation',
  id: 'cinematic-preview',
  version: 1,
  title: '电影感视频预览',
  description: '使用完整视频展示模板效果。',
  coverUrl: `/creator-presets/${'7'.repeat(64)}.jpg`,
  previewVideoUrl: `/creator-presets/${'8'.repeat(64)}.mp4`,
  author: {
    name: '@video_author',
    url: 'https://example.com/video-source'
  },
  prompt: '镜头从[2.5]米外围绕[主体名称]平滑运动，参考@Image1。[结束]',
  tags: ['video'],
  featured: false,
  sortOrder: 18,
  requirements: null,
  highlights: [{ text: '1280 × 720', colors: [] }, { text: '8 秒', colors: [] }]
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

function mockNarrowTagRow() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains('creator-template-tags-filter') ? 350 : 100;
    return { width } as DOMRect;
  });
}

describe('CreatorDashboard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['video-generation', true],
    ['video-translation', true],
    ['video-download', true],
    ['smart-dubbing', true],
    ['image-generation', false],
    ['cover-generator', false]
  ] as const)('adds a decorative video marker for %s: %s', (module, hasMarker) => {
    const preset = { ...presets[0]!, module };
    const onSelectPreset = vi.fn();
    render(<CreatorDashboard presets={[preset]} onSelectPreset={onSelectPreset} />);

    const card = screen.getByRole('button', { name: `查看${preset.title}模板详情` });
    const media = card.querySelector('.creator-template-media');
    const marker = media?.querySelector('.creator-template-play-marker');
    expect(media?.querySelector('img')).toHaveAttribute('src', preset.coverUrl);
    expect(card.querySelector('button')).toBeNull();

    if (hasMarker) {
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(marker?.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
      fireEvent.click(marker!);
    } else {
      expect(marker).toBeNull();
      fireEvent.click(card);
    }

    expect(screen.getByRole('heading', { name: preset.title })).toBeInTheDocument();
    expect(onSelectPreset).not.toHaveBeenCalled();
  });

  it('opens a template detail before creating a project', () => {
    const onSelectPreset = vi.fn();
    render(<CreatorDashboard presets={presets} onSelectPreset={onSelectPreset} />);

    expect(screen.getByRole('heading', { name: '精选模板' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
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
    expect(screen.queryByRole('heading', { name: '成果预览' })).not.toBeInTheDocument();
    const previewTrigger = screen.getByRole('button', { name: '全屏查看B站双语精翻完整作品' });
    expect(previewTrigger.querySelector('img'))
      .toHaveAttribute('src', `/creator-presets/${'d'.repeat(64)}.webp`);
    expect(screen.getByText('英文视频翻译为简体中文。')).toBeInTheDocument();
    expect(screen.getByText('英语 → 简体中文')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'PROMPT 正文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制 Prompt' })).toBeDisabled();
    expect(screen.getByText('此模板使用固定配置，无需预设提示词。')).toBeInTheDocument();
    const detailPage = document.querySelector<HTMLElement>('.creator-template-detail-page');
    const detailLayout = document.querySelector<HTMLElement>('.creator-template-detail-layout');
    const promptSection = document.querySelector<HTMLElement>('.creator-template-prompt-section');
    expect(screen.getByRole('dialog', { name: 'B站双语精翻' })).toBe(detailPage);
    expect(detailLayout?.querySelector('.creator-template-detail-info')).toContainElement(promptSection);
    expect(screen.getByRole('button', { name: '查看B站双语精翻模板详情' })).toBeInTheDocument();
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

  it('copies the raw prompt from the detail card', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('button', { name: '查看电商商品主图增强版模板详情' }));
    fireEvent.click(screen.getByRole('button', { name: '复制 Prompt' }));
    expect(writeText).toHaveBeenCalledWith(presets[1]!.prompt);
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument();
  });

  it('renders video examples with controls and a full preview', async () => {
    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    fireEvent.click(screen.getByRole('button', { name: '查看电影感视频预览模板详情' }));

    const inlineVideo = screen.getByLabelText('电影感视频预览示例视频');
    expect(inlineVideo).toHaveAttribute(
      'src',
      `/creator-presets/${'8'.repeat(64)}.mp4`
    );
    expect(inlineVideo).toHaveAttribute(
      'poster',
      `/creator-presets/${'7'.repeat(64)}.jpg`
    );
    expect(inlineVideo).toHaveAttribute('controls');
    expect(inlineVideo).toHaveAttribute('preload', 'metadata');

    const trigger = screen.getByRole('button', {
      name: '全屏查看电影感视频预览完整作品'
    });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '电影感视频预览完整作品' });
    const fullVideo = screen.getByLabelText('电影感视频预览完整示例视频');
    expect(dialog).toContainElement(fullVideo);
    expect(fullVideo).toHaveAttribute('controls');
    expect(fullVideo).toHaveAttribute('autoplay');

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
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

  it('omits tag filters on Recent, Recommended and All while keeping search available', () => {
    render(<CreatorDashboard presets={presets} />);

    for (const category of ['推荐', '全部', '最近']) {
      fireEvent.click(screen.getByRole('tab', { name: category }));
      expect(screen.queryByRole('group', { name: '筛选模板' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '搜索模板' })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('group', { name: '筛选模板' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '商品产品' }));
    fireEvent.click(screen.getByRole('tab', { name: '全部' }));
    expect(screen.queryByRole('group', { name: '筛选模板' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看社交媒体海报模板详情' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses one tag at a time and resets with All or a category change', () => {
    const catalog = [
      { ...presets[1]!, tags: ['商业广告', '产品视觉', '创意摄影'] },
      { ...presets[2]!, tags: ['海报设计', '手绘插画', '角色场景'] },
      { ...presets[3]!, tags: ['商业广告', 'cinematic', '产品视觉'] }
    ];
    render(<CreatorDashboard presets={catalog} />);

    expect(screen.queryByRole('group', { name: '筛选模板' })).not.toBeInTheDocument();
    expect(screen.queryByText('使用场景')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '电影短片' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '海报设计' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '电影短片' }));
    expect(screen.getByRole('tab', { name: '视频创作' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: '查看电商商品主图增强版模板详情' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看电影感视频预览模板详情' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getByRole('tab', { name: '视频创作' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: '查看电商商品主图增强版模板详情' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    fireEvent.click(screen.getByRole('button', { name: '商品产品' }));
    expect(screen.getByRole('tab', { name: '图像设计' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '查看电商商品主图增强版模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看社交媒体海报模板详情' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '全部' }));
    expect(screen.queryByRole('button', { name: '商品产品' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '筛选模板' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看社交媒体海报模板详情' })).toBeInTheDocument();
  });

  it('keeps one tag row and moves overflow selections into view without changing the category', () => {
    mockNarrowTagRow();
    render(<CreatorDashboard presets={[
      { ...presets[3]!, tags: ['cinematic', 'camera-motion', 'action'] },
      presets[0]!,
      { ...presets[1]!, tags: ['产品视觉', '电商视觉', '人像摄影'] },
      { ...presets[2]!, tags: ['海报设计'] }
    ]} />);

    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    const filter = screen.getByRole('group', { name: '筛选模板' });
    const line = filter.querySelector('.creator-template-tags-line')!;
    expect(within(line as HTMLElement).getByRole('button', { name: '视频翻译' })).toBeInTheDocument();
    expect(within(line as HTMLElement).queryByRole('button', { name: '镜头运动' })).not.toBeInTheDocument();
    const more = within(line as HTMLElement).getByRole('button', { name: '更多' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(filter.querySelectorAll('.creator-template-tags-measure button[tabindex="-1"]')).toHaveLength(
      filter.querySelectorAll('.creator-template-tags-measure button').length
    );

    fireEvent.click(more);
    const overflow = screen.getByRole('group', { name: '更多模板分类' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('收起');
    expect(within(overflow).queryByRole('button', { name: '视频翻译' })).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveTextContent('更多');
    expect(screen.queryByRole('group', { name: '更多模板分类' })).not.toBeInTheDocument();
    fireEvent.click(more);
    fireEvent.click(within(screen.getByRole('group', { name: '更多模板分类' }))
      .getByRole('button', { name: '镜头运动' }));
    expect(screen.queryByRole('group', { name: '更多模板分类' })).not.toBeInTheDocument();
    expect(within(line as HTMLElement).getByRole('button', { name: '镜头运动' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: '视频创作' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '查看电影感视频预览模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看B站双语精翻模板详情' })).not.toBeInTheDocument();

    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '更多模板分类' })).not.toBeInTheDocument();
    expect(more).toHaveFocus();
    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('group', { name: '更多模板分类' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(within(line as HTMLElement).getByRole('button', { name: '人像写真' })).toBeInTheDocument();
    fireEvent.click(within(line as HTMLElement).getByRole('button', { name: '更多' }));
    fireEvent.click(within(screen.getByRole('group', { name: '更多模板分类' }))
      .getByRole('button', { name: '商品产品' }));
    expect(within(line as HTMLElement).getByRole('button', { name: '商品产品' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: '图像设计' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '查看电商商品主图增强版模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看社交媒体海报模板详情' })).not.toBeInTheDocument();
  });

  it('localizes the overflow control and its options in English', () => {
    mockNarrowTagRow();
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard presets={[{ ...presets[3]!, tags: ['cinematic', 'camera-motion'] }]} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Video Creation' }));
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    expect(more).toHaveTextContent('Show less');
    const overflow = screen.getByRole('group', { name: 'More template filters' });
    fireEvent.click(within(overflow).getByRole('button', { name: 'Camera Motion' }));
    expect(screen.getByRole('button', { name: 'Camera Motion' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'Video Creation' })).toHaveAttribute('aria-selected', 'true');
  });

  it('matches localized English tags within the selected category', () => {
    const catalog = [
      { ...presets[1]!, title: 'Product Hero', tags: ['Commercial advertising', 'Product visuals'] },
      { ...presets[2]!, title: 'Illustrated Poster', tags: ['Poster design', 'Hand-drawn illustration'] },
      { ...presets[3]!, title: 'Cinematic Motion', tags: ['Cinematic storytelling', 'Animation'] }
    ];
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard presets={catalog} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Image Design' }));
    expect(screen.getByRole('button', { name: 'Brand Ads' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Posters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cinematic' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Brand Ads' }));
    expect(screen.getByRole('tab', { name: 'Image Design' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'View Product Hero template details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Illustrated Poster template details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('tab', { name: 'Image Design' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'View Illustrated Poster template details' })).toBeInTheDocument();
  });

  it('shows video workflows and motion tags separately from image design tags', () => {
    const catalog = [
      presets[0]!,
      presets[4]!,
      { ...presets[3]!, tags: ['camera-motion', 'action', 'image-to-video'] },
      { ...presets[1]!, tags: ['产品视觉', '产品摄影'] },
      { ...presets[2]!, tags: ['海报设计', '手绘插画'] }
    ];
    render(<CreatorDashboard presets={catalog} />);

    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    expect(screen.getByRole('button', { name: '视频翻译' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '火柴人动画' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '视频下载' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '镜头运动' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运动动作' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '海报设计' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '镜头运动' }));
    expect(screen.getByRole('button', { name: '查看电影感视频预览模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看B站双语精翻模板详情' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '海报设计' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '摄影' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '镜头运动' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '视频翻译' })).not.toBeInTheDocument();
  });

  it('shows specific image uses, styles and subjects in one localized filter', () => {
    const catalog: CreatorPresetSummary[] = [
      {
        ...presets[1]!,
        title: '极简城市海报',
        tags: ['极简设计', '城市街景', '海报设计'],
        tagIds: ['minimalist', 'city-street', '海报设计']
      },
      {
        ...presets[2]!,
        title: '水彩故事分镜',
        tags: ['水彩', '故事分镜', '手绘插画'],
        tagIds: ['watercolor', 'storyboard', '手绘插画']
      },
      {
        ...presets[5]!,
        title: '品牌商品广告',
        tags: ['商业广告', '产品视觉', '电商'],
        tagIds: ['商业广告', '产品视觉', 'ecommerce']
      }
    ];
    const view = render(<CreatorDashboard presets={catalog} />);
    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    const filter = screen.getByRole('group', { name: '筛选模板' });
    expect(filter.querySelectorAll('button').length).toBeGreaterThan(9);
    for (const label of ['海报设计', '故事分镜', '电商主图', '品牌广告', '水彩画', '极简设计', '城市街景', '商品产品']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '游戏视觉' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '城市街景' }));
    expect(screen.getByRole('tab', { name: '图像设计' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '查看极简城市海报模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看水彩故事分镜模板详情' })).not.toBeInTheDocument();

    view.unmount();
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard presets={[
          { ...catalog[0]!, title: 'Minimal City Poster', tags: ['Minimalist', 'City streets', 'Poster design'] },
          { ...catalog[1]!, title: 'Watercolor Storyboard', tags: ['Watercolor', 'Storyboard', 'Hand-drawn illustration'] }
        ]} />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Image Design' }));
    fireEvent.click(screen.getByRole('button', { name: 'Watercolor' }));
    expect(screen.getByRole('tab', { name: 'Image Design' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'View Watercolor Storyboard template details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Minimal City Poster template details' })).not.toBeInTheDocument();
  });

  it('shows localized video-specific tags in English', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard presets={[
          { ...presets[0]!, title: 'Bilingual Translation', tags: ['Bilingual', 'Subtitles'] },
          { ...presets[3]!, title: 'Moving Camera', tags: ['Camera motion', 'Cinematic'] }
        ]} />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Video Creation' }));
    expect(screen.getByRole('button', { name: 'Video Translation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stick Figure Animation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Camera Motion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cinematic Shorts' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Camera Motion' }));
    expect(screen.getByRole('tab', { name: 'Video Creation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'View Moving Camera template details' })).toBeInTheDocument();
  });

  it('shows the complete video tag list in order, including tags awaiting templates', () => {
    const catalog = [
      { ...presets[3]!, tags: ['nature-landscape', 'city-street', 'architecture-interior', 'anime-style'] },
      { ...presets[3]!, id: 'stickman-preview', title: '火柴人动画预览', tags: ['stickman-video'], tagIds: ['stickman-video'] },
      presets[0]!
    ];
    render(<CreatorDashboard presets={catalog} />);
    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    expect(Array.from(document.querySelectorAll('.creator-template-tags-line button'), button => button.textContent))
      .toEqual([
        '全部', '视频翻译', '火柴人动画', '电影短片', '生活 Vlog', '品牌广告', 'UGC 内容', '知识讲解',
        '片头包装', '游戏宣传', '写实电影感', '奇幻冒险', '未来科幻',
        '动漫风格', '复古胶片', '梦境视觉', '定格动画', '手绘动画',
        '人物角色', '运动动作', '自然风光', '建筑空间', '城市街景',
        '美食料理', '产品特写', '镜头运动', '视频配音', '视频下载'
      ]);
    fireEvent.click(screen.getByRole('button', { name: '视频翻译' }));
    expect(screen.getByRole('button', { name: '查看B站双语精翻模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看火柴人动画预览模板详情' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '火柴人动画' }));
    expect(screen.getByRole('button', { name: '查看火柴人动画预览模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看B站双语精翻模板详情' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '片头包装' }));
    expect(screen.getByText('该标签暂时没有模板。')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '视频创作' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: '城市街景' }));
    expect(screen.getByRole('button', { name: '查看电影感视频预览模板详情' })).toBeInTheDocument();
  });

  it('filters localized video presets by stable tag IDs in Chinese and English', () => {
    const catalog: CreatorPresetSummary[] = [
      {
        ...presets[3]!,
        title: '城市自然镜头',
        tags: ['电影感', '镜头运动', '自然风光', '城市街景', '建筑空间'],
        tagIds: ['cinematic', 'camera-motion', 'nature-landscape', 'city-street', 'architecture-interior']
      },
      {
        ...presets[3]!,
        id: 'anime-action',
        title: '动漫动作',
        tags: ['动漫风格', '动作', '怀旧'],
        tagIds: ['anime-style', 'action', 'nostalgic']
      },
      presets[0]!
    ];
    const view = render(<CreatorDashboard presets={catalog} />);
    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));

    const filter = screen.getByRole('group', { name: '筛选模板' });
    expect(filter.querySelectorAll('button').length).toBeGreaterThan(5);
    for (const label of ['视频翻译', '火柴人动画', '电影短片', '写实电影感', '镜头运动', '自然风光', '城市街景', '建筑空间', '动漫风格', '运动动作', '复古胶片']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: '自然风光' }));
    expect(screen.getByRole('tab', { name: '视频创作' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: '查看城市自然镜头模板详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看动漫动作模板详情' })).not.toBeInTheDocument();

    view.unmount();
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard presets={[
          {
            ...catalog[0]!,
            title: 'City and Nature Camera',
            tags: ['Cinematic', 'Camera motion', 'Natural landscapes', 'City streets', 'Architecture and interiors']
          },
          {
            ...catalog[1]!,
            title: 'Anime Action',
            tags: ['Anime style', 'Action', 'Nostalgic']
          },
          catalog[2]!
        ]} />
      </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Video Creation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Natural Landscapes' }));
    expect(screen.getByRole('tab', { name: 'Video Creation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'View City and Nature Camera template details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Anime Action template details' })).not.toBeInTheDocument();
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

  it('highlights video prompt variables and image slots without styling numeric parameters', () => {
    render(<CreatorDashboard presets={presets} />);
    fireEvent.click(screen.getByRole('tab', { name: '视频创作' }));
    fireEvent.click(screen.getByRole('button', { name: '查看电影感视频预览模板详情' }));

    const variables = [...document.querySelectorAll('.creator-template-prompt-variable')];
    expect(variables.map(variable => variable.textContent)).toEqual([
      '[主体名称]',
      '@Image1'
    ]);
    expect(screen.getByText('[2.5]', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('[结束]', { exact: false })).toBeInTheDocument();
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
          prompt: 'Professional product photography with a clear subject and key selling points.',
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
    expect(document.querySelector('.creator-template-prompt-card'))
      .toHaveTextContent('Professional product photography with a clear subject and key selling points.');
    expect(document.querySelector('.creator-template-prompt-card'))
      .not.toHaveTextContent(presets[1]!.prompt!);
    expect(getCreatorSkillPromptHint({
      id: 'image',
      title: 'Image',
      category: 'Image',
      image: ''
    }, 'en-US')).toContain('Describe what you want to create');
  });
});
