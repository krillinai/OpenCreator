import AppSelect from '../../components/forms/Select.js';
import { gatewayModelIdMatches, normalizeSubtitleRenderCues } from '@opencreator/protocol';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Captions,
  FileVideo,
  History,
  Languages,
  Mic2,
  Pencil,
  Plus,
  RotateCcw,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
  Sparkles,
  Square,
  X
} from 'lucide-react';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import { OfficialModelField, useOfficialServices } from './official-services.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { LocalTranscriptionNotice } from './LocalTranscriptionNotice.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import { CreatorTaskProgressBar, CreatorTaskProgressNotice, useCreatorTaskProgress } from './CreatorCollaborationPanel.js';
import { creatorStageProgressPercent } from './creator-panel-adapters.js';
import { clearTranslationContinuation, readTranslationContinuation, saveTranslationContinuation, ttsServiceConfigured, type TranslationEditorContext } from './video-translation-continuation.js';
import VideoTranslationAgentPanel from './VideoTranslationAgentPanel.js';
import CreatorResizableLayout from './CreatorResizableLayout.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import { sameSubtitleCues } from './subtitle-editing.js';
import VideoSourceInput from './VideoSourceInput.js';
import { BilibiliPartSelector } from './BilibiliPartSelector.js';
import { parseVideoSource } from './VideoSourcePreview.js';
import { VideoTranslationSubtitleImport } from './VideoTranslationSubtitleImport.js';
import SubtitleCompositionPreview from './SubtitleCompositionPreview.js';
import { readJsonFromStorage, writeJsonToStorage } from '../../storage/browser-storage.js';
import VideoTranslationResultWorkspace, {
  type SubtitleCue,
  type SubtitleResultOutput,
  type SubtitleResultVariant,
  type SubtitleVideoPreview,
  type VideoResultOutput,
  type VideoResultVariant,
  type VideoTranslationResultTab,
  type VoiceResultOutput
} from './VideoTranslationResultWorkspace.js';
import {
  createCreatorArtifactObjectUrl,
  useOptionalCreatorSession
} from './creator-session-store.js';
import {
  readCreatorResultSnapshots,
  creatorLanguages, creatorLanguage, creatorTranscriptionModel, transcriptionLanguageSupport,
  type TranscriptionLanguageCapability,
  parseBilibiliVideoSource,
  normalizeVideoSourceUrl,
  videoSourceIdentity,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorResultSnapshot,
  type CreatorServicesConfig,
  type CreatorSubtitlePreviewRequest,
  type CreatorTtsProvider,
  type VideoMetadataResponse
} from '@opencreator/protocol';

type SourceType = 'url' | 'file' | 'subtitle';
type SubtitlePosition = 'top' | 'bottom';
type SubtitleFont = 'system' | 'sans' | 'serif' | 'rounded';
type SubtitleWeight = 'regular' | 'medium' | 'bold';
type SubtitleSize = 'small' | 'medium' | 'large';
type VideoFormat = 'horizontal' | 'vertical' | 'all';
type VideoOrientation = 'landscape' | 'portrait';
type WizardStep = 0 | 1;
type WorkspacePhase = 'configure' | 'result';
type ResultProposal = 'regenerate' | 'video' | 'voice';
type TranslationStageId = 'subtitle' | 'tts' | 'render-horizontal' | 'render-vertical';

type TranslationSettingsSnapshot = {
  sourceLanguage: string;
  targetLanguage: string;
  bilingual: boolean;
  subtitlePosition: SubtitlePosition;
  preferPlatformCaptions: boolean;
  subtitleFont: SubtitleFont;
  subtitleWeight: SubtitleWeight;
  subtitleSize: SubtitleSize;
  subtitleColor: string;
  subtitleSecondaryColor: string;
  subtitleOutlineColor: string;
  subtitleOutlineWidth: number;
  subtitleVerticalOffset: number;
  subtitleShadowEnabled: boolean;
  subtitleShadowColor: string;
  subtitleShadowOpacity: number;
  subtitleShadowOffsetX: number;
  subtitleShadowOffsetY: number;
  subtitleShadowBlur: number;
  dubbing: boolean;
  ttsProvider: CreatorTtsProvider;
  ttsModel: string;
  voiceCode: string;
  voiceName: string;
  composeVideo: boolean;
  videoFormat: VideoFormat;
  verticalTitle: string;
  verticalSubtitle: string;
};

type TranslationSpeechSettings = Pick<TranslationSettingsSnapshot, 'ttsProvider' | 'ttsModel' | 'voiceCode' | 'voiceName'>;

type SubtitleStyleSettings = Pick<
  TranslationSettingsSnapshot,
  | 'subtitleFont'
  | 'subtitleWeight'
  | 'subtitleSize'
  | 'subtitleColor'
  | 'subtitleSecondaryColor'
  | 'subtitleOutlineColor'
  | 'subtitleOutlineWidth'
  | 'subtitleVerticalOffset'
  | 'subtitleShadowEnabled'
  | 'subtitleShadowColor'
  | 'subtitleShadowOpacity'
  | 'subtitleShadowOffsetX'
  | 'subtitleShadowOffsetY'
  | 'subtitleShadowBlur'
>;

type TranslationSourceSnapshot = {
  sourceType: SourceType;
  subtitleArtifactId?: string;
  subtitleFileName?: string;
  videoUrl: string;
  videoFile: File | null;
  videoFileName: string | null;
  videoFileSize: number | null;
  videoFileLastModified: number | null;
};

type TranslationResultVersion = {
  value: number;
  description: string;
  source: TranslationSourceSnapshot;
  settings: TranslationSettingsSnapshot;
  subtitleCues: SubtitleCue[];
  savedSubtitleSnapshot: string;
  generatedSubtitleSnapshot: string;
  artifactRefs: Record<string, string[]>;
  changedArtifactIds: string[];
  staleArtifactIds: string[];
};

type PersistedTranslationResultVersion = Omit<TranslationResultVersion, 'source' | 'settings'> & {
  source: Omit<TranslationSourceSnapshot, 'videoFile'>;
  settings: TranslationSettingsSnapshot;
};

type LanguageOption = {
  value: string;
  label: string;
};

const videoSteps = ['添加素材', '翻译设置'] as const;
let componentNavigationDraft: { jobId: string | null; settings: TranslationSettingsSnapshot; source: TranslationSourceSnapshot; currentStep: WizardStep; furthestStep: WizardStep; workspacePhase: WorkspacePhase; resultVersion: number; editor?: TranslationEditorContext } | undefined;
const subtitleColors = ['#FFFFFF', '#FFE45C', '#7EE7FF', '#A7F3D0', '#000000'] as const;
const defaultSubtitleStyle: SubtitleStyleSettings = {
  subtitleFont: 'sans',
  subtitleWeight: 'bold',
  subtitleSize: 'medium',
  subtitleColor: '#FFFFFF',
  subtitleSecondaryColor: '#D1D5DB',
  subtitleOutlineColor: '#000000',
  subtitleOutlineWidth: 2.5,
  subtitleVerticalOffset: 0,
  subtitleShadowEnabled: true,
  subtitleShadowColor: '#000000',
  subtitleShadowOpacity: 0.6,
  subtitleShadowOffsetX: 1.5,
  subtitleShadowOffsetY: 1.5,
  subtitleShadowBlur: 0.5
};
type SubtitleStylePreset = {
  id: string;
  name: [zh: string, en: string];
  style: SubtitleStyleSettings;
};
const subtitleStylePresets: readonly SubtitleStylePreset[] = [
  { id: 'classic', name: ['经典', 'Classic'], style: defaultSubtitleStyle },
  {
    id: 'highlight',
    name: ['醒目黄字', 'Bold yellow'],
    style: {
      ...defaultSubtitleStyle,
      subtitleSize: 'large',
      subtitleColor: '#FFE45C',
      subtitleSecondaryColor: '#FFFFFF',
      subtitleOutlineWidth: 3
    }
  },
  {
    id: 'soft',
    name: ['柔和阴影', 'Soft shadow'],
    style: {
      ...defaultSubtitleStyle,
      subtitleWeight: 'medium',
      subtitleOutlineWidth: 0.2,
      subtitleShadowOpacity: 0.45,
      subtitleShadowOffsetX: 0,
      subtitleShadowOffsetY: 0.5,
      subtitleShadowBlur: 3
    }
  },
  {
    id: 'cinema',
    name: ['电影感', 'Cinematic'],
    style: {
      ...defaultSubtitleStyle,
      subtitleFont: 'serif',
      subtitleWeight: 'regular',
      subtitleColor: '#F5F0E6',
      subtitleSecondaryColor: '#BFB8AA',
      subtitleOutlineWidth: 1,
      subtitleShadowOpacity: 0.5,
      subtitleShadowOffsetX: 1,
      subtitleShadowOffsetY: 1,
      subtitleShadowBlur: 1.5
    }
  },
  {
    id: 'playful',
    name: ['活泼圆体', 'Playful'],
    style: {
      ...defaultSubtitleStyle,
      subtitleFont: 'rounded',
      subtitleSize: 'large',
      subtitleSecondaryColor: '#7EE7FF',
      subtitleOutlineColor: '#1F2937',
      subtitleOutlineWidth: 3.5,
      subtitleShadowOpacity: 0.4,
      subtitleShadowOffsetX: 2,
      subtitleShadowOffsetY: 2,
      subtitleShadowBlur: 0
    }
  },
  {
    id: 'neon',
    name: ['霓虹', 'Neon'],
    style: {
      ...defaultSubtitleStyle,
      subtitleColor: '#7EE7FF',
      subtitleSecondaryColor: '#E0F7FF',
      subtitleOutlineColor: '#0B1F33',
      subtitleOutlineWidth: 2,
      subtitleShadowColor: '#7EE7FF',
      subtitleShadowOpacity: 0.7,
      subtitleShadowOffsetX: 0,
      subtitleShadowOffsetY: 0,
      subtitleShadowBlur: 6
    }
  },
  {
    id: 'news',
    name: ['新闻播报', 'Broadcast'],
    style: {
      ...defaultSubtitleStyle,
      subtitleWeight: 'medium',
      subtitleColor: '#FFFFFF',
      subtitleSecondaryColor: '#FFE45C',
      subtitleOutlineColor: '#0B2545',
      subtitleOutlineWidth: 2.5,
      subtitleShadowEnabled: false
    }
  },
  {
    id: 'minimal',
    name: ['极简', 'Minimal'],
    style: {
      ...defaultSubtitleStyle,
      subtitleFont: 'system',
      subtitleWeight: 'regular',
      subtitleSize: 'small',
      subtitleSecondaryColor: '#E5E7EB',
      subtitleOutlineWidth: 1.5,
      subtitleShadowEnabled: false
    }
  }
];

// CSS approximation of a subtitle style for preset thumbnails; the real render comes from the daemon.
function subtitleStyleThumbnailCss(style: SubtitleStyleSettings): CSSProperties {
  const family = style.subtitleFont === 'system'
    ? 'system-ui, sans-serif'
    : `"OpenCreator ${style.subtitleFont[0]!.toUpperCase()}${style.subtitleFont.slice(1)} ${style.subtitleWeight[0]!.toUpperCase()}${style.subtitleWeight.slice(1)}", system-ui, sans-serif`;
  const shadowAlpha = Math.round(style.subtitleShadowOpacity * 255).toString(16).padStart(2, '0');
  return {
    '--subtitle-thumb-family': family,
    '--subtitle-thumb-size': style.subtitleSize === 'small' ? '13cqw' : style.subtitleSize === 'large' ? '19cqw' : '16cqw',
    '--subtitle-thumb-color': style.subtitleColor,
    '--subtitle-thumb-secondary': style.subtitleSecondaryColor,
    '--subtitle-thumb-stroke': `${style.subtitleOutlineWidth * 0.8}px ${style.subtitleOutlineColor}`,
    '--subtitle-thumb-shadow': style.subtitleShadowEnabled
      ? `${style.subtitleShadowOffsetX}px ${style.subtitleShadowOffsetY}px ${style.subtitleShadowBlur * 1.5}px ${style.subtitleShadowColor}${shadowAlpha}`
      : 'none'
  } as CSSProperties;
}

type SavedSubtitleStyle = { id: string; name: string; style: SubtitleStyleSettings };
const savedSubtitleStylesKey = 'opencreator.videoTranslation.savedSubtitleStyles';
const savedSubtitleStylesLimit = 12;

function readSavedSubtitleStyles(): SavedSubtitleStyle[] {
  const raw = readJsonFromStorage<unknown>(savedSubtitleStylesKey);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(entry => {
    const record = readJsonRecord(entry as CreatorJson);
    if (typeof record.id !== 'string' || typeof record.name !== 'string' || record.name.trim() === '') return [];
    // Reuse the persisted-settings parser so corrupted or outdated entries fall back to safe values.
    const style = readSubtitleStyleSettings(readJsonRecord(record.style), {}, undefined);
    return [{ id: record.id, name: record.name.trim().slice(0, 24), style }];
  }).slice(0, savedSubtitleStylesLimit);
}

function writeSavedSubtitleStyles(styles: SavedSubtitleStyle[]) {
  try {
    writeJsonToStorage(savedSubtitleStylesKey, styles);
  } catch {
    // Storage can be full or blocked; the in-memory list still works for this session.
  }
}
const sourceLanguageCatalog = creatorLanguages.filter(language => language.speech)
  .sort((left, right) => Number(right.sourcePreferred) - Number(left.sourcePreferred));
const sourceLanguages: LanguageOption[] = sourceLanguageCatalog.map(language => ({ value: language.code, label: language.nativeName }));
const targetLanguages: LanguageOption[] = creatorLanguages.map(language => ({ value: language.code, label: language.nativeName }));

function LanguageSelect(props: { label: string; value: string; onChange(value: string): void; source?: boolean; l: LocalizeCopy }) {
  const selectId = useId();
  const options: (LanguageOption & { searchText: string })[] = (props.source ? sourceLanguageCatalog : creatorLanguages).map(language => ({
    value: language.code, label: language.nativeName,
    searchText: [language.englishName, language.chineseName, ...language.aliases].join(' ')
  }));
  if (!options.some(option => option.value === props.value)) options.unshift({ value: props.value, label: props.value === 'auto' ? props.l('请选择语言', 'Select a language') : creatorLanguage(props.value)?.nativeName ?? props.value, searchText: '' });
  return <div className="video-translation-field">
    <label htmlFor={selectId}>{props.label}</label>
    <div className="video-translation-select-wrap">
      <AppSelect id={selectId} value={props.value} onChange={event => props.onChange(event.target.value)}>
        {options.map(language => <option key={language.value} value={language.value} data-search={language.searchText}>{language.label}</option>)}
      </AppSelect>
    </div>
  </div>;
}

function languageLabel(options: LanguageOption[], value: string) {
  if (value === 'auto') return '—';
  return options.find(option => option.value === value)?.label ?? creatorLanguage(value)?.nativeName ?? value;
}

function ttsProviderLabel(provider: CreatorTtsProvider, l: LocalizeCopy): string {
  if (provider === 'aliyun') return l('阿里云百炼', 'Alibaba Cloud Model Studio');
  if (provider === 'minimax') return 'MiniMax';
  if (provider === 'volcengine') return l('火山引擎', 'Volcengine');
  if (provider === 'edge-tts') return 'Edge TTS';
  return 'OpenAI TTS';
}

function outputLabelFor(settings: Pick<TranslationSettingsSnapshot, 'composeVideo' | 'videoFormat'>, l: LocalizeCopy) {
  return settings.composeVideo
    ? ({
        horizontal: l('横屏视频 16:9', 'Horizontal video 16:9'),
        vertical: l('竖屏视频 9:16', 'Vertical video 9:16'),
        all: l('横屏与竖屏视频', 'Horizontal and vertical videos')
      } as const)[settings.videoFormat]
    : l('字幕文件', 'Subtitle file');
}

function subtitleFontLabel(value: SubtitleFont, l: LocalizeCopy) {
  return ({
    system: l('系统默认', 'System default'),
    sans: l('无衬线', 'Sans serif'),
    serif: l('衬线', 'Serif'),
    rounded: l('圆体', 'Rounded')
  } as const)[value];
}

function subtitleSizeLabel(value: SubtitleSize, l: LocalizeCopy) {
  return ({
    small: l('小', 'Small'),
    medium: l('中', 'Medium'),
    large: l('大', 'Large')
  } as const)[value];
}

function subtitleWeightLabel(value: SubtitleWeight, l: LocalizeCopy) {
  return ({
    regular: l('常规', 'Regular'),
    medium: l('中等', 'Medium'),
    bold: l('粗体', 'Bold')
  } as const)[value];
}

function localSourceFingerprint(source: TranslationSourceSnapshot) {
  return {
    name: source.videoFile?.name ?? source.videoFileName,
    size: source.videoFile?.size ?? source.videoFileSize,
    lastModified: source.videoFile?.lastModified ?? source.videoFileLastModified
  };
}

function sameSource(left: TranslationSourceSnapshot, right: TranslationSourceSnapshot) {
  if (left.sourceType !== right.sourceType) return false;
  if (left.sourceType === 'subtitle') return left.subtitleArtifactId === right.subtitleArtifactId;
  if (left.sourceType === 'url') return left.videoUrl === right.videoUrl;
  const leftFile = localSourceFingerprint(left);
  const rightFile = localSourceFingerprint(right);
  return leftFile.name === rightFile.name
    && leftFile.size === rightFile.size
    && leftFile.lastModified === rightFile.lastModified;
}

function sameSettings(left: TranslationSettingsSnapshot, right: TranslationSettingsSnapshot) {
  return left.sourceLanguage === right.sourceLanguage
    && left.targetLanguage === right.targetLanguage
    && left.bilingual === right.bilingual
    && left.subtitlePosition === right.subtitlePosition
    && left.preferPlatformCaptions === right.preferPlatformCaptions
    && sameSubtitleStyle(left, right)
    && left.dubbing === right.dubbing
    && left.ttsProvider === right.ttsProvider
    && left.ttsModel === right.ttsModel
    && left.voiceCode === right.voiceCode
    && left.voiceName === right.voiceName
    && left.composeVideo === right.composeVideo
    && left.videoFormat === right.videoFormat
    && left.verticalTitle === right.verticalTitle
    && left.verticalSubtitle === right.verticalSubtitle;
}

function sameSubtitleStyle(
  left: SubtitleStyleSettings,
  right: SubtitleStyleSettings
): boolean {
  return left.subtitleFont === right.subtitleFont
    && left.subtitleWeight === right.subtitleWeight
    && left.subtitleSize === right.subtitleSize
    && left.subtitleColor === right.subtitleColor
    && left.subtitleSecondaryColor === right.subtitleSecondaryColor
    && left.subtitleOutlineColor === right.subtitleOutlineColor
    && left.subtitleOutlineWidth === right.subtitleOutlineWidth
    && left.subtitleVerticalOffset === right.subtitleVerticalOffset
    && left.subtitleShadowEnabled === right.subtitleShadowEnabled
    && left.subtitleShadowColor === right.subtitleShadowColor
    && left.subtitleShadowOpacity === right.subtitleShadowOpacity
    && left.subtitleShadowOffsetX === right.subtitleShadowOffsetX
    && left.subtitleShadowOffsetY === right.subtitleShadowOffsetY
    && left.subtitleShadowBlur === right.subtitleShadowBlur;
}

function canReuseSubtitleCues(
  version: TranslationResultVersion,
  settings: TranslationSettingsSnapshot,
  source: TranslationSourceSnapshot
) {
  return sameSource(version.source, source)
    && version.settings.sourceLanguage === settings.sourceLanguage
    && version.settings.targetLanguage === settings.targetLanguage
    && version.settings.preferPlatformCaptions === settings.preferPlatformCaptions;
}

function translationChanges(
  version: TranslationResultVersion,
  settings: TranslationSettingsSnapshot,
  source: TranslationSourceSnapshot,
  subtitleNeedsRegeneration: boolean,
  subtitleModelChanged = false
) {
  const subtitleInputsChanged = subtitleModelChanged || !canReuseSubtitleCues(version, settings, source)
    || version.settings.bilingual !== settings.bilingual
    || version.settings.subtitlePosition !== settings.subtitlePosition;
  const subtitleStyleChanged = !sameSubtitleStyle(version.settings, settings);
  const voiceChanged = version.settings.dubbing !== settings.dubbing
    || version.settings.ttsProvider !== settings.ttsProvider
    || version.settings.ttsModel !== settings.ttsModel
    || version.settings.voiceCode !== settings.voiceCode;
  const outputChanged = version.settings.composeVideo !== settings.composeVideo
    || version.settings.videoFormat !== settings.videoFormat
    || version.settings.verticalTitle !== settings.verticalTitle
    || version.settings.verticalSubtitle !== settings.verticalSubtitle;
  return {
    subtitleInputsChanged,
    subtitleContentChanged: subtitleNeedsRegeneration,
    subtitleStyleChanged,
    voiceChanged,
    outputChanged
  };
}

export function videoTranslationRegenerationStage(
  version: TranslationResultVersion,
  settings: TranslationSettingsSnapshot,
  source: TranslationSourceSnapshot,
  subtitleNeedsRegeneration: boolean,
  staleArtifactKinds: ReadonlySet<string> = new Set(),
  subtitleModelChanged = false
): TranslationStageId | undefined {
  const changes = translationChanges(
    version,
    settings,
    source,
    subtitleNeedsRegeneration,
    subtitleModelChanged
  );
  if (changes.subtitleInputsChanged) return 'subtitle';
  if (
    settings.dubbing
    && (
      changes.subtitleContentChanged
      || changes.voiceChanged
      || staleArtifactKinds.has('dubbed_audio')
    )
  ) return 'tts';
  if (
    settings.composeVideo
    && (
      changes.subtitleContentChanged
      || changes.subtitleStyleChanged
      || changes.voiceChanged
      || changes.outputChanged
      || staleArtifactKinds.has('dubbed_video')
      || staleArtifactKinds.has('horizontal_video')
      || staleArtifactKinds.has('vertical_video')
    )
  ) {
    if (
      staleArtifactKinds.has('vertical_video')
      && !staleArtifactKinds.has('horizontal_video')
      && !changes.subtitleContentChanged
      && !changes.subtitleStyleChanged
      && !changes.voiceChanged
      && !changes.outputChanged
    ) {
      return 'render-vertical';
    }
    return settings.videoFormat === 'vertical'
      ? 'render-vertical'
      : 'render-horizontal';
  }
  return undefined;
}

function outputStageForRequest(input: {
  version: TranslationResultVersion;
  settings: TranslationSettingsSnapshot;
  source: TranslationSourceSnapshot;
  subtitleNeedsRegeneration: boolean;
  subtitleModelChanged: boolean;
  staleArtifactKinds: ReadonlySet<string>;
  reusableDubbedAudio: boolean;
  reusableDubbedVideo: boolean;
  type: 'video' | 'voice';
}): TranslationStageId | undefined {
  const { version, settings, source, subtitleNeedsRegeneration, subtitleModelChanged, staleArtifactKinds } = input;
  const stageSettings = settings.dubbing && canReuseSubtitleCues(version, settings, source) ? {
    ...settings,
    bilingual: version.settings.bilingual,
    subtitlePosition: version.settings.subtitlePosition
  } : settings;
  const reusableDubbing = input.reusableDubbedAudio || input.reusableDubbedVideo;
  const effectiveStaleKinds = input.reusableDubbedVideo && staleArtifactKinds.has('dubbed_audio')
    ? new Set([...staleArtifactKinds].filter(kind => kind !== 'dubbed_audio'))
    : staleArtifactKinds;
  const stage = videoTranslationRegenerationStage(
    version, stageSettings, source, subtitleNeedsRegeneration, effectiveStaleKinds, subtitleModelChanged
  );
  if (stage === 'subtitle') return stage;
  if (settings.dubbing && !reusableDubbing) return 'tts';
  return stage ?? (input.type === 'video' || (input.type === 'voice' && settings.composeVideo)
    ? settings.videoFormat === 'vertical' ? 'render-vertical' : 'render-horizontal'
    : undefined);
}

function serializeResultVersions(versions: TranslationResultVersion[]): CreatorJson {
  return versions.map((version): PersistedTranslationResultVersion => ({
    ...version,
    source: {
      sourceType: version.source.sourceType,
      ...(version.source.subtitleArtifactId ? { subtitleArtifactId: version.source.subtitleArtifactId } : {}),
      ...(version.source.subtitleFileName ? { subtitleFileName: version.source.subtitleFileName } : {}),
      videoUrl: version.source.videoUrl,
      videoFileName: version.source.videoFile?.name ?? version.source.videoFileName,
      videoFileSize: version.source.videoFile?.size ?? version.source.videoFileSize,
      videoFileLastModified: version.source.videoFile?.lastModified
        ?? version.source.videoFileLastModified
    },
    settings: version.settings
  })) as CreatorJson;
}

