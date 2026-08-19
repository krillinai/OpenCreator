import { useEffect, useMemo, useState } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import {
  ArrowUpRight,
  Clapperboard,
  Crop,
  Download,
  FileVideo,
  Image,
  ImagePlus,
  Languages,
  Mic2,
  ScanFace,
  Search,
  Sparkles,
  UserRound,
  WandSparkles,
  type LucideIcon
} from 'lucide-react';
import './dashboard.css';
import AutoClipWorkspace from './AutoClipWorkspace.js';
import CoverGeneratorWorkspace from './CoverGeneratorWorkspace.js';
import StickmanVideoWorkspace from './StickmanVideoWorkspace.js';
import VideoDownloadWorkspace from './VideoDownloadWorkspace.js';
import VideoTranslationWorkspace from './VideoTranslationWorkspace.js';
import type {
  CreatorSkillLaunch,
  CreatorWorkspace
} from './creator-workspace.js';

type DashboardCategory = '视频创作' | '图像创作' | '音频处理' | '视频编辑' | '数字人';

type DashboardEntry = {
  title: string;
  description: string;
  prompt: string;
  category: DashboardCategory;
  icon: LucideIcon;
  isNew?: boolean;
  workspace?: CreatorWorkspace;
};

type FeaturedEntry = Pick<DashboardEntry, 'title' | 'prompt'> & {
  image: string;
  accent: 'warm' | 'cyan' | 'neutral';
  workspace?: CreatorWorkspace;
};

const featuredTools: FeaturedEntry[] = [
  {
    title: '火柴人动画生成',
    image: '/dashboard/templates/ai-video-insane.jpg',
    prompt: '根据我的创意生成一支火柴人动画，请先帮我完善故事、角色动作、画面节奏和分镜。',
    accent: 'warm',
    workspace: 'stickman-video'
  },
  {
    title: '视频翻译配音',
    image: '/dashboard/templates/video-translation-example.png',
    prompt: '帮我把这段视频翻译成目标语言，保留原片语气，并生成匹配的字幕和配音。',
    accent: 'cyan',
    workspace: 'video-translation'
  },
  {
    title: '数字人口播',
    image: '/dashboard/templates/digital-presenter.jpg',
    prompt: '帮我制作一支数字人口播视频，请先优化文案，再规划人物、声音和画面。',
    accent: 'neutral'
  }
];

