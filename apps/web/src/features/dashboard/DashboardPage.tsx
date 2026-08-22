import { useEffect, useMemo, useState } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import {
  ArrowUpRight,
  Clapperboard,
  Download,
  Image,
  ImagePlus,
  Languages,
  Mic2,
  Search,
  Sparkles,
  UserRound,
  WandSparkles,
  type LucideIcon
} from 'lucide-react';
import './dashboard.css';
import AutoClipWorkspace from './AutoClipWorkspace.js';
import CoverGeneratorWorkspace from './CoverGeneratorWorkspace.js';
import DigitalAvatarWorkspace from './DigitalAvatarWorkspace.js';
import ImageGenerationWorkspace from './ImageGenerationWorkspace.js';
import SmartDubbingWorkspace from './SmartDubbingWorkspace.js';
import StickmanVideoWorkspace from './StickmanVideoWorkspace.js';
import VideoDownloadWorkspace from './VideoDownloadWorkspace.js';
import VideoTranslationWorkspace from './VideoTranslationWorkspace.js';
import VideoGenerationWorkspace from './VideoGenerationWorkspace.js';
import type {
  CreatorSkillLaunch,
  CreatorWorkspace
} from './creator-workspace.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import type { SmartDubbingService } from '../../services/smart-dubbing-service.js';
import type { ImageGenerationService } from '../../services/image-generation-service.js';
import type { VideoGenerationService } from '../../services/video-generation-service.js';

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
    title: '火柴人动画',
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
    accent: 'neutral',
    workspace: 'digital-avatar'
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
    title: '视频生成',
    description: '从创意生成完整视频',
    prompt: '根据我的创意和素材生成一支完整的 AI 视频，请先帮我梳理画面风格、镜头和节奏。',
    category: '视频创作',
    icon: WandSparkles,
    workspace: 'video-generation'
  },
  {
    title: '数字人口播',
    description: '快速制作专业口播',
    prompt: '帮我制作一支数字人口播视频，请先优化文案，再规划人物、声音和画面。',
    category: '数字人',
    icon: UserRound,
    workspace: 'digital-avatar'
  },
  {
    title: '火柴人动画',
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
    icon: Mic2,
    workspace: 'smart-dubbing'
  },
  {
    title: '图像生成',
    description: '生成创意图片与视觉素材',
    prompt: '根据我的创意生成一组图片，请先确认画面主体、风格、构图和使用场景。',
    category: '图像创作',
    icon: Image,
    workspace: 'image-generation'
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
    title: '视频下载',
    description: '支持YouTube，Bilibili等',
    prompt: '帮我下载这个视频链接，支持 YouTube、Bilibili 等平台，并保存为可用的视频文件。',
    category: '视频编辑',
    icon: Download,
    workspace: 'video-download'
  },
];

const categories = ['全部', '视频创作', '图像创作', '音频处理', '视频编辑', '数字人'] as const;
type CategoryFilter = typeof categories[number];

export default function DashboardPage(props: {
  onSelectPrompt(prompt: string): void;
  onWorkspaceModeChange?(active: boolean): void;
  skillLaunch?: CreatorSkillLaunch;
  smartDubbingService?: SmartDubbingService;
  imageGenerationService?: ImageGenerationService;
  videoGenerationService?: VideoGenerationService;
  videoMetadataService?: VideoMetadataService;
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
        videoMetadataService={props.videoMetadataService}
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

  if (activeWorkspace === 'smart-dubbing') {
    return (
      <SmartDubbingWorkspace
        promptHint={activePromptHint}
        service={props.smartDubbingService}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'image-generation') {
    return (
      <ImageGenerationWorkspace
        promptHint={activePromptHint}
        service={props.imageGenerationService}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'video-generation') {
    return (
      <VideoGenerationWorkspace
        promptHint={activePromptHint}
        service={props.videoGenerationService}
        onBack={() => {
          setActiveWorkspace(null);
          setActivePromptHint(undefined);
        }}
      />
    );
  }

  if (activeWorkspace === 'digital-avatar') {
    return (
      <DigitalAvatarWorkspace
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
        videoMetadataService={props.videoMetadataService}
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
  火柴人动画: 'Stick Figure Animation',
  视频翻译配音: 'Translate & Dub Video',
  数字人口播: 'Digital Avatar',
  视频翻译: 'Video Translation',
  '字幕、配音与口型同步': 'Subtitles, dubbing, and lip sync',
  视频生成: 'Video Generation',
  从创意生成完整视频: 'Generate complete videos from an idea',
  快速制作专业口播: 'Create professional presenter videos quickly',
  '角色、分镜与完整动画': 'Characters, storyboards, and animation',
  自动剪辑: 'Auto Clips',
  语义识别与高光切片: 'Semantic detection and highlight clips',
  智能配音: 'AI Dubbing',
  自然音色与情绪表达: 'Natural voices with expressive delivery',
  图像生成: 'Image Generation',
  生成创意图片与视觉素材: 'Generate images and visual assets',
  封面生成: 'Thumbnail Generator',
  生成视频与内容封面: 'Create thumbnails for videos and content',
  视频下载: 'Video Downloader',
  '支持YouTube，Bilibili等': 'Supports YouTube, Bilibili, and more',
};
