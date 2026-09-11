import type {
  CreatorPresetSummary,
  CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Maximize2,
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

type CreatorHomeCategory = 'recent' | 'recommended' | 'video' | 'image';

const categoryOrder: CreatorHomeCategory[] = [
  'recent',
  'recommended',
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
    const modules = category === 'video' ? videoModules : imageModules;
    return presets.filter(preset => modules.has(preset.module));
  }, [category, presets, recentPresetIds]);
  const visiblePresets = useMemo(() => categoryPresets.filter(preset => (
    normalizedQuery === ''
    || `${preset.title} ${preset.description} ${preset.tags.join(' ')}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  )), [categoryPresets, normalizedQuery]);
  const selectedPreset = selectedPresetIdentity === undefined
    ? undefined
    : presets.find(preset => presetIdentity(preset) === selectedPresetIdentity);
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
          <span>{moduleLabel(selectedPreset.module, language)}</span>
        </header>

        <div className="creator-template-detail-layout">
          <section
            className="creator-template-outcome"
            aria-labelledby="creator-template-outcome-title"
          >
            <h2 id="creator-template-outcome-title">
              {language === 'en-US' ? 'Example result' : '成果预览'}
            </h2>
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
                : renderPromptVariables(selectedPreset.prompt, language)}
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
              <img src={previewUrl} alt={selectedPreset.title} />
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
            {categoryLabel(item, language)}
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
  const variablePattern = /(\[(?:插入[^\]\n]+|[A-Z][A-Z0-9 _/.-]{1,79}|(?:品牌|城市|车辆)[^\]\n]*名称[^\]\n]*)\]|\{(?!\s*["'])[^{}\n]{1,80}\})/g;
  const completeVariablePattern = /^(?:\[(?:插入[^\]\n]+|[A-Z][A-Z0-9 _/.-]{1,79}|(?:品牌|城市|车辆)[^\]\n]*名称[^\]\n]*)\]|\{(?!\s*["'])[^{}\n]{1,80}\})$/;
  return prompt.split(variablePattern).map((part, index) => (
    completeVariablePattern.test(part) ? (
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
    video: { zh: '视频创作', en: 'Video Creation' },
    image: { zh: '图像设计', en: 'Image Design' }
  };
  return language === 'en-US' ? labels[category].en : labels[category].zh;
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