function deserializeResultVersions(value: CreatorJson | undefined): TranslationResultVersion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (item === null || Array.isArray(item) || typeof item !== 'object') return [];
    const version = item as Record<string, CreatorJson>;
    const source = version.source;
    const settings = version.settings;
    const cues = version.subtitleCues;
    if (
      typeof version.value !== 'number'
      || typeof version.description !== 'string'
      || source === null || Array.isArray(source) || typeof source !== 'object'
      || settings === null || Array.isArray(settings) || typeof settings !== 'object'
      || !Array.isArray(cues)
    ) return [];
    const sourceRecord = source as Record<string, CreatorJson>;
    const settingsRecord = settings as Record<string, CreatorJson>;
    if (sourceRecord.sourceType !== 'url' && sourceRecord.sourceType !== 'file' && sourceRecord.sourceType !== 'subtitle') return [];
    if (typeof sourceRecord.videoUrl !== 'string') return [];
    if (
      typeof settingsRecord.sourceLanguage !== 'string'
      || typeof settingsRecord.targetLanguage !== 'string'
      || typeof settingsRecord.bilingual !== 'boolean'
      || (settingsRecord.subtitlePosition !== 'top' && settingsRecord.subtitlePosition !== 'bottom')
      || typeof settingsRecord.preferPlatformCaptions !== 'boolean'
      || typeof settingsRecord.dubbing !== 'boolean'
      || typeof settingsRecord.voiceCode !== 'string'
      || typeof settingsRecord.composeVideo !== 'boolean'
      || (settingsRecord.videoFormat !== 'horizontal' && settingsRecord.videoFormat !== 'vertical' && settingsRecord.videoFormat !== 'all')
      || typeof settingsRecord.verticalTitle !== 'string'
      || typeof settingsRecord.verticalSubtitle !== 'string'
    ) return [];
    const subtitleCues = cues.flatMap(cue => {
      if (cue === null || Array.isArray(cue) || typeof cue !== 'object') return [];
      const record = cue as Record<string, CreatorJson>;
      if (
        (typeof record.id !== 'string' && typeof record.id !== 'number')
        || typeof record.start !== 'string'
        || typeof record.end !== 'string'
        || typeof record.text !== 'string'
      ) return [];
      return [{ id: record.id as number, start: record.start, end: record.end, text: record.text }];
    });
    return [{
      value: version.value,
      description: version.description,
      source: {
        sourceType: sourceRecord.sourceType,
        ...(typeof sourceRecord.subtitleArtifactId === 'string' ? { subtitleArtifactId: sourceRecord.subtitleArtifactId } : {}),
        ...(typeof sourceRecord.subtitleFileName === 'string' ? { subtitleFileName: sourceRecord.subtitleFileName } : {}),
        videoUrl: sourceRecord.videoUrl,
        videoFile: null,
        videoFileName: typeof sourceRecord.videoFileName === 'string'
          ? sourceRecord.videoFileName
          : null,
        videoFileSize: typeof sourceRecord.videoFileSize === 'number'
          ? sourceRecord.videoFileSize
          : null,
        videoFileLastModified: typeof sourceRecord.videoFileLastModified === 'number'
          ? sourceRecord.videoFileLastModified
          : null
      },
      settings: {
        sourceLanguage: settingsRecord.sourceLanguage,
        targetLanguage: settingsRecord.targetLanguage,
        bilingual: settingsRecord.bilingual,
        subtitlePosition: settingsRecord.subtitlePosition,
        preferPlatformCaptions: settingsRecord.preferPlatformCaptions,
        ...readSubtitleStyleSettings(settingsRecord, {}, undefined),
        dubbing: settingsRecord.dubbing,
        ttsProvider: isTtsProvider(settingsRecord.ttsProvider)
          ? settingsRecord.ttsProvider
          : 'openai',
        ttsModel: typeof settingsRecord.ttsModel === 'string'
          ? settingsRecord.ttsModel
          : '',
        voiceCode: settingsRecord.voiceCode,
        voiceName: typeof settingsRecord.voiceName === 'string'
          ? settingsRecord.voiceName
          : settingsRecord.voiceCode,
        composeVideo: settingsRecord.composeVideo,
        videoFormat: settingsRecord.videoFormat,
        verticalTitle: settingsRecord.verticalTitle,
        verticalSubtitle: settingsRecord.verticalSubtitle
      },
      subtitleCues,
      savedSubtitleSnapshot: typeof version.savedSubtitleSnapshot === 'string'
        ? version.savedSubtitleSnapshot
        : JSON.stringify(subtitleCues),
      generatedSubtitleSnapshot: typeof version.generatedSubtitleSnapshot === 'string'
        ? version.generatedSubtitleSnapshot
        : JSON.stringify(subtitleCues),
      artifactRefs: readArtifactRefs(version.artifactRefs),
      changedArtifactIds: readStringArray(version.changedArtifactIds),
      staleArtifactIds: readStringArray(version.staleArtifactIds)
    }];
  });
}

function readArtifactRefs(value: CreatorJson | undefined): Record<string, string[]> {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).flatMap(([kind, ids]) => (
    Array.isArray(ids) && ids.every(id => typeof id === 'string')
      ? [[kind, ids as string[]]]
      : []
  )));
}

function readStringArray(value: CreatorJson | undefined): string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value as string[]
    : [];
}

const videoArtifactKinds = ['horizontal_video', 'vertical_video', 'dubbed_video'] as const;
const videoResultVariantOrder = ['horizontal', 'vertical', 'dubbed'] as const satisfies readonly VideoResultVariant[];
const videoArtifactKindByVariant: Record<VideoResultVariant, typeof videoArtifactKinds[number]> = {
  horizontal: 'horizontal_video',
  vertical: 'vertical_video',
  dubbed: 'dubbed_video'
};

export function videoArtifactsForResultVersion(
  artifacts: CreatorArtifact[],
  resultVersion: number,
  resultSnapshots?: CreatorJson
): Partial<Record<VideoResultVariant, CreatorArtifact>> {
  return Object.fromEntries(videoResultVariantOrder.flatMap(variant => {
    const artifact = latestArtifactForResultVersion(
      artifacts,
      resultVersion,
      [videoArtifactKindByVariant[variant]],
      resultSnapshots
    );
    return artifact === undefined ? [] : [[variant, artifact]];
  })) as Partial<Record<VideoResultVariant, CreatorArtifact>>;
}

const subtitleResultVariantOrder = ['horizontal', 'vertical'] as const satisfies readonly SubtitleResultVariant[];
const subtitleArtifactKindByVariant: Record<SubtitleResultVariant, 'target_subtitle' | 'vertical_subtitle'> = {
  horizontal: 'target_subtitle',
  vertical: 'vertical_subtitle'
};

export function subtitleArtifactsForResultVersion(
  artifacts: CreatorArtifact[],
  resultVersion: number,
  resultSnapshots?: CreatorJson,
  options: { bilingual?: boolean } = {}
): Partial<Record<SubtitleResultVariant, CreatorArtifact>> {
  return Object.fromEntries(subtitleResultVariantOrder.flatMap(variant => {
    const kinds = variant === 'horizontal' && options.bilingual === true
      ? ['bilingual_subtitle', subtitleArtifactKindByVariant[variant]]
      : [subtitleArtifactKindByVariant[variant]];
    const artifact = latestArtifactForResultVersion(
      artifacts,
      resultVersion,
      kinds,
      resultSnapshots
    );
    return artifact === undefined ? [] : [[variant, artifact]];
  })) as Partial<Record<SubtitleResultVariant, CreatorArtifact>>;
}

export function videoTranslationReportNotice(artifact: CreatorArtifact | undefined, l: LocalizeCopy): string {
  if (!artifact) return '';
  const status = artifact.metadata.translationStatus;
  const layoutNotice = status === 'layout_pending' || artifact.metadata.translationLayoutPending === true
    ? l('部分字幕长度超过显示目标，已保留完整译文，可在编辑器调整。',
      'Some subtitles exceed the display target; their complete translations are preserved for editing.') : '';
  if (status === 'partial') {
    const count = typeof artifact.metadata.translationFailedCount === 'number' ? artifact.metadata.translationFailedCount : 0;
    const contentNotice = typeof artifact.metadata.editedFromArtifactId === 'string'
      ? l(`自动生成时有 ${count} 条字幕未译；当前字幕已编辑，请核对。`, `${count} subtitle items were untranslated during generation. The subtitles have since been edited; please review them.`)
      : l(`部分完成：${count} 条字幕尚未翻译，已保留原文。`, `Partially complete: ${count} subtitle items are untranslated and retain their source text.`);
    return [contentNotice, layoutNotice].filter(Boolean).join(' ');
  }
  if (status === 'degraded') {
    return l('字幕已生成，部分分段或双语对应未通过自动质量核验，请在编辑器复核。',
      'Subtitles are ready. Some segmentation or bilingual alignment needs review in the editor.');
  }
  if (status === 'layout_pending') {
    return l('翻译已完成。', 'Translation is complete. ') + layoutNotice;
  }
  return '';
}

export function subtitleCuesFromArtifact(artifact: CreatorArtifact | undefined): SubtitleCue[] {
  const cues = artifact?.metadata.renderCues ?? artifact?.metadata.cues;
  if (!Array.isArray(cues)) return [];
  return cues.flatMap(cue => {
    if (cue === null || Array.isArray(cue) || typeof cue !== 'object') return [];
    const record = cue as Record<string, CreatorJson>;
    if (
      typeof record.id !== 'number'
      || typeof record.start !== 'string'
      || typeof record.end !== 'string'
      || typeof record.text !== 'string'
    ) return [];
    return [{ id: record.id, start: record.start, end: record.end, text: record.text,
      ...(typeof record.sourceText === 'string' ? { sourceText: record.sourceText } : {}) }];
  });
}

export function subtitleCuesWithSource(
  targetCues: SubtitleCue[],
  sourceArtifact: CreatorArtifact | undefined,
  bilingual: boolean
): SubtitleCue[] {
  if (!bilingual) return targetCues;
  const sourceCues = subtitleCuesFromArtifact(sourceArtifact);
  const sourceById = new Map(sourceCues.map(cue => [cue.id, cue.text]));
  return targetCues.map((cue, index) => {
    const sourceText = sourceById.get(cue.id) ?? sourceCues[index]?.text;
    return sourceText === undefined ? cue : { ...cue, sourceText };
  });
}

function subtitleDraftKey(
  resultVersion: number,
  variant: SubtitleResultVariant
): string {
  return `${resultVersion}:${variant}`;
}

function stripSubtitleSourceText(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map(cue => ({
    id: cue.id,
    start: cue.start,
    end: cue.end,
    text: cue.text
  }));
}

export function resultVersionsFromArtifacts(
  artifacts: CreatorArtifact[],
  fallbackState: Record<string, CreatorJson>
): TranslationResultVersion[] {
  const versions = new Map(
    legacyResultVersionsFromArtifacts(artifacts, fallbackState)
      .map(version => [version.value, version] as const)
  );
  const persistedVersions = deserializeResultVersions(fallbackState.resultVersions);
  for (const snapshot of readCreatorResultSnapshots(fallbackState.resultSnapshots)) {
    const version = resultVersionFromSnapshot(artifacts, snapshot, fallbackState, persistedVersions);
    if (version !== undefined) versions.set(version.value, version);
  }
  return [...versions.values()].sort((left, right) => left.value - right.value);
}

function legacyResultVersionsFromArtifacts(
  artifacts: CreatorArtifact[],
  fallbackState: Record<string, CreatorJson>
): TranslationResultVersion[] {
  const persistedVersions = deserializeResultVersions(fallbackState.resultVersions);
  const groups = new Map<number, CreatorArtifact[]>();
  for (const artifact of artifacts) {
    if (
      artifact.status !== 'completed'
      || artifact.metadata.previewOnly === true
      || (artifact.kind !== 'target_subtitle' && !isVideoArtifactKind(artifact.kind))
    ) continue;
    const version = artifactResultVersion(artifact);
    const group = groups.get(version) ?? [];
    group.push(artifact);
    groups.set(version, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([value, group]) => {
      const videoArtifacts = group
        .filter(artifact => isVideoArtifactKind(artifact.kind))
        .sort(compareArtifactFreshness);
      const representative = videoArtifacts.at(-1)
        ?? group.filter(artifact => artifact.kind === 'target_subtitle')
          .sort(compareArtifactFreshness)
          .at(-1);
      if (representative === undefined) return [];
      const subtitleArtifact = representative.kind === 'target_subtitle'
        ? representative
        : relatedArtifact(artifacts, representative, ['target_subtitle'])
          ?? latestArtifactBefore(artifacts, representative, 'target_subtitle');
      const sourceArtifact = subtitleArtifact === undefined
        ? undefined
        : relatedArtifact(artifacts, subtitleArtifact, ['source_video']);
      const settings = representative.metadata.settingsSnapshot
        ?? subtitleArtifact?.metadata.settingsSnapshot;
      const sourceState = settings !== null && typeof settings === 'object' && !Array.isArray(settings)
        ? settings as Record<string, CreatorJson>
        : fallbackState;
      const persisted = persistedVersions.find(version => version.value === value);
      const resultSourceType = sourceState.sourceType === 'file' || sourceState.sourceType === 'subtitle'
        ? sourceState.sourceType
        : persisted?.source.sourceType ?? 'url';
      const hasHorizontal = group.some(artifact => artifact.kind === 'horizontal_video');
      const hasVertical = group.some(artifact => artifact.kind === 'vertical_video');
      const inferredVideoFormat = hasHorizontal && hasVertical
        ? 'all'
        : hasVertical
          ? 'vertical'
          : hasHorizontal
            ? 'horizontal'
            : undefined;
      const subtitleCues = Array.isArray(subtitleArtifact?.metadata.cues)
        ? subtitleArtifact.metadata.cues
        : persisted?.subtitleCues ?? [];
      const parsed = deserializeResultVersions([{
        value,
        description: value === 1
          ? '初次生成'
          : videoArtifacts.length > 0
            ? `成片版本 V${value}`
            : `字幕版本 V${value}`,
        source: {
          sourceType: resultSourceType,
          subtitleArtifactId: sourceState.importedSourceSubtitleId ?? persisted?.source.subtitleArtifactId ?? null,
          subtitleFileName: artifactFileName(artifacts.find(artifact => artifact.id === sourceState.importedSourceSubtitleId)) ?? persisted?.source.subtitleFileName ?? null,
          videoUrl: typeof sourceState.sourceUrl === 'string'
            ? sourceState.sourceUrl
            : persisted?.source.videoUrl ?? '',
          videoFileName: resultSourceType === 'file'
            ? typeof sourceState.sourceFileName === 'string'
              ? sourceState.sourceFileName
              : artifactFileName(sourceArtifact) ?? persisted?.source.videoFileName ?? null
            : null,
          videoFileSize: resultSourceType === 'file'
            ? typeof sourceState.sourceFileSize === 'number'
              ? sourceState.sourceFileSize
              : readArtifactNumber(sourceArtifact, 'size') ?? persisted?.source.videoFileSize ?? null
            : null,
          videoFileLastModified: resultSourceType === 'file'
            ? typeof sourceState.sourceFileLastModified === 'number'
              ? sourceState.sourceFileLastModified
              : readArtifactNumber(sourceArtifact, 'lastModified')
                ?? persisted?.source.videoFileLastModified
                ?? null
            : null
        },
        settings: {
          sourceLanguage: typeof sourceState.sourceLanguage === 'string'
            ? sourceState.sourceLanguage
            : persisted?.settings.sourceLanguage ?? 'en',
          targetLanguage: typeof sourceState.targetLanguage === 'string'
            ? sourceState.targetLanguage
            : persisted?.settings.targetLanguage ?? 'zh_cn',
          bilingual: typeof sourceState.bilingual === 'boolean'
            ? sourceState.bilingual
            : persisted?.settings.bilingual ?? true,
          subtitlePosition: sourceState.subtitlePosition === 'bottom'
            ? 'bottom'
            : persisted?.settings.subtitlePosition ?? 'top',
          preferPlatformCaptions: typeof sourceState.preferPlatformCaptions === 'boolean'
            ? sourceState.preferPlatformCaptions
            : persisted?.settings.preferPlatformCaptions ?? true,
          ...readSubtitleStyleSettings(sourceState, fallbackState, persisted),
          dubbing: typeof sourceState.dubbing === 'boolean'
            ? sourceState.dubbing
            : persisted?.settings.dubbing ?? false,
          ttsProvider: isTtsProvider(sourceState.ttsProvider)
            ? sourceState.ttsProvider
            : persisted?.settings.ttsProvider ?? 'openai',
          ttsModel: typeof sourceState.ttsModel === 'string'
            ? sourceState.ttsModel
            : persisted?.settings.ttsModel ?? '',
          voiceCode: typeof sourceState.voiceCode === 'string'
            ? sourceState.voiceCode
            : persisted?.settings.voiceCode ?? '',
          voiceName: typeof sourceState.voiceName === 'string'
            ? sourceState.voiceName
            : persisted?.settings.voiceName ?? '',
          composeVideo: hasHorizontal || hasVertical || sourceState.composeVideo === true,
          videoFormat: inferredVideoFormat
            ?? (sourceState.videoFormat === 'vertical' || sourceState.videoFormat === 'all'
              ? sourceState.videoFormat
              : persisted?.settings.videoFormat ?? 'horizontal'),
          verticalTitle: typeof sourceState.verticalTitle === 'string'
            ? sourceState.verticalTitle
            : persisted?.settings.verticalTitle ?? '',
          verticalSubtitle: typeof sourceState.verticalSubtitle === 'string'
            ? sourceState.verticalSubtitle
            : persisted?.settings.verticalSubtitle ?? ''
        },
        subtitleCues,
        savedSubtitleSnapshot: JSON.stringify(subtitleCues),
        generatedSubtitleSnapshot: JSON.stringify(subtitleCues),
        artifactRefs: legacyArtifactRefsForVersion(artifacts, group, representative, subtitleArtifact),
        changedArtifactIds: group.map(artifact => artifact.id),
        staleArtifactIds: []
      }]);
      return parsed;
    });
}

function resultVersionFromSnapshot(
  artifacts: CreatorArtifact[],
  snapshot: CreatorResultSnapshot,
  fallbackState: Record<string, CreatorJson>,
  persistedVersions: TranslationResultVersion[]
): TranslationResultVersion | undefined {
  const artifactRefs = resolvedSnapshotArtifactRefs(artifacts, snapshot);
  const subtitleArtifact = artifactFromRefs(artifacts, artifactRefs, ['target_subtitle']);
  const sourceArtifact = artifactFromRefs(artifacts, artifactRefs, ['source_video']);
  const videoArtifacts = videoArtifactKinds.flatMap(kind => {
    const artifact = artifactFromRefs(artifacts, artifactRefs, [kind]);
    return artifact === undefined ? [] : [artifact];
  });
  if (subtitleArtifact === undefined && videoArtifacts.length === 0) return undefined;
  const persisted = persistedVersions.find(version => version.value === snapshot.version);
  const sourceState = snapshot.state;
  const resultSourceType = sourceState.sourceType === 'file' || sourceState.sourceType === 'subtitle'
    ? sourceState.sourceType
    : persisted?.source.sourceType ?? (fallbackState.sourceType === 'file' || fallbackState.sourceType === 'subtitle' ? fallbackState.sourceType : 'url');
  const hasHorizontal = (artifactRefs.horizontal_video?.length ?? 0) > 0;
  const hasVertical = (artifactRefs.vertical_video?.length ?? 0) > 0;
  const inferredVideoFormat = hasHorizontal && hasVertical
    ? 'all'
    : hasVertical
      ? 'vertical'
      : hasHorizontal
        ? 'horizontal'
        : undefined;
  const subtitleCues = Array.isArray(subtitleArtifact?.metadata.cues)
    ? subtitleArtifact.metadata.cues
    : persisted?.subtitleCues ?? [];
  const parsed = deserializeResultVersions([{
    value: snapshot.version,
    description: snapshot.description || `项目版本 V${snapshot.version}`,
    source: {
      sourceType: resultSourceType,
      subtitleArtifactId: sourceState.importedSourceSubtitleId ?? persisted?.source.subtitleArtifactId ?? null,
      subtitleFileName: artifactFileName(artifacts.find(artifact => artifact.id === sourceState.importedSourceSubtitleId)) ?? persisted?.source.subtitleFileName ?? null,
      videoUrl: typeof sourceState.sourceUrl === 'string'
        ? sourceState.sourceUrl
        : persisted?.source.videoUrl ?? (typeof fallbackState.sourceUrl === 'string' ? fallbackState.sourceUrl : ''),
      videoFileName: resultSourceType === 'file'
        ? typeof sourceState.sourceFileName === 'string'
          ? sourceState.sourceFileName
          : artifactFileName(sourceArtifact)
            ?? persisted?.source.videoFileName
            ?? (typeof fallbackState.sourceFileName === 'string' ? fallbackState.sourceFileName : null)
        : null,
      videoFileSize: resultSourceType === 'file'
        ? typeof sourceState.sourceFileSize === 'number'
          ? sourceState.sourceFileSize
          : readArtifactNumber(sourceArtifact, 'size')
            ?? persisted?.source.videoFileSize
            ?? (typeof fallbackState.sourceFileSize === 'number' ? fallbackState.sourceFileSize : null)
        : null,
      videoFileLastModified: resultSourceType === 'file'
        ? typeof sourceState.sourceFileLastModified === 'number'
          ? sourceState.sourceFileLastModified
          : readArtifactNumber(sourceArtifact, 'lastModified')
            ?? persisted?.source.videoFileLastModified
            ?? (typeof fallbackState.sourceFileLastModified === 'number'
              ? fallbackState.sourceFileLastModified
              : null)
        : null
    },
    settings: {
      sourceLanguage: readStringSetting(sourceState, fallbackState, persisted, 'sourceLanguage', 'en'),
      targetLanguage: readStringSetting(sourceState, fallbackState, persisted, 'targetLanguage', 'zh_cn'),
      bilingual: readBooleanSetting(sourceState, fallbackState, persisted, 'bilingual', true),
      subtitlePosition: sourceState.subtitlePosition === 'bottom'
        ? 'bottom'
        : sourceState.subtitlePosition === 'top'
          ? 'top'
          : persisted?.settings.subtitlePosition ?? (fallbackState.subtitlePosition === 'bottom' ? 'bottom' : 'top'),
      preferPlatformCaptions: readBooleanSetting(
        sourceState,
        fallbackState,
        persisted,
        'preferPlatformCaptions',
        true
      ),
      ...readSubtitleStyleSettings(sourceState, fallbackState, persisted),
      dubbing: readBooleanSetting(sourceState, fallbackState, persisted, 'dubbing', false),
      ttsProvider: readTtsProviderSetting(sourceState, fallbackState, persisted),
      ttsModel: readStringSetting(sourceState, fallbackState, persisted, 'ttsModel', ''),
      voiceCode: readStringSetting(sourceState, fallbackState, persisted, 'voiceCode', ''),
      voiceName: readStringSetting(sourceState, fallbackState, persisted, 'voiceName', ''),
      composeVideo: videoArtifacts.length > 0
        || readBooleanSetting(sourceState, fallbackState, persisted, 'composeVideo', false),
      videoFormat: inferredVideoFormat
        ?? (sourceState.videoFormat === 'vertical' || sourceState.videoFormat === 'all'
          ? sourceState.videoFormat
          : persisted?.settings.videoFormat
            ?? (fallbackState.videoFormat === 'vertical' || fallbackState.videoFormat === 'all'
              ? fallbackState.videoFormat
              : 'horizontal')),
      verticalTitle: readStringSetting(sourceState, fallbackState, persisted, 'verticalTitle', ''),
      verticalSubtitle: readStringSetting(sourceState, fallbackState, persisted, 'verticalSubtitle', '')
    },
    subtitleCues,
    savedSubtitleSnapshot: JSON.stringify(subtitleCues),
    generatedSubtitleSnapshot: JSON.stringify(subtitleCues),
    artifactRefs,
    changedArtifactIds: snapshot.changedArtifactIds,
    staleArtifactIds: snapshot.staleArtifactIds
  }]);
  return parsed[0];
}

function legacyArtifactRefsForVersion(
  artifacts: CreatorArtifact[],
  group: CreatorArtifact[],
  representative: CreatorArtifact,
  subtitleArtifact: CreatorArtifact | undefined
): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  for (const artifact of group) (refs[artifact.kind] ??= []).push(artifact.id);
  if (subtitleArtifact !== undefined) refs.target_subtitle = [subtitleArtifact.id];
  for (const kind of ['dubbed_audio', 'bilingual_subtitle', 'source_subtitle', 'source_video']) {
    const artifact = relatedArtifact(artifacts, representative, [kind]);
    if (artifact !== undefined) refs[kind] = [artifact.id];
  }
  return refs;
}

function readStringSetting(
  state: Record<string, CreatorJson>,
  fallback: Record<string, CreatorJson>,
  persisted: TranslationResultVersion | undefined,
  key: 'sourceLanguage' | 'targetLanguage' | 'subtitleColor' | 'ttsModel' | 'voiceCode' | 'voiceName' | 'verticalTitle' | 'verticalSubtitle',
  defaultValue: string
): string {
  const value = state[key] ?? fallback[key];
  return typeof value === 'string' ? value : persisted?.settings[key] ?? defaultValue;
}

function readTtsProviderSetting(
  state: Record<string, CreatorJson>,
  fallback: Record<string, CreatorJson>,
  persisted: TranslationResultVersion | undefined
): CreatorTtsProvider {
  const value = state.ttsProvider ?? fallback.ttsProvider;
  return isTtsProvider(value) ? value : persisted?.settings.ttsProvider ?? 'openai';
}

function isTtsProvider(value: unknown): value is CreatorTtsProvider {
  return value === 'openai'
    || value === 'aliyun'
    || value === 'minimax'
    || value === 'edge-tts'
    || value === 'volcengine';
}

function readSubtitleStyleSettings(
  state: Record<string, CreatorJson>,
  fallback: Record<string, CreatorJson>,
  persisted: TranslationResultVersion | undefined
): SubtitleStyleSettings {
  const style = readJsonRecord(state.subtitleStyle);
  const fallbackStyle = readJsonRecord(fallback.subtitleStyle);
  const shadow = readJsonRecord(style.shadow);
  const fallbackShadow = readJsonRecord(fallbackStyle.shadow);
  const settings = persisted?.settings;
  const fontValue = style.fontPreset ?? state.subtitleFont
    ?? fallbackStyle.fontPreset ?? fallback.subtitleFont;
  const weightValue = style.fontWeight ?? state.subtitleWeight
    ?? fallbackStyle.fontWeight ?? fallback.subtitleWeight;
  const sizeValue = style.fontSize ?? state.subtitleSize
    ?? fallbackStyle.fontSize ?? fallback.subtitleSize;
  return {
    subtitleFont: isSubtitleFont(fontValue)
      ? fontValue
      : settings?.subtitleFont ?? defaultSubtitleStyle.subtitleFont,
    subtitleWeight: isSubtitleWeight(weightValue)
      ? weightValue
      : settings?.subtitleWeight ?? defaultSubtitleStyle.subtitleWeight,
    subtitleSize: isSubtitleSize(sizeValue)
      ? sizeValue
      : settings?.subtitleSize ?? defaultSubtitleStyle.subtitleSize,
    subtitleColor: readSubtitleColor(
      style.primaryColor ?? state.subtitleColor
        ?? fallbackStyle.primaryColor ?? fallback.subtitleColor,
      settings?.subtitleColor ?? defaultSubtitleStyle.subtitleColor
    ),
    subtitleSecondaryColor: readSubtitleColor(
      style.secondaryColor ?? state.subtitleSecondaryColor
        ?? fallbackStyle.secondaryColor ?? fallback.subtitleSecondaryColor,
      settings?.subtitleSecondaryColor ?? defaultSubtitleStyle.subtitleSecondaryColor
    ),
    subtitleOutlineColor: readSubtitleColor(
      style.outlineColor ?? state.subtitleOutlineColor
        ?? fallbackStyle.outlineColor ?? fallback.subtitleOutlineColor,
      settings?.subtitleOutlineColor ?? defaultSubtitleStyle.subtitleOutlineColor
    ),
    subtitleOutlineWidth: readBoundedNumber(
      style.outlineWidth ?? state.subtitleOutlineWidth
        ?? fallbackStyle.outlineWidth ?? fallback.subtitleOutlineWidth,
      0,
      8,
      settings?.subtitleOutlineWidth ?? defaultSubtitleStyle.subtitleOutlineWidth
    ),
    subtitleVerticalOffset: Math.round(readBoundedNumber(
      style.verticalOffset ?? state.subtitleVerticalOffset
        ?? fallbackStyle.verticalOffset ?? fallback.subtitleVerticalOffset,
      -20,
      100,
      settings?.subtitleVerticalOffset ?? defaultSubtitleStyle.subtitleVerticalOffset
    )),
    subtitleShadowEnabled: readBooleanValue(
      shadow.enabled ?? state.subtitleShadowEnabled
        ?? fallbackShadow.enabled ?? fallback.subtitleShadowEnabled,
      settings?.subtitleShadowEnabled ?? defaultSubtitleStyle.subtitleShadowEnabled
    ),
    subtitleShadowColor: readSubtitleColor(
      shadow.color ?? state.subtitleShadowColor
        ?? fallbackShadow.color ?? fallback.subtitleShadowColor,
      settings?.subtitleShadowColor ?? defaultSubtitleStyle.subtitleShadowColor
    ),
    subtitleShadowOpacity: readBoundedNumber(
      shadow.opacity ?? state.subtitleShadowOpacity
        ?? fallbackShadow.opacity ?? fallback.subtitleShadowOpacity,
      0,
      1,
      settings?.subtitleShadowOpacity ?? defaultSubtitleStyle.subtitleShadowOpacity
    ),
    subtitleShadowOffsetX: readBoundedNumber(
      shadow.offsetX ?? state.subtitleShadowOffsetX
        ?? fallbackShadow.offsetX ?? fallback.subtitleShadowOffsetX,
      -20,
      20,
      settings?.subtitleShadowOffsetX ?? defaultSubtitleStyle.subtitleShadowOffsetX
    ),
    subtitleShadowOffsetY: readBoundedNumber(
      shadow.offsetY ?? state.subtitleShadowOffsetY
        ?? fallbackShadow.offsetY ?? fallback.subtitleShadowOffsetY,
      -20,
      20,
      settings?.subtitleShadowOffsetY ?? defaultSubtitleStyle.subtitleShadowOffsetY
    ),
    subtitleShadowBlur: readBoundedNumber(
      shadow.blur ?? state.subtitleShadowBlur
        ?? fallbackShadow.blur ?? fallback.subtitleShadowBlur,
      0,
      10,
      settings?.subtitleShadowBlur ?? defaultSubtitleStyle.subtitleShadowBlur
    )
  };
}

