import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  ChevronDown,
  CircleStop,
  FileVideo,
  History,
  Languages,
  Mic2,
  MonitorPlay,
  Play,
  Sparkles
} from 'lucide-react';
import { beginPaneResize } from '../../components/layout/pane-resize-2026-07-29.js';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import VideoTranslationAgentPanel from './VideoTranslationAgentPanel.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import VideoSourceInput from './VideoSourceInput.js';
import VideoSourcePreview from './VideoSourcePreview.js';
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
import { useOptionalCreatorSession } from './creator-session-store.js';
import {
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorResultSnapshot,
  type CreatorTtsProvider
} from '@opencreator/protocol';

type SourceType = 'url' | 'file';
type SubtitlePosition = 'top' | 'bottom';
type SubtitleFont = 'system' | 'sans' | 'serif' | 'rounded';
type SubtitleWeight = 'regular' | 'medium' | 'bold';
type SubtitleSize = 'small' | 'medium' | 'large';
type VideoFormat = 'horizontal' | 'vertical' | 'all';
type VideoOrientation = 'landscape' | 'portrait';
type WizardStep = 0 | 1 | 2 | 3;
type WorkspacePhase = 'configure' | 'result';
type ResultProposal = 'regenerate';
type AgentFocus = 'language' | 'subtitles' | 'dubbing' | 'output';
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

type SubtitleStyleSettings = Pick<
  TranslationSettingsSnapshot,
  | 'subtitleFont'
  | 'subtitleWeight'
  | 'subtitleSize'
  | 'subtitleColor'
  | 'subtitleSecondaryColor'
  | 'subtitleOutlineColor'
  | 'subtitleOutlineWidth'
  | 'subtitleShadowEnabled'
  | 'subtitleShadowColor'
  | 'subtitleShadowOpacity'
  | 'subtitleShadowOffsetX'
  | 'subtitleShadowOffsetY'
  | 'subtitleShadowBlur'
>;

