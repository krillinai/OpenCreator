import type {
  CreatorPresetRequirements,
  CreatorPresetSummary,
  CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import {
  Cpu,
  Download,
  Image,
  ImagePlus,
  Languages,
  Mic2,
  RefreshCw,
  Search,
  WandSparkles,
  type LucideIcon
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

const moduleOrder: CreatorRuntimeWorkspace[] = [
  'video-translation',
  'video-download',
  'image-generation',
  'video-generation',
  'cover-generator',
  'smart-dubbing'
];

const moduleCopy: Record<CreatorRuntimeWorkspace, {
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
  blankZh: string;
  blankEn: string;
  icon: LucideIcon;
}> = {
  'video-translation': {
    zh: '视频翻译',
    en: 'Video Translation',
    descriptionZh: '字幕、配音与成片生成',
    descriptionEn: 'Subtitles, dubbing, and rendered video',
    blankZh: '空白视频翻译',
    blankEn: 'Blank Video Translation',
    icon: Languages
  },
  'video-download': {
    zh: '视频下载',
    en: 'Video Download',
    descriptionZh: '下载视频或提取音频',
    descriptionEn: 'Download video or extract audio',
    blankZh: '空白视频下载',
    blankEn: 'Blank Video Download',
    icon: Download
  },
  'image-generation': {
    zh: '图像生成',
    en: 'Image Generation',
    descriptionZh: '生成图片与视觉素材',
    descriptionEn: 'Generate images and visual assets',
    blankZh: '空白图像生成',
    blankEn: 'Blank Image Generation',
    icon: Image
  },
  'video-generation': {
    zh: '视频生成',
    en: 'Video Generation',
    descriptionZh: '文字或参考图生成视频',
    descriptionEn: 'Generate video from text or images',
    blankZh: '空白视频生成',
    blankEn: 'Blank Video Generation',
    icon: WandSparkles
  },
  'cover-generator': {
    zh: '封面生成',
    en: 'Cover Generation',
    descriptionZh: '生成视频与内容封面',
    descriptionEn: 'Generate thumbnails for video and content',
    blankZh: '空白封面生成',
    blankEn: 'Blank Cover Generation',
    icon: ImagePlus
  },
  'smart-dubbing': {
    zh: '智能配音',
    en: 'Smart Dubbing',
    descriptionZh: '自然音色与情绪表达',
    descriptionEn: 'Natural voices and expressive delivery',
    blankZh: '空白智能配音',
    blankEn: 'Blank Smart Dubbing',
    icon: Mic2
  }
};

export function CreatorDashboard(props: {
  presets?: CreatorPresetSummary[];
  loading?: boolean;
  error?: string;
  selectedModule?: CreatorRuntimeWorkspace;
  onRetry?(): void;
  onSelectModule?(module: CreatorRuntimeWorkspace): void;
  onSelectPreset?(preset: CreatorPresetSummary): Promise<void> | void;
  onSelectSkill?(skill: CreatorSkill): void;
}) {
  const { language } = useAppLanguage();
  const [internalSelectedModule, setInternalSelectedModule] =
    useState<CreatorRuntimeWorkspace>('video-translation');
  const [query, setQuery] = useState('');
  const [busyIdentities, setBusyIdentities] = useState<Set<string>>(
    () => new Set()
  );
  const busyIdentitiesRef = useRef(new Set<string>());
  const [actionError, setActionError] = useState<string>();
  const presets = props.presets ?? [];
  const selectedModule = props.selectedModule ?? internalSelectedModule;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visiblePresets = useMemo(() => presets.filter(preset => {
    if (preset.module !== selectedModule) return false;
    if (normalizedQuery === '') return true;
    return `${preset.title} ${preset.description} ${preset.tags.join(' ')}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  }), [normalizedQuery, presets, selectedModule]);
  const presetCounts = useMemo(() => {
    const counts = new Map<CreatorRuntimeWorkspace, number>();
    for (const module of moduleOrder) counts.set(module, 0);
    for (const preset of presets) {
      counts.set(preset.module, (counts.get(preset.module) ?? 0) + 1);
    }
    return counts;
  }, [presets]);

  function selectModule(module: CreatorRuntimeWorkspace) {
    setInternalSelectedModule(module);
    setQuery('');
    setActionError(undefined);
    props.onSelectModule?.(module);
  }

  async function selectPreset(preset: CreatorPresetSummary) {
    const identity = presetIdentity(preset);
    if (busyIdentitiesRef.current.has(identity)) return;
    busyIdentitiesRef.current.add(identity);
    setBusyIdentities(new Set(busyIdentitiesRef.current));
    setActionError(undefined);
    try {
      await props.onSelectPreset?.(preset);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      busyIdentitiesRef.current.delete(identity);
      setBusyIdentities(new Set(busyIdentitiesRef.current));
    }
  }

  return (
    <div className="creator-dashboard">
      <header className="creator-dashboard-title">
        <h1>{language === 'en-US' ? 'Creation Presets' : '创作模板'}</h1>
        <p>
          {language === 'en-US'
            ? 'Choose a module and start with a ready-to-use preset.'
            : '选择创作模块，使用预置模板快速开始。'}
        </p>
      </header>

      <section className="creator-module-section" aria-labelledby="creator-modules-title">
        <div className="creator-dashboard-heading">
          <div>
            <h2 id="creator-modules-title">
              {language === 'en-US' ? 'Creation Modules' : '创作模块'}
            </h2>
            <span>
              {language === 'en-US'
                ? 'Choose a module, then start from one of its presets.'
                : '先选择创作模块，再使用模块内的预置模板。'}
            </span>
          </div>
        </div>
        <div
          className="creator-module-grid"
          role="tablist"
          aria-label={language === 'en-US' ? 'Creation modules' : '创作模块'}
        >
          {moduleOrder.map(module => (
            <CreatorModuleButton
              key={module}
              module={module}
              count={presetCounts.get(module) ?? 0}
              selected={selectedModule === module}
              language={language}
              onSelect={selectModule}
            />
          ))}
        </div>
      </section>

      <section className="creator-dashboard-section" aria-labelledby="creator-templates-title">
        <div className="creator-dashboard-heading">
          <div>
            <h2 id="creator-templates-title">
              {language === 'en-US'
                ? `${moduleLabel(selectedModule, language)} Presets`
                : `${moduleLabel(selectedModule, language)}模板`}
            </h2>
            <span>
              {language === 'en-US'
                ? 'Preset settings remain editable before you start the task.'
                : '模板会预填工作台设置，开始任务前仍可修改。'}
            </span>
          </div>
          <label className="creator-template-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label={language === 'en-US'
                ? `Search ${moduleLabel(selectedModule, language)} presets`
                : `搜索${moduleLabel(selectedModule, language)}模板`}
              placeholder={language === 'en-US'
                ? 'Search presets'
                : `搜索${moduleLabel(selectedModule, language)}模板`}
            />
          </label>
        </div>

        {props.loading ? (
          <p className="creator-template-empty" aria-busy="true">
            {language === 'en-US' ? 'Loading presets...' : '正在加载模板...'}
          </p>
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
              const highlights = preset.highlights ?? [];
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
                    <span>{preset.description}</span>
                    {highlights.length > 0 ? (
                      <span className="creator-template-highlights">
                        {highlights.map((highlight, index) => (
                          <span
                            className="creator-template-highlight"
                            key={`${highlight.text}-${index}`}
                          >
                            {highlight.colors.length > 0 ? (
                              <span className="creator-template-swatches" aria-hidden="true">
                                {highlight.colors.map((color, colorIndex) => (
                                  <span
                                    key={`${color}-${colorIndex}`}
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </span>
                            ) : null}
                            <span>{highlight.text}</span>
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {preset.requirements ? (
                      <span className="creator-template-requirement">
                        <Cpu size={13} strokeWidth={1.8} aria-hidden="true" />
                        <span>{formatPresetRequirement(preset.requirements, language)}</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {visiblePresets.length === 0 ? (
              <p className="creator-template-empty">
                {normalizedQuery
                  ? (language === 'en-US' ? 'No matching presets.' : '没有匹配的模板。')
                  : (language === 'en-US'
                      ? 'No presets are available for this module yet.'
                      : '该模块暂时没有预置模板。')}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CreatorModuleButton(props: {
  module: CreatorRuntimeWorkspace;
  count: number;
  selected: boolean;
  language: 'zh-CN' | 'en-US';
  onSelect(module: CreatorRuntimeWorkspace): void;
}) {
  const copy = moduleCopy[props.module];
  const Icon = copy.icon;
  const countLabel = props.language === 'en-US'
    ? `${props.count} preset${props.count === 1 ? '' : 's'}`
    : `${props.count} 个模板`;
  return (
    <button
      className="creator-module-card"
      type="button"
      role="tab"
      aria-selected={props.selected}
      aria-label={`${moduleLabel(props.module, props.language)}，${countLabel}`}
      onClick={() => props.onSelect(props.module)}
    >
      <span className="creator-module-label">
        <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
        <strong>{moduleLabel(props.module, props.language)}</strong>
      </span>
      <small aria-hidden="true">{props.count}</small>
    </button>
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

function moduleLabel(
  module: CreatorRuntimeWorkspace,
  language: 'zh-CN' | 'en-US'
): string {
  return language === 'en-US' ? moduleCopy[module].en : moduleCopy[module].zh;
}

function presetIdentity(preset: CreatorPresetSummary): string {
  return `${preset.module}/${preset.id}/${preset.version}`;
}

function formatPresetRequirement(
  requirement: CreatorPresetRequirements,
  language: 'zh-CN' | 'en-US'
): string {
  const service = requirement.service === 'image'
    ? (language === 'en-US' ? 'Image' : '图像服务')
    : requirement.service === 'video'
      ? (language === 'en-US' ? 'Video' : '视频服务')
      : (language === 'en-US' ? 'TTS' : '配音服务');
  const provider = providerLabel(requirement.provider);
  return `${service} · ${provider}${requirement.model ? ` · ${requirement.model}` : ''}`;
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    openai: 'OpenAI',
    jimeng: 'Jimeng',
    kling: 'Kling',
    gemini: 'Gemini',
    seedance: 'Seedance',
    veo: 'Veo',
    aliyun: 'Aliyun',
    minimax: 'MiniMax'
  };
  return labels[provider] ?? provider;
}
