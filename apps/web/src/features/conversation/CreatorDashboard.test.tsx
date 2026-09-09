import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreatorPresetSummary } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
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
    { text: '双语字幕 · 顶部', colors: [] },
    { text: '无衬线 · 粗体 · 中字', colors: ['#FFFFFF', '#FFD45C'] }
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
  highlights: [
    { text: '1536 × 1024', colors: [] },
    { text: '标准质量', colors: [] },
    { text: '2 张', colors: [] }
  ]
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
  highlights: [
    { text: '1024 × 1536', colors: [] },
    { text: '高清质量', colors: [] }
  ]
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
  highlights: [
    { text: '个人成长风格', colors: [] },
    { text: '16:9', colors: [] }
  ]
}];

describe('CreatorDashboard', () => {
  it('renders one module hierarchy and only the selected module presets', () => {
    render(<CreatorDashboard presets={presets} />);

    expect(screen.getByRole('heading', { name: '创作模板' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '创作模块' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '视频翻译模板' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.queryByRole('tab', { name: '推荐' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /视频翻译，1 个模板/ }))
      .toHaveAttribute('aria-selected', 'true');
    const dynamicCard = screen.getByRole('button', {
      name: '使用B站双语精翻模板'
    });
    expect(dynamicCard).toHaveAttribute(
      'data-preset-id',
      'video-translation/bilibili-bilingual/1'
    );
    expect(dynamicCard.querySelector('img')).toHaveAttribute(
      'src',
      `/creator-presets/${'d'.repeat(64)}.webp`
    );
    expect(screen.getByText('英语 → 简体中文')).toBeInTheDocument();
    expect(screen.queryByText('字幕、配音与成片生成')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /视频翻译，1 个模板/ }))
      .toHaveTextContent('视频翻译1');
    expect(screen.queryByRole('button', { name: '空白视频翻译' })).not.toBeInTheDocument();
    expect(screen.queryByText('电商商品主图增强版')).not.toBeInTheDocument();
  });

  it('shows the service, provider and model required by a preset', () => {
    render(<CreatorDashboard selectedModule="video-generation" presets={[{
      ...presets[1]!,
      module: 'video-generation',
      title: '商品广告短片',
      requirements: {
        service: 'video',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128'
      },
      highlights: [{ text: '1280 × 720', colors: [] }]
    }]} />);

    expect(screen.getByText(
      '视频服务 · Seedance · doubao-seedance-2-0-260128'
    )).toBeInTheDocument();
  });

  it('renders repeated subtitle colors without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<CreatorDashboard presets={[{
      ...presets[0]!,
      highlights: [{
        text: '无衬线 · 粗体 · 中字',
        colors: ['#FFFFFF', '#FFFFFF']
      }]
    }]} />);

    expect(document.querySelectorAll('.creator-template-swatches > span')).toHaveLength(2);
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Encountered two children with the same key'),
      expect.anything()
    );
    consoleError.mockRestore();
  });

  it('keeps rendering while an older Runtime catalog has no highlights', () => {
    render(<CreatorDashboard presets={[{
      ...presets[0]!,
      highlights: undefined
    } as unknown as CreatorPresetSummary]} />);

    expect(screen.getByRole('button', { name: '使用B站双语精翻模板' }))
      .toBeInTheDocument();
    expect(document.querySelector('.creator-template-highlights')).not.toBeInTheDocument();
  });

  it('filters presets by module and localized search without exposing blank creation', () => {
    render(<CreatorDashboard presets={presets} />);

    fireEvent.click(screen.getByRole('tab', { name: /封面生成，1 个模板/ }));
    expect(screen.getByRole('heading', { name: '封面生成模板' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '空白封面生成' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: '使用个人成长封面模板'
    })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索封面生成模板' }), {
      target: { value: '不存在' }
    });
    expect(screen.getByText('没有匹配的模板。')).toBeInTheDocument();
  });

  it('deduplicates a rapid double click for the same preset', async () => {
    let resolveSelection: (() => void) | undefined;
    const onSelectPreset = vi.fn(() => new Promise<void>(resolve => {
      resolveSelection = resolve;
    }));
    render(
      <CreatorDashboard
        presets={presets}
        selectedModule="image-generation"
        onSelectPreset={onSelectPreset}
      />
    );
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
    render(
      <CreatorDashboard
        presets={presets}
        selectedModule="image-generation"
        onSelectPreset={onSelectPreset}
      />
    );
    const imageCard = screen.getByRole('button', {
      name: '使用电商商品主图增强版模板'
    });
    const posterCard = screen.getByRole('button', {
      name: '使用社交媒体海报模板'
    });

    fireEvent.click(imageCard);
    expect(imageCard).toBeDisabled();
    expect(posterCard).toBeEnabled();
    fireEvent.click(posterCard);
    expect(onSelectPreset).toHaveBeenCalledTimes(2);

    rejectSelection?.(new Error('创建模板任务失败'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('创建模板任务失败'));
    expect(imageCard).toBeEnabled();
  });

  it('uses the selected interface language for labels and prompt hints', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorDashboard selectedModule="image-generation" presets={[{
          ...presets[1]!,
          title: 'Enhanced Product Hero',
          description: 'Loaded from the localized catalog.'
        }]} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Creation Presets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Creation Modules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Image Generation Presets' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Recommended' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', {
      name: 'Use Enhanced Product Hero preset'
    })).toBeInTheDocument();
    expect(getCreatorSkillPromptHint({
      id: 'image',
      title: 'Image',
      category: 'Image',
      image: ''
    }, 'en-US')).toContain('Describe what you want to create');
  });
});