type TranslationSourceSnapshot = {
  sourceType: SourceType;
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

const steps = ['添加视频', '翻译设置', '字幕样式', '配音与输出'] as const;
const subtitleColors = ['#FFFFFF', '#FFE45C', '#7EE7FF', '#A7F3D0'] as const;
const defaultSubtitleStyle: SubtitleStyleSettings = {
  subtitleFont: 'sans',
  subtitleWeight: 'bold',
  subtitleSize: 'medium',
  subtitleColor: '#FFFFFF',
  subtitleSecondaryColor: '#D1D5DB',
  subtitleOutlineColor: '#000000',
  subtitleOutlineWidth: 2.5,
  subtitleShadowEnabled: true,
  subtitleShadowColor: '#000000',
  subtitleShadowOpacity: 0.6,
  subtitleShadowOffsetX: 1.5,
  subtitleShadowOffsetY: 1.5,
  subtitleShadowBlur: 0.5
};
const WORKSPACE_MIN_WIDTH = 780;
const AGENT_MIN_WIDTH = 320;
const WORKSPACE_RESIZE_HANDLE_WIDTH = 7;
const WORKSPACE_RESIZE_KEY_STEP = 32;

const sourceLanguages: LanguageOption[] = [
  { value: 'zh_cn', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'de', label: 'Deutsch' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'ru', label: 'Русский' },
  { value: 'ms', label: 'Bahasa Melayu' }
];

const targetLanguages: LanguageOption[] = [
  { value: 'zh_cn', label: '简体中文' },
  { value: 'zh_tw', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'th', label: 'ภาษาไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'fil', label: 'Wikang Filipino' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'pl', label: 'Polski' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'uk', label: 'Українська' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'he', label: 'עברית' },
  { value: 'fa', label: 'فارسی' },
  { value: 'af', label: 'Afrikaans' },
  { value: 'sv', label: 'Svenska' },
  { value: 'fi', label: 'Suomi' },
  { value: 'da', label: 'Dansk' },
  { value: 'no', label: 'Norsk' },
  { value: 'el', label: 'Ελληνικά' },
  { value: 'hu', label: 'Magyar' },
  { value: 'sr', label: 'Српски' },
  { value: 'hr', label: 'Hrvatski' },
  { value: 'cs', label: 'Čeština' },
  { value: 'pinyin', label: '拼音' },
  { value: 'sw', label: 'Kiswahili' },
  { value: 'yo', label: 'Èdè Yorùbá' },
  { value: 'ha', label: 'Hausa' },
  { value: 'am', label: 'አማርኛ' },
  { value: 'om', label: 'Afaan Oromoo' },
  { value: 'is', label: 'Íslenska' },
  { value: 'lb', label: 'Lëtzebuergesch' },
  { value: 'ca', label: 'Català' },
  { value: 'ro', label: 'Română' },
  { value: 'sk', label: 'Slovenčina' },
  { value: 'bs', label: 'Bosanski' },
  { value: 'mk', label: 'Македонски' },
  { value: 'sl', label: 'Slovenščina' },
  { value: 'bg', label: 'Български' },
  { value: 'lv', label: 'Latviešu' },
  { value: 'lt', label: 'Lietuvių' },
  { value: 'et', label: 'Eesti' },
  { value: 'mt', label: 'Malti' },
  { value: 'sq', label: 'Shqip' },
  { value: 'pa', label: 'ਪੰਜਾਬੀ' },
  { value: 'jv', label: 'ꦧꦱꦗꦮ' },
  { value: 'ta', label: 'தமிழ்' },
  { value: 'ur', label: 'اردو' },
  { value: 'mr', label: 'मराठी' },
  { value: 'te', label: 'తెలుగు' },
  { value: 'ps', label: 'پښتو' },
  { value: 'ln', label: 'Lingála' },
  { value: 'ml', label: 'മലയാളം' },
  { value: 'cnh', label: 'Hakha Chin' },
  { value: 'uz', label: 'Oʻzbekcha' },
  { value: 'kn', label: 'ಕನ್ನಡ' },
  { value: 'or', label: 'ଓଡ଼ିଆ' },
  { value: 'ig', label: 'Igbo' },
  { value: 'zu', label: 'isiZulu' },
  { value: 'xh', label: 'isiXhosa' },
  { value: 'km', label: 'ភាសាខ្មែរ' },
  { value: 'lo', label: 'ພາສາລາວ' },
  { value: 'ka', label: 'ქართული' },
  { value: 'hy', label: 'Հայերեն' },
  { value: 'tg', label: 'Тоҷикӣ' },
  { value: 'tk', label: 'Türkmençe' },
  { value: 'kk', label: 'Қазақша' },
  { value: 'ky', label: 'Кыргызча' },
  { value: 'mn', label: 'Монгол хэл' },
  { value: 'gd', label: 'Gàidhlig' },
  { value: 'ga', label: 'Gaeilge' },
  { value: 'cy', label: 'Cymraeg' },
  { value: 'ba', label: 'Башҡортса' },
  { value: 'ceb', label: 'Bisaya' },
  { value: 'ilo', label: 'Ilokano' },
  { value: 'tt', label: 'Татарча' },
  { value: 'pi', label: 'पाऴि' },
  { value: 'rw', label: 'Ikinyarwanda' },
  { value: 'be', label: 'Беларуская' },
  { value: 'mg', label: 'Malagasy' },
  { value: 'tvl', label: 'Te Ggana Tuuvalu' },
  { value: 'mh', label: 'Kajin M̧ajeļ' },
  { value: 'ch', label: 'Chamoru' },
  { value: 'sm', label: 'Gagana Samoa' },
  { value: 'to', label: 'Lea faka-Tonga' },
  { value: 'mi', label: 'Māori' },
  { value: 'tpi', label: 'Tok Pisin' },
  { value: 'cv', label: 'Чӑвашла' },
  { value: 'kv', label: 'Коми кыв' },
  { value: 'gv', label: 'Gaelg' }
];

function languageLabel(options: LanguageOption[], value: string) {
  return options.find(option => option.value === value)?.label ?? value;
}

function ttsProviderLabel(provider: CreatorTtsProvider, l: LocalizeCopy): string {
  if (provider === 'aliyun') return l('阿里云百炼', 'Alibaba Cloud Model Studio');
  if (provider === 'minimax') return 'MiniMax';
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

function subtitleFontFamily(value: SubtitleFont, weight: SubtitleWeight) {
  const suffix = ({ regular: 'Regular', medium: 'Medium', bold: 'Bold' } as const)[weight];
  if (value === 'serif') return `"OpenCreator Serif ${suffix}", Georgia, serif`;
  if (value === 'rounded') {
    return `"OpenCreator Rounded ${suffix}", "OpenCreator Sans ${suffix}", system-ui, sans-serif`;
  }
  return `"OpenCreator Sans ${suffix}", system-ui, sans-serif`;
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
  left: TranslationSettingsSnapshot,
  right: TranslationSettingsSnapshot
): boolean {
  return left.subtitleFont === right.subtitleFont
    && left.subtitleWeight === right.subtitleWeight
    && left.subtitleSize === right.subtitleSize
    && left.subtitleColor === right.subtitleColor
    && left.subtitleSecondaryColor === right.subtitleSecondaryColor
    && left.subtitleOutlineColor === right.subtitleOutlineColor
    && left.subtitleOutlineWidth === right.subtitleOutlineWidth
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
  subtitleNeedsRegeneration: boolean
) {
  const subtitleInputsChanged = !canReuseSubtitleCues(version, settings, source)
    || version.settings.bilingual !== settings.bilingual
    || version.settings.subtitlePosition !== settings.subtitlePosition;
  const subtitleStyleChanged = !sameSubtitleStyle(version.settings, settings);
  const voiceChanged = version.settings.dubbing !== settings.dubbing
    || version.settings.ttsProvider !== settings.ttsProvider
    || version.settings.ttsModel !== settings.ttsModel
    || version.settings.voiceCode !== settings.voiceCode
    || version.settings.voiceName !== settings.voiceName;
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
  staleArtifactKinds: ReadonlySet<string> = new Set()
): TranslationStageId | undefined {
  const changes = translationChanges(
    version,
    settings,
    source,
    subtitleNeedsRegeneration
  );
  if (changes.subtitleInputsChanged) return 'subtitle';
  if (
    settings.dubbing
    && (
      changes.subtitleContentChanged
      || changes.voiceChanged
      || staleArtifactKinds.has('dubbed_audio')
      || staleArtifactKinds.has('dubbed_video')
    )
  ) return 'tts';
  if (
    settings.composeVideo
    && (
      changes.subtitleContentChanged
      || changes.subtitleStyleChanged
      || changes.voiceChanged
      || changes.outputChanged
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

function serializeResultVersions(versions: TranslationResultVersion[]): CreatorJson {
  return versions.map((version): PersistedTranslationResultVersion => ({
    ...version,
    source: {
      sourceType: version.source.sourceType,
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
    if (sourceRecord.sourceType !== 'url' && sourceRecord.sourceType !== 'file') return [];
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

export function subtitleCuesFromArtifact(artifact: CreatorArtifact | undefined): SubtitleCue[] {
  const cues = artifact?.metadata.cues;
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
    return [{ id: record.id, start: record.start, end: record.end, text: record.text }];
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

function applySubtitleTextEdits(
  cues: SubtitleCue[],
  edits: Record<string, Partial<Pick<SubtitleCue, 'text' | 'sourceText'>>> | undefined
): SubtitleCue[] {
  if (edits === undefined) return cues;
  return cues.map(cue => {
    const edit = edits[String(cue.id)];
    return edit === undefined ? cue : { ...cue, ...edit };
  });
}

function subtitleTextChanged(
  original: SubtitleCue[],
  edited: SubtitleCue[]
): boolean {
  if (original.length !== edited.length) return true;
  return original.some((cue, index) => cue.text !== edited[index]?.text || cue.sourceText !== edited[index]?.sourceText);
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
      const resultSourceType = sourceState.sourceType === 'file'
        ? 'file'
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
            : persisted?.settings.sourceLanguage ?? 'zh_cn',
          targetLanguage: typeof sourceState.targetLanguage === 'string'
            ? sourceState.targetLanguage
            : persisted?.settings.targetLanguage ?? 'en',
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
          composeVideo: videoArtifacts.length > 0 || sourceState.composeVideo === true,
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
  const resultSourceType = sourceState.sourceType === 'file'
    ? 'file'
    : persisted?.source.sourceType ?? (fallbackState.sourceType === 'file' ? 'file' : 'url');
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
      sourceLanguage: readStringSetting(sourceState, fallbackState, persisted, 'sourceLanguage', 'zh_cn'),
      targetLanguage: readStringSetting(sourceState, fallbackState, persisted, 'targetLanguage', 'en'),
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
    || value === 'edge-tts';
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
  l: LocalizeCopy
) {
  const changes = translationChanges(version, settings, source, subtitleNeedsRegeneration);
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

export default function VideoTranslationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  videoMetadataService?: VideoMetadataService;
  creatorServicesService?: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const creatorSession = useOptionalCreatorSession();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const collabLayoutRef = useRef<HTMLDivElement>(null);
  const agentFocusTimeoutRef = useRef<number>();
  const skipPersistRef = useRef(false);
  const restoredResultNavigationRef = useRef<{
    jobId: string;
    latestVersion: number | null;
  }>();
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [furthestStep, setFurthestStep] = useState<WizardStep>(0);
  const [workspacePhase, setWorkspacePhase] = useState<WorkspacePhase>('configure');
  const [sourceType, setSourceType] = useState<SourceType>('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [videoFileSize, setVideoFileSize] = useState<number | null>(null);
  const [videoFileLastModified, setVideoFileLastModified] = useState<number | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('en');
  const [targetLanguage, setTargetLanguage] = useState('zh_cn');
  const [bilingual, setBilingual] = useState(true);
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>('top');
  const [preferPlatformCaptions, setPreferPlatformCaptions] = useState(true);
  const [subtitleFont, setSubtitleFont] = useState<SubtitleFont>(defaultSubtitleStyle.subtitleFont);
  const [subtitleWeight, setSubtitleWeight] = useState<SubtitleWeight>(defaultSubtitleStyle.subtitleWeight);
  const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>(defaultSubtitleStyle.subtitleSize);
  const [subtitleColor, setSubtitleColor] = useState(defaultSubtitleStyle.subtitleColor);
  const [subtitleSecondaryColor, setSubtitleSecondaryColor] = useState(defaultSubtitleStyle.subtitleSecondaryColor);
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState(defaultSubtitleStyle.subtitleOutlineColor);
  const [subtitleOutlineWidth, setSubtitleOutlineWidth] = useState(defaultSubtitleStyle.subtitleOutlineWidth);
  const [subtitleShadowEnabled, setSubtitleShadowEnabled] = useState(defaultSubtitleStyle.subtitleShadowEnabled);
  const [subtitleShadowColor, setSubtitleShadowColor] = useState(defaultSubtitleStyle.subtitleShadowColor);
  const [subtitleShadowOpacity, setSubtitleShadowOpacity] = useState(defaultSubtitleStyle.subtitleShadowOpacity);
  const [subtitleShadowOffsetX, setSubtitleShadowOffsetX] = useState(defaultSubtitleStyle.subtitleShadowOffsetX);
  const [subtitleShadowOffsetY, setSubtitleShadowOffsetY] = useState(defaultSubtitleStyle.subtitleShadowOffsetY);
  const [subtitleShadowBlur, setSubtitleShadowBlur] = useState(defaultSubtitleStyle.subtitleShadowBlur);
  const [dubbing, setDubbing] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<CreatorTtsProvider>('openai');
  const [ttsModel, setTtsModel] = useState('gpt-4o-mini-tts');
  const [voiceCode, setVoiceCode] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const [composeVideo, setComposeVideo] = useState(false);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('horizontal');
  const [sourceOrientation, setSourceOrientation] = useState<VideoOrientation>(() => (
    creatorSession?.state.sourceOrientation === 'portrait' ? 'portrait' : 'landscape'
  ));
  const [verticalTitle, setVerticalTitle] = useState('');
  const [verticalSubtitle, setVerticalSubtitle] = useState('');
  const [attemptedContinue, setAttemptedContinue] = useState(false);
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState<number>();
  const [resultTab, setResultTab] = useState<VideoTranslationResultTab>('video');
  const [resultVersion, setResultVersion] = useState(1);
  const [resultVersions, setResultVersions] = useState<TranslationResultVersion[]>([]);
  const [subtitleTextEdits, setSubtitleTextEdits] = useState<Record<string, Record<string, Partial<Pick<SubtitleCue, 'text' | 'sourceText'>>>>>({});
  const [draftBaseVersion, setDraftBaseVersion] = useState<number>();
  const [resultProposal, setResultProposal] = useState<ResultProposal>();
  const [resultNotice, setResultNotice] = useState('');
  const [voicePreviewReload, setVoicePreviewReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<'uploading' | 'starting'>();
  const [startRevisionConflict, setStartRevisionConflict] = useState(false);
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [agentFocus, setAgentFocus] = useState<AgentFocus>();
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (creatorSession === null) return;
    skipPersistRef.current = true;
    const persisted = creatorSession.state;
    if (persisted.sourceType === 'url' || persisted.sourceType === 'file') setSourceType(persisted.sourceType);
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
    const persistedSubtitleStyle = readSubtitleStyleSettings(persisted, {}, undefined);
    setSubtitleFont(persistedSubtitleStyle.subtitleFont);
    setSubtitleWeight(persistedSubtitleStyle.subtitleWeight);
    setSubtitleSize(persistedSubtitleStyle.subtitleSize);
    setSubtitleColor(persistedSubtitleStyle.subtitleColor);
    setSubtitleSecondaryColor(persistedSubtitleStyle.subtitleSecondaryColor);
    setSubtitleOutlineColor(persistedSubtitleStyle.subtitleOutlineColor);
    setSubtitleOutlineWidth(persistedSubtitleStyle.subtitleOutlineWidth);
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
    setSourceOrientation(videoOrientationFromDimensions(
      persistedSourceArtifact?.metadata.width,
      persistedSourceArtifact?.metadata.height
    ) ?? persistedOrientation ?? 'landscape');
    if (typeof persisted.verticalTitle === 'string') setVerticalTitle(persisted.verticalTitle);
    if (typeof persisted.verticalSubtitle === 'string') setVerticalSubtitle(persisted.verticalSubtitle);
    if (persisted.currentStep === 0 || persisted.currentStep === 1 || persisted.currentStep === 2 || persisted.currentStep === 3) {
      setCurrentStep(persisted.currentStep);
    }
    if (persisted.furthestStep === 0 || persisted.furthestStep === 1 || persisted.furthestStep === 2 || persisted.furthestStep === 3) {
      setFurthestStep(persisted.furthestStep);
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
    if (latest !== undefined) {
      if (!shouldRestoreLatestResult) return;
      setCurrentStep(3);
      setFurthestStep(3);
      setResultVersion(latest.value);
      setDraftBaseVersion(latest.value);
      setResultTab('video');
      setWorkspacePhase('result');
    } else if (shouldRestoreLatestResult) {
      setDraftBaseVersion(undefined);
      setWorkspacePhase('configure');
    }
  }, [creatorSession?.job.id, creatorSession?.job.revision]);

  useEffect(() => {
    let active = true;
    if (props.creatorServicesService === null || props.creatorServicesService === undefined) {
      return () => {
        active = false;
      };
    }
    void props.creatorServicesService.getConfig()
      .then(response => {
        if (!active) return;
        const persistedProvider = creatorSession?.state.ttsProvider;
        const provider = isTtsProvider(persistedProvider)
          ? persistedProvider
          : response.config.tts.provider;
        setTtsProvider(provider);
        if (provider === 'edge-tts') {
          setTtsModel('');
          return;
        }
        const providerConfig = response.config.tts[provider];
        if (typeof creatorSession?.state.ttsModel !== 'string') {
          setTtsModel(providerConfig.model);
        }
        if (typeof creatorSession?.state.voiceCode !== 'string') {
          setVoiceCode(providerConfig.defaultVoiceId);
          setVoiceName(providerConfig.defaultVoiceId);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [creatorSession?.job.id, props.creatorServicesService]);

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
      ...(creatorSession.job.templateVersion >= 2
        ? { subtitleStyle }
        : { subtitleFont, subtitleSize, subtitleColor }),
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
      resultVersion: resultVersions.length > 0 ? resultVersion : null,
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

  useEffect(() => () => {
    if (agentFocusTimeoutRef.current !== undefined) {
      window.clearTimeout(agentFocusTimeoutRef.current);
    }
  }, []);

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
  const selectedFileRegistered = videoFile !== null
    && registeredSourceArtifact !== undefined
    && sourceArtifactMatchesFile(registeredSourceArtifact, videoFile);
  const hasSource = sourceType === 'url'
    ? isValidVideoUrl(videoUrl)
    : videoFile !== null || videoFileName !== null || registeredSourceArtifact !== undefined;
  const latestStage = creatorSession?.job.stages.at(-1);
  const activeStage = creatorSession === null
    ? undefined
    : [...creatorSession.job.stages].reverse().find(stage => (
        stage.status === 'queued' || stage.status === 'running'
      ));
  const resumableStage = activeStage === undefined
    && (latestStage?.status === 'canceled' || latestStage?.status === 'interrupted')
    ? latestStage
    : undefined;
  const rawStageFailure = latestStage?.status === 'failed'
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
    setResultNotice(l(
      '翻译任务已开始，进度会实时同步到创作动态',
      'Translation started. Progress will appear in creation activity.'
    ));
  }, [
    activeStage,
    creatorSession,
    l,
    startRevisionConflict
  ]);
  const sourceName = sourceType === 'url'
    ? (videoUrl.trim() || l('等待填写链接', 'Waiting for a link'))
    : (videoFile?.name
      ?? videoFileName
      ?? registeredSourceFile?.name
      ?? l('等待上传视频', 'Waiting for an upload'));
  const outputLabel = outputLabelFor({ composeVideo, videoFormat }, l);
  const subtitleStyleLabel = `${subtitleFontLabel(subtitleFont, l)} · ${subtitleWeightLabel(subtitleWeight, l)} · ${subtitleSizeLabel(subtitleSize, l)} · ${subtitleColor.toUpperCase()}`;
  const summaryItems = useMemo(() => [
    { label: l('翻译语言', 'Languages'), value: `${languageLabel(sourceLanguages, sourceLanguage)} → ${languageLabel(targetLanguages, targetLanguage)}` },
    { label: l('字幕', 'Subtitles'), value: bilingual ? l(`双语 · 译文在${subtitlePosition === 'top' ? '上' : '下'}`, `Bilingual · translation ${subtitlePosition === 'top' ? 'above' : 'below'}`) : l('仅译文', 'Translation only') },
    { label: l('字幕样式', 'Subtitle style'), value: subtitleStyleLabel },
    { label: l('配音', 'Dubbing'), value: dubbing ? (voiceName.trim() || voiceCode.trim() || l('自动匹配音色', 'Auto-match voice')) : l('关闭', 'Off') },
    { label: l('输出', 'Output'), value: outputLabel }
  ], [bilingual, dubbing, l, outputLabel, sourceLanguage, subtitlePosition, subtitleStyleLabel, targetLanguage, voiceCode, voiceName]);
  const targetLanguageLabel = languageLabel(targetLanguages, targetLanguage);
  const selectedResult = resultVersions.find(version => version.value === resultVersion);
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
  const selectedVideoEntries = finalVideoEntries.length > 0
    ? finalVideoEntries
    : selectedVideoArtifacts.dubbed === undefined
      ? []
      : [{ variant: 'dubbed' as const, artifact: selectedVideoArtifacts.dubbed }];
  const selectedVoiceArtifact = latestArtifactForResultVersion(
    jobArtifacts,
    resultVersion,
    ['dubbed_audio'],
    creatorSession?.state.resultSnapshots
  );
  const selectedSubtitleArtifacts = subtitleArtifactsForResultVersion(
    jobArtifacts,
    resultVersion,
    creatorSession?.state.resultSnapshots,
    { bilingual: selectedResultSettings?.bilingual === true }
  );
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
      : selectedVideoArtifacts.horizontal ?? selectedVideoArtifacts.dubbed ?? selectedSourceVideoArtifact,
    vertical: selectedSubtitleArtifacts.vertical === undefined
      ? undefined
      : selectedVideoArtifacts.vertical ?? selectedSourceVideoArtifact
  };
  const hasVoiceArtifact = selectedVoiceArtifact !== undefined;
  const [videoPreviews, setVideoPreviews] = useState<Record<string, {
    src?: string;
    loading: boolean;
    error?: string;
  }>>({});
  const openArtifact = creatorSession?.openArtifact;
  const previewArtifacts = [...new Map([
    ...selectedVideoEntries.map(({ artifact }) => artifact),
    ...Object.values(subtitleVideoArtifacts).filter((artifact): artifact is CreatorArtifact => artifact !== undefined)
  ].map(artifact => [artifact.id, artifact])).values()];
  const selectedVideoArtifactIds = previewArtifacts.map(artifact => artifact.id).join('|');
  useEffect(() => {
    const artifacts = previewArtifacts;
    if (artifacts.length === 0 || openArtifact === undefined) {
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
      void openArtifact(artifact.id)
        .then(response => {
          if (!response.ok) throw new Error(`Creator artifact HTTP ${response.status}`);
          return response.blob();
        })
        .then(blob => {
          const objectUrl = URL.createObjectURL(blob);
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
            [artifact.id]: { loading: false, error: creatorErrorMessage(cause, l) }
          }));
        });
    }
    return () => {
      canceled = true;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [l, openArtifact, selectedVideoArtifactIds]);
  const [voicePreview, setVoicePreview] = useState<{
    src?: string;
    loading: boolean;
    error?: string;
  }>({ loading: false });
  const selectedVoiceArtifactId = selectedVoiceArtifact?.id;
  useEffect(() => {
    if (
      resultTab !== 'voice'
      || selectedVoiceArtifactId === undefined
      || openArtifact === undefined
    ) {
      setVoicePreview({ loading: false });
      return;
    }
    let canceled = false;
    let objectUrl: string | undefined;
    setVoicePreview({ loading: true });
    void openArtifact(selectedVoiceArtifactId)
      .then(response => {
        if (!response.ok) throw new Error(`Creator artifact HTTP ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        objectUrl = URL.createObjectURL(blob);
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
          error: creatorErrorMessage(cause, l)
        });
      });
    return () => {
      canceled = true;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [l, openArtifact, resultTab, selectedVoiceArtifactId, voicePreviewReload]);
  const selectedResultSource = selectedResult?.source;
  const selectedSubtitleCues = selectedResult?.subtitleCues ?? [];
  const horizontalSubtitleDraftKey = subtitleDraftKey(resultVersion, 'horizontal');
  const verticalSubtitleDraftKey = subtitleDraftKey(resultVersion, 'vertical');
  const baseHorizontalSubtitleCues = subtitleCuesWithSource(
    selectedSubtitleCues,
    selectedSourceSubtitleArtifact,
    selectedResultSettings?.bilingual === true
  );
  const baseVerticalSubtitleCues = subtitleCuesFromArtifact(selectedVerticalSubtitleArtifact);
  const displayedHorizontalSubtitleCues = applySubtitleTextEdits(
    baseHorizontalSubtitleCues,
    subtitleTextEdits[horizontalSubtitleDraftKey]
  );
  const displayedVerticalSubtitleCues = applySubtitleTextEdits(
    baseVerticalSubtitleCues,
    subtitleTextEdits[verticalSubtitleDraftKey]
  );
  const videoOutputs: VideoResultOutput[] = selectedVideoEntries.map(({ variant, artifact }) => {
    const preview = videoPreviews[artifact.id];
    return {
      artifactId: artifact.id,
      variant,
      artifactVersion: artifact.version,
      fileName: artifactFileName(artifact),
      src: preview?.src,
      previewLoading: preview?.loading ?? openArtifact !== undefined,
      previewError: preview?.error
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
      previewError: preview?.error,
      source: artifact.kind === 'source_video'
    } satisfies SubtitleVideoPreview]];
  })) as Partial<Record<SubtitleResultVariant, SubtitleVideoPreview>>;
  const voiceOutput: VoiceResultOutput | undefined = selectedVoiceArtifact === undefined
    ? undefined
    : {
        artifactId: selectedVoiceArtifact.id,
        artifactVersion: selectedVoiceArtifact.version,
        fileName: artifactFileName(selectedVoiceArtifact),
        src: voicePreview.src,
        previewLoading: voicePreview.loading,
        previewError: voicePreview.error
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
  const selectedSourceName = selectedResultSource?.sourceType === 'url'
    ? (selectedResultSource.videoUrl.trim() || l('等待填写链接', 'Waiting for a link'))
    : (selectedResultSource?.videoFile?.name
      ?? selectedResultSource?.videoFileName
      ?? l('等待上传视频', 'Waiting for an upload'));
  const subtitleDirtyByVariant: Partial<Record<SubtitleResultVariant, boolean>> = {
    horizontal: subtitleTextChanged(baseHorizontalSubtitleCues, displayedHorizontalSubtitleCues),
    vertical: subtitleTextChanged(baseVerticalSubtitleCues, displayedVerticalSubtitleCues)
  };
  const subtitleDirty = subtitleDirtyByVariant.horizontal === true;
  const subtitleNeedsRegeneration = selectedResult
    ? JSON.stringify(stripSubtitleSourceText(displayedHorizontalSubtitleCues))
      !== selectedResult.generatedSubtitleSnapshot
    : false;
  const selectedHasStaleArtifacts = (selectedResult?.staleArtifactIds.length ?? 0) > 0;
  const staleArtifactKinds = new Set(
    (selectedResult?.staleArtifactIds ?? []).flatMap(id => {
      const artifact = jobArtifacts.find(candidate => candidate.id === id);
      return artifact === undefined ? [] : [artifact.kind];
    })
  );
  const visibleResultNotice = resultNotice || (selectedHasStaleArtifacts
    ? l(
        '当前项目版本中的部分配音或成片基于较早内容，可继续使用；重新生成后会更新引用。',
        'Some dubbing or video outputs in this project version are based on earlier content. They remain usable until regenerated.'
      )
    : '');
  const nextVersion = resultVersions.reduce((highest, version) => Math.max(highest, version.value), 0) + 1;
  const selectedSubtitleContextLabel = subtitleOutputs.length > 1
    ? l('横屏与竖屏字幕', 'Horizontal and vertical subtitles')
    : subtitleOutputs[0]?.variant === 'vertical'
      ? l('竖屏字幕', 'Vertical subtitles')
      : l('横屏字幕', 'Horizontal subtitles');
  const agentContextSummary = workspacePhase === 'result'
    ? `${resultTab === 'video'
      ? l('生成物', 'Outputs')
      : resultTab === 'subtitles'
        ? selectedSubtitleContextLabel
        : ({ voice: l('配音', 'Dubbing'), settings: l('任务设置', 'Task settings') } as const)[resultTab]} V${resultVersion}`
    : currentStep === 0
      ? sourceName
      : currentStep === 1
        ? `${languageLabel(sourceLanguages, sourceLanguage)} → ${targetLanguageLabel}`
        : currentStep === 2
          ? subtitleStyleLabel
          : `${dubbing ? l('配音开启', 'Dubbing on') : l('无配音', 'No dubbing')}, ${outputLabel}`;
  function openWizardStep(step: WizardStep) {
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
    setVideoUrl(source.videoUrl);
    setVideoFile(source.videoFile);
    setVideoFileName(source.videoFile?.name ?? source.videoFileName);
    setVideoFileSize(source.videoFile?.size ?? source.videoFileSize);
    setVideoFileLastModified(
      source.videoFile?.lastModified ?? source.videoFileLastModified
    );
  }

  function focusAgentControl(focus: AgentFocus) {
    if (agentFocusTimeoutRef.current !== undefined) {
      window.clearTimeout(agentFocusTimeoutRef.current);
    }
    setAgentFocus(focus);
    agentFocusTimeoutRef.current = window.setTimeout(() => {
      setAgentFocus(undefined);
      agentFocusTimeoutRef.current = undefined;
    }, 1800);
  }

  function openAgentConfiguration(step: Extract<WizardStep, 1 | 3>, focus: AgentFocus) {
    if (workspacePhase === 'result' && selectedResult) {
      if (draftBaseVersion !== selectedResult.value) {
        applySourceSnapshot(selectedResult.source);
        applySettingsSnapshot(selectedResult.settings);
      }
      setDraftBaseVersion(selectedResult.value);
      setWorkspacePhase('configure');
      setResultProposal(undefined);
      setResultNotice('');
    }
    openWizardStep(step);
    focusAgentControl(focus);
  }

  const draftSettingsSnapshot = currentDraftSettings();
  const draftSourceSnapshot = currentDraftSource();
  const draftAppliesToSelectedResult = selectedResult !== undefined
    && draftBaseVersion === selectedResult.value;
  const hasConfigDraftChanges = draftAppliesToSelectedResult
    && (!sameSettings(draftSettingsSnapshot, selectedResult.settings)
      || !sameSource(draftSourceSnapshot, selectedResult.source));
  const hasPendingChanges = subtitleNeedsRegeneration
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
        l
      )
    : [];

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
    const baseCues = variant === 'horizontal'
      ? baseHorizontalSubtitleCues
      : baseVerticalSubtitleCues;
    const original = baseCues.find(cue => cue.id === id);
    if (original === undefined) return;
    const key = subtitleDraftKey(resultVersion, variant);
    setSubtitleTextEdits(current => {
      const nextVariant = { ...(current[key] ?? {}) };
      const edit = { ...nextVariant[String(id)] };
      if (text === original[field]) delete edit[field];
      else edit[field] = text;
      if (Object.keys(edit).length === 0) delete nextVariant[String(id)];
      else nextVariant[String(id)] = edit;
      if (Object.keys(nextVariant).length === 0) {
        const { [key]: _removed, ...remaining } = current;
        return remaining;
      }
      return { ...current, [key]: nextVariant };
    });
    setResultNotice('');
  }

  async function persistSubtitleVariant(
    variant: SubtitleResultVariant,
    baseResultVersion: number
  ): Promise<{ version: number; hasStaleArtifacts: boolean }> {
    if (creatorSession === null) {
      throw new Error('Creator Runtime is unavailable');
    }
    const artifact = variant === 'horizontal'
      ? selectedTargetSubtitleArtifact
      : selectedVerticalSubtitleArtifact;
    const cues = variant === 'horizontal'
      ? displayedHorizontalSubtitleCues
      : displayedVerticalSubtitleCues;
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
    const key = subtitleDraftKey(baseResultVersion, variant);
    setSubtitleTextEdits(current => {
      const { [key]: _removed, ...remaining } = current;
      return remaining;
    });
    const editedVersion = readPositiveResultVersion(editedJob.state.resultVersion);
    if (editedVersion === undefined) {
      throw new Error('Creator Runtime did not return the edited subtitle version');
    }
    const editedSnapshot = readCreatorResultSnapshots(editedJob.state.resultSnapshots)
      .find(snapshot => snapshot.version === editedVersion);
    return {
      version: editedVersion,
      hasStaleArtifacts: (editedSnapshot?.staleArtifactIds.length ?? 0) > 0
    };
  }

  function continueToSettings() {
    setAttemptedContinue(true);
    if (!hasSource) return;
    openWizardStep(1);
  }

  async function executeRegeneration(stageId: TranslationStageId | undefined) {
    if (
      creatorSession === null
      || selectedResult === undefined
      || regenerationSource === undefined
    ) {
      throw new Error('Video translation regeneration context is unavailable');
    }
    const selectedBaseVersion = selectedResult.value;
    const sourceChanged = !sameSource(regenerationSource, selectedResult.source);

    if (subtitleDirty && stageId !== 'subtitle') {
      await persistSubtitleVariant('horizontal', selectedBaseVersion);
    }

    if (stageId === undefined) {
      const committedJob = await creatorSession.applyAction({
        action: 'commit-version',
        input: { baseResultVersion: selectedBaseVersion }
      });
      return readPositiveResultVersion(committedJob.state.resultVersion);
    }

    const inputResultVersion = sourceChanged && stageId === 'subtitle'
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
    if (!hasSource) {
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
            subtitleNeedsRegeneration
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
        await creatorSession.applyAction({
          action: 'run-stage',
          input: { stageId: 'subtitle', workflow: true }
        });
      }
      setWorkspacePhase('result');
      setDraftBaseVersion(undefined);
      setResultNotice(isRegeneration
        ? stageId === undefined
          ? l(
              '修改已保存，本次无需重新转录或生成',
              'Changes were saved without retranscribing or regenerating.'
            )
          : l(
              `新版本已从“${translationStageLabel(stageId, l)}”开始，已有前置产物会直接复用`,
              `The new version started from "${translationStageLabel(stageId, l)}" and will reuse existing upstream outputs.`
            )
        : l(
            '翻译任务已开始，进度会实时同步到创作动态',
            'Translation started. Progress will appear in creation activity.'
          ));
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

  function renderTaskControlButton() {
    if (activeStage !== undefined) {
      const cancelRequested = activeStage.progress.cancelRequested === true;
      return (
        <button
          className="video-translation-primary-action"
          data-intent="danger"
          type="button"
          disabled={taskControlPending !== undefined || cancelRequested}
          onClick={requestCancelTask}
        >
          <CircleStop size={16} strokeWidth={1.9} aria-hidden="true" />
          {taskControlPending === 'canceling' || cancelRequested
            ? l('正在终止...', 'Stopping...')
            : l('终止任务', 'Stop task')}
        </button>
      );
    }
    if (resumableStage !== undefined) {
      return (
        <button
          className="video-translation-primary-action"
          type="button"
          disabled={taskControlPending !== undefined}
          onClick={() => void resumeTask()}
        >
          <Play size={16} strokeWidth={1.9} aria-hidden="true" />
          {taskControlPending === 'resuming'
            ? l('正在继续...', 'Resuming...')
            : l('继续任务', 'Resume task')}
        </button>
      );
    }
    return null;
  }

  async function saveSubtitles(variant: SubtitleResultVariant) {
    if (creatorSession === null || selectedResult === undefined) {
      setResultNotice(l('当前项目版本没有可编辑的真实字幕产物', 'This project version has no editable subtitle artifact.'));
      return;
    }
    setSubmitting(true);
    try {
      const saved = await persistSubtitleVariant(variant, selectedResult.value);
      const variantLabel = variant === 'horizontal' ? '横屏' : '竖屏';
      setResultNotice(saved.hasStaleArtifacts
        ? l(
            `${variantLabel}字幕已保存，项目仍为 V${saved.version}。现有配音或成片已保留，重新生成后会更新`,
            `${variant === 'horizontal' ? 'Horizontal' : 'Vertical'} subtitles were saved; the project remains V${saved.version}. Existing dubbing or videos are preserved until regenerated.`
          )
        : l(
            `${variantLabel}字幕已保存，项目仍为 V${saved.version}`,
            `${variant === 'horizontal' ? 'Horizontal' : 'Vertical'} subtitles were saved; the project remains V${saved.version}.`
          ));
    } catch (cause) {
      setResultNotice(creatorErrorMessage(cause, l));
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
        const response = await creatorSession.openArtifact(artifact.id);
        if (!response.ok) throw new Error(`Creator artifact HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
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
    setFurthestStep(3);
    setResultProposal(undefined);
    setResultNotice('');
  }

  function returnToBaseResult() {
    const version = draftBaseVersion ?? resultVersion;
    setResultVersion(version);
    setWorkspacePhase('result');
    setResultTab('video');
    setResultProposal(undefined);
    setResultNotice(l(`已返回 V${version}，配置草稿仍然保留`, `Returned to V${version}. Your configuration draft is still saved.`));
  }

  function selectResultVersion(version: number) {
    setResultVersion(version);
    setResultProposal(undefined);
    setResultNotice('');
  }

  async function confirmRegeneration() {
    if (!selectedResult || !regenerationSettings || !regenerationSource) return;
    if (!hasPendingChanges) {
      setResultProposal(undefined);
      setResultNotice(l('当前版本没有修改，不需要生成新版本', 'Nothing changed, so a new version is not needed'));
      return;
    }
    if (creatorSession === null) {
      setResultNotice(l('Creator Runtime 当前不可用，无法生成新版本', 'Creator Runtime is unavailable, so a new version cannot be generated.'));
      return;
    }
    setSubmitting(true);
    try {
      const stageId = videoTranslationRegenerationStage(
        selectedResult,
        regenerationSettings,
        regenerationSource,
        subtitleNeedsRegeneration,
        staleArtifactKinds
      );
      await executeRegeneration(stageId);
      setResultProposal(undefined);
      setResultNotice(stageId === undefined
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

  function paneWidthBounds() {
    const rect = collabLayoutRef.current?.getBoundingClientRect();
    const fallbackWidth = 900;
    return {
      fallback: rect ? Math.round(rect.width * 0.68) : fallbackWidth,
      max: rect
        ? Math.max(
            WORKSPACE_MIN_WIDTH,
            rect.width - AGENT_MIN_WIDTH - WORKSPACE_RESIZE_HANDLE_WIDTH
          )
        : fallbackWidth
    };
  }

  function updateWorkspacePaneWidth(clientX: number) {
    const rect = collabLayoutRef.current?.getBoundingClientRect();
    if (!rect) return;
    setWorkspacePaneWidth(clampPaneWidth(
      clientX - rect.left,
      WORKSPACE_MIN_WIDTH,
      Math.max(
        WORKSPACE_MIN_WIDTH,
        rect.width - AGENT_MIN_WIDTH - WORKSPACE_RESIZE_HANDLE_WIDTH
      )
    ));
  }

  function adjustWorkspacePaneWidth(delta: number) {
    const bounds = paneWidthBounds();
    setWorkspacePaneWidth(previous => clampPaneWidth(
      (previous ?? bounds.fallback) + delta,
      WORKSPACE_MIN_WIDTH,
      bounds.max
    ));
  }

  function handlePaneResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    beginPaneResize(event, updateWorkspacePaneWidth);
  }

  function handlePaneResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      adjustWorkspacePaneWidth(-WORKSPACE_RESIZE_KEY_STEP);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      adjustWorkspacePaneWidth(WORKSPACE_RESIZE_KEY_STEP);
    }
  }

  const collabLayoutStyle = workspacePaneWidth === undefined
    ? undefined
    : ({ '--video-translation-pane-width': `${workspacePaneWidth}px` } as CSSProperties);

  return (
    <main className="video-translation-page">
      <div className="video-translation-page-inner video-translation-wizard">
        <div
          className="video-translation-collab-layout"
          ref={collabLayoutRef}
          style={collabLayoutStyle}
        >
          <div
            className="video-translation-wizard-main"
            data-step={currentStep}
            data-phase={workspacePhase}
            role="region"
            aria-label={l('视频翻译操作区', 'Video translation workspace')}
          >
        <header className="video-translation-header">
          <button type="button" onClick={props.onBack} aria-label={l('返回', 'Back')}>
            <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <span className="video-translation-title-icon" aria-hidden="true">
            <Languages size={20} strokeWidth={1.8} />
          </span>
          <div className="video-translation-header-copy">
            <h1>{workspacePhase === 'result' ? l('视频翻译项目', 'Video Translation Project') : l('视频翻译配音', 'Translate & Dub Video')}</h1>
            <p>{workspacePhase === 'result' ? selectedSourceName : l('创建字幕、配音与多画幅成片', 'Create subtitles, dubbing, and videos in multiple formats')}</p>
          </div>
        </header>

        {workspacePhase === 'configure' ? (
          <div className="video-translation-configure-top">
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
              activeTab={resultTab}
              version={resultVersion}
              versions={resultVersions.map(({ value, description }) => ({ value, description }))}
              targetLanguage={selectedTargetLanguageLabel}
              outputLabel={selectedOutputLabel}
              subtitleStyleLabel={selectedSubtitleStyleLabel}
              dubbing={selectedResultSettings?.dubbing ?? false}
              hasVoiceArtifact={hasVoiceArtifact}
              videoOutputs={videoOutputs}
              subtitleOutputs={subtitleOutputs}
              subtitleVideoPreviews={subtitleVideoPreviews}
              voiceOutput={voiceOutput}
              subtitleDirty={subtitleDirty}
              subtitleDirtyByVariant={subtitleDirtyByVariant}
              subtitleSavePending={submitting}
              nextVersion={nextVersion}
              affectedArtifacts={regenerationArtifacts}
              hasPendingChanges={hasPendingChanges}
              regenerationPending={resultProposal === 'regenerate'}
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
            <VideoSourceInput
              file={videoFile}
              registeredFile={registeredSourceFile}
              sourceType={sourceType}
              url={videoUrl}
              hasSource={hasSource}
              invalid={attemptedContinue && !hasSource}
              metadataService={props.videoMetadataService}
              onFileChange={chooseVideo}
              onUrlChange={url => {
                setVideoUrl(url);
                setSourceType('url');
                setVideoFile(null);
                setSourceOrientation('landscape');
                setAttemptedContinue(false);
              }}
              onClear={clearCurrentSource}
              onDimensions={updateSourceOrientation}
            />
          ) : null}

          {workspacePhase === 'configure' && currentStep === 1 ? (
            <section className="video-translation-step-panel" aria-labelledby="translation-settings-title">
              <div className="video-translation-step-heading">
                <h2 id="translation-settings-title">{l('设置翻译语言', 'Set translation languages')}</h2>
                <p>{l('选择视频原语言、目标语言和字幕内容方式', 'Choose the source language, target language, and subtitle content')}</p>
              </div>

              <div className="video-translation-language-row">
                <label className="video-translation-field">
                  <span>{l('源语言', 'Source language')}</span>
                  <div className="video-translation-select-wrap">
                    <select value={sourceLanguage} onChange={event => setSourceLanguage(event.target.value)}>
                      {sourceLanguages.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                    </select>
                    <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                </label>
                <span className="video-translation-language-arrow" aria-hidden="true">→</span>
                <label className="video-translation-field" data-agent-focus={agentFocus === 'language'}>
                  <span>{l('翻译为', 'Translate to')}</span>
                  <div className="video-translation-select-wrap">
                    <select value={targetLanguage} onChange={event => {
                      setTargetLanguage(event.target.value);
                    }}>
                      {targetLanguages.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                    </select>
                    <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
                  </div>
                </label>
              </div>

              <div className="video-translation-toggle-list" data-agent-focus={agentFocus === 'subtitles'}>
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
                <Switch
                  checked={preferPlatformCaptions && sourceType === 'url'}
                  label={l('优先使用平台字幕', 'Prefer platform subtitles')}
                  description={sourceType === 'url' ? l('平台无字幕时自动识别', 'Transcribe automatically when platform subtitles are unavailable') : l('仅视频链接可用', 'Available for video links only')}
                  disabled={sourceType !== 'url'}
                  onChange={setPreferPlatformCaptions}
                />
              </div>
            </section>
          ) : null}

          {workspacePhase === 'configure' && currentStep === 2 ? (
            <section className="video-translation-step-panel video-translation-subtitle-style" aria-labelledby="subtitle-style-title">
              <div className="video-translation-step-heading">
                <h2 id="subtitle-style-title">{l('设置字幕样式', 'Set subtitle style')}</h2>
                <p>{l('调整字幕字体、大小和颜色，并实时预览显示效果', 'Choose the subtitle font, size, and color with a live preview')}</p>
              </div>

              <div className="video-translation-subtitle-style-layout">
                <div className="video-translation-subtitle-controls">
                  <label className="video-translation-field">
                    <span>{l('字幕字体', 'Subtitle font')}</span>
                    <div className="video-translation-select-wrap">
                      <select
                        aria-label={l('字幕字体', 'Subtitle font')}
                        value={subtitleFont}
                        onChange={event => setSubtitleFont(event.target.value as SubtitleFont)}
                      >
                        <option value="system">{l('系统默认', 'System default')}</option>
                        <option value="sans">{l('无衬线', 'Sans serif')}</option>
                        <option value="serif">{l('衬线', 'Serif')}</option>
                        <option value="rounded">{l('圆体', 'Rounded')}</option>
                      </select>
                      <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
                    </div>
                  </label>

                  <div className="video-translation-style-control">
                    <span>{l('字重', 'Font weight')}</span>
                    <div className="video-translation-size-options" role="radiogroup" aria-label={l('字幕字重', 'Subtitle font weight')}>
                      {(['regular', 'medium', 'bold'] as const).map(weight => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={subtitleWeight === weight}
                          key={weight}
                          onClick={() => setSubtitleWeight(weight)}
                        >
                          {subtitleWeightLabel(weight, l)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="video-translation-style-control">
                    <span>{l('字幕大小', 'Subtitle size')}</span>
                    <div className="video-translation-size-options" role="radiogroup" aria-label={l('字幕大小', 'Subtitle size')}>
                      {(['small', 'medium', 'large'] as const).map(size => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={subtitleSize === size}
                          key={size}
                          onClick={() => setSubtitleSize(size)}
                        >
                          {subtitleSizeLabel(size, l)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="video-translation-style-control">
                    <span>{l('译文颜色', 'Translation color')}</span>
                    <div className="video-translation-color-options">
                      {subtitleColors.map(color => (
                        <button
                          type="button"
                          aria-label={color}
                          aria-pressed={subtitleColor.toUpperCase() === color}
                          key={color}
                          style={{ '--subtitle-swatch-color': color } as CSSProperties}
                          onClick={() => setSubtitleColor(color)}
                        >
                          {subtitleColor.toUpperCase() === color ? <Check size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
                        </button>
                      ))}
                      <label className="video-translation-custom-color" title={l('自定义颜色', 'Custom color')}>
                        <input
                          type="color"
                          aria-label={l('自定义译文颜色', 'Custom translation color')}
                          value={subtitleColor}
                          onChange={event => setSubtitleColor(event.target.value.toUpperCase())}
                        />
                        <span>{l('自定义', 'Custom')}</span>
                      </label>
                    </div>
                  </div>

                  <div className="video-translation-style-fields">
                    <label className="video-translation-field video-translation-color-field">
                      <span>{l('原文颜色', 'Original color')}</span>
                      <input
                        type="color"
                        aria-label={l('原文颜色', 'Original color')}
                        value={subtitleSecondaryColor}
                        onChange={event => setSubtitleSecondaryColor(event.target.value.toUpperCase())}
                      />
                    </label>
                    <label className="video-translation-field video-translation-color-field">
                      <span>{l('描边颜色', 'Outline color')}</span>
                      <input
                        type="color"
                        aria-label={l('描边颜色', 'Outline color')}
                        value={subtitleOutlineColor}
                        onChange={event => setSubtitleOutlineColor(event.target.value.toUpperCase())}
                      />
                    </label>
                    <label className="video-translation-field">
                      <span>{l('描边宽度', 'Outline width')}</span>
                      <input
                        type="number"
                        min="0"
                        max="8"
                        step="0.5"
                        value={subtitleOutlineWidth}
                        onChange={event => setSubtitleOutlineWidth(Number(event.target.value))}
                      />
                    </label>
                  </div>

                  <div className="video-translation-shadow-settings">
                    <Switch
                      checked={subtitleShadowEnabled}
                      label={l('字幕阴影', 'Subtitle shadow')}
                      description={l('为字幕增加可控阴影，提高复杂画面上的可读性', 'Add a controlled shadow for readability on detailed footage')}
                      onChange={setSubtitleShadowEnabled}
                    />
                    {subtitleShadowEnabled ? (
                      <div className="video-translation-style-fields">
                        <label className="video-translation-field video-translation-color-field">
                          <span>{l('阴影颜色', 'Shadow color')}</span>
                          <input
                            type="color"
                            aria-label={l('阴影颜色', 'Shadow color')}
                            value={subtitleShadowColor}
                            onChange={event => setSubtitleShadowColor(event.target.value.toUpperCase())}
                          />
                        </label>
                        <label className="video-translation-field">
                          <span>{l('不透明度', 'Opacity')}</span>
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            value={subtitleShadowOpacity}
                            onChange={event => setSubtitleShadowOpacity(Number(event.target.value))}
                          />
                        </label>
                        <label className="video-translation-field">
                          <span>{l('水平偏移', 'Horizontal offset')}</span>
                          <input
                            type="number"
                            min="-20"
                            max="20"
                            step="1"
                            value={subtitleShadowOffsetX}
                            onChange={event => setSubtitleShadowOffsetX(Number(event.target.value))}
                          />
                        </label>
                        <label className="video-translation-field">
                          <span>{l('垂直偏移', 'Vertical offset')}</span>
                          <input
                            type="number"
                            min="-20"
                            max="20"
                            step="1"
                            value={subtitleShadowOffsetY}
                            onChange={event => setSubtitleShadowOffsetY(Number(event.target.value))}
                          />
                        </label>
                        <label className="video-translation-field">
                          <span>{l('模糊', 'Blur')}</span>
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.5"
                            value={subtitleShadowBlur}
                            onChange={event => setSubtitleShadowBlur(Number(event.target.value))}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  className="video-translation-subtitle-preview"
                  data-ratio={videoFormat === 'vertical' ? '9:16' : '16:9'}
                  role="region"
                  aria-label={l('字幕样式预览', 'Subtitle style preview')}
                >
                  <span>{l('字幕样式预览', 'Subtitle style preview')}</span>
                  <div
                    style={{
                      '--subtitle-preview-color': subtitleColor,
                      '--subtitle-preview-secondary-color': subtitleSecondaryColor,
                      '--subtitle-preview-outline-color': subtitleOutlineColor,
                      '--subtitle-preview-outline-width': `${subtitleOutlineWidth}px`,
                      '--subtitle-preview-shadow': subtitleShadowEnabled
                        ? `${subtitleShadowOffsetX}px ${subtitleShadowOffsetY}px ${subtitleShadowBlur}px color-mix(in srgb, ${subtitleShadowColor} ${Math.round(subtitleShadowOpacity * 100)}%, transparent)`
                        : 'none',
                      '--subtitle-preview-font-size': ({ small: '14px', medium: '16px', large: '18px' } as const)[subtitleSize],
                      '--subtitle-preview-font-family': subtitleFontFamily(subtitleFont, subtitleWeight),
                      '--subtitle-preview-font-weight': ({ regular: 400, medium: 500, bold: 700 } as const)[subtitleWeight]
                    } as CSSProperties}
                  >
                    {bilingual && subtitlePosition === 'bottom' ? (
                      <small data-subtitle-kind="original">{l('这是一段原文字幕', 'This is an original subtitle')}</small>
                    ) : null}
                    <strong data-subtitle-kind="translation">{l('这是一段译文字幕', 'This is a translated subtitle')}</strong>
                    {bilingual && subtitlePosition === 'top' ? (
                      <small data-subtitle-kind="original">{l('这是一段原文字幕', 'This is an original subtitle')}</small>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {workspacePhase === 'configure' && currentStep === 3 ? (
            <div className="video-translation-final-grid">
              <section className="video-translation-step-panel video-translation-final-settings" aria-labelledby="output-settings-title">
                <div className="video-translation-step-heading">
                  <h2 id="output-settings-title">{l('选择输出内容', 'Choose output')}</h2>
                  <p>{l('按需生成配音和多画幅成片', 'Generate dubbing and videos in the formats you need')}</p>
                </div>

                <div className="video-translation-option-block" data-agent-focus={agentFocus === 'dubbing'}>
                  <div className="video-translation-option-title">
                    <span className="video-translation-option-icon"><Mic2 size={17} strokeWidth={1.8} /></span>
                    <Switch
                      checked={dubbing}
                      label={l('生成目标语言配音', 'Generate target-language dubbing')}
                      description={l('匹配翻译后的语速与停顿', 'Match the translated pacing and pauses')}
                      onChange={value => {
                        setDubbing(value);
                      }}
                    />
                  </div>
                  {dubbing ? (
                    <div className="video-translation-option-content">
                      <div className="video-translation-voice-source">
                        <strong>{ttsProviderLabel(ttsProvider, l)}</strong>
                        <small>{ttsModel || l('本地语音服务', 'Local speech service')}</small>
                      </div>
                      <TtsVoicePicker
                        id="video-translation-voice"
                        provider={ttsProvider}
                        model={ttsModel}
                        value={voiceCode}
                        service={props.creatorServicesService ?? null}
                        label={l('配音音色', 'Dubbing voice')}
                        onChange={(voiceId, voice) => {
                          setVoiceCode(voiceId);
                          setVoiceName(voice?.name ?? voiceId);
                        }}
                        onVoiceResolved={voice => setVoiceName(voice.name)}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="video-translation-option-block" data-agent-focus={agentFocus === 'output'}>
                  <div className="video-translation-option-title">
                    <span className="video-translation-option-icon"><MonitorPlay size={17} strokeWidth={1.8} /></span>
                    <Switch
                      checked={composeVideo}
                      label={l('合成字幕视频', 'Render subtitled video')}
                      description={l('将字幕直接嵌入成片', 'Embed subtitles directly in the final video')}
                      onChange={value => {
                        setComposeVideo(value);
                      }}
                    />
                  </div>
                  {composeVideo ? (
                    <div className="video-translation-option-content">
                      <div className="video-translation-format" role="radiogroup" aria-label={l('输出画幅', 'Output format')}>
                        {([
                          ['horizontal', '16:9', '横屏'],
                          ['vertical', '9:16', '竖屏'],
                          ['all', '双画幅', '全部']
                        ] as const).map(([value, ratio, label]) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={videoFormat === value}
                            disabled={sourceOrientation === 'portrait' && value !== 'vertical'}
                            title={sourceOrientation === 'portrait' && value !== 'vertical'
                              ? l('竖屏源视频仅支持竖屏输出', 'Portrait source videos only support portrait output')
                              : undefined}
                            key={value}
                            onClick={() => {
                              setVideoFormat(value);
                            }}
                          >
                            <span>{ratio}</span>
                            <small>{localizeFormatLabel(label, l)}</small>
                            {videoFormat === value ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
                          </button>
                        ))}
                      </div>
                      {videoFormat === 'vertical' || videoFormat === 'all' ? (
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
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>

              <CreatorTaskSummary
                sourceIcon={FileVideo}
                sourceLabel={l('视频来源', 'Video source')}
                sourceValue={sourceName}
                items={summaryItems}
                note={l('配置将带入 Home 对话继续创建', 'These settings will carry into the Home conversation')}
                noteIcon={Captions}
              />
            </div>
          ) : null}
        </div>

        {workspacePhase === 'configure' ? (
        <div className="video-translation-actions-stack">
        <footer className="video-translation-wizard-actions">
          {currentStep > 0 ? (
            <button className="video-translation-secondary-action" type="button" onClick={() => setCurrentStep((currentStep - 1) as WizardStep)}>
              <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
              {l('上一步', 'Back')}
            </button>
          ) : <span />}
          {activeStage !== undefined || resumableStage !== undefined ? (
            renderTaskControlButton()
          ) : currentStep === 0 ? (
            <div className="video-translation-action-group">
              {attemptedContinue && !hasSource ? (
                <p className="video-translation-error" role="alert">{l('请先添加需要翻译的视频', 'Add a video to translate first')}</p>
              ) : null}
              <button className="video-translation-primary-action" type="button" onClick={continueToSettings}>
                {l('继续', 'Continue')}
                <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          ) : currentStep < 3 ? (
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
        {sessionError !== null || needsInput !== null || stageFailure !== undefined || resultNotice ? (
          <div
            className={`video-translation-run-notice${sessionError !== null || needsInput !== null || stageFailure !== undefined ? ' is-error' : ''}`}
            role={sessionError !== null || needsInput !== null || stageFailure !== undefined ? 'alert' : 'status'}
          >
            <span>
              {runIssueMessage || resultNotice}
            </span>
            {needsCreatorServicesConfiguration(sessionError?.code, needsInput?.code, stageConfigurationCode) ? (
              <a href={creatorServicesSettingsHref(
                sessionError?.code,
                needsInput?.code,
                stageConfigurationCode
              )}>
                {l('打开 AI 服务设置', 'Open AI service settings')}
              </a>
            ) : null}
          </div>
        ) : null}
        </div>
        ) : null}
        {workspacePhase === 'result' && (activeStage !== undefined || resumableStage !== undefined) ? (
          <footer className="video-translation-wizard-actions video-translation-task-controls">
            <span />
            {renderTaskControlButton()}
          </footer>
        ) : null}
          </div>

          <div
            className="pane-resize-handle video-translation-pane-resize"
            role="separator"
            aria-label={l('调整操作区和对话区宽度', 'Resize workspace and conversation panels')}
            aria-orientation="vertical"
            aria-valuemin={WORKSPACE_MIN_WIDTH}
            aria-valuenow={workspacePaneWidth}
            aria-valuetext={workspacePaneWidth === undefined
              ? l('默认宽度', 'Default width')
              : l(`操作区宽度 ${workspacePaneWidth} 像素`, `Workspace width ${workspacePaneWidth} pixels`)}
            tabIndex={0}
            title={l('拖动调整宽度，双击恢复默认', 'Drag to resize. Double-click to restore the default.')}
            onDoubleClick={() => setWorkspacePaneWidth(undefined)}
            onMouseDown={handlePaneResizeMouseDown}
            onKeyDown={handlePaneResizeKeyDown}
          />

          <VideoTranslationAgentPanel
            stepLabel={workspacePhase === 'result' ? l('项目结果', 'Project results') : localizeStep(steps[currentStep], l)}
            contextSummary={agentContextSummary}
            promptHint={props.promptHint}
            currentIssue={runIssueMessage || undefined}
            quickActions={[
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
              {
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
              },
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
          />
        </div>
      </div>
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
              <span aria-hidden="true"><CircleStop size={18} strokeWidth={1.9} /></span>
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
                <CircleStop size={15} strokeWidth={1.9} aria-hidden="true" />
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

function clampPaneWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  if (code === 'creator_transcription_config_missing') {
    return l('当前字幕策略需要配置语音识别服务。', 'The current subtitle strategy requires a transcription service.');
  }
  if (code === 'creator_tts_config_missing') {
    return l('已开启配音，请先配置配音服务。', 'Dubbing is enabled. Configure a TTS service first.');
  }
  if (code === 'unsupported_source') {
    return l('当前仅支持 YouTube、Bilibili 公共链接或已上传的本地视频。', 'Only public YouTube/Bilibili links or uploaded local videos are supported.');
  }
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  return message || l('启动翻译失败，请检查配置后重试。', 'Failed to start translation. Check the configuration and retry.');
}

function translationStageLabel(stageId: string, l: LocalizeCopy): string {
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

function creatorStageProgressPercent(
  stage: import('@opencreator/protocol').CreatorStageRun
): number | null {
  const payload = stage.progress.krillinEventPayload;
  const nested = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const value = typeof stage.progress.percent === 'number'
    ? stage.progress.percent
    : typeof nested?.percent === 'number'
      ? nested.percent
      : null;
  return value === null || !Number.isFinite(value)
    ? null
    : Math.max(0, Math.min(100, Math.round(value)));
}

function stageErrorMessage(code: string | null, message: string | null, l: LocalizeCopy): string {
  const configurationCode = normalizeStageConfigurationError(code, message);
  if (configurationCode !== null) return creatorErrorMessage({ code: configurationCode }, l);
  if (code === 'dependency_not_packaged') {
    return l('当前安装包缺少所选语音识别能力，请更换服务或重新安装完整运行时。', 'The selected transcription runtime is not packaged. Choose another service or reinstall the full runtime.');
  }
  return message || l('翻译阶段执行失败，请检查创作动态和服务配置。', 'The translation stage failed. Check activity and service configuration.');
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
    || code === 'creator_transcription_config_missing'
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
    : code === 'creator_transcription_config_missing'
      ? 'transcription'
      : 'text';
  return `#/settings?tab=ai-services&section=${section}`;
}

function localizeStep(step: typeof steps[number], l: LocalizeCopy): string {
  if (step === '添加视频') return l(step, 'Add video');
  if (step === '翻译设置') return l(step, 'Translation');
  if (step === '字幕样式') return l(step, 'Subtitle style');
  return l(step, 'Dubbing & output');
}

function localizeFormatLabel(label: '横屏' | '竖屏' | '全部', l: LocalizeCopy): string {
  if (label === '横屏') return l(label, 'Horizontal');
  if (label === '竖屏') return l(label, 'Vertical');
  return l(label, 'Both');
}
