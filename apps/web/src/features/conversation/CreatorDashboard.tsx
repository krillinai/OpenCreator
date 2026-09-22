import type {
  CreatorPresetSummary,
  CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Maximize2,
  Play,
  RefreshCw,
  Search,
  WandSparkles,
  UserRound,
  X
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import type { CreatorWorkspace } from '../dashboard/creator-workspace.js';

export type CreatorSkill = {
  id: string;
  title: string;
  category: string;
  image: string;
  interaction?: {
    type: 'workspace';
    workspace: CreatorWorkspace;
  };
  promptHint?: {
    zhCN: string;
    enUS: string;
  };
};

type CreatorHomeCategory = 'recent' | 'recommended' | 'all' | 'video' | 'image';
type FacetOption = {
  id: string;
  zh: string;
  en: string;
  tags: string[];
  modules?: CreatorRuntimeWorkspace[];
};

const videoTagOptions: FacetOption[] = [
  { id: 'translation', zh: '视频翻译', en: 'Video Translation', tags: [], modules: ['video-translation'] },
  { id: 'stickman-animation', zh: '火柴人动画', en: 'Stick Figure Animation', tags: ['stickman-video', 'stick-figure-animation', '火柴人动画', 'Stick figure animation'] },
  { id: 'short-film', zh: '电影短片', en: 'Cinematic Shorts', tags: ['cinematic', 'Cinematic', 'mystery', 'Mystery'] },
  { id: 'vlog', zh: '生活 Vlog', en: 'Lifestyle Vlogs', tags: ['dv', 'DV', 'ugc', 'UGC'] },
  { id: 'brand-ad', zh: '品牌广告', en: 'Brand Ads', tags: ['advertising', 'Advertising', 'jewelry', 'Jewelry'] },
  { id: 'ugc', zh: 'UGC 内容', en: 'UGC Content', tags: ['ugc', 'UGC'] },
  { id: 'tutorial', zh: '知识讲解', en: 'Explainers', tags: ['cooking', 'Cooking', 'multi-stage', 'Multi-stage'] },
  { id: 'intro', zh: '片头包装', en: 'Intros / Branding', tags: [] },
  { id: 'game-promo', zh: '游戏宣传', en: 'Game Promos', tags: [] },
  { id: 'cinematic-realism', zh: '写实电影感', en: 'Cinematic Realism', tags: ['cinematic', 'Cinematic'] },
  { id: 'fantasy', zh: '奇幻冒险', en: 'Fantasy Adventures', tags: ['fantasy', 'Fantasy'] },
  { id: 'scifi', zh: '未来科幻', en: 'Future Sci-fi', tags: ['sci-fi', 'Sci-fi'] },
  { id: 'anime', zh: '动漫风格', en: 'Anime Style', tags: ['anime-style', 'Anime style'] },
  { id: 'retro-film', zh: '复古胶片', en: 'Retro Film', tags: ['nostalgic', 'Nostalgic', 'dv', 'DV'] },
  { id: 'dreamlike', zh: '梦境视觉', en: 'Dreamlike Visuals', tags: [] },
  { id: 'stop-motion', zh: '定格动画', en: 'Stop Motion', tags: ['stop-motion', 'Stop motion'] },
  { id: 'drawn-animation', zh: '手绘动画', en: 'Hand-drawn Animation', tags: ['watercolor', 'Watercolor', '手绘插画', 'Hand-drawn illustration'] },
  { id: 'characters', zh: '人物角色', en: 'People / Characters', tags: ['character-interaction', 'Character interaction', 'first-person', 'First person', '真人贴纸', 'ugc', 'UGC'] },
  { id: 'motion-action', zh: '运动动作', en: 'Sports / Action', tags: ['action', 'Action', 'martial-arts', 'Martial arts', 'parkour', 'Parkour', 'skateboard', 'Skateboard'] },
  { id: 'landscape', zh: '自然风光', en: 'Natural Landscapes', tags: ['nature-landscape', 'Natural landscapes'] },
  { id: 'architecture', zh: '建筑空间', en: 'Architecture / Interiors', tags: ['architecture-interior', 'Architecture and interiors'] },
  { id: 'city', zh: '城市街景', en: 'City Streets', tags: ['city-street', 'City streets'] },
  { id: 'food-video', zh: '美食料理', en: 'Food / Cooking', tags: ['cooking', 'Cooking'] },
  { id: 'product-video', zh: '产品特写', en: 'Product Close-ups', tags: ['advertising', 'Advertising', 'jewelry', 'Jewelry'] },
  { id: 'camera-video', zh: '镜头运动', en: 'Camera Motion', tags: ['camera-motion', 'Camera motion', 'rack-focus', 'Rack focus', 'drone-orbit', 'Drone orbit', 'dolly-zoom', 'Dolly zoom', 'crane-up', 'Crane up', 'pan-right', 'Pan right', 'aerial', 'Aerial'] },
  { id: 'dubbing', zh: '视频配音', en: 'Video Dubbing', tags: [], modules: ['smart-dubbing'] },
  { id: 'download', zh: '视频下载', en: 'Video Downloads', tags: [], modules: ['video-download'] }
];

const imageTagOptions: FacetOption[] = [
  { id: 'image-portrait', zh: '人像写真', en: 'Portraits', tags: ['人像摄影', 'Portrait photography', 'portrait', 'Portrait'] },
  { id: 'image-social', zh: '社交帖子', en: 'Social Posts', tags: ['社交媒体', 'Social media', 'social', 'Social'] },
  { id: 'image-infographic', zh: '信息图解', en: 'Infographics', tags: ['信息图表', 'Infographics', '教育科普', 'Educational content'] },
  { id: 'image-thumbnail', zh: '视频封面', en: 'Video Thumbnails', tags: ['视频缩略图', 'Video thumbnails', 'youtube', 'YouTube', 'cover', 'Cover'] },
  { id: 'image-storyboard', zh: '故事分镜', en: 'Storyboards', tags: ['storyboard', 'Storyboard'] },
  { id: 'image-ad', zh: '品牌广告', en: 'Brand Ads', tags: ['商业广告', 'Commercial advertising', 'advertising', 'Advertising'] },
  { id: 'image-ecommerce', zh: '电商主图', en: 'E-commerce', tags: ['电商视觉', 'E-commerce visuals', 'ecommerce', 'E-commerce'] },
  { id: 'image-game', zh: '游戏视觉', en: 'Game Art', tags: ['游戏视觉', 'Game visuals'] },
  { id: 'image-poster', zh: '海报设计', en: 'Posters', tags: ['海报设计', 'Poster design', '活动物料', 'Event collateral', 'poster', 'Poster'] },
  { id: 'image-web', zh: '网页设计', en: 'Web Design', tags: ['网页界面', 'Web interfaces'] },
  { id: 'image-photography', zh: '摄影', en: 'Photography', tags: ['人像摄影', 'Portrait photography', '创意摄影', 'Creative photography', '产品摄影', 'Product photography'] },
  { id: 'image-cinematic', zh: '电影感', en: 'Cinematic', tags: ['cinematic', 'Cinematic', '电影感'] },
  { id: 'image-anime', zh: '动漫插画', en: 'Anime Illustration', tags: ['anime-style', 'Anime style'] },
  { id: 'image-illustration', zh: '手绘插画', en: 'Hand-drawn Art', tags: ['手绘插画', 'Hand-drawn illustration', '概念艺术', 'Concept art'] },
  { id: 'image-3d', zh: '三维场景', en: '3D Scenes', tags: ['3d-render', '3D render', '等轴测', 'Isometric', '微缩场景', 'Miniature scenes'] },
  { id: 'image-collage', zh: '拼贴手作', en: 'Collage / Craft', tags: ['拼贴设计', 'Collage design', '手工材质', 'Handcrafted textures'] },
  { id: 'image-watercolor', zh: '水彩画', en: 'Watercolor', tags: ['watercolor', 'Watercolor'] },
  { id: 'image-traditional', zh: '国风美学', en: 'Chinese-inspired', tags: ['传统文化', 'Traditional culture'] },
  { id: 'image-retro', zh: '复古怀旧', en: 'Retro', tags: ['nostalgic', 'Nostalgic'] },
  { id: 'image-future', zh: '未来科技', en: 'Futuristic', tags: ['未来科技', 'Future technology'] },
  { id: 'image-minimal', zh: '极简设计', en: 'Minimalist', tags: ['minimalist', 'Minimalist'] },
  { id: 'image-people', zh: '人物角色', en: 'People / Characters', tags: ['人像摄影', 'Portrait photography', '角色场景', 'Character scenes', '真人贴纸', 'Real-person stickers'] },
  { id: 'image-product', zh: '商品产品', en: 'Products', tags: ['产品视觉', 'Product visuals', '产品摄影', 'Product photography', '电商视觉', 'E-commerce visuals', '工业设计', 'Industrial design', 'product', 'Product'] },
  { id: 'image-food', zh: '美食饮品', en: 'Food / Drink', tags: ['食品饮料', 'Food and beverage'] },
  { id: 'image-fashion', zh: '时尚穿搭', en: 'Fashion / Beauty', tags: ['时尚美妆', 'Fashion and beauty'] },
  { id: 'image-architecture', zh: '建筑空间', en: 'Architecture', tags: ['建筑空间', 'Architecture and interiors'] },
  { id: 'image-city', zh: '城市街景', en: 'City Streets', tags: ['city-street', 'City streets'] },
  { id: 'image-nature', zh: '自然植物', en: 'Nature / Plants', tags: ['自然植物', 'Nature and botanicals'] },
  { id: 'image-maps', zh: '地图图表', en: 'Maps / Charts', tags: ['地图视觉', 'Map visuals', '信息图表', 'Infographics'] },
  { id: 'image-type', zh: '文字排版', en: 'Typography', tags: ['文本排版', 'Text layout', '编辑设计', 'Editorial design'] }
];

const categoryOrder: CreatorHomeCategory[] = [
  'recent',
  'recommended',
  'all',
  'video',
  'image'
];
const videoModules = new Set<CreatorRuntimeWorkspace>([
  'video-translation',
  'video-download',
  'video-generation',
  'smart-dubbing'
]);
const imageModules = new Set<CreatorRuntimeWorkspace>([
  'image-generation',
  'cover-generator'
]);
const recentPresetStorageKey = 'opencreator.creator-presets.recent.v1';
const recentPresetLimit = 12;

export function CreatorDashboard(props: {
  presets?: CreatorPresetSummary[];
  loading?: boolean;
  error?: string;
  onRetry?(): void;
  onSelectPreset?(preset: CreatorPresetSummary): Promise<void> | void;
  onSelectSkill?(skill: CreatorSkill): void;
}) {
  const { language } = useAppLanguage();
  const [category, setCategory] = useState<CreatorHomeCategory>('recommended');
  const [selectedTag, setSelectedTag] = useState<string>();
  const [visibleTagCount, setVisibleTagCount] = useState(Infinity);
  const [moreTagsOpen, setMoreTagsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedPresetIdentity, setSelectedPresetIdentity] = useState<string>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [promptHasOverflow, setPromptHasOverflow] = useState(false);
  const [promptAtEnd, setPromptAtEnd] = useState(true);
  const [recentPresetIds, setRecentPresetIds] = useState<string[]>(readRecentPresetIds);
  const [busyIdentities, setBusyIdentities] = useState<Set<string>>(
    () => new Set()
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const detailPageRef = useRef<HTMLDivElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const tagsFilterRef = useRef<HTMLDivElement>(null);
  const tagsMeasureRef = useRef<HTMLDivElement>(null);
  const moreTagsButtonRef = useRef<HTMLButtonElement>(null);
  const busyIdentitiesRef = useRef(new Set<string>());
  const [actionError, setActionError] = useState<string>();
  const presets = props.presets ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const categoryPresets = useMemo(() => {
    if (category === 'recent') {
      const presetsById = new Map(presets.map(preset => [presetIdentity(preset), preset]));
      return recentPresetIds.flatMap(identity => {
        const preset = presetsById.get(identity);
        return preset === undefined ? [] : [preset];
      });
    }
    if (category === 'recommended') return presets.filter(preset => preset.featured);
    if (category === 'all') return presets;
    const modules = category === 'video' ? videoModules : imageModules;
    return presets.filter(preset => modules.has(preset.module));
  }, [category, presets, recentPresetIds]);
  const categoryTagOptions = category === 'video'
    ? videoTagOptions
    : category === 'image'
      ? imageTagOptions
      : [];
  const availableTagOptions = category === 'video'
    ? videoTagOptions
    : categoryTagOptions.filter(option => (
        categoryPresets.some(preset => matchesFacet(preset, option))
      ));
  const pinnedTag = availableTagOptions.findIndex(option => option.id === selectedTag) >= visibleTagCount
    ? selectedTag
    : undefined;
  const orderedTagOptions = pinnedTag === undefined
    ? availableTagOptions
    : [
        ...availableTagOptions.filter(option => option.id === pinnedTag),
        ...availableTagOptions.filter(option => option.id !== pinnedTag)
      ];
  const visibleTagOptions = orderedTagOptions.slice(0, visibleTagCount);
  const overflowTagOptions = orderedTagOptions.slice(visibleTagCount);
  const availableTagKey = orderedTagOptions.map(option => option.id).join('|');
  const visiblePresets = useMemo(() => categoryPresets.filter(preset => (
    (selectedTag === undefined
      || categoryTagOptions.some(option => option.id === selectedTag && matchesFacet(preset, option)))
    && (normalizedQuery === ''
      || `${preset.title} ${preset.description} ${preset.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(normalizedQuery))
  )), [categoryPresets, selectedTag, normalizedQuery, category]);
  const selectedPreset = selectedPresetIdentity === undefined
    ? undefined
    : presets.find(preset => presetIdentity(preset) === selectedPresetIdentity);
  useLayoutEffect(() => {
    const filter = tagsFilterRef.current;
    const measure = tagsMeasureRef.current;
    if (filter === null || measure === null) return;

    const update = () => {
      const widths = Array.from(measure.children, child => child.getBoundingClientRect().width);
      const toggleWidths = widths.splice(-2);
      widths.push(Math.max(...toggleWidths));
      const gap = Number.parseFloat(window.getComputedStyle(measure).columnGap) || 0;
      const count = fitTagCount(widths, filter.getBoundingClientRect().width, gap);
      setVisibleTagCount(count);
      if (count === availableTagOptions.length) setMoreTagsOpen(false);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(filter);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [availableTagKey, language]);

  useEffect(() => {
    if (!moreTagsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!tagsFilterRef.current?.contains(event.target as Node)) setMoreTagsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreTagsOpen(false);
      moreTagsButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreTagsOpen]);
  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    window.setTimeout(() => previewTriggerRef.current?.focus(), 0);
  }, []);
  const updatePromptOverflow = useCallback(() => {
    const prompt = promptRef.current;
    if (prompt === null) return;
    const hasOverflow = prompt.scrollHeight > prompt.clientHeight + 1;
    setPromptHasOverflow(hasOverflow);
    setPromptAtEnd(
      !hasOverflow
      || prompt.scrollTop + prompt.clientHeight >= prompt.scrollHeight - 2
    );
  }, []);

  useEffect(() => {
    if (!previewOpen || selectedPreset === undefined) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePreview();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        previewCloseRef.current?.focus();
      }
    };
    previewCloseRef.current?.focus();
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closePreview, previewOpen, selectedPreset]);

  useLayoutEffect(() => {
    if (selectedPresetIdentity === undefined) return;
    const scrollContainer = detailPageRef.current?.closest<HTMLElement>('.creator-home-wrap');
    if (scrollContainer !== null && scrollContainer !== undefined) {
      scrollContainer.scrollTop = 0;
    }
  }, [selectedPresetIdentity]);

  useLayoutEffect(() => {
    const prompt = promptRef.current;
    if (prompt === null) {
      setPromptHasOverflow(false);
      setPromptAtEnd(true);
      return;
    }
    prompt.scrollTop = 0;
    updatePromptOverflow();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updatePromptOverflow);
    observer.observe(prompt);
    return () => observer.disconnect();
  }, [selectedPreset?.prompt, updatePromptOverflow]);

  function selectCategory(nextCategory: CreatorHomeCategory) {
    setCategory(nextCategory);
    setSelectedTag(undefined);
    setMoreTagsOpen(false);
    setQuery('');
    setSearchOpen(false);
    setActionError(undefined);
  }

  async function selectPreset(preset: CreatorPresetSummary) {
    const identity = presetIdentity(preset);
    if (busyIdentitiesRef.current.has(identity)) return;
    busyIdentitiesRef.current.add(identity);
    setBusyIdentities(new Set(busyIdentitiesRef.current));
    setActionError(undefined);
    try {
      await props.onSelectPreset?.(preset);
      const storedRecentPresetIds = readRecentPresetIds();
      const nextRecentPresetIds = [
        identity,
        ...storedRecentPresetIds.filter(item => item !== identity)
      ].slice(0, recentPresetLimit);
      writeRecentPresetIds(nextRecentPresetIds);
      setRecentPresetIds(nextRecentPresetIds);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      busyIdentitiesRef.current.delete(identity);
      setBusyIdentities(new Set(busyIdentitiesRef.current));
    }
  }

  if (selectedPreset !== undefined) {
    const identity = presetIdentity(selectedPreset);
    const busy = busyIdentities.has(identity);
    const previewUrl = selectedPreset.previewUrl ?? selectedPreset.coverUrl;
    return (
      <>
        <div ref={detailPageRef} className="creator-dashboard creator-template-detail-page">
        <header className="creator-template-detail-toolbar">
          <button
            type="button"
            className="creator-template-back"
            onClick={() => {
              setPreviewOpen(false);
              setSelectedPresetIdentity(undefined);
              setActionError(undefined);
            }}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {language === 'en-US' ? 'Back to templates' : '返回模板列表'}
          </button>
          <span>{moduleLabel(selectedPreset.module, language === 'zh-CN' ? 'zh-CN' : 'en-US')}</span>
        </header>

        <div className="creator-template-detail-layout">
          <section
            className="creator-template-outcome"
            aria-labelledby="creator-template-outcome-title"
          >
            <h2 id="creator-template-outcome-title">
              {language === 'en-US' ? 'Example result' : '成果预览'}
            </h2>
            {selectedPreset.previewVideoUrl === undefined ? (
              <button
                ref={previewTriggerRef}
                type="button"
                className="creator-template-outcome-media"
                aria-label={language === 'en-US'
                  ? `View full ${selectedPreset.title} result`
                  : `全屏查看${selectedPreset.title}完整作品`}
                title={language === 'en-US' ? 'View full result' : '查看完整作品'}
                onClick={() => setPreviewOpen(true)}
              >
                <img src={previewUrl} alt={selectedPreset.title} />
                <span className="creator-template-outcome-expand" aria-hidden="true">
                  <Maximize2 size={17} />
                </span>
              </button>
            ) : (
              <div className="creator-template-outcome-media creator-template-outcome-video">
                <video
                  src={selectedPreset.previewVideoUrl}
                  poster={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={language === 'en-US'
                    ? `${selectedPreset.title} example video`
                    : `${selectedPreset.title}示例视频`}
                />
                <button
                  ref={previewTriggerRef}
                  type="button"
                  className="creator-template-outcome-expand"
                  aria-label={language === 'en-US'
                    ? `View full ${selectedPreset.title} result`
                    : `全屏查看${selectedPreset.title}完整作品`}
                  title={language === 'en-US' ? 'View full result' : '查看完整作品'}
                  onClick={() => setPreviewOpen(true)}
                >
                  <Maximize2 size={17} />
                </button>
              </div>
            )}
          </section>

          <aside className="creator-template-detail-info">
            <div className="creator-template-detail-intro">
              <h1>{selectedPreset.title}</h1>
              <p>{selectedPreset.description}</p>
            </div>

            {selectedPreset.author === undefined ? null : (
              <section
                className="creator-template-author"
                aria-label={language === 'en-US' ? 'Template author' : '模板作者'}
              >
                <span className="creator-template-author-avatar" aria-hidden="true">
                  {selectedPreset.author.avatarUrl === undefined ? null : (
                    <img
                      src={selectedPreset.author.avatarUrl}
                      alt=""
                      onError={event => { event.currentTarget.hidden = true; }}
                    />
                  )}
                  <UserRound size={17} />
                </span>
                <span className="creator-template-author-copy">
                  <small>{language === 'en-US' ? 'Author' : '作者'}</small>
                  <strong title={selectedPreset.author.name}>{selectedPreset.author.name}</strong>
                </span>
                {selectedPreset.author.url === undefined ? null : (
                  <a
                    href={selectedPreset.author.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={language === 'en-US'
                      ? `View original source from ${selectedPreset.author.name}`
                      : `查看${selectedPreset.author.name}的原始来源`}
                  >
                    <span>{language === 'en-US' ? 'Original source' : '原始来源'}</span>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                )}
              </section>
            )}

            {selectedPreset.highlights.length > 0 ? (
              <section className="creator-template-detail-section">
                <h2>{language === 'en-US' ? 'Template settings' : '模板配置'}</h2>
                <div className="creator-template-highlights">
                  {selectedPreset.highlights.map(highlight => (
                    <span className="creator-template-highlight" key={highlight.text}>
                      {highlight.colors.length > 0 ? (
                        <span className="creator-template-swatches" aria-hidden="true">
                          {highlight.colors.map(color => (
                            <span key={color} style={{ backgroundColor: color }} />
                          ))}
                        </span>
                      ) : null}
                      <span>{highlight.text}</span>
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="creator-template-detail-section">
              <h2>{language === 'en-US' ? 'Tags' : '标签'}</h2>
              <ul className="creator-template-tags" aria-label={language === 'en-US'
                ? 'Template tags'
                : '模板标签'}>
                {selectedPreset.tags.map(tag => <li key={tag}>{tag}</li>)}
              </ul>
            </section>

            {selectedPreset.requirements !== null ? (
              <p className="creator-template-runtime-requirement">
                {language === 'en-US' ? 'Requires' : '运行需要'}: {' '}
                {selectedPreset.requirements.provider}
                {selectedPreset.requirements.model === undefined
                  ? ''
                  : ` / ${selectedPreset.requirements.model}`}
              </p>
            ) : null}

            {actionError ? (
              <p className="creator-template-action-error" role="alert">{actionError}</p>
            ) : null}

            <button
              className="creator-template-use-button"
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void selectPreset(selectedPreset)}
            >
              <WandSparkles size={17} aria-hidden="true" />
              {busy
                ? (language === 'en-US' ? 'Creating...' : '正在创建...')
                : (language === 'en-US' ? 'Use this template' : '使用此模板')}
            </button>
          </aside>
        </div>

        <section className="creator-template-detail-section creator-template-prompt-section">
          <h2>{language === 'en-US' ? 'Prompt' : '提示词'}</h2>
          <div className={`creator-template-prompt-card${promptHasOverflow
            ? ' is-scrollable'
            : ''}${promptAtEnd ? ' is-at-end' : ''}`}>
            <p
              ref={promptRef}
              onScroll={updatePromptOverflow}
              className={selectedPreset.prompt === null
                ? 'creator-template-detail-empty'
                : 'creator-template-prompt'}
            >
              {selectedPreset.prompt === null
                ? (language === 'en-US'
                    ? 'This template uses fixed settings and does not require a preset prompt.'
                    : '此模板使用固定配置，无需预设提示词。')
                : renderPromptVariables(selectedPreset.prompt, language === 'zh-CN' ? 'zh-CN' : 'en-US')}
            </p>
            <span className="creator-template-prompt-scroll-cue" aria-hidden="true">
              <ChevronDown size={17} />
            </span>
          </div>
        </section>
        </div>
        {!previewOpen ? null : createPortal(
          <div
            className="creator-template-preview-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closePreview();
            }}
          >
            <section
              className="creator-template-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={language === 'en-US'
                ? `${selectedPreset.title} full result`
                : `${selectedPreset.title}完整作品`}
            >
              {selectedPreset.previewVideoUrl === undefined ? (
                <img src={previewUrl} alt={selectedPreset.title} />
              ) : (
                <video
                  src={selectedPreset.previewVideoUrl}
                  poster={previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  autoPlay
                  aria-label={language === 'en-US'
                    ? `${selectedPreset.title} full example video`
                    : `${selectedPreset.title}完整示例视频`}
                />
              )}
              <button
                ref={previewCloseRef}
                type="button"
                aria-label={language === 'en-US' ? 'Close preview' : '关闭预览'}
                title={language === 'en-US' ? 'Close preview' : '关闭预览'}
                onClick={closePreview}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </section>
          </div>,
          document.body
        )}
      </>
    );
  }

  return (
    <div className="creator-dashboard">
      <div
        className="creator-template-tabs"
        role="tablist"
        aria-label={language === 'en-US' ? 'Creation template categories' : '创作模板分类'}
      >
        {categoryOrder.map(item => (
          <button
            type="button"
            role="tab"
            key={item}
            aria-selected={category === item}
            aria-controls="creator-template-panel"
            onClick={() => selectCategory(item)}
          >
            {categoryLabel(item, language === 'zh-CN' ? 'zh-CN' : 'en-US')}
          </button>
        ))}
      </div>

      <section
        id="creator-template-panel"
        className="creator-dashboard-section"
        role="tabpanel"
        aria-labelledby="creator-templates-title"
      >
        <div className="creator-dashboard-heading">
          <h1 id="creator-templates-title">
            {language === 'en-US' ? 'Featured Templates' : '精选模板'}
          </h1>
          {searchOpen ? (
            <div className="creator-template-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Escape') return;
                  setQuery('');
                  setSearchOpen(false);
                }}
                aria-label={language === 'en-US' ? 'Search templates' : '搜索模板'}
                placeholder={language === 'en-US' ? 'Search templates' : '搜索模板'}
              />
              <button
                type="button"
                aria-label={language === 'en-US' ? 'Close template search' : '关闭模板搜索'}
                title={language === 'en-US' ? 'Close search' : '关闭搜索'}
                onClick={() => {
                  setQuery('');
                  setSearchOpen(false);
                }}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              className="creator-template-search-trigger"
              type="button"
              aria-label={language === 'en-US' ? 'Search templates' : '搜索模板'}
              title={language === 'en-US' ? 'Search templates' : '搜索模板'}
              onClick={() => {
                setSearchOpen(true);
                window.requestAnimationFrame(() => searchInputRef.current?.focus());
              }}
            >
              <Search size={17} aria-hidden="true" />
            </button>
          )}
        </div>

        {(category === 'video' || category === 'image') ? (
          <div className="creator-template-tags-filter" role="group" aria-label={language === 'en-US' ? 'Filter templates' : '筛选模板'} ref={tagsFilterRef}>
            <div className="creator-template-tags-line">
              <button
                type="button"
                aria-pressed={selectedTag === undefined}
                onClick={() => {
                  setSelectedTag(undefined);
                  setMoreTagsOpen(false);
                }}
              >
                {language === 'en-US' ? 'All' : '全部'}
              </button>
              {visibleTagOptions.map(option => (
                <button
                  type="button"
                  key={option.id}
                  aria-pressed={selectedTag === option.id}
                  onClick={() => setSelectedTag(option.id)}
                >
                  {language === 'en-US' ? option.en : option.zh}
                </button>
              ))}
              {overflowTagOptions.length > 0 ? (
                <button
                  className="creator-template-tags-more"
                  type="button"
                  ref={moreTagsButtonRef}
                  aria-expanded={moreTagsOpen}
                  aria-controls="creator-template-tags-overflow"
                  onClick={() => setMoreTagsOpen(open => !open)}
                >
                  {moreTagsOpen
                    ? (language === 'en-US' ? 'Show less' : '收起')
                    : (language === 'en-US' ? 'More' : '更多')}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {moreTagsOpen && overflowTagOptions.length > 0 ? (
              <div className="creator-template-tags-overflow" id="creator-template-tags-overflow" role="group" aria-label={language === 'en-US' ? 'More template filters' : '更多模板分类'}>
                {overflowTagOptions.map(option => (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={selectedTag === option.id}
                    onClick={() => {
                      setSelectedTag(option.id);
                      setMoreTagsOpen(false);
                    }}
                  >
                    {language === 'en-US' ? option.en : option.zh}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="creator-template-tags-measure" aria-hidden="true" ref={tagsMeasureRef}>
              <button type="button" tabIndex={-1}>{language === 'en-US' ? 'All' : '全部'}</button>
              {orderedTagOptions.map(option => (
                <button type="button" tabIndex={-1} key={option.id} aria-pressed={selectedTag === option.id}>
                  {language === 'en-US' ? option.en : option.zh}
                </button>
              ))}
              <button type="button" tabIndex={-1} className="creator-template-tags-more">
                {language === 'en-US' ? 'More' : '更多'}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              <button type="button" tabIndex={-1} className="creator-template-tags-more">
                {language === 'en-US' ? 'Show less' : '收起'}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        {props.loading ? (
          <div
            className="creator-template-grid creator-template-loading-grid"
            role="status"
            aria-busy="true"
            aria-label={language === 'en-US' ? 'Loading templates' : '正在加载模板'}
          >
            {[0, 1, 2, 3].map(item => (
              <span className="creator-template-skeleton" aria-hidden="true" key={item}>
                <span className="creator-template-skeleton-media" />
                <span className="creator-template-skeleton-copy">
                  <span />
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {props.error ? (
          <div className="creator-template-error" role="alert">
            <span>{props.error}</span>
            <button type="button" onClick={props.onRetry}>
              <RefreshCw size={15} aria-hidden="true" />
              {language === 'en-US' ? 'Retry' : '重试'}
            </button>
          </div>
        ) : null}
        {actionError ? (
          <p className="creator-template-action-error" role="alert">{actionError}</p>
        ) : null}

        {!props.loading && !props.error ? (
          <div className="creator-template-grid">
            {visiblePresets.map(preset => {
              const identity = presetIdentity(preset);
              return (
                <button
                  className="creator-template-card"
                  type="button"
                  key={identity}
                  data-preset-id={identity}
                  onClick={() => {
                    setPreviewOpen(false);
                    setSelectedPresetIdentity(identity);
                    setActionError(undefined);
                  }}
                  aria-label={language === 'en-US'
                    ? `View ${preset.title} template details`
                    : `查看${preset.title}模板详情`}
                >
                  <span className="creator-template-media">
                    <img src={preset.coverUrl} alt="" loading="lazy" />
                    {videoModules.has(preset.module) ? (
                      <span className="creator-template-play-marker" aria-hidden="true">
                        <Play size={16} fill="currentColor" strokeWidth={0} />
                      </span>
                    ) : null}
                  </span>
                  <span className="creator-template-copy">
                    <strong>{preset.title}</strong>
                  </span>
                </button>
              );
            })}
            {visiblePresets.length === 0 ? (
              <p className="creator-template-empty">
                {normalizedQuery
                  ? (language === 'en-US' ? 'No matching presets.' : '没有匹配的模板。')
                  : selectedTag !== undefined
                    ? (language === 'en-US' ? 'No templates for this tag yet.' : '该标签暂时没有模板。')
                  : category === 'recent'
                    ? (language === 'en-US'
                        ? 'No recently used templates.'
                        : '还没有使用过模板。')
                    : (language === 'en-US'
                        ? 'No templates are available in this category yet.'
                        : '该分类暂时没有模板。')}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function getCreatorSkillPromptHint(
  skill: CreatorSkill,
  language: 'zh-CN' | 'en-US'
): string {
  if (skill.promptHint !== undefined) {
    return language === 'en-US' ? skill.promptHint.enUS : skill.promptHint.zhCN;
  }
  return language === 'en-US'
    ? `Describe what you want to create with ${skill.title} and any requirements`
    : `描述你希望用「${skill.title}」完成的内容和要求`;
}

function presetIdentity(preset: CreatorPresetSummary): string {
  return `${preset.module}/${preset.id}/${preset.version}`;
}

function renderPromptVariables(
  prompt: string,
  language: 'zh-CN' | 'en-US'
) {
  const variablePattern = /(@Image\d+|\[[^\]\n]{1,80}\]|\{(?!\s*["'])[^{}\n]{1,80}\})/g;
  const nonVariableLabels = new Set(['结束', 'end']);
  const isVariable = (part: string): boolean => {
    if (/^@Image\d+$/.test(part) || /^\{(?!\s*["'])[^{}\n]{1,80}\}$/.test(part)) {
      return true;
    }
    const bracketMatch = part.match(/^\[([^\]\n]{1,80})\]$/);
    if (bracketMatch === null) return false;
    const label = bracketMatch[1]?.trim() ?? '';
    if (nonVariableLabels.has(label.toLowerCase())) return false;
    if (/(?:强制执行|严格限制|strict (?:rules?|requirements?))/i.test(label)) return false;
    return !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(label);
  };
  return prompt.split(variablePattern).map((part, index) => (
    isVariable(part) ? (
      <mark
        className="creator-template-prompt-variable"
        title={language === 'en-US' ? 'Replaceable variable' : '可替换变量'}
        key={`${index}-${part}`}
      >
        {part}
      </mark>
    ) : part
  ));
}

function categoryLabel(
  category: CreatorHomeCategory,
  language: 'zh-CN' | 'en-US'
): string {
  const labels: Record<CreatorHomeCategory, { zh: string; en: string }> = {
    recent: { zh: '最近', en: 'Recent' },
    recommended: { zh: '推荐', en: 'Recommended' },
    all: { zh: '全部', en: 'All' },
    video: { zh: '视频创作', en: 'Video Creation' },
    image: { zh: '图像设计', en: 'Image Design' }
  };
  return language === 'en-US' ? labels[category].en : labels[category].zh;
}

function matchesFacet(preset: CreatorPresetSummary, option: FacetOption): boolean {
  return option.modules?.includes(preset.module) === true
    || (preset.tagIds ?? preset.tags).some(tag => option.tags.includes(tag));
}

function fitTagCount(widths: number[], availableWidth: number, gap: number): number {
  if (widths.length < 2) return 0;
  const optionWidths = widths.slice(1, -1);
  const allWidth = widths[0]!;
  const fullWidth = allWidth + optionWidths.reduce((sum, width) => sum + width + gap, 0);
  if (fullWidth <= availableWidth) return optionWidths.length;

  let usedWidth = allWidth + widths[widths.length - 1]! + gap;
  let count = 0;
  for (const width of optionWidths) {
    if (usedWidth + width + gap > availableWidth) break;
    usedWidth += width + gap;
    count++;
  }
  return count;
}

function moduleLabel(
  module: CreatorRuntimeWorkspace,
  language: 'zh-CN' | 'en-US'
): string {
  const labels: Record<CreatorRuntimeWorkspace, { zh: string; en: string }> = {
    'video-translation': { zh: '视频翻译', en: 'Video translation' },
    'video-download': { zh: '视频下载', en: 'Video download' },
    'image-generation': { zh: '图像生成', en: 'Image generation' },
    'video-generation': { zh: '视频生成', en: 'Video generation' },
    'cover-generator': { zh: '封面生成', en: 'Cover generation' },
    'smart-dubbing': { zh: '智能配音', en: 'Smart dubbing' }
  };
  return language === 'en-US' ? labels[module].en : labels[module].zh;
}

function readRecentPresetIds(): string[] {
  try {
    const stored = window.localStorage.getItem(recentPresetStorageKey);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeRecentPresetIds(identities: string[]) {
  try {
    window.localStorage.setItem(recentPresetStorageKey, JSON.stringify(identities));
  } catch {
    // Recent templates are optional when browser storage is unavailable.
  }
}