function readJsonRecord(value: CreatorJson | undefined): Record<string, CreatorJson> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function isSubtitleFont(value: unknown): value is SubtitleFont {
  return value === 'system' || value === 'sans' || value === 'serif' || value === 'rounded';
}

function isSubtitleWeight(value: unknown): value is SubtitleWeight {
  return value === 'regular' || value === 'medium' || value === 'bold';
}

function isSubtitleSize(value: unknown): value is SubtitleSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

function readSubtitleColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value.toUpperCase()
    : fallback;
}

function readBoundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function readBooleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readBooleanSetting(
  state: Record<string, CreatorJson>,
  fallback: Record<string, CreatorJson>,
  persisted: TranslationResultVersion | undefined,
  key: 'bilingual' | 'preferPlatformCaptions' | 'dubbing' | 'composeVideo',
  defaultValue: boolean
): boolean {
  const value = state[key] ?? fallback[key];
  return typeof value === 'boolean' ? value : persisted?.settings[key] ?? defaultValue;
}

function artifactFileName(artifact: CreatorArtifact | undefined): string | undefined {
  return typeof artifact?.metadata.fileName === 'string' ? artifact.metadata.fileName : undefined;
}

function readPositiveResultVersion(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function latestArtifactForResultVersion(
  artifacts: CreatorArtifact[],
  resultVersion: number,
  kinds: readonly string[],
  resultSnapshots?: CreatorJson
): CreatorArtifact | undefined {
  const snapshot = readCreatorResultSnapshots(resultSnapshots)
    .find(candidate => candidate.version === resultVersion);
  if (snapshot !== undefined) {
    return artifactFromRefs(artifacts, resolvedSnapshotArtifactRefs(artifacts, snapshot), kinds);
  }
  for (const kind of kinds) {
    const selected = artifacts.filter(artifact => (
      artifact.kind === kind
      && artifact.status === 'completed'
      && artifactResultVersion(artifact) === resultVersion
    ))
      .sort(compareArtifactFreshness)
      .at(-1);
    if (selected !== undefined) return selected;
  }
  const resultVideo = artifacts.filter(artifact => (
    isVideoArtifactKind(artifact.kind)
    && artifact.status === 'completed'
    && artifactResultVersion(artifact) === resultVersion
  )).sort(compareArtifactFreshness).at(-1);
  if (resultVideo !== undefined) return relatedArtifact(artifacts, resultVideo, kinds);
  return undefined;
}

function resolvedSnapshotArtifactRefs(
  artifacts: CreatorArtifact[],
  snapshot: CreatorResultSnapshot
): Record<string, string[]> {
  const refs = Object.fromEntries(
    Object.entries(snapshot.artifactRefs).map(([kind, ids]) => [kind, [...ids]])
  );
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const staleIds = new Set(snapshot.staleArtifactIds);
  for (const id of snapshot.changedArtifactIds) {
    const artifact = artifactsById.get(id);
    if (
      artifact === undefined
      || staleIds.has(id)
      || !['completed', 'stale'].includes(artifact.status)
      || (refs[artifact.kind]?.length ?? 0) > 0
    ) continue;
    refs[artifact.kind] = [id];
  }
  return refs;
}

function artifactFromRefs(
  artifacts: CreatorArtifact[],
  refs: Record<string, string[]>,
  kinds: readonly string[]
): CreatorArtifact | undefined {
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  for (const kind of kinds) {
    for (const id of [...(refs[kind] ?? [])].reverse()) {
      const artifact = artifactsById.get(id);
      if (artifact !== undefined && ['completed', 'stale'].includes(artifact.status)) return artifact;
    }
  }
  return undefined;
}

function artifactResultVersion(artifact: CreatorArtifact): number {
  const value = artifact.metadata.resultVersion;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : artifact.version;
}

function isVideoArtifactKind(kind: string): kind is typeof videoArtifactKinds[number] {
  return videoArtifactKinds.includes(kind as typeof videoArtifactKinds[number]);
}

function relatedArtifact(
  artifacts: CreatorArtifact[],
  output: CreatorArtifact,
  kinds: readonly string[]
): CreatorArtifact | undefined {
  const artifactsById = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const queue = [...output.sourceArtifactIds];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const artifact = artifactsById.get(id);
    if (artifact === undefined) continue;
    if (['completed', 'stale'].includes(artifact.status) && kinds.includes(artifact.kind)) return artifact;
    queue.push(...artifact.sourceArtifactIds);
  }
  return undefined;
}

function latestArtifactBefore(
  artifacts: CreatorArtifact[],
  output: CreatorArtifact,
  kind: string
): CreatorArtifact | undefined {
  return artifacts.filter(artifact => (
    artifact.kind === kind
    && ['completed', 'stale'].includes(artifact.status)
    && artifact.createdAt <= output.createdAt
  )).sort(compareArtifactFreshness).at(-1);
}

function compareArtifactFreshness(left: CreatorArtifact, right: CreatorArtifact): number {
  if (left.version !== right.version) return left.version - right.version;
  return left.createdAt.localeCompare(right.createdAt);
}

function affectedArtifacts(
  version: TranslationResultVersion,
  settings: TranslationSettingsSnapshot,
  source: TranslationSourceSnapshot,
  subtitleNeedsRegeneration: boolean,
  staleArtifactKinds: ReadonlySet<string>,
  l: LocalizeCopy,
  subtitleModelChanged = false
) {
  const changes = translationChanges(version, settings, source, subtitleNeedsRegeneration, subtitleModelChanged);
  const artifacts = new Set<string>();

  if (
    changes.subtitleContentChanged
    || changes.subtitleInputsChanged
    || changes.subtitleStyleChanged
  ) {
    artifacts.add(l('字幕', 'Subtitles'));
  }
  if (
    changes.voiceChanged
    || ((changes.subtitleContentChanged || changes.subtitleInputsChanged) && settings.dubbing)
    || staleArtifactKinds.has('dubbed_audio')
    || staleArtifactKinds.has('dubbed_video')
  ) {
    artifacts.add(l('配音', 'Dubbing'));
  }
  if (
    changes.subtitleContentChanged
    || changes.subtitleInputsChanged
    || changes.subtitleStyleChanged
    || changes.voiceChanged
    || changes.outputChanged
    || staleArtifactKinds.has('horizontal_video')
    || staleArtifactKinds.has('vertical_video')
  ) {
    artifacts.add(l('成片', 'Final video'));
  }
  if (artifacts.size === 0) {
    artifacts.add(l('字幕', 'Subtitles'));
    if (settings.dubbing) artifacts.add(l('配音', 'Dubbing'));
    artifacts.add(l('成片', 'Final video'));
  }
  return [...artifacts];
}

function Switch(props: {
  checked: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className={`video-translation-toggle-row${props.disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{props.label}</strong>
        {props.description ? <small>{props.description}</small> : null}
      </span>
      <button
        className="video-translation-switch"
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <span />
      </button>
    </div>
  );
}

function isValidVideoUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function videoOrientationFromDimensions(width: unknown, height: unknown): VideoOrientation | undefined {
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return undefined;
  return height > width ? 'portrait' : 'landscape';
}

function videoDimensionsFromUnknown(width: unknown, height: unknown): { width: number; height: number } | undefined {
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return undefined;
  return { width, height };
}

function SubtitlePresetThumbnail(props: {
  style: SubtitleStyleSettings;
  bilingual: boolean;
  translationOnTop: boolean;
  posterUrl?: string;
}) {
  const l = useLocalizedCopy();
  const translation = <span data-line="translation">{l('字幕样式', 'Subtitle')}</span>;
  const original = props.bilingual ? <span data-line="original">{l('原文', 'Original')}</span> : null;
  return (
    <span className="video-translation-subtitle-preset-thumb" style={subtitleStyleThumbnailCss(props.style)} aria-hidden="true">
      {props.posterUrl ? <img src={props.posterUrl} alt="" onError={event => { event.currentTarget.hidden = true; }} /> : null}
      <span className="video-translation-subtitle-preset-lines">
        {props.translationOnTop ? <>{translation}{original}</> : <>{original}{translation}</>}
      </span>
    </span>
  );
}

function SubtitleRangeControl(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange(value: number): void;
}) {
  const l = useLocalizedCopy();
  const clamp = (value: number) => Math.min(props.max, Math.max(props.min, value));
  return (
    <div className="video-translation-range-control">
      <span>{props.label}</span>
      <div>
        <input
          type="range"
          aria-label={l(`${props.label}滑块`, `${props.label} slider`)}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          style={{ '--range-progress': `${((props.value - props.min) / (props.max - props.min)) * 100}%` } as CSSProperties}
          onChange={event => props.onChange(Number(event.target.value))}
        />
        <input
          type="number"
          aria-label={props.label}
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onChange={event => {
            const value = Number(event.target.value);
            if (event.target.value !== '' && Number.isFinite(value)) props.onChange(clamp(value));
          }}
        />
      </div>
    </div>
  );
}

function SubtitleColorControl(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  prefixPresetLabel?: boolean;
}) {
  const l = useLocalizedCopy();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(props.value.toUpperCase());
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean }>();
  useEffect(() => { setHex(props.value.toUpperCase()); }, [props.value]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight);
      const below = bottomEdge - rect.bottom - 14;
      const above = rect.top - topEdge - 14;
      const opensAbove = below < 360 && above > below;
      const width = Math.min(240, viewportWidth - 16);
      setPosition({
        left: Math.max(leftEdge + 8, Math.min(rect.left, leftEdge + viewportWidth - width - 8)),
        top: opensAbove ? rect.top - 6 : rect.bottom + 6,
        width,
        maxHeight: Math.max(0, Math.min(400, opensAbove ? above : below)),
        above: opensAbove
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !position) return;
    (paletteRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?? paletteRef.current?.querySelector<HTMLButtonElement>('.video-translation-color-options > button'))?.focus();
    const onOutside = (event: Event) => {
      if (!triggerRef.current?.contains(event.target as Node) && !paletteRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('focusin', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('focusin', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, position !== undefined]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="video-translation-style-control">
      <span>{props.label}</span>
      <button
        type="button"
        className="video-translation-color-trigger"
        ref={triggerRef}
        aria-label={l(`选择${props.label}`, `Choose ${props.label.toLowerCase()}`)}
        title={props.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => { setHex(props.value.toUpperCase()); setOpen(value => !value); }}
      >
        <span className="video-translation-current-color" style={{ '--subtitle-swatch-color': props.value } as CSSProperties} />
        <span>{props.value.toUpperCase()}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && position ? createPortal(<div
        id={id}
        ref={paletteRef}
        className="video-translation-color-palette"
        role="dialog"
        aria-label={l(`${props.label}色板`, `${props.label} palette`)}
        style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: position.above ? 'translateY(-100%)' : undefined }}
      >
        <div className="video-translation-color-palette-heading">
          <strong>{props.label}</strong>
          <button type="button" aria-label={l('关闭色板', 'Close palette')} title={l('关闭色板', 'Close palette')} onClick={close}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <HexColorPicker
          className="video-translation-color-picker"
          color={props.value}
          onChange={value => props.onChange(value.toUpperCase())}
          aria-label={l(`选择${props.label}`, `Choose ${props.label.toLowerCase()}`)}
        />
        <div className="video-translation-color-options">
          {subtitleColors.map(color => (
            <button
              type="button"
              aria-label={props.prefixPresetLabel ? `${props.label} ${color}` : color}
              title={color}
              aria-pressed={props.value.toUpperCase() === color}
              key={color}
              style={{ '--subtitle-swatch-color': color, '--subtitle-swatch-ink': color === '#000000' ? '#FFFFFF' : '#17191d' } as CSSProperties}
              onClick={() => props.onChange(color)}
            >
              {props.value.toUpperCase() === color ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <div className="video-translation-custom-color-fields">
          <span className="video-translation-current-color" style={{ '--subtitle-swatch-color': props.value } as CSSProperties} />
          <input
            className="video-translation-color-hex"
            type="text"
            aria-label={`${props.label} HEX`}
            placeholder="#RRGGBB"
            maxLength={7}
            spellCheck={false}
            value={hex}
            onChange={event => {
              const value = event.target.value;
              setHex(value);
              if (/^#?[0-9a-f]{6}$/i.test(value)) props.onChange(`#${value.replace(/^#/, '').toUpperCase()}`);
            }}
            onBlur={() => setHex(props.value.toUpperCase())}
          />
        </div>
      </div>, document.body) : null}
    </div>
  );
}