const creatorTools: DashboardEntry[] = [
  {
    title: '视频翻译',
    description: '字幕、配音与口型同步',
    prompt: '帮我把这段视频翻译成目标语言，保留原片语气，并生成匹配的字幕和配音。',
    category: '视频编辑',
    icon: Languages,
    isNew: true,
    workspace: 'video-translation'
  },
  {
    title: 'AI 视频生成',
    description: '从创意生成完整视频',
    prompt: '根据我的创意和素材生成一支完整的 AI 视频，请先帮我梳理画面风格、镜头和节奏。',
    category: '视频创作',
    icon: WandSparkles
  },
  {
    title: '数字人口播',
    description: '快速制作专业口播',
    prompt: '帮我制作一支数字人口播视频，请先优化文案，再规划人物、声音和画面。',
    category: '数字人',
    icon: UserRound
  },
  {
    title: '火柴人视频生成',
    description: '角色、分镜与完整动画',
    prompt: '根据我的创意生成一支动画短片，请先帮我完善故事、角色和分镜。',
    category: '视频创作',
    icon: Sparkles,
    workspace: 'stickman-video'
  },
  {
    title: '自动剪辑',
    description: '语义识别与高光切片',
    prompt: '帮我剪辑这些视频素材，请梳理叙事节奏，给出剪辑方案并生成成片。',
    category: '视频编辑',
    icon: Clapperboard,
    workspace: 'auto-clips'
  },
  {
    title: '智能配音',
    description: '自然音色与情绪表达',
    prompt: '帮我为这段内容制作配音，请根据使用场景优化文本、语速、停顿和情绪。',
    category: '音频处理',
    icon: Mic2
  },
  {
    title: '图像生成',
    description: '生成创意图片与视觉素材',
    prompt: '根据我的创意生成一组图片，请先确认画面主体、风格、构图和使用场景。',
    category: '图像创作',
    icon: Image
  },
  {
    title: '封面生成',
    description: '生成视频与内容封面',
    prompt: '根据我的内容主题生成一张封面，请先规划标题层级、主体画面、构图和视觉风格。',
    category: '图像创作',
    icon: ImagePlus,
    workspace: 'cover-generator'
  },
  {
    title: '画面扩展',
    description: '智能补全画面边界',
    prompt: '帮我扩展这张图片的画面范围，保持主体、光线、透视和原有风格一致。',
    category: '图像创作',
    icon: Crop
  },
  {
    title: '视频转格式',
    description: '适配不同平台与尺寸',
    prompt: '帮我把视频转换为目标平台需要的格式、分辨率和画幅，并尽量保持画质。',
    category: '视频编辑',
    icon: FileVideo
  },
  {
    title: '视频下载',
    description: '支持YouTube，Bilibili等',
    prompt: '帮我下载这个视频链接，支持 YouTube、Bilibili 等平台，并保存为可用的视频文件。',
    category: '视频编辑',
    icon: Download,
    workspace: 'video-download'
  },
  {
    title: '数字人分身',
    description: '创建专属数字人形象',
    prompt: '帮我创建一个专属数字人分身，请先规划人物形象、表达风格和适用场景。',
    category: '数字人',
    icon: ScanFace
  },
];

const categories = ['全部', '视频创作', '图像创作', '音频处理', '视频编辑', '数字人'] as const;
type CategoryFilter = typeof categories[number];

