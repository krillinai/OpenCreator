import type {
  CreatorPresetSummary,
  CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import {
  RefreshCw,
  Search,
  X
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
  const [recentPresetIds, setRecentPresetIds] = useState<string[]>(readRecentPresetIds);
  const [busyIdentities, setBusyIdentities] = useState<Set<string>>(
    () => new Set()
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
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
            {language === 'en-US' ? 'Creation Templates' : '创作模板'}
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
              const busy = busyIdentities.has(identity);
              return (
                <button
                  className="creator-template-card"
                  type="button"
                  key={identity}
                  data-preset-id={identity}
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => void selectPreset(preset)}
                  aria-label={language === 'en-US'
                    ? `Use ${preset.title} preset`
                    : `使用${preset.title}模板`}
                >
                  <span className="creator-template-media">
                    <img src={preset.coverUrl} alt="" loading="lazy" />
                    {busy ? (
                      <span className="creator-template-busy">
                        {language === 'en-US' ? 'Creating...' : '正在创建...'}
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