export default function VideoTranslationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  videoMetadataService?: VideoMetadataService;
  creatorServicesService?: CreatorServicesSettingsService | null;
  runtimeDependencies?: RuntimeDependenciesController;
}) {
  const l = useLocalizedCopy();
  const translationStartedNotice = l(
    '翻译任务已开始，进度会实时同步到创作动态',
    'Translation started. Progress will appear in creation activity.'
  );
  const creatorSession = useOptionalCreatorSession();
  const officialText = useOfficialServices('text');
  const officialSpeech = useOfficialServices('speech');
  const legacyModelBaselines = useRef(new Map<string, { text?: string; transcription?: string }>());
  const mediaPreviewContextRef = useRef({ session: creatorSession, localize: l });
  mediaPreviewContextRef.current = { session: creatorSession, localize: l };
  const mediaPreviewJobId = creatorSession?.job.id;
  const canOpenMediaPreview = creatorSession?.openArtifact !== undefined;
  const videoInputRef = useRef<HTMLInputElement>(null);
  const skipPersistRef = useRef(false);
  const restoredResultNavigationRef = useRef<{
    jobId: string;
    latestVersion: number | null;
  }>();
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [furthestStep, setFurthestStep] = useState<WizardStep>(0);
  const [workspacePhase, setWorkspacePhase] = useState<WorkspacePhase>('configure');
  const [sourceType, setSourceType] = useState<SourceType>('url');
  const subtitleOnly = sourceType === 'subtitle';
  const officialTranscription = useOfficialServices('transcription', !subtitleOnly);
  const steps = videoSteps;
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [urlMetadata, setUrlMetadata] = useState<{ url: string; value: VideoMetadataResponse }>();
  const [bilibiliMetadataError, setBilibiliMetadataError] = useState<{ url: string; message: string }>();
  const [metadataRetry, setMetadataRetry] = useState(0);
  const [previewRequest, setPreviewRequest] = useState<{ version: number; pending: boolean; error?: string }>();
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoFileSize, setVideoFileSize] = useState<number | null>(null);
  const [videoFileLastModified, setVideoFileLastModified] = useState<number | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [asrCapability, setAsrCapability] = useState<TranscriptionLanguageCapability>();
  const [targetLanguage, setTargetLanguage] = useState('zh_cn');
  const [bilingual, setBilingual] = useState(true);
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>('top');
  const [preferPlatformCaptions, setPreferPlatformCaptions] = useState(true);
  const [skipVideoDownload, setSkipVideoDownload] = useState(false);
  const continuationRef = useRef(readTranslationContinuation());
  const editorContextRef = useRef<TranslationEditorContext | undefined>(componentNavigationDraft?.jobId === creatorSession?.job.id ? componentNavigationDraft?.editor : continuationRef.current?.jobId === creatorSession?.job.id ? continuationRef.current?.editor : undefined);
  const [outputRequest, setOutputRequest] = useState<'video' | 'voice'>();
  const outputStartingRef = useRef(false);
  const speechSelectionRef = useRef<{ context: string; followSettings: boolean; defaults?: TranslationSpeechSettings }>();
  const speechConfigRequestRef = useRef(0);
  const speechBusyRef = useRef(false);
  const speechVoiceSelectionRef = useRef(creatorSession?.state.ttsVoiceSelection);
  speechVoiceSelectionRef.current = creatorSession?.state.ttsVoiceSelection;
  const [speechDefaults, setSpeechDefaults] = useState<TranslationSpeechSettings>();
  const [speechSyncing, setSpeechSyncing] = useState(false);
  const [configurationRequired, setConfigurationRequired] = useState<'video' | 'voice' | undefined>(continuationRef.current?.jobId === creatorSession?.job.id && continuationRef.current?.status === 'configure' ? continuationRef.current.type : undefined);
  const [subtitleFont, setSubtitleFont] = useState<SubtitleFont>(defaultSubtitleStyle.subtitleFont);
  const [subtitleWeight, setSubtitleWeight] = useState<SubtitleWeight>(defaultSubtitleStyle.subtitleWeight);
  const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>(defaultSubtitleStyle.subtitleSize);
  const [subtitleColor, setSubtitleColor] = useState(defaultSubtitleStyle.subtitleColor);
  const [subtitleSecondaryColor, setSubtitleSecondaryColor] = useState(defaultSubtitleStyle.subtitleSecondaryColor);
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState(defaultSubtitleStyle.subtitleOutlineColor);
  const [subtitleOutlineWidth, setSubtitleOutlineWidth] = useState(defaultSubtitleStyle.subtitleOutlineWidth);
  const [subtitleVerticalOffset, setSubtitleVerticalOffset] = useState(defaultSubtitleStyle.subtitleVerticalOffset);
  const [subtitleShadowEnabled, setSubtitleShadowEnabled] = useState(defaultSubtitleStyle.subtitleShadowEnabled);
  const [subtitleShadowColor, setSubtitleShadowColor] = useState(defaultSubtitleStyle.subtitleShadowColor);
  const [subtitleShadowOpacity, setSubtitleShadowOpacity] = useState(defaultSubtitleStyle.subtitleShadowOpacity);
  const [subtitleShadowOffsetX, setSubtitleShadowOffsetX] = useState(defaultSubtitleStyle.subtitleShadowOffsetX);
  const [subtitleShadowOffsetY, setSubtitleShadowOffsetY] = useState(defaultSubtitleStyle.subtitleShadowOffsetY);
  const [subtitleShadowBlur, setSubtitleShadowBlur] = useState(defaultSubtitleStyle.subtitleShadowBlur);
  const [dubbingRequested, setDubbing] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<CreatorTtsProvider>('openai');
  const [ttsModel, setTtsModel] = useState('gpt-4o-mini-tts');
  const [voiceCode, setVoiceCode] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const speechDraftRef = useRef({ ttsProvider, ttsModel, voiceCode, voiceName });
  speechDraftRef.current = { ttsProvider, ttsModel, voiceCode, voiceName };
  const [composeVideoRequested, setComposeVideo] = useState(false);
  const composeVideo = !subtitleOnly && composeVideoRequested;
  const dubbing = !subtitleOnly && dubbingRequested;
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('horizontal');
  const outputFormatName = useId();
  const [sourceOrientation, setSourceOrientation] = useState<VideoOrientation>(() => (
    creatorSession?.state.sourceOrientation === 'portrait' ? 'portrait' : 'landscape'
  ));
  const [verticalTitle, setVerticalTitle] = useState('');
  const [verticalSubtitle, setVerticalSubtitle] = useState('');
  const [attemptedContinue, setAttemptedContinue] = useState(false);
  const [resultTab, setResultTab] = useState<VideoTranslationResultTab>('subtitles');
  const [resultVersion, setResultVersion] = useState(1);
  const [videoPreviewRequest, setVideoPreviewRequest] = useState<{ key: string; version: number }>();
  const [resultVersions, setResultVersions] = useState<TranslationResultVersion[]>([]);
  const [subtitleDrafts, setSubtitleDrafts] = useState<Record<string, SubtitleCue[]>>({});
  const [subtitleImmersive, setSubtitleImmersive] = useState(true);
  const [subtitleSaving, setSubtitleSaving] = useState(false);
  const [subtitleSaveError, setSubtitleSaveError] = useState('');
  const subtitleSaveWorkRef = useRef<Promise<boolean>>();
  const [subtitleAssistantOpen, setSubtitleAssistantOpen] = useState(false);
  const [taskDetailsRequest, setTaskDetailsRequest] = useState<{ key: number; stageRunId?: string }>();
  const [draftBaseVersion, setDraftBaseVersion] = useState<number>();
  const [resultProposal, setResultProposal] = useState<ResultProposal>();
  const [resultNoticeState, setResultNoticeState] = useState({ message: '' });
  const resultNotice = resultNoticeState.message;
  const setResultNotice = useCallback((message: string) => {
    setResultNoticeState({ message });
  }, []);
  useEffect(() => {
    if (!resultNoticeState.message) return;
    const timeout = window.setTimeout(() => {
      setResultNoticeState(current => current === resultNoticeState ? { message: '' } : current);
    }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [resultNoticeState]);
  const [voicePreviewReload, setVoicePreviewReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [subtitleImportPending, setSubtitleImportPending] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<'uploading' | 'starting'>();
  const [startRevisionConflict, setStartRevisionConflict] = useState(false);
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [styleDrawerSnapshot, setStyleDrawerSnapshot] = useState<SubtitleStyleSettings>();
  const styleDrawerTriggerRef = useRef<HTMLButtonElement>(null);
  const currentSubtitleStyle: SubtitleStyleSettings = {
    subtitleFont,
    subtitleWeight,
    subtitleSize,
    subtitleColor,
    subtitleSecondaryColor,
    subtitleOutlineColor,
    subtitleOutlineWidth,
    subtitleVerticalOffset,
    subtitleShadowEnabled,
    subtitleShadowColor,
    subtitleShadowOpacity,
    subtitleShadowOffsetX,
    subtitleShadowOffsetY,
    subtitleShadowBlur
  };
  const activeSubtitlePreset = subtitleStylePresets.find(preset => sameSubtitleStyle(preset.style, currentSubtitleStyle));
  const [savedSubtitleStyles, setSavedSubtitleStyles] = useState<SavedSubtitleStyle[]>(() => readSavedSubtitleStyles());
  const [saveStyleName, setSaveStyleName] = useState<string>();
  const [editingSavedStyle, setEditingSavedStyle] = useState<{ id: string; name: string }>();
  const [subtitleStyleTab, setSubtitleStyleTab] = useState<'recommended' | 'mine'>(
    () => savedSubtitleStyles.length > 0 ? 'mine' : 'recommended'
  );
  const activeSavedSubtitleStyle = activeSubtitlePreset === undefined
    ? savedSubtitleStyles.find(saved => sameSubtitleStyle(saved.style, currentSubtitleStyle))
    : undefined;
  function saveCurrentSubtitleStyle(name: string) {
    const trimmed = name.trim().slice(0, 24);
    if (trimmed === '') return;
    const next = [
      ...savedSubtitleStyles,
      { id: `saved-${Date.now().toString(36)}`, name: trimmed, style: currentSubtitleStyle }
    ].slice(-savedSubtitleStylesLimit);
    setSavedSubtitleStyles(next);
    writeSavedSubtitleStyles(next);
    setSaveStyleName(undefined);
    setSubtitleStyleTab('mine');
  }
  function openSavedStyleEditor(saved: SavedSubtitleStyle) {
    // Snapshot the style in use before editing so Cancel restores it, not the template.
    setStyleDrawerSnapshot(currentSubtitleStyle);
    applySubtitleStyle(saved.style);
    setEditingSavedStyle({ id: saved.id, name: saved.name });
  }
  function updateEditingSavedStyle() {
    if (editingSavedStyle === undefined) return;
    const name = editingSavedStyle.name.trim().slice(0, 24);
    const next = savedSubtitleStyles.map(saved => saved.id === editingSavedStyle.id
      ? { ...saved, name: name === '' ? saved.name : name, style: currentSubtitleStyle }
      : saved);
    setSavedSubtitleStyles(next);
    writeSavedSubtitleStyles(next);
  }
  function deleteSavedSubtitleStyle(id: string) {
    const next = savedSubtitleStyles.filter(saved => saved.id !== id);
    setSavedSubtitleStyles(next);
    writeSavedSubtitleStyles(next);
    if (next.length === 0) setSubtitleStyleTab('recommended');
  }
  function applySubtitleStyle(style: SubtitleStyleSettings) {
    setSubtitleFont(style.subtitleFont);
    setSubtitleWeight(style.subtitleWeight);
    setSubtitleSize(style.subtitleSize);
    setSubtitleColor(style.subtitleColor);
    setSubtitleSecondaryColor(style.subtitleSecondaryColor);
    setSubtitleOutlineColor(style.subtitleOutlineColor);
    setSubtitleOutlineWidth(style.subtitleOutlineWidth);
    setSubtitleVerticalOffset(style.subtitleVerticalOffset);
    setSubtitleShadowEnabled(style.subtitleShadowEnabled);
    setSubtitleShadowColor(style.subtitleShadowColor);
    setSubtitleShadowOpacity(style.subtitleShadowOpacity);
    setSubtitleShadowOffsetX(style.subtitleShadowOffsetX);
    setSubtitleShadowOffsetY(style.subtitleShadowOffsetY);
    setSubtitleShadowBlur(style.subtitleShadowBlur);
  }
  function selectSubtitleStyle(style: SubtitleStyleSettings) {
    applySubtitleStyle(style);
  }
  function closeStyleDrawer(revert: boolean) {
    if (revert && styleDrawerSnapshot) applySubtitleStyle(styleDrawerSnapshot);
    setStyleDrawerSnapshot(undefined);
    setSaveStyleName(undefined);
    setEditingSavedStyle(undefined);
    styleDrawerTriggerRef.current?.focus();
  }
  useEffect(() => {
    if (styleDrawerSnapshot === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Nested color palettes handle their own Escape first.
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.video-translation-color-palette')) return;
      closeStyleDrawer(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);
  const parsedVideoSource = useMemo(() => parseVideoSource(videoUrl), [videoUrl]);
  const currentUrlMetadata = sourceType === 'url' && urlMetadata?.url === videoUrl ? urlMetadata.value : undefined;
  const sourceSelectionReady = sourceType !== 'url' || (parsedVideoSource.kind !== 'invalid'
    && (parsedVideoSource.kind !== 'bilibili' || (currentUrlMetadata !== undefined
      && ((currentUrlMetadata.parts?.length ?? 0) < 2 || currentUrlMetadata.selectedPart !== undefined))));

  useEffect(() => {
    if (sourceType !== 'url' || !isValidVideoUrl(videoUrl)
      || props.videoMetadataService === undefined || currentUrlMetadata !== undefined
      || (currentStep === 0 && parsedVideoSource.kind !== 'bilibili')
      || (parsedVideoSource.kind !== 'youtube' && parsedVideoSource.kind !== 'bilibili')) return;
    let canceled = false;
    if (parsedVideoSource.kind === 'bilibili') setBilibiliMetadataError(undefined);
    const timeout = setTimeout(() => {
      void props.videoMetadataService!.getVideoMetadata(videoUrl).then(metadata => {
        if (canceled) return;
        setUrlMetadata({ url: videoUrl, value: metadata });
        setBilibiliMetadataError(undefined);
        if (metadata.width !== undefined && metadata.height !== undefined) {
          updateSourceOrientation(metadata.width, metadata.height);
        }
      }).catch(error => {
        if (!canceled && parsedVideoSource.kind === 'bilibili') {
          setBilibiliMetadataError({ url: videoUrl, message: error instanceof Error
            ? error.message : l('无法读取 B 站分集信息，请重试', 'Could not load Bilibili parts. Please retry.') });
        }
      });
    }, parsedVideoSource.kind === 'bilibili' ? 350 : 0);
    return () => { canceled = true; clearTimeout(timeout); };
  }, [currentStep, sourceType, videoUrl, props.videoMetadataService, currentUrlMetadata, parsedVideoSource.kind, metadataRetry]);

  useEffect(() => {
    if (creatorSession === null) return;
    skipPersistRef.current = true;
    const persisted = creatorSession.state;
    if (persisted.sourceType === 'url' || persisted.sourceType === 'file' || persisted.sourceType === 'subtitle') setSourceType(persisted.sourceType);
    if (typeof persisted.sourceUrl === 'string') setVideoUrl(persisted.sourceUrl);
    setVideoFileName(typeof persisted.sourceFileName === 'string' ? persisted.sourceFileName : null);
    setVideoFileSize(typeof persisted.sourceFileSize === 'number' ? persisted.sourceFileSize : null);
    setVideoFileLastModified(
      typeof persisted.sourceFileLastModified === 'number'
        ? persisted.sourceFileLastModified
        : null
    );
    if (typeof persisted.sourceLanguage === 'string') setSourceLanguage(persisted.sourceLanguage);
    if (typeof persisted.targetLanguage === 'string') setTargetLanguage(persisted.targetLanguage);
    if (typeof persisted.bilingual === 'boolean') setBilingual(persisted.bilingual);
    if (persisted.subtitlePosition === 'top' || persisted.subtitlePosition === 'bottom') setSubtitlePosition(persisted.subtitlePosition);
    if (typeof persisted.preferPlatformCaptions === 'boolean') setPreferPlatformCaptions(persisted.preferPlatformCaptions);
    setSkipVideoDownload(persisted.skipVideoDownload === true);
    const persistedSubtitleStyle = readSubtitleStyleSettings(persisted, {}, undefined);
    setSubtitleFont(persistedSubtitleStyle.subtitleFont);
    setSubtitleWeight(persistedSubtitleStyle.subtitleWeight);
    setSubtitleSize(persistedSubtitleStyle.subtitleSize);
    setSubtitleColor(persistedSubtitleStyle.subtitleColor);
    setSubtitleSecondaryColor(persistedSubtitleStyle.subtitleSecondaryColor);
    setSubtitleOutlineColor(persistedSubtitleStyle.subtitleOutlineColor);
    setSubtitleOutlineWidth(persistedSubtitleStyle.subtitleOutlineWidth);
    setSubtitleVerticalOffset(persistedSubtitleStyle.subtitleVerticalOffset);
    setSubtitleShadowEnabled(persistedSubtitleStyle.subtitleShadowEnabled);
    setSubtitleShadowColor(persistedSubtitleStyle.subtitleShadowColor);
    setSubtitleShadowOpacity(persistedSubtitleStyle.subtitleShadowOpacity);
    setSubtitleShadowOffsetX(persistedSubtitleStyle.subtitleShadowOffsetX);
    setSubtitleShadowOffsetY(persistedSubtitleStyle.subtitleShadowOffsetY);
    setSubtitleShadowBlur(persistedSubtitleStyle.subtitleShadowBlur);
    if (typeof persisted.dubbing === 'boolean') setDubbing(persisted.dubbing);
    if (isTtsProvider(persisted.ttsProvider)) setTtsProvider(persisted.ttsProvider);
    if (typeof persisted.ttsModel === 'string') setTtsModel(persisted.ttsModel);
    if (typeof persisted.voiceCode === 'string') setVoiceCode(persisted.voiceCode);
    if (typeof persisted.voiceName === 'string') setVoiceName(persisted.voiceName);
    if (typeof persisted.composeVideo === 'boolean') setComposeVideo(persisted.composeVideo);
    if (persisted.videoFormat === 'horizontal' || persisted.videoFormat === 'vertical' || persisted.videoFormat === 'all') {
      setVideoFormat(persisted.videoFormat);
    }
    const persistedOrientation = persisted.sourceOrientation === 'portrait' || persisted.sourceOrientation === 'landscape'
      ? persisted.sourceOrientation
      : undefined;
    const persistedSourceArtifact = [...creatorSession.job.artifacts].reverse().find(artifact => (
      artifact.kind === 'source_video' && artifact.status === 'completed'
    ));
    const artifactMatchesCurrentFile = persistedSourceArtifact !== undefined
      && persisted.sourceType === 'file'
      && videoFile === null
      && (persisted.sourceArtifactId === persistedSourceArtifact.id
        || (typeof persisted.sourceFileName === 'string'
          && persisted.sourceFileName === readArtifactString(persistedSourceArtifact, 'fileName')));
    const restoredDimensions = videoDimensionsFromUnknown(
      artifactMatchesCurrentFile ? persistedSourceArtifact.metadata.width : undefined,
      artifactMatchesCurrentFile ? persistedSourceArtifact.metadata.height : undefined
    );
    setSourceOrientation(videoOrientationFromDimensions(
      restoredDimensions?.width,
      restoredDimensions?.height
    ) ?? persistedOrientation ?? 'landscape');
    if (typeof persisted.verticalTitle === 'string') setVerticalTitle(persisted.verticalTitle);
    if (typeof persisted.verticalSubtitle === 'string') setVerticalSubtitle(persisted.verticalSubtitle);
    if (persisted.currentStep === 0 || persisted.currentStep === 1 || persisted.currentStep === 2 || persisted.currentStep === 3) {
      setCurrentStep(Math.min(persisted.currentStep, 1) as WizardStep);
    }
    if (persisted.furthestStep === 0 || persisted.furthestStep === 1 || persisted.furthestStep === 2 || persisted.furthestStep === 3) {
      setFurthestStep(Math.min(persisted.furthestStep, 1) as WizardStep);
    }
    const artifactVersions = resultVersionsFromArtifacts(creatorSession.job.artifacts, persisted);
    const latest = artifactVersions.at(-1);
    const restoredResultNavigation = restoredResultNavigationRef.current;
    const shouldRestoreLatestResult = restoredResultNavigation === undefined
      || restoredResultNavigation.jobId !== creatorSession.job.id
      || (latest !== undefined
        && (restoredResultNavigation.latestVersion === null
          || latest.value > restoredResultNavigation.latestVersion));
    restoredResultNavigationRef.current = {
      jobId: creatorSession.job.id,
      latestVersion: latest?.value ?? null
    };
    setResultVersions(artifactVersions);
    const persistedVersion = artifactVersions.find(version => version.value === persisted.resultVersion);
    if (persistedVersion !== undefined) setResultVersion(persistedVersion.value);
    if (creatorSession.job.status === 'draft' && readCreatorResultSnapshots(persisted.resultSnapshots).at(-1)?.action === 'import-subtitle') {
      setDraftBaseVersion(undefined);
      setWorkspacePhase('configure');
      return;
    }
    if (latest !== undefined) {
      if (!shouldRestoreLatestResult) return;
      setCurrentStep(1);
      setFurthestStep(1);
      setResultVersion(persistedVersion?.value ?? latest.value);
      const selected = persistedVersion ?? latest;
      if (persisted.draftBaseVersion !== selected.value) {
        applySettingsSnapshot(selected.settings);
        applySourceSnapshot(selected.source);
      }
      setDraftBaseVersion(selected.value);
      setResultTab('subtitles');
      setSubtitleImmersive(true);
      setWorkspacePhase('result');
    } else if (shouldRestoreLatestResult) {
      setResultTab('subtitles');
      setDraftBaseVersion(undefined);
      setWorkspacePhase(creatorSession.job.status !== 'draft'
        && creatorSession.job.stages.some(stage => ['subtitle', 'tts', 'render-horizontal', 'render-vertical'].includes(stage.stageId))
        ? 'result' : 'configure');
    }
  }, [creatorSession?.job.id, creatorSession?.job.revision]);

  useEffect(() => {
    let active = true;
    const service = props.creatorServicesService;
    if (!service) return;
    const refresh = () => {
      void Promise.all([service.getConfig(), service.getCapabilities()]).then(([response, capabilities]) => {
        if (!active) return;
        const provider = capabilities.transcription.providers.find(item => item.provider === response.config.transcription.provider);
        setAsrCapability(provider?.languageCapabilities?.[creatorTranscriptionModel(response.config)] ?? { coverage: 'unknown', supportedLanguages: [], timestamps: 'unknown', profileVersion: 'unverified-v1' });
      }).catch(() => { if (active) setAsrCapability(undefined); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [props.creatorServicesService, currentStep]);

  useEffect(() => {
    if (creatorSession === null) return;
    const skipPersist = skipPersistRef.current;
    if (skipPersist) skipPersistRef.current = false;
    const shouldPersistSourceFile = sourceType === 'file'
      || creatorSession.state.sourceFileName !== undefined
      || creatorSession.state.sourceFileSize !== undefined
      || creatorSession.state.sourceFileLastModified !== undefined;
    const subtitleStyle = {
      fontPreset: subtitleFont,
      fontWeight: subtitleWeight,
      fontSize: subtitleSize,
      primaryColor: subtitleColor,
      secondaryColor: subtitleSecondaryColor,
      outlineColor: subtitleOutlineColor,
      outlineWidth: subtitleOutlineWidth,
      verticalOffset: subtitleVerticalOffset,
      shadow: {
        enabled: subtitleShadowEnabled,
        color: subtitleShadowColor,
        opacity: subtitleShadowOpacity,
        offsetX: subtitleShadowOffsetX,
        offsetY: subtitleShadowOffsetY,
        blur: subtitleShadowBlur
      }
    } as const;
    const next = {
      sourceType,
      sourceUrl: videoUrl,
      ...(shouldPersistSourceFile
        ? {
            sourceFileName: sourceType === 'file' ? videoFileName : null,
            sourceFileSize: sourceType === 'file' ? videoFileSize : null,
            sourceFileLastModified: sourceType === 'file' ? videoFileLastModified : null
          }
        : {}),
      sourceLanguage,
      targetLanguage,
      bilingual,
      subtitlePosition,
      preferPlatformCaptions,
      skipVideoDownload,
      subtitleStyle,
      dubbing,
      ttsProvider,
      ttsModel,
      voiceCode,
      voiceName,
      composeVideo,
      videoFormat,
      sourceOrientation,
      verticalTitle,
      verticalSubtitle,
      currentStep,
      furthestStep,
      workspacePhase,
      latestResultVersion: resultVersions.at(-1)?.value ?? null,
      resultTab,
      resultVersions: serializeResultVersions(resultVersions),
      draftBaseVersion: draftBaseVersion ?? null
    } as const;
    const patch = Object.fromEntries(Object.entries(next).filter(([key, value]) => (
      JSON.stringify(creatorSession.state[key]) !== JSON.stringify(value)
    )));
    if (Object.keys(patch).length === 0) return;
    if (skipPersist) {
      if (creatorSession.job.id.startsWith('pending:')) {
        creatorSession.updateDraft(patch, { persist: false });
      }
      return;
    }
    creatorSession.updateDraft(patch);
  }, [
    bilingual,
    composeVideo,
    creatorSession,
    currentStep,
    dubbing,
    furthestStep,
    preferPlatformCaptions,
    skipVideoDownload,
    resultTab,
    resultVersion,
    resultVersions,
    sourceLanguage,
    sourceOrientation,
    sourceType,
    subtitleColor,
    subtitleFont,
    subtitleOutlineColor,
    subtitleOutlineWidth,
    subtitleVerticalOffset,
    subtitleSecondaryColor,
    subtitleShadowBlur,
    subtitleShadowColor,
    subtitleShadowEnabled,
    subtitleShadowOffsetX,
    subtitleShadowOffsetY,
    subtitleShadowOpacity,
    subtitleSize,
    subtitleWeight,
    subtitlePosition,
    targetLanguage,
    ttsModel,
    ttsProvider,
    verticalSubtitle,
    verticalTitle,
    videoFormat,
    videoFileLastModified,
    videoFileName,
    videoFileSize,
    videoUrl,
    voiceCode,
    voiceName,
    workspacePhase,
    draftBaseVersion
  ]);

  useEffect(() => {
    if (sourceOrientation === 'portrait' && videoFormat !== 'vertical') {
      setVideoFormat('vertical');
    }
  }, [sourceOrientation, videoFormat]);

  useEffect(() => {
    if (!cancelDialogOpen) return;
    cancelConfirmRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setCancelDialogOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cancelDialogOpen]);

  const jobArtifacts = creatorSession?.job.artifacts ?? [];
  const currentSourceIdentity = sourceType === 'url' ? videoSourceIdentity(videoUrl) : null;
  const currentSourcePreviewArtifact = currentSourceIdentity === null ? undefined : [...jobArtifacts].reverse().find(artifact => {
    if (artifact.kind !== 'source_video' || artifact.status !== 'completed') return false;
    const settings = artifact.metadata.settingsSnapshot;
    const url = settings !== null && typeof settings === 'object' && !Array.isArray(settings)
      ? settings.sourceUrl : artifact.metadata.sourceUrl;
    return typeof url === 'string' && videoSourceIdentity(url) === currentSourceIdentity;
  });
  const [draftPreviewRequest, setDraftPreviewRequest] = useState<{ url: string; pending: boolean; error?: string }>();
  const [draftSourcePreview, setDraftSourcePreview] = useState<{ artifactId: string; src?: string; loading: boolean; error?: string }>();
  const [draftPreviewReload, setDraftPreviewReload] = useState(0);
  const currentSourcePreviewArtifactId = currentSourcePreviewArtifact?.id;
  useEffect(() => {
    const { session, localize } = mediaPreviewContextRef.current;
    if (workspacePhase !== 'configure' || currentSourcePreviewArtifactId === undefined || session === null || !canOpenMediaPreview) {
      setDraftSourcePreview(undefined);
      return;
    }
    let canceled = false;
    let objectUrl: string | undefined;
    setDraftSourcePreview({ artifactId: currentSourcePreviewArtifactId, loading: true });
    void createCreatorArtifactObjectUrl(session, currentSourcePreviewArtifactId,
      'video-translation.load-source-preview', localize('原视频预览加载失败，请重试。', 'Source video preview failed to load. Try again.'))
      .then(src => {
        objectUrl = src;
        if (canceled) { URL.revokeObjectURL(src); return; }
        setDraftSourcePreview({ artifactId: currentSourcePreviewArtifactId, src, loading: false });
      }).catch(() => {
        if (!canceled) setDraftSourcePreview({ artifactId: currentSourcePreviewArtifactId, loading: false, error: 'load' });
      });
    return () => {
      canceled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [workspacePhase, currentSourcePreviewArtifactId, canOpenMediaPreview, mediaPreviewJobId, draftPreviewReload]);
  const currentDraftSourcePreview = draftSourcePreview?.artifactId === currentSourcePreviewArtifactId ? draftSourcePreview : undefined;
  const draftPreviewStage = [...(creatorSession?.job.stages ?? [])].reverse().find(stage =>
    stage.stageId === 'preview-source-video' && stage.progress.previewSourceUrl === videoUrl);
  const draftPreviewPending = (draftPreviewRequest?.url === videoUrl && draftPreviewRequest.pending)
    || draftPreviewStage?.status === 'queued' || draftPreviewStage?.status === 'running' || currentDraftSourcePreview?.loading === true;
  const draftPreviewError = draftPreviewRequest?.url === videoUrl && draftPreviewRequest.error
    ? draftPreviewRequest.error
    : currentDraftSourcePreview?.error
      ? l('原视频预览加载失败，请重试。', 'Source video preview failed to load. Try again.')
      : draftPreviewStage?.status === 'failed'
        ? draftPreviewStage.errorMessage ?? l('视频下载失败，请重试。', 'Video download failed. Try again.')
        : draftPreviewStage?.status === 'canceled' || draftPreviewStage?.status === 'interrupted'
          ? l('视频预览准备已停止，可以重试。', 'Video preview preparation stopped. You can retry.') : undefined;
  const registeredSourceArtifactId = creatorSession?.state.sourceArtifactId;
  const registeredSourceArtifact = (
    typeof registeredSourceArtifactId === 'string'
      ? jobArtifacts.find(artifact => artifact.id === registeredSourceArtifactId)
      : undefined
  ) ?? [...jobArtifacts].reverse().find(artifact => (
    artifact.kind === 'source_video'
    && artifact.status === 'completed'
    && artifact.metadata.source === 'local-upload'
  ));
  const registeredSourceFile = registeredSourceArtifact === undefined
    ? undefined
    : {
        name: readArtifactString(registeredSourceArtifact, 'fileName') ?? 'local-video',
        size: readArtifactNumber(registeredSourceArtifact, 'size') ?? 0,
        mime: readArtifactString(registeredSourceArtifact, 'mimeType') ?? 'application/octet-stream'
      };
  const previewPosterUrl = sourceType === 'url'
    ? currentUrlMetadata?.thumbnailUrl
      ?? (parsedVideoSource.kind === 'youtube' ? parsedVideoSource.thumbnailUrl : undefined)
    : undefined;
  const previewVerticalOutput = videoFormat === 'vertical' || videoFormat === 'all';
  const selectedFileRegistered = videoFile !== null
    && registeredSourceArtifact !== undefined
    && sourceArtifactMatchesFile(registeredSourceArtifact, videoFile);
  const importedSourceSubtitle = creatorSession?.job.artifacts.find(artifact => artifact.id === creatorSession.state.importedSourceSubtitleId
    && artifact.kind === 'source_subtitle' && artifact.status === 'completed');
  const hasSource = subtitleOnly ? importedSourceSubtitle !== undefined : sourceType === 'url'
    ? isValidVideoUrl(videoUrl)
    : videoFile !== null || videoFileName !== null || registeredSourceArtifact !== undefined;
  const latestStage = creatorSession?.job.stages.filter(stage => !['preview-source-video', 'prepare-source-video'].includes(stage.stageId)).at(-1)
    ?? creatorSession?.job.stages.at(-1);
  const activeGenerationStage = [...(creatorSession?.job.stages ?? [])].reverse().find(stage => (
    !['preview-source-video', 'prepare-source-video'].includes(stage.stageId) && ['queued', 'running'].includes(stage.status)
  ));
  const activeStage = activeGenerationStage ?? [...(creatorSession?.job.stages ?? [])].reverse().find(stage => (
    stage.status === 'queued' || stage.status === 'running'
  ));
  const resumableStage = activeStage === undefined
    && (latestStage?.status === 'canceled' || latestStage?.status === 'interrupted')
    ? latestStage
    : undefined;
  const taskProgress = useCreatorTaskProgress({
    starting: submitting || outputRequest !== undefined,
    onCompleted: (version, key, stageId) => {
      if (version !== undefined && stageId.startsWith('render-')) {
        setResultVersion(version);
        setVideoPreviewRequest({ version, key });
      }
    }
  });
  const rawStageFailure = latestStage?.status === 'failed' && !['preview-source-video', 'prepare-source-video'].includes(latestStage.stageId)
    ? latestStage
    : undefined;
  const rawStageConfigurationCode = normalizeStageConfigurationError(
    rawStageFailure?.errorCode,
    rawStageFailure?.errorMessage
  );
  const stageFailure = !dubbing && rawStageConfigurationCode === 'creator_tts_config_missing'
    ? undefined
    : rawStageFailure;
  const stageConfigurationCode = normalizeStageConfigurationError(
    stageFailure?.errorCode,
    stageFailure?.errorMessage
  );
  const rawSessionError = creatorSession?.error ?? null;
  const sessionError = !dubbing && rawSessionError?.code === 'creator_tts_config_missing'
    ? null
    : rawSessionError;
  const needsInput = readCreatorNeedsInput(creatorSession?.state.needsInput, dubbing);
  const runIssueMessage = sessionError !== null
    ? creatorErrorMessage(sessionError, l)
    : needsInput !== null
      ? creatorErrorMessage(needsInput, l)
      : stageFailure !== undefined
        ? stageErrorMessage(stageFailure.errorCode, stageFailure.errorMessage, l)
        : resumableStage !== undefined
          ? l(
              `任务已终止，可从“${translationStageLabel(resumableStage.stageId, l)}”重新开始`,
              `The task stopped and can restart from "${translationStageLabel(resumableStage.stageId, l)}"`
            )
        : '';
  useEffect(() => {
    if (!startRevisionConflict || activeStage === undefined) return;
    setStartRevisionConflict(false);
    if (creatorSession?.error?.code === 'creator_revision_conflict') {
      creatorSession.clearError();
    }
    setWorkspacePhase('result');
    setDraftBaseVersion(undefined);
    setResultNotice(translationStartedNotice);
  }, [
    activeStage,
    creatorSession,
    translationStartedNotice,
    startRevisionConflict
  ]);
  const sourceName = subtitleOnly ? artifactFileName(importedSourceSubtitle) ?? l('等待上传字幕', 'Waiting for subtitles') : sourceType === 'url'
    ? (videoUrl.trim() || l('等待填写链接', 'Waiting for a link'))
    : (videoFile?.name
      ?? videoFileName
      ?? registeredSourceFile?.name
      ?? l('等待上传视频', 'Waiting for an upload'));
  const initialTranslation = workspacePhase === 'configure' && draftBaseVersion === undefined;
  const outputLabel = outputLabelFor({ composeVideo: composeVideo && !initialTranslation, videoFormat }, l);
  const subtitleStyleLabel = `${subtitleFontLabel(subtitleFont, l)} · ${subtitleWeightLabel(subtitleWeight, l)} · ${subtitleSizeLabel(subtitleSize, l)} · ${subtitleColor.toUpperCase()}`;
  const summaryItems = useMemo(() => [
    { label: l('翻译语言', 'Languages'), value: `${languageLabel(sourceLanguages, sourceLanguage)} → ${languageLabel(targetLanguages, targetLanguage)}` },
    { label: l('字幕', 'Subtitles'), value: bilingual ? l(`双语 · 译文在${subtitlePosition === 'top' ? '上' : '下'}`, `Bilingual · translation ${subtitlePosition === 'top' ? 'above' : 'below'}`) : l('仅译文', 'Translation only') },
    ...(composeVideo && !initialTranslation ? [{ label: l('字幕样式', 'Subtitle style'), value: subtitleStyleLabel }] : []),
    ...(!initialTranslation && (composeVideo || dubbing) ? [{ label: l('配音', 'Dubbing'), value: dubbing ? (voiceName.trim() || voiceCode.trim() || l('自动匹配音色', 'Auto-match voice')) : l('关闭', 'Off') }] : []),
    { label: l('输出', 'Output'), value: outputLabel }
  ], [bilingual, composeVideo, dubbing, initialTranslation, l, outputLabel, sourceLanguage, subtitlePosition, subtitleStyleLabel, targetLanguage, voiceCode, voiceName]);
  const targetLanguageLabel = languageLabel(targetLanguages, targetLanguage);
  const selectedResult = resultVersions.find(version => version.value === resultVersion);
  const selectedSubtitleOnly = (selectedResult?.source.sourceType ?? sourceType) === 'subtitle';
  const selectedResultState = readCreatorResultSnapshots(creatorSession?.state.resultSnapshots)
    .find(snapshot => snapshot.version === selectedResult?.value)?.state;
  const resultModelChoices = selectedResultState?.officialModels;
  const resultTextModel = resultModelChoices && typeof resultModelChoices === 'object' && !Array.isArray(resultModelChoices)
    && typeof resultModelChoices.text === 'string' ? resultModelChoices.text : undefined;
  const resultTranscriptionModel = resultModelChoices && typeof resultModelChoices === 'object' && !Array.isArray(resultModelChoices)
    && typeof resultModelChoices.transcription === 'string' ? resultModelChoices.transcription : undefined;
  // Older versions may not record model choices. Merely opening them must not request regeneration.
  const baselineKey = `${creatorSession?.job.id}:${selectedResult?.value}`;
  if (selectedResult && !legacyModelBaselines.current.has(baselineKey)
    && (officialText.selectable || officialTranscription.selectable)) {
    legacyModelBaselines.current.set(baselineKey, { text: officialText.selected, transcription: officialTranscription.selected });
  }
  const legacyBaseline = legacyModelBaselines.current.get(baselineKey);
  const baselineTextModel = resultTextModel ?? (legacyBaseline ? legacyBaseline.text : officialText.selected);
  const baselineTranscriptionModel = resultTranscriptionModel ?? (legacyBaseline ? legacyBaseline.transcription : officialTranscription.selected);
  const transcriptionModelChanged = officialTranscription.official && selectedResult !== undefined && !selectedSubtitleOnly
    && officialTranscription.selected !== undefined && !gatewayModelIdMatches(officialTranscription.selected, baselineTranscriptionModel);
  const subtitleModelChanged = transcriptionModelChanged || (officialText.official && selectedResult !== undefined && !selectedSubtitleOnly
    && officialText.selected !== undefined && !gatewayModelIdMatches(officialText.selected, baselineTextModel));
  const generationStage = [...(creatorSession?.job.stages ?? [])].reverse().find(stage => (
    ['subtitle', 'tts', 'render-horizontal', 'render-vertical'].includes(stage.stageId)
  ));
  const generationVersion = generationStage === undefined ? undefined
    : readPositiveResultVersion(generationStage.progress.targetResultVersion)
      ?? readPositiveResultVersion(generationStage.progress.resultVersion)
      ?? (typeof generationStage.progress.baseResultVersion === 'number'
        ? (resultVersions.at(-1)?.value ?? 0) + 1
        : selectedResult === undefined ? resultVersion : undefined);
  const generationStatus = creatorSession?.job.status === 'needs_input'
    ? 'needs_input' as const
    : creatorSession?.job.status === 'running' && generationStage?.status === 'succeeded' && activeStage === undefined
      ? 'running' as const : generationStage?.status;
  const resultExecution = generationVersion === resultVersion && generationStage !== undefined
    && generationStatus !== undefined && generationStatus !== 'succeeded'
    ? { status: generationStatus, stageLabel: generationStage.status === 'succeeded' && generationStatus === 'running'
        ? l('准备下一阶段', 'Preparing the next stage')
        : translationStageLabel(generationStage.stageId, l) }
    : undefined;
  const selectedResultSettings = selectedResult?.settings;
  const selectedVideoArtifacts = videoArtifactsForResultVersion(
    jobArtifacts,
    resultVersion,
    creatorSession?.state.resultSnapshots
  );
  const finalVideoEntries = (['horizontal', 'vertical'] as const).flatMap(variant => {
    const artifact = selectedVideoArtifacts[variant];
    return artifact === undefined ? [] : [{ variant, artifact }];
  });
  const selectedVideoEntries = [
    ...finalVideoEntries,
    ...(selectedVideoArtifacts.dubbed === undefined
      ? []
      : [{ variant: 'dubbed' as const, artifact: selectedVideoArtifacts.dubbed }])
  ];
  const selectedVoiceArtifact = latestArtifactForResultVersion(
    jobArtifacts,
    resultVersion,
    ['dubbed_audio'],
    creatorSession?.state.resultSnapshots
  );
  const taskVideoVersion = taskProgress?.workflow?.resultVersion;
  const taskVideoArtifacts = taskVideoVersion === undefined ? undefined
    : videoArtifactsForResultVersion(jobArtifacts, taskVideoVersion, creatorSession?.state.resultSnapshots);
  const taskVideoArtifact = taskVideoArtifacts?.horizontal ?? taskVideoArtifacts?.vertical;
  speechBusyRef.current = speechSyncing || submitting || activeGenerationStage !== undefined;
  // Only real dubbing outputs make a version's speech settings historical.
  const speechContext = `${creatorSession?.job.id ?? 'draft'}:${resultVersion}:${selectedVoiceArtifact?.id ?? selectedVideoArtifacts.dubbed?.id ?? 'no-speech'}`;
  if (speechSelectionRef.current?.context !== speechContext) {
    speechSelectionRef.current = { context: speechContext, followSettings: !selectedVoiceArtifact && !selectedVideoArtifacts.dubbed };
  }

  function applySpeechSettings(speech: TranslationSpeechSettings) {
    speechDraftRef.current = speech;
    setTtsProvider(speech.ttsProvider);
    setTtsModel(speech.ttsModel);
    setVoiceCode(speech.voiceCode);
    setVoiceName(speech.voiceName);
  }

  function resolveSpeechSettings(config: CreatorServicesConfig['tts'], useCurrentSettings = false): TranslationSpeechSettings {
    const provider = config.provider;
    const defaults = provider === 'edge-tts' ? undefined : config[provider];
    const nextDefaults = { ttsProvider: provider, ttsModel: defaults?.model ?? '',
      voiceCode: defaults?.defaultVoiceId ?? '', voiceName: defaults?.defaultVoiceId ?? '' };
    const selection = speechSelectionRef.current!;
    if (useCurrentSettings) selection.followSettings = true;
    const changed = !selection.defaults || selection.defaults.ttsProvider !== nextDefaults.ttsProvider
      || selection.defaults.ttsModel !== nextDefaults.ttsModel || selection.defaults.voiceCode !== nextDefaults.voiceCode;
    let speech = speechDraftRef.current;
    if (useCurrentSettings || (selection.followSettings && changed)) {
      speech = nextDefaults;
    } else {
      const savedDefaults = speech.ttsProvider === 'edge-tts' ? undefined : config[speech.ttsProvider];
      speech = { ...speech, ttsModel: speech.ttsProvider === 'edge-tts' ? '' : speech.ttsModel.trim() || savedDefaults?.model || '',
        voiceCode: speech.voiceCode.trim() || savedDefaults?.defaultVoiceId || '',
        voiceName: speech.voiceName.trim() || speech.voiceCode.trim() || savedDefaults?.defaultVoiceId || '' };
    }
    const voiceSelection = speechVoiceSelectionRef.current;
    if (selection.followSettings && voiceSelection && typeof voiceSelection === 'object' && !Array.isArray(voiceSelection)
      && voiceSelection.resultVersion === resultVersion) {
      if (!useCurrentSettings && voiceSelection.ttsProvider === speech.ttsProvider && voiceSelection.ttsModel === speech.ttsModel
        && typeof voiceSelection.voiceCode === 'string' && voiceSelection.voiceCode.trim()) {
        speech = { ...speech, voiceCode: voiceSelection.voiceCode,
          voiceName: typeof voiceSelection.voiceName === 'string' ? voiceSelection.voiceName : voiceSelection.voiceCode };
      } else {
        speechVoiceSelectionRef.current = null;
        creatorSession?.updateDraft({ ttsVoiceSelection: null });
      }
    }
    selection.defaults = nextDefaults;
    setSpeechDefaults(nextDefaults);
    applySpeechSettings(speech);
    return speech;
  }

  useEffect(() => {
    if (!dubbing) return;
    if (officialSpeech.official) {
      const voices = officialSpeech.model?.voices ?? [];
      const voice = voices.includes(speechDraftRef.current.voiceCode) ? speechDraftRef.current.voiceCode : voices[0] ?? '';
      applySpeechSettings({ ttsProvider: 'openai', ttsModel: officialSpeech.model?.id ?? '', voiceCode: voice, voiceName: voice });
      return;
    }
    const service = props.creatorServicesService;
    if (!service) return;
    let active = true;
    const refresh = () => {
      if (speechBusyRef.current) return;
      const request = ++speechConfigRequestRef.current;
      void service.getConfig().then(({ config }) => {
        if (active && request === speechConfigRequestRef.current && !speechBusyRef.current) resolveSpeechSettings(config.tts);
      }).catch(cause => {
        if (active && request === speechConfigRequestRef.current) creatorSession?.captureCreatorFailure(
          'video-translation.load-service-config', cause,
          l('无法读取配音服务配置，请稍后重试。', 'Could not load dubbing settings. Try again later.'), 'client');
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [dubbing, speechContext, props.creatorServicesService, officialSpeech.official, officialSpeech.model?.id]);

  async function useCurrentSpeechSettings() {
    const service = props.creatorServicesService;
    if (!service) return;
    const context = speechContext;
    const request = ++speechConfigRequestRef.current;
    setSpeechSyncing(true);
    try {
      const { config } = await service.getConfig();
      if (speechSelectionRef.current?.context === context && request === speechConfigRequestRef.current) resolveSpeechSettings(config.tts, true);
    } catch (cause) { setResultNotice(creatorErrorMessage(cause, l)); }
    finally { setSpeechSyncing(false); }
  }

  const selectedSubtitleArtifacts = subtitleArtifactsForResultVersion(
    jobArtifacts,
    resultVersion,
    creatorSession?.state.resultSnapshots,
    { bilingual: false }
  );
  // Dubbed renders share the TTS-aligned target track; the old vertical SRT is no longer an output subtitle.
  if (selectedVideoArtifacts.dubbed !== undefined) selectedSubtitleArtifacts.vertical = undefined;
  const selectedTargetSubtitleArtifact = latestArtifactForResultVersion(
    jobArtifacts,
    resultVersion,
    ['target_subtitle'],
    creatorSession?.state.resultSnapshots
  );
  const selectedVerticalSubtitleArtifact = latestArtifactForResultVersion(
    jobArtifacts,
    resultVersion,
    ['vertical_subtitle'],
    creatorSession?.state.resultSnapshots
  );
  const selectedSourceSubtitleArtifact = latestArtifactForResultVersion(
    jobArtifacts,
    resultVersion,
    ['source_subtitle'],
    creatorSession?.state.resultSnapshots
  );
  const selectedSourceVideoArtifact = latestArtifactForResultVersion(
    jobArtifacts,
    resultVersion,
    ['source_video'],
    creatorSession?.state.resultSnapshots
  );
  const subtitleVideoArtifacts: Partial<Record<SubtitleResultVariant, CreatorArtifact>> = {
    horizontal: selectedSubtitleArtifacts.horizontal === undefined
      ? undefined
      : selectedVideoArtifacts.dubbed ?? selectedSourceVideoArtifact ?? selectedVideoArtifacts.horizontal,
    vertical: selectedSubtitleArtifacts.vertical === undefined
      ? undefined
      : selectedSourceVideoArtifact ?? selectedVideoArtifacts.vertical
  };
  const hasVoiceArtifact = selectedVoiceArtifact !== undefined;
  const [videoPreviews, setVideoPreviews] = useState<Record<string, {
    src?: string;
    loading: boolean;
    error?: { cause: unknown };
  }>>({});
  const openArtifact = creatorSession?.openArtifact;
  const previewArtifacts = [...new Map([
    ...selectedVideoEntries.map(({ artifact }) => artifact),
    ...Object.values(subtitleVideoArtifacts).filter((artifact): artifact is CreatorArtifact => artifact !== undefined)
  ].map(artifact => [artifact.id, artifact])).values()];
  const selectedVideoArtifactIds = JSON.stringify(previewArtifacts.map(artifact => artifact.id).sort());
  useEffect(() => {
    const { session, localize } = mediaPreviewContextRef.current;
    const artifacts = previewArtifacts;
    if (artifacts.length === 0 || session === null || !canOpenMediaPreview) {
      setVideoPreviews({});
      return;
    }
    let canceled = false;
    const objectUrls: string[] = [];
    setVideoPreviews(Object.fromEntries(artifacts.map(artifact => [
      artifact.id,
      { loading: true }
    ])));
    for (const artifact of artifacts) {
      void createCreatorArtifactObjectUrl(
        session,
        artifact.id,
        'video-translation.load-video-preview',
        localize('视频预览加载失败，请稍后重试。', 'The video preview failed to load. Try again later.')
      )
        .then(objectUrl => {
          if (canceled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          objectUrls.push(objectUrl);
          setVideoPreviews(current => ({
            ...current,
            [artifact.id]: { src: objectUrl, loading: false }
          }));
        })
        .catch(cause => {
          if (canceled) return;
          setVideoPreviews(current => ({
            ...current,
            [artifact.id]: { loading: false, error: { cause } }
          }));
        });
    }
    return () => {
      canceled = true;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [canOpenMediaPreview, mediaPreviewJobId, selectedVideoArtifactIds]);
  const [voicePreview, setVoicePreview] = useState<{
    src?: string;
    loading: boolean;
    error?: { cause: unknown };
  }>({ loading: false });
  const selectedVoiceArtifactId = selectedVoiceArtifact?.id;
  useEffect(() => {
    const { session, localize } = mediaPreviewContextRef.current;
    if (
      (resultTab !== 'voice' && !(subtitleImmersive && resultTab === 'subtitles'))
      || selectedVoiceArtifactId === undefined
      || session === null || !canOpenMediaPreview
    ) {
      setVoicePreview({ loading: false });
      return;
    }
    let canceled = false;
    let objectUrl: string | undefined;
    setVoicePreview({ loading: true });
    void createCreatorArtifactObjectUrl(
      session,
      selectedVoiceArtifactId,
      'video-translation.load-voice-preview',
      localize('配音预览加载失败，请稍后重试。', 'The dubbing preview failed to load. Try again later.')
    )
      .then(url => {
        objectUrl = url;
        if (canceled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setVoicePreview({ src: objectUrl, loading: false });
      })
      .catch(cause => {
        if (canceled) return;
        setVoicePreview({
          loading: false,
          error: { cause }
        });
      });
    return () => {
      canceled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [canOpenMediaPreview, mediaPreviewJobId, resultTab, subtitleImmersive, selectedVoiceArtifactId, voicePreviewReload]);
  const selectedResultSource = selectedResult?.source;
  const selectedSubtitleCues = selectedResult?.subtitleCues ?? [];
  const horizontalSubtitleDraftKey = subtitleDraftKey(resultVersion, 'horizontal');
  const verticalSubtitleDraftKey = subtitleDraftKey(resultVersion, 'vertical');
  const baseHorizontalSubtitleCues = subtitleCuesWithSource(
    selectedSubtitleCues,
    selectedSourceSubtitleArtifact,
    selectedSubtitleOnly || subtitleImmersive || selectedResultSettings?.bilingual === true
      || selectedVideoArtifacts.dubbed !== undefined
  );
  const baseVerticalSubtitleCues = subtitleCuesFromArtifact(selectedVerticalSubtitleArtifact);
  const displayedHorizontalSubtitleCues = subtitleDrafts[horizontalSubtitleDraftKey] ?? baseHorizontalSubtitleCues;
  const displayedVerticalSubtitleCues = subtitleDrafts[verticalSubtitleDraftKey] ?? baseVerticalSubtitleCues;
  const videoOutputs: VideoResultOutput[] = selectedVideoEntries.map(({ variant, artifact }) => {
    const preview = videoPreviews[artifact.id];
    return {
      artifactId: artifact.id,
      variant,
      artifactVersion: artifact.version,
      fileName: artifactFileName(artifact),
      src: preview?.src,
      previewLoading: preview?.loading ?? openArtifact !== undefined,
      previewError: preview?.error ? mediaPreviewErrorMessage('video', l) : undefined
    };
  });
  const subtitleOutputs: SubtitleResultOutput[] = subtitleResultVariantOrder.flatMap(variant => {
    const artifact = selectedSubtitleArtifacts[variant];
    if (artifact === undefined) return [];
    return [{
      artifactId: artifact.id,
      variant,
      artifactVersion: artifact.version,
      fileName: artifactFileName(artifact),
      cues: variant === 'horizontal' ? displayedHorizontalSubtitleCues : displayedVerticalSubtitleCues,
      readOnly: false,
      translationPosition: variant === 'horizontal' && selectedResultSettings?.bilingual === true
        ? selectedResultSettings.subtitlePosition
        : undefined
    }];
  });
  const subtitleVideoPreviews = Object.fromEntries(subtitleResultVariantOrder.flatMap(variant => {
    const artifact = subtitleVideoArtifacts[variant];
    if (artifact === undefined) return [];
    const preview = videoPreviews[artifact.id];
    return [[variant, {
      artifactId: artifact.id,
      src: preview?.src,
      previewLoading: preview?.loading ?? openArtifact !== undefined,
      previewError: preview?.error ? mediaPreviewErrorMessage('video', l) : undefined,
      source: artifact.kind === 'source_video',
      needsSubtitleOverlay: artifact.kind === 'source_video' || artifact.kind === 'dubbed_video'
    } satisfies SubtitleVideoPreview]];
  })) as Partial<Record<SubtitleResultVariant, SubtitleVideoPreview>>;
  const selectedPreviewStage = [...(creatorSession?.job.stages ?? [])].reverse().find(stage =>
    (stage.stageId === 'prepare-source-video' && stage.progress.inputResultVersion === resultVersion)
      || (stage.stageId === 'preview-source-video' && stage.progress.backgroundSourceDownload === true
        && typeof stage.progress.previewSourceUrl === 'string' && selectedResultSource?.sourceType === 'url'
        && videoSourceIdentity(stage.progress.previewSourceUrl) === videoSourceIdentity(selectedResultSource.videoUrl)));
  const sourcePreviewPending = (previewRequest?.version === resultVersion && previewRequest.pending)
    || selectedPreviewStage?.status === 'queued' || selectedPreviewStage?.status === 'running';
  const sourcePreviewError = previewRequest?.version === resultVersion && previewRequest.error
    ? l('无法启动原视频准备，请检查诊断信息后重试。', 'Could not start source video preparation. Check the diagnostics and retry.')
    : selectedPreviewStage?.status === 'failed'
      ? l('原视频准备失败，已完成的字幕仍可编辑和下载。', 'Source video preparation failed. Existing subtitles remain editable and downloadable.')
      : selectedPreviewStage?.status === 'canceled' || selectedPreviewStage?.status === 'interrupted'
        ? l('原视频准备已停止，已有字幕会保留，可以重新下载。', 'Source video preparation stopped. Existing subtitles are preserved; you can retry.') : undefined;
  const sourcePreviewErrorDetail = previewRequest?.version === resultVersion && previewRequest.error
    ? previewRequest.error : selectedPreviewStage?.status === 'failed' ? selectedPreviewStage.errorMessage ?? undefined : undefined;
  const canPrepareSourcePreview = creatorSession !== null && selectedResultSource?.sourceType === 'url'
    && videoSourceIdentity(selectedResultSource.videoUrl) !== null;
  const voiceOutput: VoiceResultOutput | undefined = selectedVoiceArtifact === undefined
    ? undefined
    : {
        artifactId: selectedVoiceArtifact.id,
        artifactVersion: selectedVoiceArtifact.version,
        fileName: artifactFileName(selectedVoiceArtifact),
        src: voicePreview.src,
        previewLoading: voicePreview.loading,
        previewError: voicePreview.error ? mediaPreviewErrorMessage('voice', l) : undefined
      };
  const selectedTargetLanguageLabel = selectedResultSettings
    ? languageLabel(targetLanguages, selectedResultSettings.targetLanguage)
    : targetLanguageLabel;
  const selectedOutputLabel = selectedResultSettings
    ? outputLabelFor(selectedResultSettings, l)
    : outputLabel;
  const selectedSubtitleStyleLabel = selectedResultSettings
    ? `${subtitleFontLabel(selectedResultSettings.subtitleFont, l)} · ${subtitleWeightLabel(selectedResultSettings.subtitleWeight, l)} · ${subtitleSizeLabel(selectedResultSettings.subtitleSize, l)} · ${selectedResultSettings.subtitleColor.toUpperCase()}`
    : subtitleStyleLabel;
  const selectedSourceName = selectedResultSource === undefined ? sourceName : selectedResultSource.sourceType === 'subtitle'
    ? selectedResultSource.subtitleFileName ?? sourceName : selectedResultSource.sourceType === 'url'
    ? (selectedResultSource.videoUrl.trim() || l('等待填写链接', 'Waiting for a link'))
    : (selectedResultSource?.videoFile?.name
      ?? selectedResultSource?.videoFileName
      ?? l('等待上传视频', 'Waiting for an upload'));
  const subtitleDirtyByVariant: Partial<Record<SubtitleResultVariant, boolean>> = {
    horizontal: !sameSubtitleCues(baseHorizontalSubtitleCues, displayedHorizontalSubtitleCues),
    vertical: !sameSubtitleCues(baseVerticalSubtitleCues, displayedVerticalSubtitleCues)
  };
  const subtitleDirty = subtitleDirtyByVariant.horizontal === true;
  const subtitleNeedsRegeneration = !selectedSubtitleOnly && selectedResult
    ? JSON.stringify(stripSubtitleSourceText(displayedHorizontalSubtitleCues))
      !== selectedResult.generatedSubtitleSnapshot
    : false;
  const selectedHasStaleArtifacts = !selectedSubtitleOnly && (selectedResult?.staleArtifactIds.length ?? 0) > 0;
  const staleArtifactKinds = new Set(
    (selectedResult?.staleArtifactIds ?? []).flatMap(id => {
      const artifact = jobArtifacts.find(candidate => candidate.id === id);
      return artifact === undefined ? [] : [artifact.kind];
    })
  );
  const reusableDubbedAudio = selectedVoiceArtifact?.status === 'completed'
    && !staleArtifactKinds.has('dubbed_audio');
  const reusableDubbedVideo = selectedVideoArtifacts.dubbed?.status === 'completed'
    && !staleArtifactKinds.has('dubbed_video');
  const currentResultNotice = resultNotice === translationStartedNotice
    && resultExecution?.status !== 'running' && resultExecution?.status !== 'queued'
    ? '' : resultNotice;
  const translationReportNotice = videoTranslationReportNotice(selectedSubtitleArtifacts.horizontal, l);
  const visibleResultNotice = [currentResultNotice, translationReportNotice].filter(Boolean).join(' · ');
  const nextVersion = resultVersions.reduce((highest, version) => Math.max(highest, version.value), 0) + 1;
  const selectedSubtitleContextLabel = subtitleOutputs.length > 1
    ? l('横屏与竖屏字幕', 'Horizontal and vertical subtitles')
    : subtitleOutputs[0]?.variant === 'vertical'
      ? l('竖屏字幕', 'Vertical subtitles')
      : l('横屏字幕', 'Horizontal subtitles');
  const agentContextSummary = workspacePhase === 'result'
    ? `${resultTab === 'video'
      ? l('作品', 'Works')
      : resultTab === 'subtitles'
        ? selectedSubtitleContextLabel
        : l('配音', 'Dubbing')} V${resultVersion}`
    : currentStep === 0
      ? sourceName
      : currentStep === 1
        ? `${languageLabel(sourceLanguages, sourceLanguage)} → ${targetLanguageLabel}`
        : composeVideo
          ? `${outputLabel} · ${subtitleStyleLabel} · ${dubbing ? l('配音开启', 'Dubbing on') : l('无配音', 'No dubbing')}`
          : outputLabel;
  function openWizardStep(step: WizardStep) {
    if (step > 0 && !sourceSelectionReady) {
      setCurrentStep(0);
      setAttemptedContinue(true);
      return;
    }
    step = Math.min(step, steps.length - 1) as WizardStep;
    setCurrentStep(step);
    setFurthestStep(previous => Math.max(previous, step) as WizardStep);
  }

  function currentDraftSettings(): TranslationSettingsSnapshot {
    return {
      sourceLanguage,
      targetLanguage,
      bilingual,
      subtitlePosition,
      preferPlatformCaptions,
      subtitleFont,
      subtitleWeight,
      subtitleSize,
      subtitleColor,
      subtitleSecondaryColor,
      subtitleOutlineColor,
      subtitleOutlineWidth,
      subtitleVerticalOffset,
      subtitleShadowEnabled,
      subtitleShadowColor,
      subtitleShadowOpacity,
      subtitleShadowOffsetX,
      subtitleShadowOffsetY,
      subtitleShadowBlur,
      dubbing,
      ttsProvider,
      ttsModel,
      voiceCode,
      voiceName,
      composeVideo,
      videoFormat,
      verticalTitle,
      verticalSubtitle
    };
  }

  function currentDraftSource(): TranslationSourceSnapshot {
    return {
      sourceType,
      ...(subtitleOnly && importedSourceSubtitle ? { subtitleArtifactId: importedSourceSubtitle.id, subtitleFileName: artifactFileName(importedSourceSubtitle) } : {}),
      videoUrl,
      videoFile,
      videoFileName,
      videoFileSize,
      videoFileLastModified
    };
  }

  function applySettingsSnapshot(settings: TranslationSettingsSnapshot) {
    setSourceLanguage(settings.sourceLanguage);
    setTargetLanguage(settings.targetLanguage);
    setBilingual(settings.bilingual);
    setSubtitlePosition(settings.subtitlePosition);
    setPreferPlatformCaptions(settings.preferPlatformCaptions);
    setSubtitleFont(settings.subtitleFont);
    setSubtitleWeight(settings.subtitleWeight);
    setSubtitleSize(settings.subtitleSize);
    setSubtitleColor(settings.subtitleColor);
    setSubtitleSecondaryColor(settings.subtitleSecondaryColor);
    setSubtitleOutlineColor(settings.subtitleOutlineColor);
    setSubtitleOutlineWidth(settings.subtitleOutlineWidth);
    setSubtitleVerticalOffset(settings.subtitleVerticalOffset);
    setSubtitleShadowEnabled(settings.subtitleShadowEnabled);
    setSubtitleShadowColor(settings.subtitleShadowColor);
    setSubtitleShadowOpacity(settings.subtitleShadowOpacity);
    setSubtitleShadowOffsetX(settings.subtitleShadowOffsetX);
    setSubtitleShadowOffsetY(settings.subtitleShadowOffsetY);
    setSubtitleShadowBlur(settings.subtitleShadowBlur);
    setDubbing(settings.dubbing);
    setTtsProvider(settings.ttsProvider);
    setTtsModel(settings.ttsModel);
    setVoiceCode(settings.voiceCode);
    setVoiceName(settings.voiceName);
    setComposeVideo(settings.composeVideo);
    setVideoFormat(settings.videoFormat);
    setVerticalTitle(settings.verticalTitle);
    setVerticalSubtitle(settings.verticalSubtitle);
  }

  function applySourceSnapshot(source: TranslationSourceSnapshot) {
    setSourceType(source.sourceType);
    if (source.sourceType === 'subtitle' && source.subtitleArtifactId) {
      creatorSession?.updateDraft({ importedSourceSubtitleId: source.subtitleArtifactId, importedTargetSubtitleId: null });
    }
    setVideoUrl(source.videoUrl);
    setVideoFile(source.videoFile);
    setVideoFileName(source.videoFile?.name ?? source.videoFileName);
    setVideoFileSize(source.videoFile?.size ?? source.videoFileSize);
    setVideoFileLastModified(
      source.videoFile?.lastModified ?? source.videoFileLastModified
    );
  }

  const draftSettingsSnapshot = currentDraftSettings();
  const draftSourceSnapshot = currentDraftSource();
  const navigationDraftRef = useRef(componentNavigationDraft);
  useEffect(() => {
    const draft = navigationDraftRef.current;
    if (!draft || draft.jobId !== (creatorSession?.job.id ?? null)) return;
    navigationDraftRef.current = undefined;
    componentNavigationDraft = undefined;
    applySettingsSnapshot(draft.settings);
    applySourceSnapshot(draft.source);
    setCurrentStep(Math.min(draft.currentStep, 1) as WizardStep);
    setFurthestStep(Math.min(draft.furthestStep, 1) as WizardStep);
    setWorkspacePhase(draft.workspacePhase);
    setResultVersion(draft.resultVersion);
    editorContextRef.current = draft.editor;
  }, [creatorSession?.job.id]);
  function preserveComponentNavigationDraft() {
    componentNavigationDraft = { jobId: creatorSession?.job.id ?? null, settings: currentDraftSettings(), source: currentDraftSource(), currentStep, furthestStep, workspacePhase, resultVersion, editor: editorContextRef.current };
  }
  const draftAppliesToSelectedResult = selectedResult !== undefined
    && draftBaseVersion === selectedResult.value;
  const settingsMatchSelectedResult = selectedResult === undefined || (selectedSubtitleOnly
    ? draftSettingsSnapshot.sourceLanguage === selectedResult.settings.sourceLanguage
      && draftSettingsSnapshot.targetLanguage === selectedResult.settings.targetLanguage
      && draftSettingsSnapshot.bilingual === selectedResult.settings.bilingual
      && draftSettingsSnapshot.subtitlePosition === selectedResult.settings.subtitlePosition
    : sameSettings(draftSettingsSnapshot, selectedResult.settings));
  const hasConfigDraftChanges = draftAppliesToSelectedResult
    && (!settingsMatchSelectedResult
      || !sameSource(draftSourceSnapshot, selectedResult.source));
  const hasPendingChanges = subtitleNeedsRegeneration
    || subtitleModelChanged
    || hasConfigDraftChanges
    || selectedHasStaleArtifacts;
  const regenerationSettings = hasConfigDraftChanges && selectedResult
    ? draftSettingsSnapshot
    : selectedResultSettings;
  const regenerationSource = hasConfigDraftChanges && selectedResult
    ? draftSourceSnapshot
    : selectedResultSource;
  const regenerationArtifacts = selectedResult && regenerationSettings && regenerationSource
    ? affectedArtifacts(
        selectedResult,
        regenerationSettings,
        regenerationSource,
        subtitleNeedsRegeneration,
        staleArtifactKinds,
        l,
        subtitleModelChanged
      )
    : [];
  const outputRequestType = resultProposal === 'voice' || regenerationSettings?.dubbing ? 'voice' : 'video';
  const plannedStage = selectedResult && regenerationSettings && regenerationSource
    ? outputStageForRequest({
        version: selectedResult, settings: regenerationSettings, source: regenerationSource,
        subtitleNeedsRegeneration, subtitleModelChanged, staleArtifactKinds,
        reusableDubbedAudio, reusableDubbedVideo, type: outputRequestType
      })
    : undefined;
  const currentVideoReady = finalVideoEntries.length > 0 && finalVideoEntries.every(({ artifact }) => (
    artifact.status === 'completed' && !staleArtifactKinds.has(artifact.kind)
  ));
  const outputUpToDate = !hasPendingChanges && currentVideoReady;
  const generationLabel = outputUpToDate ? l('当前已是最新', 'Up to date')
    : plannedStage === 'subtitle' ? l('重新翻译字幕', 'Retranslate subtitles')
      : plannedStage === 'tts' ? (reusableDubbedAudio || reusableDubbedVideo
        ? l('重新配音并合成视频', 'Redub and compose video')
        : l('配音并合成视频', 'Dub and compose video'))
        : isVideoCompositionStage(plannedStage) ? (finalVideoEntries.length > 0
          ? l('重新合成视频', 'Recompose video') : l('合成视频', 'Compose video'))
          : l('保存设置', 'Save settings');
  const outputActionDetail = isVideoCompositionStage(plannedStage) && regenerationSettings?.dubbing
    && (reusableDubbedAudio || reusableDubbedVideo) && hasPendingChanges
    ? l(`复用 V${resultVersion} 配音 · 更新字幕和视频`, `Reuse V${resultVersion} dubbing · update subtitles and video`)
    : undefined;
  const generationSummary = plannedStage === 'subtitle' && resultProposal !== 'voice'
    ? l('将按当前语言和模型重新翻译，生成新的字幕结果。人工修改保留在历史版本中。', 'The selected languages and model will be used to translate again. Manual edits remain in the previous version.')
    : plannedStage === 'tts'
      ? l('将根据当前字幕生成配音，然后自动合成到视频。', 'Generate dubbing from the current subtitles, then compose it into the video.')
      : outputActionDetail
        ? l('将复用已有配音，仅更新字幕和视频。', 'Reuse the existing dubbing and update subtitles and video.')
      : l('将使用当前字幕、样式和配音设置生成视频。已有文件保留在历史版本中。', 'Render a video with the current subtitles, style, and dubbing settings. Previous files remain in version history.');

  function requestOutput(type: 'video' | 'voice') {
    if (speechSyncing || submitting || subtitleSaving || activeStage || sourcePreviewPending || outputStartingRef.current || !selectedResult) return;
    setResultNotice('');
    if (type === 'voice' && regenerationSettings && regenerationSource
      && (subtitleModelChanged || !canReuseSubtitleCues(selectedResult, regenerationSettings, regenerationSource))) {
      setResultNotice(l('翻译输入已修改，请先重新翻译字幕，再生成配音。', 'The translation inputs changed. Retranslate the subtitles before generating dubbing.'));
      return;
    }
    prepareEditorSettings();
    if (type === 'video' || (type === 'voice' && !dubbing)) setComposeVideo(true);
    if (type === 'voice') setDubbing(true);
    if (type === 'video' && plannedStage === 'subtitle') { setResultProposal('regenerate'); return; }
    setOutputRequest(type);
  }

  useEffect(() => {
    if (!outputRequest || outputStartingRef.current) return;
    const type = outputRequest;
    outputStartingRef.current = true;
    setOutputRequest(undefined);
    void confirmRegeneration(type).finally(() => { outputStartingRef.current = false; });
  }, [outputRequest]);

  useEffect(() => {
    const pending = continuationRef.current;
    if (!pending || pending.status !== 'ready' || pending.jobId !== creatorSession?.job.id
      || selectedResult?.value !== pending.version || workspacePhase !== 'result' || !props.creatorServicesService) return;
    continuationRef.current = undefined;
    clearTranslationContinuation();
    void props.creatorServicesService.getConfig().then(({ config }) => {
      prepareEditorSettings();
      resolveSpeechSettings(config.tts, true);
      setDubbing(true);
      setOutputRequest(pending.type);
    }).catch(cause => setResultNotice(creatorErrorMessage(cause, l)));
  }, [creatorSession?.job.id, selectedResult?.value, workspacePhase, props.creatorServicesService]);

  async function configureDubbingService() {
    if (!creatorSession || !selectedResult || !configurationRequired) return;
    setSubmitting(true);
    try {
      for (const variant of ['horizontal', 'vertical'] as const) {
        if (subtitleDirtyByVariant[variant]) await persistSubtitleVariant(variant, selectedResult.value);
      }
      await creatorSession.flush();
      preserveComponentNavigationDraft();
      const returnPath = `#/workbench?tool=video-translation&jobId=${encodeURIComponent(creatorSession.job.id)}`;
      saveTranslationContinuation({ jobId: creatorSession.job.id, version: selectedResult.value,
        type: configurationRequired, returnPath, status: 'configure', createdAt: Date.now(), editor: editorContextRef.current });
      window.location.hash = `#/settings?tab=ai-services&section=tts&from=video-translation&returnPath=${encodeURIComponent(returnPath)}`;
    } catch (cause) { setResultNotice(creatorErrorMessage(cause, l)); }
    finally { setSubmitting(false); }
  }

  function chooseVideo(file: File | null) {
    setVideoFile(file);
    setVideoFileName(file?.name ?? null);
    setVideoFileSize(file?.size ?? null);
    setVideoFileLastModified(file?.lastModified ?? null);
    setSourceOrientation('landscape');
    if (file) {
      setVideoUrl('');
      setSourceType('file');
    } else {
      setSourceType('url');
    }
    setAttemptedContinue(false);
  }

  function selectBilibiliPart(index: number) {
    const source = parseBilibiliVideoSource(videoUrl);
    const part = currentUrlMetadata?.parts?.find(candidate => candidate.index === index);
    if (source === null || part === undefined || currentUrlMetadata === undefined) return;
    const url = `https://www.bilibili.com/video/${source.videoId}?p=${index}`;
    setUrlMetadata({
      url,
      value: { ...currentUrlMetadata, selectedPart: part, width: part.width, height: part.height }
    });
    setVideoUrl(url);
    setSourceOrientation('landscape');
    if (part.width !== undefined && part.height !== undefined) updateSourceOrientation(part.width, part.height);
    setAttemptedContinue(false);
  }

  function clearCurrentSource() {
    if (sourceType === 'file') {
      chooseVideo(null);
      return;
    }
    setVideoUrl('');
    setSourceType('url');
    setAttemptedContinue(false);
  }

  function updateSourceOrientation(width: number, height: number) {
    const orientation = videoOrientationFromDimensions(width, height);
    if (orientation === undefined) return;
    setSourceOrientation(orientation);
    if (orientation === 'portrait') setVideoFormat('vertical');
  }

  function updateSubtitleText(
    variant: SubtitleResultVariant,
    id: number,
    text: string,
    field: 'text' | 'sourceText' = 'text'
  ) {
    const cues = variant === 'horizontal' ? displayedHorizontalSubtitleCues : displayedVerticalSubtitleCues;
    updateSubtitleCues(variant, cues.map(cue => cue.id === id ? { ...cue, [field]: text } : cue));
  }

  function updateSubtitleCues(variant: SubtitleResultVariant, cues: SubtitleCue[]) {
    if (submitting) return;
    const key = subtitleDraftKey(resultVersion, variant);
    setSubtitleDrafts(current => ({ ...current, [key]: cues }));
    setSubtitleSaveError('');
    setResultNotice('');
  }

  async function persistSubtitleVariant(
    variant: SubtitleResultVariant,
    baseResultVersion: number,
    savedCues?: SubtitleCue[]
  ): Promise<{ version: number; hasStaleArtifacts: boolean }> {
    if (creatorSession === null) {
      throw new Error('Creator Runtime is unavailable');
    }
    const artifact = variant === 'horizontal'
      ? selectedTargetSubtitleArtifact
      : selectedVerticalSubtitleArtifact;
    const cues = savedCues ?? (variant === 'horizontal'
      ? displayedHorizontalSubtitleCues
      : displayedVerticalSubtitleCues);
    if (artifact === undefined || cues.length === 0) {
      throw new Error(`The selected project version has no editable ${variant} subtitle artifact`);
    }
    const editedJob = await creatorSession.applyAction({
      action: 'edit-subtitle',
      input: {
        artifactId: artifact.id,
        cues: cues.map(cue => ({
          id: cue.id,
          start: cue.start,
          end: cue.end,
          text: cue.text,
          ...(cue.sourceText === undefined ? {} : { sourceText: cue.sourceText })
        })),
        baseResultVersion,
        preserveResultVersion: true
      }
    });
    const editedVersion = readPositiveResultVersion(editedJob.state.resultVersion);
    if (editedVersion === undefined) {
      throw new Error('Creator Runtime did not return the edited subtitle version');
    }
    const key = subtitleDraftKey(baseResultVersion, variant);
    setSubtitleDrafts(current => {
      // Keep edits made while this request was in flight for the next save.
      if (current[key] && !sameSubtitleCues(current[key]!, cues)) return current;
      const { [key]: _removed, ...remaining } = current;
      return remaining;
    });
    const editedSnapshot = readCreatorResultSnapshots(editedJob.state.resultSnapshots)
      .find(snapshot => snapshot.version === editedVersion);
    return {
      version: editedVersion,
      hasStaleArtifacts: (editedSnapshot?.staleArtifactIds.length ?? 0) > 0
    };
  }

  function continueToSettings() {
    setAttemptedContinue(true);
    if (!hasSource || !sourceSelectionReady) return;
    openWizardStep(1);
  }

  async function executeRegeneration(stageId: TranslationStageId | undefined, speech?: Pick<TranslationSettingsSnapshot, 'ttsProvider' | 'ttsModel' | 'voiceCode' | 'voiceName'>) {
    if (
      creatorSession === null
      || selectedResult === undefined
      || regenerationSource === undefined
    ) {
      throw new Error('Video translation regeneration context is unavailable');
    }
    creatorSession.updateDraft({ composeVideo, dubbing, ttsProvider, ttsModel, voiceCode, voiceName, ...speech });
    const selectedBaseVersion = selectedResult.value;
    const sourceChanged = !sameSource(regenerationSource, selectedResult.source);

    for (const variant of ['horizontal', 'vertical'] as const) {
      if (subtitleDirtyByVariant[variant]) await persistSubtitleVariant(variant, selectedBaseVersion);
    }

    if (stageId === undefined) {
      const committedJob = await creatorSession.applyAction({
        action: 'commit-version',
        input: { baseResultVersion: selectedBaseVersion }
      });
      return readPositiveResultVersion(committedJob.state.resultVersion);
    }

    const inputResultVersion = (sourceChanged || transcriptionModelChanged) && stageId === 'subtitle'
      ? undefined
      : selectedBaseVersion;
    const stageJob = await creatorSession.applyAction({
      action: 'run-stage',
      input: {
        stageId,
        workflow: true,
        baseResultVersion: selectedBaseVersion,
        ...(inputResultVersion === undefined ? {} : { inputResultVersion })
      }
    });
    return readPositiveResultVersion(stageJob.state.resultVersion);
  }

  async function submit() {
    if (subtitleImportPending) return;
    if (importedSourceSubtitle && sourceLanguage === 'auto') {
      setCurrentStep(1);
      setResultNotice(l('未能可靠识别字幕语言，请手动选择源语言。', 'The subtitle language could not be reliably detected. Select the source language.'));
      return;
    }
    if (!hasSource || !sourceSelectionReady) {
      setCurrentStep(0);
      setAttemptedContinue(true);
      return;
    }
    if (creatorSession === null) {
      setResultNotice(l('Creator Runtime 当前不可用，无法启动真实翻译任务', 'Creator Runtime is unavailable, so a real translation task cannot start.'));
      return;
    }
    creatorSession.clearError();
    setStartRevisionConflict(false);
    setSubmitting(true);
    setSubmissionPhase(sourceType === 'file' && videoFile !== null && !selectedFileRegistered
      ? 'uploading'
      : 'starting');
    setResultNotice('');
    try {
      const isRegeneration = draftBaseVersion !== undefined
        && selectedResult !== undefined
        && regenerationSettings !== undefined
        && regenerationSource !== undefined;
      if (isRegeneration && !hasPendingChanges) {
        setResultNotice(l(
          '当前版本没有修改，不需要生成新版本',
          'Nothing changed, so a new version is not needed'
        ));
        return;
      }
      const stageId = isRegeneration
        ? videoTranslationRegenerationStage(
            selectedResult,
            regenerationSettings,
            regenerationSource,
            subtitleNeedsRegeneration,
            staleArtifactKinds,
            subtitleModelChanged
          )
        : 'subtitle';
      if (sourceType === 'file' && videoFile !== null && !selectedFileRegistered) {
        setResultNotice(l('正在上传本地视频...', 'Uploading the local video...'));
        await creatorSession.uploadSourceVideo(videoFile);
        setSubmissionPhase('starting');
        setResultNotice(l('本地视频已上传，正在启动翻译...', 'The local video is uploaded. Starting translation...'));
      }
      if (isRegeneration) {
        await executeRegeneration(stageId);
      } else {
        creatorSession.updateDraft({ composeVideo: false, dubbing: false, skipVideoDownload });
        setComposeVideo(false);
        setDubbing(false);
        await creatorSession.applyAction({
          action: 'run-stage',
          input: { stageId: 'subtitle', workflow: true }
        });
      }
      setWorkspacePhase('result');
      setResultTab('subtitles');
      setSubtitleImmersive(true);
      setResultNotice(isRegeneration && isVideoCompositionStage(stageId)
        ? ''
        : isRegeneration
          ? stageId === undefined
            ? l(
                '修改已保存，本次无需重新转录或生成',
                'Changes were saved without retranscribing or regenerating.'
              )
            : l(
                `新版本已从“${translationStageLabel(stageId, l)}”开始，已有前置产物会直接复用`,
                `The new version started from "${translationStageLabel(stageId, l)}" and will reuse existing upstream outputs.`
              )
          : translationStartedNotice);
    } catch (cause) {
      if ((cause as { code?: unknown })?.code === 'creator_revision_conflict') {
        setStartRevisionConflict(true);
      }
      setResultNotice(creatorErrorMessage(cause, l));
    } finally {
      setSubmitting(false);
      setSubmissionPhase(undefined);
    }
  }

  function requestCancelTask() {
    if (
      activeStage === undefined
      || activeStage.progress.cancelRequested === true
      || taskControlPending !== undefined
    ) return;
    setCancelDialogOpen(true);
  }

  async function prepareSourcePreview() {
    if (!canPrepareSourcePreview || creatorSession === null || activeStage !== undefined || sourcePreviewPending) return;
    const version = resultVersion;
    creatorSession.clearError();
    setPreviewRequest({ version, pending: true });
    try {
      await creatorSession.applyAction({ action: 'run-stage', input: { stageId: 'prepare-source-video', inputResultVersion: version } });
      setPreviewRequest({ version, pending: false });
    } catch (error) {
      setPreviewRequest({ version, pending: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function prepareDraftSourcePreview() {
    if (creatorSession === null || currentSourceIdentity === null || activeStage !== undefined || draftPreviewPending) return;
    if (currentSourcePreviewArtifact !== undefined) {
      setDraftPreviewReload(value => value + 1);
      return;
    }
    const url = videoUrl;
    creatorSession.clearError();
    setDraftPreviewRequest({ url, pending: true });
    try {
      await creatorSession.applyAction({ action: 'run-stage', input: { stageId: 'preview-source-video' } });
      setDraftPreviewRequest({ url, pending: false });
    } catch (cause) {
      setDraftPreviewRequest({ url, pending: false, error: creatorErrorMessage(cause, l) });
    }
  }

  async function cancelTask() {
    if (creatorSession === null || activeStage === undefined || taskControlPending !== undefined) return;
    setCancelDialogOpen(false);
    setTaskControlPending('canceling');
    creatorSession.clearError();
    setResultNotice(l('正在终止当前阶段...', 'Stopping the current stage...'));
    try {
      await creatorSession.cancelJob();
      setResultNotice(l(
        '终止请求已发送。已完成阶段和产物会保留；继续时当前阶段将重新开始。',
        'Stop requested. Completed stages and outputs are preserved; the current stage will restart when resumed.'
      ));
    } catch (cause) {
      setResultNotice(creatorErrorMessage(cause, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (creatorSession === null || resumableStage === undefined || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    creatorSession.clearError();
    setResultNotice(l('正在继续任务...', 'Resuming the task...'));
    try {
      await creatorSession.resumeJob();
      setResultNotice(l(
        `任务已继续，正在从“${translationStageLabel(resumableStage.stageId, l)}”重新开始`,
        `The task resumed and is restarting from "${translationStageLabel(resumableStage.stageId, l)}"`
      ));
    } catch (cause) {
      setResultNotice(creatorErrorMessage(cause, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  function saveSubtitles(variant: SubtitleResultVariant): Promise<boolean> {
    if (subtitleSaveWorkRef.current) return subtitleSaveWorkRef.current;
    if (creatorSession === null || selectedResult === undefined) return Promise.resolve(false);
    const version = selectedResult.value;
    const cues = variant === 'horizontal' ? displayedHorizontalSubtitleCues : displayedVerticalSubtitleCues;
    setSubtitleSaving(true);
    setSubtitleSaveError('');
    const work = (async () => {
      try {
        await persistSubtitleVariant(variant, version, cues);
        return true;
      } catch (cause) {
        setSubtitleSaveError(creatorErrorMessage(cause, l));
        return false;
      } finally {
        subtitleSaveWorkRef.current = undefined;
        setSubtitleSaving(false);
      }
    })();
    subtitleSaveWorkRef.current = work;
    return work;
  }

  const autosaveRef = useRef({ saveSubtitles, subtitleDirtyByVariant });
  autosaveRef.current = { saveSubtitles, subtitleDirtyByVariant };
  useEffect(() => {
    if (workspacePhase !== 'result' || submitting || subtitleSaving || subtitleSaveError || activeGenerationStage) return;
    const variant = subtitleDirtyByVariant.horizontal ? 'horizontal' : subtitleDirtyByVariant.vertical ? 'vertical' : undefined;
    if (!variant) return;
    const timer = window.setTimeout(() => { void autosaveRef.current.saveSubtitles(variant); }, 900);
    return () => window.clearTimeout(timer);
  }, [subtitleDrafts, resultVersion, workspacePhase, submitting, subtitleSaving, subtitleSaveError, activeGenerationStage, creatorSession?.job.id]);

  useEffect(() => {
    if (!Object.values(subtitleDirtyByVariant).some(Boolean) && !subtitleSaving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [subtitleDrafts, subtitleSaving, subtitleDirtyByVariant.horizontal, subtitleDirtyByVariant.vertical]);

  function showResultOutputs() {
    setSubtitleImmersive(false);
    setSubtitleAssistantOpen(false);
    setResultProposal(undefined);
    setResultTab(selectedSubtitleOnly ? 'subtitles' : 'video');
  }

  async function leaveWorkspace(destination: 'project' | 'outputs' = 'project') {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (subtitleSaveWorkRef.current && !await subtitleSaveWorkRef.current) return;
      const pending = autosaveRef.current;
      for (const variant of ['horizontal', 'vertical'] as const) {
        if (pending.subtitleDirtyByVariant[variant] && !await pending.saveSubtitles(variant)) return;
      }
      if (destination === 'outputs') showResultOutputs();
      else props.onBack();
    } finally {
      setSubmitting(false);
    }
  }

  async function exportResult(type: 'video' | 'subtitles' | 'voice', artifactId?: string) {
    if (creatorSession !== null) {
      const artifact = artifactId === undefined
        ? type === 'video'
          ? selectedVideoEntries[0]?.artifact
          : type === 'voice'
            ? selectedVoiceArtifact
            : selectedSubtitleArtifacts.horizontal
        : jobArtifacts.find(candidate => (
            candidate.id === artifactId
            && ['completed', 'stale'].includes(candidate.status)
          ));
      if (artifact === undefined) {
        setResultNotice(l('当前版本没有对应的真实产物。', 'This version has no matching generated artifact.'));
        return;
      }
      try {
        const url = await createCreatorArtifactObjectUrl(
          creatorSession,
          artifact.id,
          'video-translation.download-artifact',
          l('产物下载失败，请稍后重试。', 'The artifact download failed. Try again later.')
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = artifactFileName(artifact) ?? `OpenCreator-${artifact.kind}-V${resultVersion}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        setResultNotice(l('产物文件已开始下载', 'Artifact download started'));
      } catch (cause) {
        setResultNotice(creatorErrorMessage(cause, l));
      }
      return;
    }
    setResultNotice(l('Creator Runtime 当前不可用，没有可导出的真实产物', 'Creator Runtime is unavailable and there is no real artifact to export.'));
  }

  function adjustSettingsFromResult() {
    if (!selectedResult) return;
    if (draftBaseVersion !== selectedResult.value) {
      applySourceSnapshot(selectedResult.source);
      applySettingsSnapshot(selectedResult.settings);
    }
    setDraftBaseVersion(selectedResult.value);
    setWorkspacePhase('configure');
    setCurrentStep(1);
    setFurthestStep(1);
    setResultProposal(undefined);
    setResultNotice('');
  }

  function prepareEditorSettings() {
    if (!selectedResult) return;
    if (draftBaseVersion !== selectedResult.value) {
      applySourceSnapshot(selectedResult.source);
      applySettingsSnapshot(selectedResult.settings);
      setDraftBaseVersion(selectedResult.value);
      setResultProposal(undefined);
    }
  }

  function returnToBaseResult() {
    const version = draftBaseVersion ?? resultVersion;
    setResultVersion(version);
    setWorkspacePhase('result');
    setResultTab('subtitles');
    setSubtitleImmersive(true);
    setResultProposal(undefined);
    setResultNotice(l(`已返回 V${version}，配置草稿仍然保留`, `Returned to V${version}. Your configuration draft is still saved.`));
  }

  function selectResultVersion(version: number) {
    const selected = resultVersions.find(item => item.value === version);
    if (selected) {
      applySettingsSnapshot(selected.settings);
      applySourceSnapshot(selected.source);
      setDraftBaseVersion(version);
    }
    setResultVersion(version);
    setSubtitleSaveError('');
    setResultProposal(undefined);
    setResultNotice('');
  }

  async function confirmRegeneration(proposal: ResultProposal | undefined = resultProposal) {
    if (!selectedResult || !regenerationSettings || !regenerationSource) return;
    if (!hasPendingChanges && proposal === 'regenerate') {
      setResultProposal(undefined);
      setResultNotice(l('当前版本没有修改，不需要生成新版本', 'Nothing changed, so a new version is not needed'));
      return;
    }
    if (creatorSession === null) {
      setResultNotice(l('Creator Runtime 当前不可用，无法生成新版本', 'Creator Runtime is unavailable, so a new version cannot be generated.'));
      return;
    }
    setSubmitting(true);
    setResultNotice('');
    try {
      let speech = { ttsProvider, ttsModel, voiceCode, voiceName };
      const type = proposal === 'voice' || regenerationSettings.dubbing ? 'voice' : 'video';
      const stageId = outputStageForRequest({
        version: selectedResult, settings: regenerationSettings, source: regenerationSource,
        subtitleNeedsRegeneration, subtitleModelChanged, staleArtifactKinds,
        reusableDubbedAudio, reusableDubbedVideo, type
      });
      if (stageId === 'tts' && !officialSpeech.official) {
        const service = props.creatorServicesService;
        ++speechConfigRequestRef.current;
        const response = service ? await service.getConfig() : undefined;
        if (response) speech = resolveSpeechSettings(response.config.tts);
        if (!service || !response || !ttsServiceConfigured(response, speech.ttsProvider)) {
          setConfigurationRequired(proposal === 'voice' ? 'voice' : 'video');
          setResultNotice(l('请先配置配音服务，配置后可返回继续配音合成。', 'Configure a dubbing service, then return to continue composing.'));
          return;
        }
        if (speech.ttsProvider !== 'edge-tts' && speech.ttsProvider !== 'volcengine') {
          const { voices } = await service.getTtsVoices(speech.ttsProvider, speech.ttsModel);
          if (voices.length > 0 && !voices.some(voice => voice.id === speech.voiceCode)) {
            setResultNotice(l('当前音色已不可用，请在配音设置中选择音色后继续。', 'The current voice is unavailable. Choose a voice in dubbing settings to continue.'));
            return;
          }
        }
      }
      if (stageId === 'tts') applySpeechSettings(speech);
      setConfigurationRequired(undefined);
      await executeRegeneration(stageId, speech);
      setSubtitleImmersive(true);
      setResultTab('subtitles');
      if (stageId === 'subtitle') setSubtitleAssistantOpen(true);
      setResultProposal(undefined);
      setResultNotice(isVideoCompositionStage(stageId)
        ? ''
        : stageId === undefined
          ? l(
              '修改已保存，本次无需重新转录或生成',
              'Changes were saved without retranscribing or regenerating.'
            )
          : l(
              `新版本已从“${translationStageLabel(stageId, l)}”开始，旧版本和已有前置产物会继续保留`,
              `The new version started from "${translationStageLabel(stageId, l)}"; previous versions and upstream outputs remain available.`
            ));
    } catch (cause) {
      setResultNotice(creatorErrorMessage(cause, l));
    } finally {
      setSubmitting(false);
    }
  }

  const subtitleRenderStyle: CreatorSubtitlePreviewRequest['subtitleStyle'] = {
    fontPreset: subtitleFont,
    fontWeight: subtitleWeight,
    fontSize: subtitleSize,
    primaryColor: subtitleColor,
    secondaryColor: subtitleSecondaryColor,
    outlineColor: subtitleOutlineColor,
    outlineWidth: subtitleOutlineWidth,
    verticalOffset: subtitleVerticalOffset,
    shadow: {
      enabled: subtitleShadowEnabled,
      color: subtitleShadowColor,
      opacity: subtitleShadowOpacity,
      offsetX: subtitleShadowOffsetX,
      offsetY: subtitleShadowOffsetY,
      blur: subtitleShadowBlur
    }
  };

  const subtitlePreviewTitles = previewVerticalOutput && (verticalTitle.trim() || verticalSubtitle.trim()) ? (
    <div className="video-translation-subtitle-preview-titles">
      {verticalTitle.trim() ? <div data-title-kind="major">{verticalTitle}</div> : null}
      {verticalSubtitle.trim() ? <div data-title-kind="minor">{verticalSubtitle}</div> : null}
    </div>
  ) : null;
  const subtitleStyleEditor = (
    <>
      <h4 className="video-translation-style-drawer-section">{l('文字', 'Text')}</h4>
      <div className="video-translation-typography-fields">
        <label className="video-translation-field">
          <span>{l('字幕字体', 'Subtitle font')}</span>
          <div className="video-translation-select-wrap">
            <AppSelect
              aria-label={l('字幕字体', 'Subtitle font')}
              value={subtitleFont}
              onChange={event => setSubtitleFont(event.target.value as SubtitleFont)}
            >
              <option value="system">{l('系统默认', 'System default')}</option>
              <option value="sans">{l('无衬线', 'Sans serif')}</option>
              <option value="serif">{l('衬线', 'Serif')}</option>
              <option value="rounded">{l('圆体', 'Rounded')}</option>
            </AppSelect>
          </div>
        </label>

        <label className="video-translation-field">
          <span>{l('字重', 'Font weight')}</span>
          <div className="video-translation-select-wrap">
            <AppSelect
              aria-label={l('字幕字重', 'Subtitle font weight')}
              value={subtitleWeight}
              onChange={event => setSubtitleWeight(event.target.value as SubtitleWeight)}
            >
              {(['regular', 'medium', 'bold'] as const).map(weight => (
                <option key={weight} value={weight}>{subtitleWeightLabel(weight, l)}</option>
              ))}
            </AppSelect>
          </div>
        </label>

        <label className="video-translation-field">
          <span>{l('字幕大小', 'Subtitle size')}</span>
          <div className="video-translation-select-wrap">
            <AppSelect
              aria-label={l('字幕大小', 'Subtitle size')}
              value={subtitleSize}
              onChange={event => setSubtitleSize(event.target.value as SubtitleSize)}
            >
              {(['small', 'medium', 'large'] as const).map(size => (
                <option key={size} value={size}>{subtitleSizeLabel(size, l)}</option>
              ))}
            </AppSelect>
          </div>
        </label>
      </div>

      <div className="video-translation-style-fields">
        <SubtitleColorControl
          label={l('译文颜色', 'Translation color')}
          value={subtitleColor}
          onChange={setSubtitleColor}
        />

        {bilingual ? <SubtitleColorControl
          label={l('原文颜色', 'Original color')}
          value={subtitleSecondaryColor}
          onChange={setSubtitleSecondaryColor}
          prefixPresetLabel
        /> : null}
      </div>

      <h4 className="video-translation-style-drawer-section">{l('位置', 'Position')}</h4>
      <SubtitleRangeControl label={l('字幕高度', 'Subtitle height')} min={-20} max={100} step={1} value={subtitleVerticalOffset} onChange={value => setSubtitleVerticalOffset(Math.round(value))} />

      <h4 className="video-translation-style-drawer-section">{l('描边与阴影', 'Outline & shadow')}</h4>
        <div className="video-translation-advanced-style-content">
          <div className="video-translation-style-stack">
            <SubtitleColorControl
              label={l('描边颜色', 'Outline color')}
              value={subtitleOutlineColor}
              onChange={setSubtitleOutlineColor}
              prefixPresetLabel
            />
            <SubtitleRangeControl label={l('描边宽度', 'Outline width')} min={0} max={8} step={0.5} value={subtitleOutlineWidth} onChange={setSubtitleOutlineWidth} />
          </div>

          <div className="video-translation-shadow-settings">
            <Switch
              checked={subtitleShadowEnabled}
              label={l('字幕阴影', 'Subtitle shadow')}
              description={l('为字幕增加可控阴影，提高复杂画面上的可读性', 'Add a controlled shadow for readability on detailed footage')}
              onChange={setSubtitleShadowEnabled}
            />
            {subtitleShadowEnabled ? (
              <>
                <SubtitleColorControl
                  label={l('阴影颜色', 'Shadow color')}
                  value={subtitleShadowColor}
                  onChange={setSubtitleShadowColor}
                  prefixPresetLabel
                />
                <div className="video-translation-style-stack">
                  <SubtitleRangeControl label={l('不透明度', 'Opacity')} min={0} max={1} step={0.05} value={subtitleShadowOpacity} onChange={setSubtitleShadowOpacity} />
                  <SubtitleRangeControl label={l('水平偏移', 'Horizontal offset')} min={-20} max={20} step={1} value={subtitleShadowOffsetX} onChange={setSubtitleShadowOffsetX} />
                  <SubtitleRangeControl label={l('垂直偏移', 'Vertical offset')} min={-20} max={20} step={1} value={subtitleShadowOffsetY} onChange={setSubtitleShadowOffsetY} />
                  <SubtitleRangeControl label={l('模糊', 'Blur')} min={0} max={10} step={0.5} value={subtitleShadowBlur} onChange={setSubtitleShadowBlur} />
                </div>
              </>
            ) : null}
          </div>
        </div>
    </>
  );

  const subtitleLayoutControls = (
    <>
      <Switch
        checked={bilingual}
        label={l('双语字幕', 'Bilingual subtitles')}
        description={l('同时保留原文和译文', 'Keep both the original and translated text')}
        onChange={value => {
          setBilingual(value);
        }}
      />
      {bilingual ? (
        <div className="video-translation-inline-setting">
          <span>{l('译文位置', 'Translation position')}</span>
          <div role="group" aria-label={l('译文位置', 'Translation position')}>
            <button type="button" aria-pressed={subtitlePosition === 'top'} onClick={() => setSubtitlePosition('top')}>{l('在上', 'Above')}</button>
            <button type="button" aria-pressed={subtitlePosition === 'bottom'} onClick={() => setSubtitlePosition('bottom')}>{l('在下', 'Below')}</button>
          </div>
        </div>
      ) : null}
    </>
  );

  const translationModelControl = officialText.official ? <div className="video-translation-model-setting">
    <OfficialModelField label={l('翻译模型', 'Translation model')} service={officialText} disabled={submitting || activeGenerationStage !== undefined} />
    {!officialText.ready ? <p role="status">{l('请选择可用的翻译模型后开始。', 'Choose an available translation model before starting.')}</p> : null}
  </div> : null;
  const transcriptionModelControl = !subtitleOnly && officialTranscription.official ? <div className="video-translation-model-setting">
    <OfficialModelField label={l('语音识别模型', 'Transcription model')} service={officialTranscription} disabled={submitting || activeGenerationStage !== undefined} />
  </div> : null;
  const languageControls = (
    <>
      <div className="video-translation-language-row">
        <LanguageSelect label={l('源语言', 'Source language')} value={sourceLanguage} onChange={setSourceLanguage} source l={l} />
        <span className="video-translation-language-arrow" aria-hidden="true">→</span>
        <LanguageSelect label={l('翻译为', 'Translate to')} value={targetLanguage} onChange={setTargetLanguage} l={l} />
      </div>
      {!subtitleOnly && transcriptionLanguageSupport(sourceLanguage, asrCapability) === 'unsupported' ? <p role="status">{l('当前识别服务不支持该源语言。请更换识别服务或导入原文字幕；优先使用平台字幕时仅影响转录回退。', 'The speech service does not support this source language. Change services or import source subtitles; with platform captions this only affects audio fallback.')}</p> : null}
      {importedSourceSubtitle && sourceLanguage === 'auto' ? <p role="status">{l('未能可靠识别字幕语言，请手动选择源语言。', 'The subtitle language could not be reliably detected. Select the source language.')}</p> : null}
      {!subtitleOnly && asrCapability && transcriptionLanguageSupport(sourceLanguage, asrCapability) === 'unknown' ? <p role="status">{l('当前识别服务的语言范围尚未确认，请确认服务支持所选语言。', 'Language coverage is unverified. Confirm that the speech service supports this language.')}</p> : null}
    </>
  );
  const subtitleImportControl = !subtitleOnly ? <VideoTranslationSubtitleImport
    sourceLanguage={sourceLanguage} targetLanguage={targetLanguage}
    disabled={submitting || activeGenerationStage !== undefined} onBusyChange={setSubtitleImportPending} /> : null;
  const platformCaptionsControl = !subtitleOnly ? <Switch
    checked={preferPlatformCaptions && sourceType === 'url'}
    label={l('优先使用平台字幕', 'Prefer platform subtitles')}
    description={sourceType === 'url' ? l('平台无字幕时自动识别', 'Transcribe automatically when platform subtitles are unavailable') : l('仅视频链接可用', 'Available for video links only')}
    disabled={sourceType !== 'url'} onChange={setPreferPlatformCaptions}
  /> : null;

  const outputFormatOptions = [
    ['horizontal', '16:9', '横屏'],
    ['vertical', '9:16', '竖屏'],
    ['all', '双画幅', '全部']
  ] as const;
  const outputFormatControl = subtitleImmersive ? (
    <div className="video-translation-output-format-options" role="radiogroup" aria-label={l('输出画幅', 'Output format')}>
      {outputFormatOptions.map(([value, ratio, label]) => (
        <label className="video-translation-output-format-choice" data-selected={videoFormat === value || undefined} key={value}
          title={sourceOrientation === 'portrait' && value !== 'vertical'
            ? l('竖屏源视频仅支持竖屏输出', 'Portrait source videos only support portrait output') : undefined}>
          <span className="video-translation-output-format-icon" aria-hidden="true">
            {value !== 'vertical' ? <RectangleHorizontal size={24} strokeWidth={1.5} /> : null}
            {value !== 'horizontal' ? <RectangleVertical size={24} strokeWidth={1.5} /> : null}
          </span>
          <span>{value === 'all' ? l('双画幅', '16:9 + 9:16') : ratio} {localizeFormatLabel(label, l)}</span>
          <input type="radio" name={outputFormatName} value={value} checked={videoFormat === value}
            disabled={sourceOrientation === 'portrait' && value !== 'vertical'}
            onChange={() => setVideoFormat(value)} />
        </label>
      ))}
    </div>
  ) : (
    <label className="video-translation-field video-translation-output-format-inline">
      <span>{l('输出画幅', 'Output format')}</span>
      <div className="video-translation-select-wrap">
        <AppSelect
          aria-label={l('输出画幅', 'Output format')}
          value={videoFormat}
          onChange={event => setVideoFormat(event.target.value as VideoFormat)}
        >
          {outputFormatOptions.map(([value, ratio, label]) => (
            <option
              value={value}
              disabled={sourceOrientation === 'portrait' && value !== 'vertical'}
              title={sourceOrientation === 'portrait' && value !== 'vertical'
                ? l('竖屏源视频仅支持竖屏输出', 'Portrait source videos only support portrait output')
                : undefined}
              key={value}
            >
              {value === 'all' ? l('双画幅', '16:9 + 9:16') : ratio} {localizeFormatLabel(label, l)}
            </option>
          ))}
        </AppSelect>
      </div>
    </label>
  );

  const subtitleStyleChoices = (
    <>
      <h3 className="video-translation-subtitle-style-title">{l('字幕样式', 'Subtitle style')}</h3>
      <div className="video-translation-subtitle-style-tabs-row">
        <div className="video-translation-subtitle-style-tabs" role="tablist" aria-label={l('字幕样式分类', 'Subtitle style groups')}>
          {([
            ['recommended', l('推荐', 'Presets')],
            ['mine', l('我的样式', 'My styles')]
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              id={`subtitle-style-tab-${tab}`}
              aria-selected={subtitleStyleTab === tab}
              aria-controls="subtitle-style-tabpanel"
              onClick={() => setSubtitleStyleTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          ref={styleDrawerTriggerRef}
          type="button"
          className="video-translation-subtitle-customize"
          aria-haspopup="dialog"
          aria-expanded={styleDrawerSnapshot !== undefined}
          onClick={() => setStyleDrawerSnapshot(currentSubtitleStyle)}
        >
          <SlidersHorizontal size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>{l('自定义样式', 'Customize')}</span>
        </button>
      </div>
      <div
        id="subtitle-style-tabpanel"
        role="tabpanel"
        aria-labelledby={`subtitle-style-tab-${subtitleStyleTab}`}
      >
        {subtitleStyleTab === 'mine' && savedSubtitleStyles.length === 0 ? (
          <p className="video-translation-subtitle-presets-empty">
            {l('还没有保存的样式。在自定义样式里调整后点「另存为模版」。', 'No saved styles yet. Adjust a style in Customize, then choose Save as template.')}
          </p>
        ) : <div className="video-translation-subtitle-presets" role="radiogroup"
          aria-label={subtitleStyleTab === 'mine' ? l('我的样式', 'My styles') : l('推荐样式', 'Recommended styles')}>
          {subtitleStyleTab === 'recommended' ? subtitleStylePresets.map(preset => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={activeSubtitlePreset?.id === preset.id}
              className="video-translation-subtitle-preset"
              onClick={() => selectSubtitleStyle(preset.style)}
            >
              <SubtitlePresetThumbnail style={preset.style} bilingual={bilingual} translationOnTop={subtitlePosition === 'top'} posterUrl={previewPosterUrl} />
              <span>{l(...preset.name)}</span>
            </button>
          )) : null}
          {subtitleStyleTab === 'mine' ? savedSubtitleStyles.map(saved => (
            <div key={saved.id} className="video-translation-subtitle-preset-saved">
              <button
                type="button"
                role="radio"
                aria-checked={activeSavedSubtitleStyle?.id === saved.id}
                className="video-translation-subtitle-preset"
                onClick={() => selectSubtitleStyle(saved.style)}
              >
                <SubtitlePresetThumbnail style={saved.style} bilingual={bilingual} translationOnTop={subtitlePosition === 'top'} posterUrl={previewPosterUrl} />
                <span>{saved.name}</span>
              </button>
              <div className="video-translation-subtitle-preset-actions">
                <button
                  type="button"
                  aria-label={l(`编辑模版 ${saved.name}`, `Edit template ${saved.name}`)}
                  title={l('编辑模版', 'Edit template')}
                  aria-haspopup="dialog"
                  onClick={() => openSavedStyleEditor(saved)}
                >
                  <Pencil size={11} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={l(`删除模版 ${saved.name}`, `Delete template ${saved.name}`)}
                  title={l('删除模版', 'Delete template')}
                  onClick={() => deleteSavedSubtitleStyle(saved.id)}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </div>
            </div>
          )) : null}
        </div>}
      </div>
    </>
  );

  const verticalTitleControls = (
    videoFormat === 'vertical' || videoFormat === 'all' ? (
    <div className="video-translation-title-fields">
      <label className="video-translation-field">
        <span>{l('竖屏主标题', 'Vertical video title')} <small>{l('选填', 'Optional')}</small></span>
        <input value={verticalTitle} onChange={event => setVerticalTitle(event.target.value)} placeholder={l('留空将自动生成', 'Leave blank to generate automatically')} />
      </label>
      <label className="video-translation-field">
        <span>{l('竖屏副标题', 'Vertical video subtitle')} <small>{l('选填', 'Optional')}</small></span>
        <input value={verticalSubtitle} onChange={event => setVerticalSubtitle(event.target.value)} placeholder={l('留空将自动生成', 'Leave blank to generate automatically')} />
      </label>
    </div>
    ) : null
  );

  const dubbingSettings = (
    <div className="video-translation-option-block video-translation-dubbing-settings">
      <div className="video-translation-option-title">
        <span className="video-translation-option-icon"><Mic2 size={17} strokeWidth={1.8} /></span>
        <Switch
          checked={dubbing}
          label={l('启用配音', 'Enable dubbing')}
          description={l('合成时自动生成配音并加入视频', 'Generate dubbing and include it when composing the video')}
          onChange={value => {
            setDubbing(value);
            if (value) setComposeVideo(true);
          }}
        />
      </div>
      {dubbing ? (
        <div className="video-translation-option-content video-translation-dubbing-row">
          {officialSpeech.official ? <OfficialModelField label={l('语音合成模型', 'Speech model')} service={officialSpeech} /> : <div className="video-translation-voice-source">
            <span>{l('语音服务', 'Speech service')}</span>
            <div>
              <strong>{ttsProviderLabel(ttsProvider, l)}</strong>
              <small>{ttsModel || l('本地语音服务', 'Local speech service')}</small>
            </div>
          </div>}
          <TtsVoicePicker
            id="video-translation-voice"
            catalogKey={officialSpeech.official ? JSON.stringify([officialSpeech.model?.voices, officialSpeech.model?.voiceProfiles]) : undefined}
            provider={ttsProvider}
            model={ttsModel}
            value={voiceCode}
            service={props.creatorServicesService ?? null}
            label={l('配音音色', 'Dubbing voice')}
            disabled={speechSyncing || submitting || activeGenerationStage !== undefined}
            onChange={(voiceId, voice) => {
              const speech = { ...speechDraftRef.current, voiceCode: voiceId, voiceName: voice?.name ?? voiceId };
              const selection = { resultVersion, ...speech };
              speechVoiceSelectionRef.current = selection;
              creatorSession?.updateDraft({ ttsVoiceSelection: selection });
              applySpeechSettings(speech);
            }}
            onVoiceResolved={voice => setVoiceName(voice.name)}
          />
          {!officialSpeech.official && props.creatorServicesService ? (
            <div className="video-translation-voice-config-actions">
              <span>{speechSelectionRef.current?.followSettings
                ? l('服务与模型来自当前设置', 'Service and model from current settings')
                : l('保留任务配音配置', 'Saved dubbing settings')}
              </span>
              <button type="button" disabled={speechSyncing || submitting || activeGenerationStage !== undefined}
                title={speechDefaults ? `${ttsProviderLabel(speechDefaults.ttsProvider, l)} · ${speechDefaults.ttsModel || l('本地语音服务', 'Local speech service')}` : undefined}
                onClick={() => void useCurrentSpeechSettings()}>
                {speechSyncing ? l('正在同步…', 'Syncing…') : l('使用当前设置', 'Use current settings')}
              </button>
            </div>
          ) : null}
          <div className="video-translation-burn-subtitles">
            <Switch
              checked={composeVideo}
              label={l('烧录字幕', 'Burn subtitles')}
              description={bilingual
                ? l('使用字幕样式中的双语字幕', 'Use bilingual subtitles from Subtitle style')
                : l('使用字幕样式中的目标语言字幕', 'Use target-language subtitles from Subtitle style')}
              onChange={setComposeVideo}
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <main className="video-translation-page" data-subtitle-immersive={subtitleImmersive && subtitleOutputs.length > 0 && workspacePhase === 'result' && resultTab === 'subtitles' || undefined}
      data-subtitle-assistant={subtitleAssistantOpen || undefined}>
      <div className="video-translation-page-inner video-translation-wizard">
        <CreatorResizableLayout
          className="video-translation-collab-layout"
          agentPanelRequest={taskDetailsRequest}
          workspace={<div
            className="video-translation-wizard-main"
            data-step={currentStep}
            data-phase={workspacePhase}
            role="region"
            aria-label={l('视频翻译操作区', 'Video translation workspace')}
          >
        <header className="video-translation-header">
          <button type="button" onClick={() => void leaveWorkspace()} aria-label={l('返回', 'Back')}>
            <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span className="video-translation-title-icon" aria-hidden="true">
            <Languages size={20} strokeWidth={1.8} />
          </span>
          <div className="video-translation-header-copy">
            <h1>{(workspacePhase === 'result' ? selectedSubtitleOnly : subtitleOnly) ? l('字幕翻译', 'Subtitle Translation') : workspacePhase === 'result' ? l('视频翻译项目', 'Video Translation Project') : l('视频翻译配音', 'Translate & Dub Video')}</h1>
            <p>{workspacePhase === 'result' ? selectedSourceName : subtitleOnly ? sourceName : l('创建字幕、配音与多画幅成片', 'Create subtitles, dubbing, and videos in multiple formats')}</p>
          </div>
        </header>

        {workspacePhase === 'configure' ? (
          <div className="video-translation-configure-top">
            {!subtitleOnly ? <LocalTranscriptionNotice controller={props.runtimeDependencies}
              importedSubtitle={typeof creatorSession?.state.importedSourceSubtitleId === 'string' || typeof creatorSession?.state.importedTargetSubtitleId === 'string'}
              beforeNavigate={preserveComponentNavigationDraft} /> : null}
            {draftBaseVersion !== undefined ? (
              <div className="video-translation-draft-bar" role="status">
                <History size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  <strong>{l(`正在基于 V${draftBaseVersion} 调整`, `Adjusting from V${draftBaseVersion}`)}</strong>
                  <small>{l('原成品已保留，当前修改为配置草稿', 'The original output is preserved. Current changes are a draft.')}</small>
                </span>
                <button type="button" onClick={returnToBaseResult}>
                  <FileVideo size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l(`返回 V${draftBaseVersion} 成品`, `Return to V${draftBaseVersion} output`)}
                </button>
              </div>
            ) : null}
            <nav className="video-translation-steps" aria-label={l('翻译流程', 'Translation steps')}>
              <ol>
                {steps.map((step, index) => {
                  const completed = index < currentStep;
                  const active = index === currentStep;
                  return (
                    <li key={step} data-active={active} data-completed={completed}>
                      <button
                        type="button"
                        disabled={index > furthestStep}
                        aria-current={active ? 'step' : undefined}
                        onClick={() => index !== currentStep && openWizardStep(index as WizardStep)}
                      >
                        <span>{completed ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : index + 1}</span>
                        <strong>{localizeStep(step, l)}</strong>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>
        ) : null}

        <div className="video-translation-wizard-body" key={`${workspacePhase}-${currentStep}`}>
          {workspacePhase === 'result' ? (
            <VideoTranslationResultWorkspace
              workbench
              onBack={() => void leaveWorkspace(selectedSubtitleOnly ? 'project' : 'outputs')}
              onRequestOutput={requestOutput}
              generationLabel={generationLabel}
              outputUpToDate={outputUpToDate}
              outputActionDetail={outputActionDetail}
              outputDisabled={Boolean(sourcePreviewPending) || taskProgress?.active}
              outputBusyLabel={taskProgress?.active && !['prepare-source-video', 'preview-source-video'].includes(taskProgress.stage?.stageId ?? '') ? taskProgress.title : undefined}
              videoPreviewRequest={videoPreviewRequest}
              taskProgress={taskProgress ? <CreatorTaskProgressBar task={taskProgress}
                onDetails={() => {
                  setSubtitleAssistantOpen(true);
                  setTaskDetailsRequest(previous => ({ key: (previous?.key ?? 0) + 1, stageRunId: taskProgress.stage?.id }));
                }}
                onCancel={activeStage ? requestCancelTask : undefined}
                onResume={resumableStage ? () => void resumeTask() : undefined}
                controlPending={taskControlPending}
                onPreview={taskVideoArtifact && taskVideoVersion !== undefined ? () => {
                  selectResultVersion(taskVideoVersion);
                  setVideoPreviewRequest({ version: taskVideoVersion, key: `${taskProgress.workflow?.key}:${Date.now()}` });
                } : undefined}
                onDownload={taskVideoArtifact ? () => void exportResult('video', taskVideoArtifact.id) : undefined}
              /> : undefined}
              initialEditorContext={editorContextRef.current}
              onEditorContextChange={context => { editorContextRef.current = context; }}
              configurationAction={configurationRequired ? <div className="video-translation-service-setup" role="status">
                <p>{l('尚未配置可用的配音服务', 'A dubbing service needs to be configured')}</p>
                <button type="button" disabled={submitting} onClick={() => void configureDubbingService()}>{l('去配置配音服务', 'Configure dubbing service')}</button>
              </div> : undefined}
              generationSummary={generationSummary}
              staleOutputs={[...(staleArtifactKinds.has('dubbed_audio') && !reusableDubbedVideo || (subtitleNeedsRegeneration && hasVoiceArtifact) ? [l('配音', 'Dubbing')] : []),
                ...(staleArtifactKinds.has('dubbed_video') || staleArtifactKinds.has('horizontal_video') || staleArtifactKinds.has('vertical_video') || (videoOutputs.length > 0 && (subtitleNeedsRegeneration || hasConfigDraftChanges)) ? [l('视频', 'Video')] : [])]}
              subtitleAutosave
              subtitleSaveError={subtitleSaveError}
              subtitleOnly={selectedSubtitleOnly}
              activeTab={selectedSubtitleOnly && (resultTab === 'video' || resultTab === 'voice') ? 'subtitles' : resultTab}
              version={resultVersion}
              versions={resultVersions.map(({ value, description }) => ({ value, description }))}
              targetLanguage={selectedTargetLanguageLabel}
              outputLabel={selectedOutputLabel}
              subtitleStyleLabel={selectedSubtitleStyleLabel}
              dubbing={dubbing}
              hasVoiceArtifact={hasVoiceArtifact}
              videoOutputs={videoOutputs}
              preferCompletedVideoPreview={finalVideoEntries.length > 0 && finalVideoEntries.every(({ artifact }) => (
                artifact.status === 'completed' && !staleArtifactKinds.has(artifact.kind)
              ))}
              subtitleOutputs={selectedSubtitleOnly ? subtitleOutputs.filter(output => output.variant === 'horizontal') : subtitleOutputs}
              subtitleDownloads={[
                { kind: 'target_subtitle', label: l('译文 SRT', 'Translated SRT') },
                { kind: 'bilingual_subtitle', label: l('双语 SRT', 'Bilingual SRT') }
              ].flatMap(({ kind, label }) => {
                const artifact = latestArtifactForResultVersion(jobArtifacts, resultVersion, [kind], creatorSession?.state.resultSnapshots);
                return artifact ? [{ artifactId: artifact.id, label }] : [];
              })}
              subtitleVideoPreviews={subtitleVideoPreviews}
              previewPreparation={{ pending: Boolean(sourcePreviewPending), blocked: activeStage !== undefined, error: sourcePreviewError, errorDetail: sourcePreviewErrorDetail, progress: selectedPreviewStage ? <CreatorTaskProgressNotice stage={selectedPreviewStage} /> : undefined }}
              onPrepareSourceVideo={canPrepareSourcePreview ? () => void prepareSourcePreview() : undefined}
              voiceOutput={voiceOutput}
              subtitleDirty={subtitleDirty}
              subtitleDirtyByVariant={subtitleDirtyByVariant}
              subtitleSavePending={subtitleSaving}
              subtitleReadOnly={submitting}
              immersive={subtitleImmersive && subtitleOutputs.length > 0}
              editorSettings={!selectedSubtitleOnly ? {
                language: <><p>{l('修改语言或模型后需要重新翻译字幕。人工修改将保留在历史版本中。', 'Language or model changes require translating again. Manual edits remain in version history.')}</p>{languageControls}{translationModelControl}{transcriptionModelControl}<div className="video-translation-toggle-list">{subtitleImportControl}{platformCaptionsControl}</div></>,
                style: <><p>{l('样式用于视频预览和合成的视频；SRT 文件仅包含字幕文本与时间。', 'Styles apply to video previews and exported videos. SRT files contain subtitle text and timing only.')}</p>{subtitleLayoutControls}{subtitleStyleChoices}</>,
                voice: dubbingSettings,
                output: <><p>{l('选择画幅后合成带字幕的视频，字幕和样式修改会用于本次合成。', 'Choose a format to export a video with your current subtitles and style.')}</p>{outputFormatControl}{verticalTitleControls}</>,
                previewFormat: previewVerticalOutput ? 'vertical' : 'horizontal',
                previewTitles: subtitlePreviewTitles,
                disabled: speechSyncing || submitting || subtitleSaving || subtitleImportPending || activeGenerationStage !== undefined,
                onOpen: prepareEditorSettings
              } : undefined}
              renderSubtitlePreview={creatorSession?.prepareSubtitleRender && creatorSession.openSubtitleFont ? (cues, width, height, videoRef, variant) => {
                const settings = subtitleImmersive ? undefined : selectedResultSettings;
                const style = settings ? {
                  fontPreset: settings.subtitleFont, fontWeight: settings.subtitleWeight, fontSize: settings.subtitleSize,
                  primaryColor: settings.subtitleColor, secondaryColor: settings.subtitleSecondaryColor,
                  outlineColor: settings.subtitleOutlineColor, outlineWidth: settings.subtitleOutlineWidth,
                  verticalOffset: settings.subtitleVerticalOffset,
                  shadow: { enabled: settings.subtitleShadowEnabled, color: settings.subtitleShadowColor, opacity: settings.subtitleShadowOpacity,
                    offsetX: settings.subtitleShadowOffsetX, offsetY: settings.subtitleShadowOffsetY, blur: settings.subtitleShadowBlur }
                } : subtitleRenderStyle;
                return <SubtitleCompositionPreview prepare={creatorSession.prepareSubtitleRender!} openFont={creatorSession.openSubtitleFont!} videoRef={videoRef}
                  input={{ width, height, horizontal: variant === 'horizontal',
                    bilingual: settings?.bilingual ?? bilingual, subtitlePosition: settings?.subtitlePosition ?? subtitlePosition,
                    subtitleStyle: style, majorTitle: variant === 'vertical' ? settings?.verticalTitle ?? verticalTitle : '',
                    minorTitle: variant === 'vertical' ? settings?.verticalSubtitle ?? verticalSubtitle : '',
                    cues: normalizeSubtitleRenderCues({ cues,
                      legacyMixed: variant === 'vertical' && !Array.isArray(selectedVerticalSubtitleArtifact?.metadata.renderCues),
                      targetPosition: readJsonRecord(selectedVerticalSubtitleArtifact?.metadata.settingsSnapshot).subtitlePosition === 'bottom' ? 'bottom' : 'top',
                      targetCues: selectedSubtitleCues })
                  }} />;
              } : undefined}
              assistantOpen={subtitleAssistantOpen}
              onImmersiveChange={value => {
                if (value) {
                  setSubtitleImmersive(true);
                  prepareEditorSettings();
                  setResultTab('subtitles');
                } else {
                  showResultOutputs();
                }
              }}
              onToggleAssistant={() => setSubtitleAssistantOpen(value => !value)}
              onSubtitleCuesChange={updateSubtitleCues}
              nextVersion={nextVersion}
              affectedArtifacts={regenerationArtifacts}
              hasPendingChanges={hasPendingChanges}
              regenerationPending={resultProposal !== undefined}
              execution={resultExecution}
              notice={visibleResultNotice}
              onTabChange={tab => {
                setResultTab(tab);
                setResultNotice('');
              }}
              onVersionChange={selectResultVersion}
              onSubtitleChange={updateSubtitleText}
              onSaveSubtitles={saveSubtitles}
              onAdjustSettings={adjustSettingsFromResult}
              onExport={exportResult}
              onReloadVoice={() => setVoicePreviewReload(value => value + 1)}
              onRequestRegenerate={() => {
                setResultProposal('regenerate');
                setResultNotice('');
              }}
              onCancelRegenerate={() => setResultProposal(undefined)}
              onConfirmRegenerate={confirmRegeneration}
            />
          ) : null}

          {workspacePhase === 'configure' && currentStep === 0 ? (
            <>
            <div className="video-translation-source-modes" role="tablist" aria-label={l('素材类型', 'Source type')}>
              {([
                { value: 'url', label: l('翻译视频', 'Translate video'), icon: FileVideo },
                { value: 'subtitle', label: l('翻译字幕', 'Translate subtitles'), icon: Captions }
              ] as const).map(({ value, label, icon: Icon }) => <button
                key={value} type="button" role="tab" aria-selected={value === 'subtitle' ? subtitleOnly : !subtitleOnly}
                disabled={submitting || subtitleImportPending || activeStage !== undefined}
                onClick={() => {
                  if ((value === 'subtitle') === subtitleOnly) return;
                  setSourceType(value);
                  setAttemptedContinue(false);
                  setCurrentStep(0);
                  setFurthestStep(0);
                  creatorSession?.updateDraft({ sourceType: value,
                    ...(subtitleOnly && value !== 'subtitle' ? { importedSourceSubtitleId: null, importedTargetSubtitleId: null } : {}) });
                }}
              ><Icon size={16} aria-hidden="true" />{label}</button>)}
            </div>
            {subtitleOnly ? <section className="video-translation-step-panel video-translation-subtitle-source-step">
              <div className="video-translation-step-heading"><h2>{l('添加字幕', 'Add subtitles')}</h2></div>
              <VideoTranslationSubtitleImport sourceOnly sourceLanguage={sourceLanguage} targetLanguage={targetLanguage} disabled={submitting || activeGenerationStage !== undefined} onBusyChange={setSubtitleImportPending} />
            </section> : <VideoSourceInput
              showSupportedPlatforms
              file={videoFile}
              registeredFile={registeredSourceFile}
              sourceType={sourceType}
              url={videoUrl}
              hasSource={hasSource}
              invalid={attemptedContinue && !hasSource}
              metadataService={parsedVideoSource.kind === 'bilibili' ? undefined : props.videoMetadataService}
              metadata={currentUrlMetadata}
              previewEnabled={sourceSelectionReady}
              playbackPreview={sourceType === 'url' && parsedVideoSource.kind === 'link' ? {
                src: currentDraftSourcePreview?.src,
                pending: Boolean(draftPreviewPending),
                blocked: activeStage !== undefined,
                error: draftPreviewError,
                onPrepare: creatorSession !== null && currentSourceIdentity !== null ? () => void prepareDraftSourcePreview() : undefined
              } : undefined}
              onFileChange={chooseVideo}
              onUrlChange={url => {
                setVideoUrl(normalizeVideoSourceUrl(url));
                setSourceType('url');
                setVideoFile(null);
                setSourceOrientation('landscape');
                setAttemptedContinue(false);
              }}
              onClear={clearCurrentSource}
              onDimensions={updateSourceOrientation}
              onMetadata={(url, metadata) => {
                setUrlMetadata({ url, value: metadata });
              }}
            />}
            {sourceType === 'url' && parsedVideoSource.kind === 'bilibili' ? (
              <BilibiliPartSelector
                metadata={currentUrlMetadata}
                error={bilibiliMetadataError?.url === videoUrl ? bilibiliMetadataError.message : props.videoMetadataService === undefined
                  ? l('分集信息服务不可用，请确认 Creator Runtime 已连接', 'The parts service is unavailable. Check the Creator Runtime connection.') : undefined}
                onRetry={props.videoMetadataService === undefined ? undefined : () => {
                  setBilibiliMetadataError(undefined);
                  setMetadataRetry(value => value + 1);
                }}
                onSelect={selectBilibiliPart}
              />
            ) : null}
            </>
          ) : null}

          {workspacePhase === 'configure' && currentStep === 1 ? (
            <section className="video-translation-step-panel" aria-labelledby="translation-settings-title">
              <div className="video-translation-step-heading">
                <h2 id="translation-settings-title">{l('设置翻译语言', 'Set translation languages')}</h2>
                {!subtitleOnly ? <p>{l('先生成翻译字幕，完成后可直接下载，或继续调整样式、配音和合成视频。', 'Generate translated subtitles first, then download them or adjust styles, add dubbing, and export a video.')}</p> : null}
              </div>

              {languageControls}

              {translationModelControl}
              {transcriptionModelControl}

              <div className="video-translation-toggle-list">
                {subtitleImportControl}
                {platformCaptionsControl}
                {sourceType === 'url' ? <Switch checked={skipVideoDownload}
                  label={l('暂不下载原视频', 'Skip downloading the source video')}
                  description={skipVideoDownload ? l('先生成字幕；预览或合成时再下载视频', 'Generate subtitles first; download the video when previewing or composing')
                    : l('原视频下载与字幕生成同时开始，完成后即可预览', 'Download the video while generating subtitles so it is ready to preview')}
                  onChange={setSkipVideoDownload} /> : null}
              </div>
            </section>
          ) : null}

        </div>

        {workspacePhase === 'configure' ? (
        <div className="video-translation-actions-stack">
        {activeStage === undefined && resumableStage === undefined ? (
        <footer className="video-translation-wizard-actions">
          {currentStep > 0 ? (
            <button className="video-translation-secondary-action" type="button" onClick={() => setCurrentStep((currentStep - 1) as WizardStep)}>
              <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
              {l('上一步', 'Back')}
            </button>
          ) : <span />}
          {currentStep === 0 ? (
            <div className="video-translation-action-group">
              {attemptedContinue && !hasSource ? (
                <p className="video-translation-error" role="alert">{subtitleOnly ? l('请先添加需要翻译的 SRT 字幕', 'Add an SRT file to translate first') : l('请先添加需要翻译的视频', 'Add a video to translate first')}</p>
              ) : null}
              {attemptedContinue && hasSource && !sourceSelectionReady ? (
                <p className="video-translation-error" role="alert">{l('请确认链接有效，并选择要翻译的分集后继续', 'Check the link and choose a part before continuing')}</p>
              ) : null}
              <button className="video-translation-primary-action" type="button" disabled={subtitleImportPending} onClick={continueToSettings}>
                {l('继续', 'Continue')}
                <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          ) : currentStep < steps.length - 1 ? (
            <button className="video-translation-primary-action" type="button" onClick={() => openWizardStep((currentStep + 1) as WizardStep)}>
              {l('继续', 'Continue')}
              <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : (
            <button className="video-translation-primary-action" type="button" disabled={submitting} onClick={() => void submit()}>
              {submitting
                ? submissionPhase === 'uploading'
                  ? l('正在上传...', 'Uploading...')
                  : l('正在启动...', 'Starting...')
                : draftBaseVersion === undefined
                  ? l('开始翻译', 'Start translation')
                  : `${l('生成', 'Generate')} V${nextVersion}`}
              <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
        </footer>
        ) : null}
        {resultNotice && !runIssueMessage ? (
          <div className="video-translation-run-notice" role="status">{resultNotice}</div>
        ) : null}
        </div>
        ) : null}
          </div>}
          agentPanel={<VideoTranslationAgentPanel
            stepLabel={workspacePhase === 'result' ? l('项目结果', 'Project results') : localizeStep(steps[Math.min(currentStep, 1) as WizardStep], l)}
            contextSummary={agentContextSummary}
            taskSummary={<CreatorTaskSummary
              sourceIcon={subtitleOnly ? Captions : FileVideo}
              sourceLabel={subtitleOnly ? l('字幕文件', 'Subtitle file') : l('视频来源', 'Video source')}
              sourceValue={sourceName}
              items={summaryItems}
              compactSummary={`${languageLabel(sourceLanguages, sourceLanguage)} → ${targetLanguageLabel} · ${outputLabel}`}
            />}
            promptHint={props.promptHint}
            currentIssue={runIssueMessage || undefined}
            quickActions={[
              ...(needsCreatorServicesConfiguration(sessionError?.code, needsInput?.code, stageConfigurationCode) ? [{
                id: 'open-ai-services',
                label: l('打开 AI 服务设置', 'Open AI service settings'),
                kind: 'action' as const,
                onAction: () => { window.location.hash = creatorServicesSettingsHref(sessionError?.code, needsInput?.code, stageConfigurationCode); }
              }] : []),
              {
                id: 'open-settings',
                label: workspacePhase === 'result'
                  ? l('调整任务设置', 'Adjust settings')
                  : l('打开翻译设置', 'Open translation settings'),
                kind: 'action',
                onAction: () => workspacePhase === 'result'
                  ? adjustSettingsFromResult()
                  : openWizardStep(1)
              },
              ...(workspacePhase === 'configure' || activeStage !== undefined || resumableStage !== undefined ? [{
                id: 'run-translation',
                label: activeStage !== undefined
                  ? activeStage.progress.cancelRequested === true
                    ? l('正在终止...', 'Stopping...')
                    : l('终止任务', 'Stop task')
                  : resumableStage !== undefined
                    ? l('继续任务', 'Resume task')
                    : l('开始翻译', 'Start translation'),
                kind: 'action',
                disabled: taskControlPending !== undefined || activeStage?.progress.cancelRequested === true,
                onAction: () => activeStage !== undefined
                  ? requestCancelTask()
                  : resumableStage !== undefined
                    ? void resumeTask()
                    : void submit()
              } as const] : []),
              {
                id: 'agent-review',
                label: l('让 Agent 检查设置', 'Ask Agent to review settings'),
                kind: 'agent',
                prompt: l('检查当前视频翻译设置，指出缺失项，并给出下一步建议。', 'Review the current video translation settings, identify missing inputs, and recommend the next step.')
              }
            ]}
            onCancelTask={requestCancelTask}
            onResumeTask={() => void resumeTask()}
            taskControlPending={taskControlPending}
          />}
        />
      </div>
      {styleDrawerSnapshot !== undefined ? createPortal(
        <div
          className="video-translation-style-drawer-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeStyleDrawer(true);
          }}
        >
          <section
            className="video-translation-style-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-translation-style-drawer-title"
          >
            <header>
              <h2 id="video-translation-style-drawer-title">
                {editingSavedStyle !== undefined ? l('编辑模版', 'Edit template') : l('自定义字幕样式', 'Customize subtitle style')}
              </h2>
              <div>
                <button type="button" aria-label={l('恢复默认样式', 'Reset to default style')} title={l('恢复默认样式', 'Reset to default style')} onClick={() => applySubtitleStyle(defaultSubtitleStyle)}>
                  <RotateCcw size={15} aria-hidden="true" />
                </button>
                <button type="button" aria-label={l('关闭', 'Close')} title={l('关闭', 'Close')} onClick={() => closeStyleDrawer(true)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="video-translation-style-drawer-body">
              {editingSavedStyle !== undefined ? (
                <label className="video-translation-field">
                  <span>{l('模版名称', 'Template name')}</span>
                  <input
                    maxLength={24}
                    value={editingSavedStyle.name}
                    onChange={event => setEditingSavedStyle({ ...editingSavedStyle, name: event.target.value })}
                  />
                </label>
              ) : null}
              {subtitleStyleEditor}
            </div>
            {saveStyleName !== undefined ? (
              <form
                className="video-translation-style-drawer-save"
                onSubmit={event => { event.preventDefault(); saveCurrentSubtitleStyle(saveStyleName); }}
              >
                <label className="video-translation-field">
                  <span>{l('模版名称', 'Template name')}</span>
                  <input
                    autoFocus
                    maxLength={24}
                    value={saveStyleName}
                    placeholder={l('例如：口播黄字', 'e.g. Talking-head yellow')}
                    onChange={event => setSaveStyleName(event.target.value)}
                    onKeyDown={event => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      setSaveStyleName(undefined);
                    }}
                  />
                </label>
                <button type="button" onClick={() => setSaveStyleName(undefined)}>{l('取消', 'Cancel')}</button>
                <button type="submit" data-intent="primary" disabled={saveStyleName.trim() === ''}>{l('保存', 'Save')}</button>
              </form>
            ) : null}
            <footer>
              <button
                type="button"
                data-intent="ghost"
                disabled={saveStyleName !== undefined}
                onClick={() => setSaveStyleName(l(`我的样式 ${savedSubtitleStyles.length + 1}`, `My style ${savedSubtitleStyles.length + 1}`))}
              >
                <Plus size={14} aria-hidden="true" />
                {l('另存为模版', 'Save as template')}
              </button>
              <span />
              <button type="button" onClick={() => closeStyleDrawer(true)}>{l('取消', 'Cancel')}</button>
              <button
                type="button"
                data-intent="primary"
                disabled={editingSavedStyle !== undefined && editingSavedStyle.name.trim() === ''}
                onClick={() => { updateEditingSavedStyle(); closeStyleDrawer(false); }}
              >
                {editingSavedStyle !== undefined ? l('保存修改', 'Save changes') : l('完成', 'Done')}
              </button>
            </footer>
          </section>
        </div>,
        document.body
      ) : null}
      {cancelDialogOpen && activeStage !== undefined ? (
        <div
          className="video-translation-confirm-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setCancelDialogOpen(false);
          }}
        >
          <section
            className="video-translation-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-translation-cancel-title"
          >
            <header>
              <span aria-hidden="true"><Square size={18} fill="currentColor" /></span>
              <div>
                <h2 id="video-translation-cancel-title">{l('终止翻译任务？', 'Stop translation task?')}</h2>
                <p>
                  {stageCancelDescription(activeStage, l)}
                </p>
              </div>
            </header>
            <div className="video-translation-confirm-note">
              <strong>{l('终止后如何继续', 'How resuming works')}</strong>
              <span>{stageResumeDescription(activeStage, l)}</span>
            </div>
            <footer>
              <button type="button" onClick={() => setCancelDialogOpen(false)}>
                {l('取消', 'Cancel')}
              </button>
              <button
                ref={cancelConfirmRef}
                type="button"
                data-intent="danger"
                onClick={() => void cancelTask()}
              >
                <Square size={15} fill="currentColor" aria-hidden="true" />
                {l('终止任务', 'Stop task')}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function readArtifactString(artifact: CreatorArtifact, key: string): string | undefined {
  const value = artifact.metadata[key];
  return typeof value === 'string' ? value : undefined;
}

function readArtifactNumber(artifact: CreatorArtifact | undefined, key: string): number | undefined {
  const value = artifact?.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sourceArtifactMatchesFile(artifact: CreatorArtifact, file: File): boolean {
  return readArtifactString(artifact, 'fileName') === file.name
    && readArtifactNumber(artifact, 'size') === file.size
    && readArtifactNumber(artifact, 'lastModified') === file.lastModified;
}

function mediaPreviewErrorMessage(kind: 'video' | 'voice', localize: LocalizeCopy): string {
  return kind === 'video'
    ? localize('视频预览加载失败，请稍后重试。', 'The video preview failed to load. Try again later.', 'Det gick inte att läsa in videoförhandsvisningen. Försök igen senare.')
    : localize('配音预览加载失败，请稍后重试。', 'The dubbing preview failed to load. Try again later.', 'Det gick inte att läsa in dubbningsförhandsvisningen. Försök igen senare.');
}

function creatorErrorMessage(cause: unknown, l: LocalizeCopy): string {
  const candidate = cause as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  if (code === 'creator_revision_conflict') {
    return l('任务状态刚刚发生变化，请重试一次。你的设置没有丢失。', 'The task changed just now. Retry once; your settings are preserved.');
  }
  if (code === 'creator_job_not_running') {
    return l('任务已经结束，无需再次终止。', 'The task has already ended.');
  }
  if (code === 'creator_job_not_resumable') {
    return l('当前任务没有可继续的终止阶段。', 'This task has no stopped stage to resume.');
  }
  if (code === 'creator_job_control_unavailable') {
    return l('当前 Creator Runtime 不支持任务终止与继续。', 'The current Creator Runtime does not support stopping and resuming tasks.');
  }
  if (code === 'creator_source_missing') {
    return l('本地视频尚未上传，请重新选择视频后再试。', 'The local video has not been uploaded. Select it again and retry.');
  }
  if (code === 'creator_source_too_large') {
    return l('本地视频文件过大，无法上传到当前创作项目。', 'The local video is too large to upload to this creator project.');
  }
  if (code === 'creator_source_invalid' || code === 'creator_source_type_unsupported') {
    return l('无法读取该本地媒体文件，请选择有效的视频或音频文件。', 'The local media file could not be read. Choose a valid video or audio file.');
  }
  if (code === 'creator_source_upload_failed') {
    return l('本地视频上传失败，请检查服务状态后重试。', 'The local video upload failed. Check the service and retry.');
  }
  if (code === 'creator_llm_config_missing') {
    return l('开始翻译前需要配置文本翻译模型 API。', 'Configure the text translation model API before starting.');
  }
  if (code === 'creator_transcription_language_unsupported') return l('当前识别模型不支持所选源语言，请更换识别服务或导入原文字幕', 'This model does not support the source language. Change the speech service or import source subtitles');
  if (code === 'creator_transcription_timestamps_unavailable') return l('请选择提供字幕时间戳的识别服务', 'Choose a speech service that provides subtitle timestamps');
  if (code === 'creator_transcription_config_missing') {
    return l('当前字幕策略需要配置语音识别服务。', 'The current subtitle strategy requires a transcription service.');
  }
  if (code === 'creator_tts_config_missing') {
    return l('已开启配音，请先配置配音服务。', 'Dubbing is enabled. Configure a TTS service first.');
  }
  if (code === 'unsupported_source') {
    return l('请使用 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书、Pinterest、Reddit 的单个公开视频链接或已上传的本地视频。', 'Use a single public video link from YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, or Reddit, or an uploaded local video.');
  }
  return l('启动翻译失败，请在 Agent 区域查看诊断后重试。', 'Failed to start translation. Review the diagnosis in the Agent panel and retry.');
}

function isVideoCompositionStage(stageId: TranslationStageId | undefined): boolean {
  return stageId === 'render-horizontal' || stageId === 'render-vertical';
}

function translationStageLabel(stageId: string, l: LocalizeCopy): string {
  if (stageId === 'prepare-source-video') return l('原视频预览准备', 'Source video preview preparation');
  if (stageId === 'subtitle') return l('字幕翻译', 'Subtitle translation');
  if (stageId === 'tts') return l('配音生成', 'Dubbing');
  if (stageId === 'render-horizontal') return l('横屏成片', 'Landscape render');
  if (stageId === 'render-vertical') return l('竖屏成片', 'Portrait render');
  return l('当前阶段', 'Current stage');
}

function stageCancelDescription(
  stage: import('@opencreator/protocol').CreatorStageRun,
  l: LocalizeCopy
): string {
  const percent = creatorStageProgressPercent(stage);
  const label = translationStageLabel(stage.stageId, l);
  if (stage.status === 'queued') {
    return l(
      `“${label}”正在等待执行。`,
      `"${label}" is waiting to run.`
    );
  }
  return percent === null
    ? l(`当前正在执行“${label}”。`, `Currently running "${label}".`)
    : l(
        `当前正在执行“${label}”，进度 ${percent}%。`,
        `Currently running "${label}" at ${percent}%.`
      );
}

function stageResumeDescription(
  stage: import('@opencreator/protocol').CreatorStageRun,
  l: LocalizeCopy
): string {
  const label = translationStageLabel(stage.stageId, l);
  if (stage.stageId === 'subtitle' && typeof stage.progress.translationResumeKey === 'string') {
    return l('继续任务会保留已保存的译文；来源、语言和模型一致时，从尚未完成的内容继续。',
      'Saved translations are preserved. With the same source, languages and model, the task continues with unfinished content.');
  }
  if (stage.status === 'queued') {
    return l(
      `已完成阶段和产物会保留。继续任务时，“${label}”会重新进入执行队列。`,
      `Completed stages and outputs are preserved. Resuming places "${label}" back in the execution queue.`
    );
  }
  const percent = creatorStageProgressPercent(stage);
  return percent === null
    ? l(
        `已完成阶段和产物会保留。继续任务时，“${label}”会从头重新执行。`,
        `Completed stages and outputs are preserved. Resuming restarts "${label}" from the beginning.`
      )
    : l(
        `已完成阶段和产物会保留。继续任务时，“${label}”会从头重新执行，当前 ${percent}% 的阶段内进度不会保留。`,
        `Completed stages and outputs are preserved. Resuming restarts "${label}" from the beginning; its current ${percent}% progress is not preserved.`
      );
}

function stageErrorMessage(code: string | null, message: string | null, l: LocalizeCopy): string {
  const configurationCode = normalizeStageConfigurationError(code, message);
  if (configurationCode !== null) return creatorErrorMessage({ code: configurationCode }, l);
  if (code === 'dependency_not_packaged') {
    return l('当前安装包缺少所选语音识别能力，请更换服务或重新安装完整运行时。', 'The selected transcription runtime is not packaged. Choose another service or reinstall the full runtime.');
  }
  return l('翻译阶段执行失败，请在 Agent 区域查看诊断和服务配置。', 'The translation stage failed. Review the diagnosis in the Agent panel and service configuration.');
}

function normalizeStageConfigurationError(code: string | null | undefined, message: string | null | undefined): string | null {
  if (
    code === 'creator_llm_config_missing'
    || code === 'creator_transcription_config_missing'
    || code === 'creator_tts_config_missing'
  ) return code;
  if (code === 'usage' && typeof message === 'string') {
    if (/OpenAI.*(?:转录|transcri)|(?:转录|transcri).*OpenAI/i.test(message)) return 'creator_transcription_config_missing';
    if (/(?:TTS|配音|语音合成)/i.test(message)) return 'creator_tts_config_missing';
    if (/(?:LLM|大模型|文本翻译)/i.test(message)) return 'creator_llm_config_missing';
  }
  return null;
}

function needsCreatorServicesConfiguration(...codes: Array<string | null | undefined>): boolean {
  return codes.some(code => (
    code === 'creator_llm_config_missing'
    || ['creator_transcription_config_missing', 'creator_transcription_language_unsupported', 'creator_transcription_timestamps_unavailable'].includes(code ?? '')
    || code === 'creator_tts_config_missing'
  ));
}

function readCreatorNeedsInput(
  value: unknown,
  dubbing: boolean
): { code: string; message: string } | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string') return null;
  if (record.code === 'creator_tts_config_missing' && !dubbing) return null;
  return {
    code: record.code,
    message: typeof record.message === 'string' ? record.message : ''
  };
}

function creatorServicesSettingsHref(...codes: Array<string | null | undefined>): string {
  const code = codes.find(candidate => needsCreatorServicesConfiguration(candidate));
  const section = code === 'creator_tts_config_missing'
    ? 'tts'
    : ['creator_transcription_config_missing', 'creator_transcription_language_unsupported', 'creator_transcription_timestamps_unavailable'].includes(code ?? '')
      ? 'transcription'
      : 'text';
  return `#/settings?tab=ai-services&section=${section}`;
}

function localizeStep(step: typeof videoSteps[number] | undefined, l: LocalizeCopy): string {
  if (step === '添加素材') return l(step, 'Add source');
  return l('翻译设置', 'Translation');
}

function localizeFormatLabel(label: '横屏' | '竖屏' | '全部', l: LocalizeCopy): string {
  if (label === '横屏') return l(label, 'Horizontal');
  if (label === '竖屏') return l(label, 'Vertical');
  return l(label, 'Both');
}