export default function DashboardPage(props: {
  onSelectPrompt(prompt: string): void;
  onWorkspaceModeChange?(active: boolean): void;
  skillLaunch?: CreatorSkillLaunch;
}) {
  const { language, t } = useAppLanguage();
  const [activeWorkspace, setActiveWorkspace] = useState<CreatorWorkspace | null>(
    () => props.skillLaunch?.workspace ?? null
  );
  const [activePromptHint, setActivePromptHint] = useState(
    () => props.skillLaunch?.promptHint
  );
  const [category, setCategory] = useState<CategoryFilter>('全部');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const localize = (value: string) => language === 'en-US'
    ? englishDashboardLabels[value] ?? value
    : value;
  const visibleTools = useMemo(() => creatorTools.filter(tool => {
    const matchesCategory = category === '全部' || tool.category === category;
    const matchesQuery = normalizedQuery.length === 0
      || `${localize(tool.title)} ${localize(tool.description)} ${localize(tool.category)}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  }), [category, language, normalizedQuery]);

  useEffect(() => {
    props.onWorkspaceModeChange?.(activeWorkspace !== null);
    return () => props.onWorkspaceModeChange?.(false);
  }, [activeWorkspace, props.onWorkspaceModeChange]);

  if (activeWorkspace === 'video-translation') {
    return (
      <VideoTranslationWorkspace
        promptHint={activePromptHint}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'video-download') {
    return (
      <VideoDownloadWorkspace
        promptHint={activePromptHint}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'stickman-video') {
    return (
      <StickmanVideoWorkspace
        promptHint={activePromptHint}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'auto-clips') {
    return (
      <AutoClipWorkspace
        promptHint={activePromptHint}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'cover-generator') {
    return (
      <CoverGeneratorWorkspace
        promptHint={activePromptHint}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  return (
    <main className="creator-tools-page">
      <div className="creator-tools-page-inner">
        <header className="creator-tools-page-header">
          <h1>{t('dashboard.title')}</h1>
        </header>

        <section className="dashboard-featured" aria-labelledby="dashboard-featured-title">
          <h2 id="dashboard-featured-title">{t('dashboard.featured')}</h2>
          <div className="dashboard-featured-grid">
            {featuredTools.map(tool => (
              <button
                className="dashboard-featured-card"
                data-accent={tool.accent}
                type="button"
                key={tool.title}
                onClick={() => tool.workspace
                  ? setActiveWorkspace(tool.workspace)
                  : props.onSelectPrompt(tool.prompt)}
                aria-label={t('dashboard.openTool', { title: localize(tool.title) })}
              >
                <img src={tool.image} alt="" />
                <span className="dashboard-featured-scrim" aria-hidden="true" />
                <span className="dashboard-featured-copy">
                  <strong>{localize(tool.title)}</strong>
                  <span>{t('dashboard.start')} <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden="true" /></span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-directory" aria-label={t('dashboard.apps')}>
          <div className="dashboard-directory-controls">
            <div className="dashboard-category-tabs" role="tablist" aria-label={t('dashboard.categories')}>
              {categories.map(item => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={category === item}
                  key={item}
                  onClick={() => setCategory(item)}
                >
                  {localize(item)}
                </button>
              ))}
            </div>
            <label className="dashboard-search">
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
              <input
                type="search"
                aria-label={t('dashboard.search')}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('dashboard.search')}
              />
            </label>
          </div>

          {visibleTools.length > 0 ? (
            <div className="dashboard-app-grid">
              {visibleTools.map(({ title, description, prompt, icon: Icon, isNew, workspace }) => (
                <button
                  className="dashboard-app-card"
                  type="button"
                  key={title}
                  onClick={() => workspace ? setActiveWorkspace(workspace) : props.onSelectPrompt(prompt)}
                >
                  <span className="dashboard-app-icon">
                    <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <span className="dashboard-app-copy">
                    <span className="dashboard-app-title">
                      <strong>{localize(title)}</strong>
                      {isNew ? <small>NEW</small> : null}
                    </span>
                    <span>{localize(description)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty" role="status">
              <Search size={20} strokeWidth={1.6} aria-hidden="true" />
              <p>{t('dashboard.empty')}</p>
              <button type="button" onClick={() => { setQuery(''); setCategory('全部'); }}>
                {t('dashboard.showAll')}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const englishDashboardLabels: Record<string, string> = {
  全部: 'All',
  视频创作: 'Video Creation',
  图像创作: 'Image Creation',
  音频处理: 'Audio',
  视频编辑: 'Video Editing',
  数字人: 'Avatars',
  火柴人动画生成: 'Stick Figure Animation',
  视频翻译配音: 'Translate & Dub Video',
  数字人口播: 'Digital Avatar',
  视频翻译: 'Video Translation',
  '字幕、配音与口型同步': 'Subtitles, dubbing, and lip sync',
  'AI 视频生成': 'AI Video Generation',
  从创意生成完整视频: 'Generate complete videos from an idea',
  快速制作专业口播: 'Create professional presenter videos quickly',
  火柴人视频生成: 'Stick Figure Video',
  '角色、分镜与完整动画': 'Characters, storyboards, and animation',
  自动剪辑: 'Auto Clips',
  语义识别与高光切片: 'Semantic detection and highlight clips',
  智能配音: 'AI Dubbing',
  自然音色与情绪表达: 'Natural voices with expressive delivery',
  图像生成: 'Image Generation',
  生成创意图片与视觉素材: 'Generate images and visual assets',
  封面生成: 'Thumbnail Generator',
  生成视频与内容封面: 'Create thumbnails for videos and content',
  画面扩展: 'Image Expansion',
  智能补全画面边界: 'Extend image boundaries intelligently',
  视频转格式: 'Video Converter',
  适配不同平台与尺寸: 'Adapt videos for platforms and formats',
  视频下载: 'Video Downloader',
  '支持YouTube，Bilibili等': 'Supports YouTube, Bilibili, and more',
  数字人分身: 'Digital Human Avatar',
  创建专属数字人形象: 'Create a custom digital human avatar'
};
