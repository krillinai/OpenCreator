import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  ChevronDown,
  FileAudio,
  FileVideo,
  History,
  Languages,
  Link2,
  Mic2,
  MonitorPlay,
  Sparkles,
  UploadCloud
} from 'lucide-react';
import { beginPaneResize } from '../../components/layout/pane-resize-2026-07-29.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import VideoTranslationAgentPanel, {
  type VideoTranslationAgentAction
} from './VideoTranslationAgentPanel.js';
import VideoSourcePreview from './VideoSourcePreview.js';
import VideoTranslationResultWorkspace, {
  type SubtitleCue,
  type VideoTranslationResultTab
} from './VideoTranslationResultWorkspace.js';

type SourceType = 'url' | 'file';
type SubtitlePosition = 'top' | 'bottom';
type VideoFormat = 'horizontal' | 'vertical' | 'all';
type WizardStep = 0 | 1 | 2;
type WorkspacePhase = 'configure' | 'result';
type ResultProposal = 'regenerate';
type AgentFocus = 'language' | 'subtitles' | 'dubbing' | 'output';

type TranslationSettingsSnapshot = {
  sourceLanguage: string;
  targetLanguage: string;
  bilingual: boolean;
  subtitlePosition: SubtitlePosition;
  preferPlatformCaptions: boolean;
  dubbing: boolean;
  voiceCode: string;
  voiceSample: File | null;
  composeVideo: boolean;
  videoFormat: VideoFormat;
  verticalTitle: string;
  verticalSubtitle: string;
};

type TranslationSourceSnapshot = {
  sourceType: SourceType;
  videoUrl: string;
  videoFile: File | null;
};

type TranslationResultVersion = {
  value: number;
  description: string;
  source: TranslationSourceSnapshot;
  settings: TranslationSettingsSnapshot;
  subtitleCues: SubtitleCue[];
  savedSubtitleSnapshot: string;
  generatedSubtitleSnapshot: string;
};

type AgentUndo =
  | { type: 'target_language'; value: string; description: string }
  | { type: 'bilingual'; value: boolean; description: string }
  | { type: 'dubbing'; value: boolean; description: string }
  | { type: 'output'; composeVideo: boolean; videoFormat: VideoFormat; description: string }
  | {
      type: 'subtitle_only';
      dubbing: boolean;
      composeVideo: boolean;
      videoFormat: VideoFormat;
      description: string;
    }
  | {
      type: 'task_snapshot';
      settings: TranslationSettingsSnapshot;
      source: TranslationSourceSnapshot;
      description: string;
    }
  | { type: 'subtitle_text'; version: number; cueId: number; value: string; description: string };

type LanguageOption = {
  value: string;
  label: string;
};

const steps = ['添加视频', '翻译设置', '配音与输出'] as const;
const WORKSPACE_MIN_WIDTH = 780;
const AGENT_MIN_WIDTH = 320;
const WORKSPACE_RESIZE_HANDLE_WIDTH = 7;
const WORKSPACE_RESIZE_KEY_STEP = 32;

function createSubtitleCues(targetLanguage: string): SubtitleCue[] {
  if (targetLanguage === 'ja') {
    return [
      { id: 1, start: '00:00:00,000', end: '00:00:03,200', text: 'OpenCreator へようこそ。' },
      { id: 2, start: '00:00:03,200', end: '00:00:07,100', text: '元の動画から音声を自動的に認識します。' },
      { id: 3, start: '00:00:07,100', end: '00:00:11,400', text: '自然なニュアンスを保ちながら字幕を翻訳します。' },
      { id: 4, start: '00:00:11,400', end: '00:00:15,000', text: '確認後、吹き替えと動画を生成できます。' }
    ];
  }

  return [
    { id: 1, start: '00:00:00,000', end: '00:00:03,200', text: 'Welcome to OpenCreator.' },
    { id: 2, start: '00:00:03,200', end: '00:00:07,100', text: 'We automatically identify the speech in your original video.' },
    { id: 3, start: '00:00:07,100', end: '00:00:11,400', text: 'Your subtitles are translated while keeping the original tone.' },
    { id: 4, start: '00:00:11,400', end: '00:00:15,000', text: 'Review the result, then generate the voice and final video.' }
  ];
}

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
  { value: 'uk', label: 'Українська' }
];

function languageLabel(options: LanguageOption[], value: string) {
  return options.find(option => option.value === value)?.label ?? value;
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

function sameFile(left: File | null, right: File | null) {
  return left === right || Boolean(
    left && right
    && left.name === right.name
    && left.size === right.size
    && left.type === right.type
    && left.lastModified === right.lastModified
  );
}

function sameSource(left: TranslationSourceSnapshot, right: TranslationSourceSnapshot) {
  return left.sourceType === right.sourceType
    && left.videoUrl === right.videoUrl
    && sameFile(left.videoFile, right.videoFile);
}

function sameSettings(left: TranslationSettingsSnapshot, right: TranslationSettingsSnapshot) {
  return left.sourceLanguage === right.sourceLanguage
    && left.targetLanguage === right.targetLanguage
    && left.bilingual === right.bilingual
    && left.subtitlePosition === right.subtitlePosition
    && left.preferPlatformCaptions === right.preferPlatformCaptions
    && left.dubbing === right.dubbing
    && left.voiceCode === right.voiceCode
    && sameFile(left.voiceSample, right.voiceSample)
    && left.composeVideo === right.composeVideo
    && left.videoFormat === right.videoFormat
    && left.verticalTitle === right.verticalTitle
    && left.verticalSubtitle === right.verticalSubtitle;
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

function affectedArtifacts(
  version: TranslationResultVersion,
  settings: TranslationSettingsSnapshot,
  source: TranslationSourceSnapshot,
  subtitleNeedsRegeneration: boolean,
  l: LocalizeCopy
) {
  const translationChanged = !canReuseSubtitleCues(version, settings, source)
    || version.settings.bilingual !== settings.bilingual
    || version.settings.subtitlePosition !== settings.subtitlePosition;
  const voiceChanged = version.settings.dubbing !== settings.dubbing
    || version.settings.voiceCode !== settings.voiceCode
    || !sameFile(version.settings.voiceSample, settings.voiceSample);
  const outputChanged = version.settings.composeVideo !== settings.composeVideo
    || version.settings.videoFormat !== settings.videoFormat
    || version.settings.verticalTitle !== settings.verticalTitle
    || version.settings.verticalSubtitle !== settings.verticalSubtitle;
  const artifacts = new Set<string>();

  if (subtitleNeedsRegeneration || translationChanged) artifacts.add(l('字幕', 'Subtitles'));
  if (voiceChanged || ((subtitleNeedsRegeneration || translationChanged) && settings.dubbing)) artifacts.add(l('配音', 'Dubbing'));
  if (subtitleNeedsRegeneration || translationChanged || voiceChanged || outputChanged) artifacts.add(l('成片', 'Final video'));
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

export default function VideoTranslationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
}) {
  const l = useLocalizedCopy();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const collabLayoutRef = useRef<HTMLDivElement>(null);
  const agentFocusTimeoutRef = useRef<number>();
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
  const [furthestStep, setFurthestStep] = useState<WizardStep>(0);
  const [workspacePhase, setWorkspacePhase] = useState<WorkspacePhase>('configure');
  const [dragActive, setDragActive] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>('url');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [sourceLanguage, setSourceLanguage] = useState('zh_cn');
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [bilingual, setBilingual] = useState(true);
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePosition>('top');
  const [preferPlatformCaptions, setPreferPlatformCaptions] = useState(true);
  const [dubbing, setDubbing] = useState(false);
  const [voiceCode, setVoiceCode] = useState('');
  const [voiceSample, setVoiceSample] = useState<File | null>(null);
  const [composeVideo, setComposeVideo] = useState(false);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>('horizontal');
  const [verticalTitle, setVerticalTitle] = useState('');
  const [verticalSubtitle, setVerticalSubtitle] = useState('');
  const [attemptedContinue, setAttemptedContinue] = useState(false);
  const [agentUndo, setAgentUndo] = useState<AgentUndo>();
  const [workspacePaneWidth, setWorkspacePaneWidth] = useState<number>();
  const [resultTab, setResultTab] = useState<VideoTranslationResultTab>('video');
  const [resultVersion, setResultVersion] = useState(1);
  const [resultVersions, setResultVersions] = useState<TranslationResultVersion[]>([]);
  const [draftBaseVersion, setDraftBaseVersion] = useState<number>();
  const [resultProposal, setResultProposal] = useState<ResultProposal>();
  const [resultNotice, setResultNotice] = useState('');
  const [agentFocus, setAgentFocus] = useState<AgentFocus>();

  useEffect(() => () => {
    if (agentFocusTimeoutRef.current !== undefined) {
      window.clearTimeout(agentFocusTimeoutRef.current);
    }
  }, []);

  const hasSource = sourceType === 'url' ? isValidVideoUrl(videoUrl) : videoFile !== null;
  const sourceName = sourceType === 'url'
    ? (videoUrl.trim() || l('等待填写链接', 'Waiting for a link'))
    : (videoFile?.name ?? l('等待上传视频', 'Waiting for an upload'));
  const outputLabel = outputLabelFor({ composeVideo, videoFormat }, l);
  const summaryItems = useMemo(() => [
    { label: l('翻译语言', 'Languages'), value: `${languageLabel(sourceLanguages, sourceLanguage)} → ${languageLabel(targetLanguages, targetLanguage)}` },
    { label: l('字幕', 'Subtitles'), value: bilingual ? l(`双语 · 译文在${subtitlePosition === 'top' ? '上' : '下'}`, `Bilingual · translation ${subtitlePosition === 'top' ? 'above' : 'below'}`) : l('仅译文', 'Translation only') },
    { label: l('配音', 'Dubbing'), value: dubbing ? (voiceCode.trim() || l('自动匹配音色', 'Auto-match voice')) : l('关闭', 'Off') },
    { label: l('输出', 'Output'), value: outputLabel }
  ], [bilingual, dubbing, l, outputLabel, sourceLanguage, subtitlePosition, targetLanguage, voiceCode]);
  const targetLanguageLabel = languageLabel(targetLanguages, targetLanguage);
  const selectedResult = resultVersions.find(version => version.value === resultVersion);
  const selectedResultSource = selectedResult?.source;
  const selectedResultSettings = selectedResult?.settings;
  const selectedSubtitleCues = selectedResult?.subtitleCues ?? [];
  const selectedTargetLanguageLabel = selectedResultSettings
    ? languageLabel(targetLanguages, selectedResultSettings.targetLanguage)
    : targetLanguageLabel;
  const selectedOutputLabel = selectedResultSettings
    ? outputLabelFor(selectedResultSettings, l)
    : outputLabel;
  const selectedSourceName = selectedResultSource?.sourceType === 'url'
    ? (selectedResultSource.videoUrl.trim() || l('等待填写链接', 'Waiting for a link'))
    : (selectedResultSource?.videoFile?.name ?? l('等待上传视频', 'Waiting for an upload'));
  const subtitleDirty = selectedResult
    ? JSON.stringify(selectedResult.subtitleCues) !== selectedResult.savedSubtitleSnapshot
    : false;
  const subtitleNeedsRegeneration = selectedResult
    ? JSON.stringify(selectedResult.subtitleCues) !== selectedResult.generatedSubtitleSnapshot
    : false;
  const nextVersion = resultVersions.reduce((highest, version) => Math.max(highest, version.value), 0) + 1;
  const agentContextSummary = workspacePhase === 'result'
    ? `${({ video: l('成片', 'Final video'), subtitles: l('字幕', 'Subtitles'), voice: l('配音', 'Dubbing'), settings: l('任务设置', 'Task settings') } as const)[resultTab]} V${resultVersion}`
    : currentStep === 0
      ? sourceName
      : currentStep === 1
        ? `${languageLabel(sourceLanguages, sourceLanguage)} → ${targetLanguageLabel}`
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
      dubbing,
      voiceCode,
      voiceSample,
      composeVideo,
      videoFormat,
      verticalTitle,
      verticalSubtitle
    };
  }

  function currentDraftSource(): TranslationSourceSnapshot {
    return { sourceType, videoUrl, videoFile };
  }

  function applySettingsSnapshot(settings: TranslationSettingsSnapshot) {
    setSourceLanguage(settings.sourceLanguage);
    setTargetLanguage(settings.targetLanguage);
    setBilingual(settings.bilingual);
    setSubtitlePosition(settings.subtitlePosition);
    setPreferPlatformCaptions(settings.preferPlatformCaptions);
    setDubbing(settings.dubbing);
    setVoiceCode(settings.voiceCode);
    setVoiceSample(settings.voiceSample);
    setComposeVideo(settings.composeVideo);
    setVideoFormat(settings.videoFormat);
    setVerticalTitle(settings.verticalTitle);
    setVerticalSubtitle(settings.verticalSubtitle);
  }

  function applySourceSnapshot(source: TranslationSourceSnapshot) {
    setSourceType(source.sourceType);
    setVideoUrl(source.videoUrl);
    setVideoFile(source.videoFile);
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

  function openAgentConfiguration(step: Extract<WizardStep, 1 | 2>, focus: AgentFocus) {
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
  const hasPendingChanges = subtitleNeedsRegeneration || hasConfigDraftChanges;
  const regenerationSettings = hasConfigDraftChanges && selectedResult
    ? draftSettingsSnapshot
    : selectedResultSettings;
  const regenerationSource = hasConfigDraftChanges && selectedResult
    ? draftSourceSnapshot
    : selectedResultSource;
  const regenerationArtifacts = selectedResult && regenerationSettings && regenerationSource
    ? affectedArtifacts(selectedResult, regenerationSettings, regenerationSource, subtitleNeedsRegeneration, l)
    : [];

  function chooseVideo(file: File | null) {
    setVideoFile(file);
    if (file) {
      setVideoUrl('');
      setSourceType('file');
    } else {
      setSourceType('url');
    }
    setAttemptedContinue(false);
  }

  function openVideoPicker() {
    if (videoInputRef.current) {
      videoInputRef.current.value = '';
      videoInputRef.current.click();
    }
  }

  function dropVideo(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    chooseVideo(event.dataTransfer.files[0] ?? null);
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

  function continueToSettings() {
    setAttemptedContinue(true);
    if (!hasSource) return;
    openWizardStep(1);
  }

  function generateResult(
    settings: TranslationSettingsSnapshot = currentDraftSettings(),
    baseVersion = draftBaseVersion,
    source: TranslationSourceSnapshot = currentDraftSource(),
    subtitleCues?: SubtitleCue[]
  ) {
    const version = nextVersion;
    const nextCues = (subtitleCues ?? createSubtitleCues(settings.targetLanguage))
      .map(cue => ({ ...cue }));
    applySettingsSnapshot(settings);
    applySourceSnapshot(source);
    setResultVersion(version);
    setResultVersions(current => [
      ...current,
      {
        value: version,
        description: version === 1 ? l('初次生成', 'Initial generation') : l(`基于 V${baseVersion ?? resultVersion} 调整`, `Adjusted from V${baseVersion ?? resultVersion}`),
        source,
        settings,
        subtitleCues: nextCues,
        savedSubtitleSnapshot: JSON.stringify(nextCues),
        generatedSubtitleSnapshot: JSON.stringify(nextCues)
      }
    ]);
    setDraftBaseVersion(version);
    setAgentUndo(undefined);
    setResultProposal(undefined);
    setResultNotice(
      version === 1
        ? l('V1 已生成完成', 'V1 is ready.')
        : l(
            `V${version} 已生成完成，之前的版本仍可查看`,
            `V${version} is ready. Previous versions remain available.`
          )
    );
    setResultTab('video');
    setWorkspacePhase('result');
  }

  function submit() {
    if (!hasSource) {
      setCurrentStep(0);
      setAttemptedContinue(true);
      return;
    }
    const settings = currentDraftSettings();
    const source = currentDraftSource();
    const baseVersion = resultVersions.find(version => version.value === draftBaseVersion);
    generateResult(
      settings,
      draftBaseVersion,
      source,
      baseVersion && canReuseSubtitleCues(baseVersion, settings, source)
        ? baseVersion.subtitleCues
        : undefined
    );
  }

  function applyAgentAction(action: VideoTranslationAgentAction) {
    const settingsBeforeAction = workspacePhase === 'result'
      && selectedResult
      && draftBaseVersion !== selectedResult.value
      ? selectedResult.settings
      : draftSettingsSnapshot;

    switch (action.type) {
      case 'explain_source':
        return l('可以粘贴 YouTube、Bilibili 等公开视频链接，也可以直接上传本地视频或音频文件。', 'Paste a public YouTube, Bilibili, or similar link, or upload a local video or audio file.');
      case 'apply_task_request': {
        const sourceBeforeAction = workspacePhase === 'result'
          && selectedResult
          && draftBaseVersion !== selectedResult.value
          ? selectedResult.source
          : draftSourceSnapshot;
        const nextSource = action.request.videoUrl
          ? { sourceType: 'url' as const, videoUrl: action.request.videoUrl, videoFile: null }
          : sourceBeforeAction;
        const nextSettings: TranslationSettingsSnapshot = {
          ...settingsBeforeAction,
          targetLanguage: action.request.targetLanguage?.value ?? settingsBeforeAction.targetLanguage,
          bilingual: action.request.bilingual ?? settingsBeforeAction.bilingual,
          dubbing: action.request.output === 'subtitles'
            ? false
            : action.request.dubbing ?? settingsBeforeAction.dubbing,
          composeVideo: action.request.output === 'subtitles'
            ? false
            : action.request.output
              ? true
              : settingsBeforeAction.composeVideo,
          videoFormat: action.request.output === 'horizontal' || action.request.output === 'vertical'
            ? action.request.output
            : settingsBeforeAction.videoFormat
        };
        const changes: string[] = [];
        if (action.request.videoUrl) changes.push(l('已添加视频链接', 'Video link added'));
        if (action.request.targetLanguage) changes.push(l(`目标语言为${action.request.targetLanguage.label}`, `Target language: ${action.request.targetLanguage.label}`));
        if (action.request.bilingual !== undefined) {
          changes.push(action.request.bilingual ? l('已开启双语字幕', 'Bilingual subtitles enabled') : l('已关闭双语字幕', 'Bilingual subtitles disabled'));
        }
        if (action.request.output === 'subtitles') {
          changes.push(l('仅生成字幕', 'Subtitles only'));
        } else {
          if (action.request.dubbing !== undefined) {
            changes.push(action.request.dubbing ? l('已开启配音', 'Dubbing enabled') : l('已关闭配音', 'Dubbing disabled'));
          }
          if (action.request.output) {
            changes.push(action.request.output === 'vertical' ? l('输出竖屏视频', 'Vertical video output') : l('输出横屏视频', 'Horizontal video output'));
          }
        }
        const description = changes.join(l('，', ', ')) || l('已更新任务设置', 'Task settings updated');

        setAgentUndo({
          type: 'task_snapshot',
          settings: settingsBeforeAction,
          source: sourceBeforeAction,
          description
        });
        applySourceSnapshot(nextSource);
        applySettingsSnapshot(nextSettings);
        setAttemptedContinue(false);

        if (workspacePhase === 'result' && selectedResult) {
          setDraftBaseVersion(selectedResult.value);
          setResultProposal(undefined);
          setResultNotice('');
        }

        if (action.request.execute) {
          const sourceReady = nextSource.sourceType === 'url'
            ? isValidVideoUrl(nextSource.videoUrl)
            : nextSource.videoFile !== null;
          if (!sourceReady) {
            setWorkspacePhase('configure');
            setCurrentStep(0);
            return l('还缺少视频。请在对话中发送公开视频链接，或从左侧上传本地文件。', 'A video is still required. Send a public link here or upload a local file on the left.');
          }
          if (workspacePhase === 'result' && selectedResult) {
            const requestHasChanges = subtitleNeedsRegeneration
              || !sameSettings(nextSettings, selectedResult.settings)
              || !sameSource(nextSource, selectedResult.source);
            if (!requestHasChanges) {
              setResultProposal(undefined);
              return l('当前版本没有修改，不需要重新生成。', 'Nothing changed in this version, so regeneration is not needed.');
            }
            setResultProposal('regenerate');
            return l(`${description}。将基于 V${selectedResult.value} 生成 V${nextVersion}，请确认后执行。`, `${description}. V${nextVersion} will be generated from V${selectedResult.value}. Confirm to continue.`);
          }
          const baseVersion = resultVersions.find(version => version.value === draftBaseVersion);
          generateResult(
            nextSettings,
            draftBaseVersion,
            nextSource,
            baseVersion && canReuseSubtitleCues(baseVersion, nextSettings, nextSource)
              ? baseVersion.subtitleCues
              : undefined
          );
          return l(`${description}。视频翻译已完成，V${nextVersion} 的产出已打开。`, `${description}. Translation is complete and the V${nextVersion} output is open.`);
        }

        if (workspacePhase === 'result') setWorkspacePhase('configure');
        if (action.request.output || action.request.dubbing !== undefined) {
          openWizardStep(2);
          focusAgentControl(action.request.dubbing !== undefined ? 'dubbing' : 'output');
          return l(`${description}。左侧已同步到配音与输出设置。`, `${description}. The dubbing and output settings are synchronized on the left.`);
        }
        if (action.request.targetLanguage || action.request.bilingual !== undefined) {
          openWizardStep(1);
          focusAgentControl(action.request.targetLanguage ? 'language' : 'subtitles');
          return l(`${description}。左侧已同步到翻译设置。`, `${description}. The translation settings are synchronized on the left.`);
        }
        setCurrentStep(0);
        return l(`${description}。视频预览已显示在左侧，可以继续设置或直接开始翻译。`, `${description}. The video preview is open on the left. Continue setup or start translating.`);
      }
      case 'advance_task':
        if (workspacePhase === 'result') {
          return l('当前任务已经完成。你可以修改字幕或设置，再生成新版本。', 'This task is complete. Edit subtitles or settings, then generate a new version.');
        }
        if (currentStep === 0) {
          if (!hasSource) return l('请先发送公开视频链接，或从左侧上传本地文件。', 'Send a public video link or upload a local file on the left first.');
          openWizardStep(1);
          return l('视频已就绪。请确认目标语言和字幕设置，也可以直接告诉我要翻译成哪种语言。', 'The video is ready. Confirm the target language and subtitle settings, or tell me the language you want.');
        }
        if (currentStep === 1) {
          openWizardStep(2);
          return l('翻译设置已确认。接下来可以选择配音和输出画幅，或直接开始翻译。', 'Translation settings are confirmed. Choose dubbing and output format, or start translating now.');
        }
        return applyAgentAction({ type: 'run_translation' });
      case 'run_translation': {
        if (!hasSource) {
          setCurrentStep(0);
          return l('还缺少视频。请在对话中发送公开视频链接，或从左侧上传本地文件。', 'A video is still required. Send a public link here or upload a local file on the left.');
        }
        if (workspacePhase === 'result') {
          if (!hasPendingChanges) return l('当前版本没有修改，不需要重新生成。', 'Nothing changed in this version, so regeneration is not needed.');
          setResultProposal('regenerate');
          return l(`将基于 V${resultVersion} 生成 V${nextVersion}，请确认后执行。`, `V${nextVersion} will be generated from V${resultVersion}. Confirm to continue.`);
        }
        const settings = currentDraftSettings();
        const source = currentDraftSource();
        const baseVersion = resultVersions.find(version => version.value === draftBaseVersion);
        generateResult(
          settings,
          draftBaseVersion,
          source,
          baseVersion && canReuseSubtitleCues(baseVersion, settings, source)
            ? baseVersion.subtitleCues
            : undefined
        );
        return l(`视频翻译已完成，V${nextVersion} 的产出已打开。`, `Translation is complete and the V${nextVersion} output is open.`);
      }
      case 'set_target_language': {
        const description = l(`目标语言已改为${action.label}`, `Target language changed to ${action.label}`);
        setAgentUndo({ type: 'target_language', value: settingsBeforeAction.targetLanguage, description });
        openAgentConfiguration(1, 'language');
        setTargetLanguage(action.value);
        return l(`${description}，左侧设置已同步更新。`, `${description}. The settings on the left are synchronized.`);
      }
      case 'set_bilingual': {
        const description = action.value ? l('已开启双语字幕', 'Bilingual subtitles enabled') : l('已关闭双语字幕', 'Bilingual subtitles disabled');
        setAgentUndo({ type: 'bilingual', value: settingsBeforeAction.bilingual, description });
        openAgentConfiguration(1, 'subtitles');
        setBilingual(action.value);
        return l(`${description}，左侧设置已同步更新。`, `${description}. The settings on the left are synchronized.`);
      }
      case 'set_dubbing': {
        const description = action.value ? l('已开启目标语言配音', 'Target-language dubbing enabled') : l('已关闭目标语言配音', 'Target-language dubbing disabled');
        setAgentUndo({ type: 'dubbing', value: settingsBeforeAction.dubbing, description });
        openAgentConfiguration(2, 'dubbing');
        setDubbing(action.value);
        return l(`${description}，左侧已打开配音设置，你仍可以继续选择音色。`, `${description}. Dubbing settings are open on the left, where you can choose a voice.`);
      }
      case 'set_output': {
        const description = action.value === 'vertical' ? l('已改为竖屏视频输出', 'Output changed to vertical video') : l('已改为横屏视频输出', 'Output changed to horizontal video');
        setAgentUndo({
          type: 'output',
          composeVideo: settingsBeforeAction.composeVideo,
          videoFormat: settingsBeforeAction.videoFormat,
          description
        });
        openAgentConfiguration(2, 'output');
        setComposeVideo(true);
        setVideoFormat(action.value);
        return l(`${description}，左侧输出选项已展开。`, `${description}. Output options are open on the left.`);
      }
      case 'subtitle_only': {
        const description = l('已改为仅生成字幕', 'Output changed to subtitles only');
        setAgentUndo({
          type: 'subtitle_only',
          dubbing: settingsBeforeAction.dubbing,
          composeVideo: settingsBeforeAction.composeVideo,
          videoFormat: settingsBeforeAction.videoFormat,
          description
        });
        openAgentConfiguration(2, 'output');
        setDubbing(false);
        setComposeVideo(false);
        return l(`${description}，配音和视频合成都已关闭。`, `${description}. Dubbing and video rendering are disabled.`);
      }
      case 'open_subtitle_editor':
        setResultTab('subtitles');
        setResultProposal(undefined);
        return l('已打开左侧字幕。你可以直接编辑，或告诉我“把第 2 条字幕改为……”。', 'Subtitles are open on the left. Edit them directly, or tell me "change subtitle 2 to...".');
      case 'edit_subtitle': {
        if (!selectedResult) return l('请先完成一次视频翻译，再修改字幕。', 'Complete a video translation before editing subtitles.');
        const cue = selectedResult.subtitleCues[action.index - 1];
        if (!cue) return l(`当前只有 ${selectedResult.subtitleCues.length} 条字幕，请换一个有效序号。`, `There are only ${selectedResult.subtitleCues.length} subtitles. Choose a valid number.`);
        const description = l(`已修改第 ${action.index} 条字幕`, `Subtitle ${action.index} updated`);
        setAgentUndo({
          type: 'subtitle_text',
          version: selectedResult.value,
          cueId: cue.id,
          value: cue.text,
          description
        });
        setResultVersions(current => current.map(version => version.value === selectedResult.value
          ? {
              ...version,
              subtitleCues: version.subtitleCues.map(item => item.id === cue.id
                ? { ...item, text: action.text }
                : item)
            }
          : version));
        setResultTab('subtitles');
        setResultProposal(undefined);
        setResultNotice('');
        return l(`${description}，左侧编辑稿已同步。确认无误后保存字幕，再生成新版本。`, `${description}. The draft on the left is synchronized. Save the subtitles, then generate a new version.`);
      }
      case 'open_result_settings':
        openAgentConfiguration(1, 'language');
        return l('已在左侧打开当前版本的任务设置，你可以直接修改参数。', 'The current version settings are open on the left for direct editing.');
      case 'regenerate_result':
        if (!hasPendingChanges) {
          setResultProposal(undefined);
          return l('当前版本没有修改，不需要生成新版本。', 'Nothing changed in this version, so a new version is not needed.');
        }
        setResultProposal('regenerate');
        return l(`重新生成会创建 V${nextVersion}，当前版本会保留。请在左侧确认后执行。`, `Regeneration will create V${nextVersion} and preserve the current version. Confirm on the left to continue.`);
      case 'confirm_regeneration': {
        if (resultProposal !== 'regenerate') return l('当前没有等待确认的生成任务。', 'There is no generation waiting for confirmation.');
        const generatedVersion = nextVersion;
        confirmRegeneration();
        return l(`V${generatedVersion} 已生成完成，之前的版本仍可在版本历史中查看。`, `V${generatedVersion} is ready. Previous versions remain available in version history.`);
      }
      case 'cancel_regeneration':
        setResultProposal(undefined);
        return l('已取消生成，当前修改仍然保留。', 'Generation canceled. Current edits are still saved.');
    }
  }

  function saveSubtitles() {
    setResultVersions(current => current.map(version => version.value === resultVersion
      ? { ...version, savedSubtitleSnapshot: JSON.stringify(version.subtitleCues) }
      : version));
    setResultNotice(l(`V${resultVersion} 字幕修改已保存，成片需要重新生成后才会更新`, `Subtitle edits for V${resultVersion} were saved. Regenerate the final video to apply them.`));
  }

  function exportResult(type: 'video' | 'subtitles' | 'voice') {
    if (type === 'subtitles') {
      const content = selectedSubtitleCues
        .map((cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}`)
        .join('\n\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `OpenCreator-subtitles-V${resultVersion}.srt`;
      link.click();
      URL.revokeObjectURL(url);
      setResultNotice(l('字幕文件已开始下载', 'Subtitle download started'));
      return;
    }
    setResultNotice(type === 'video' ? l('成片已加入下载队列', 'Final video added to the download queue') : l('配音文件已加入下载队列', 'Dubbing file added to the download queue'));
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
    setFurthestStep(2);
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
    setResultNotice(l(`正在查看 V${version}`, `Viewing V${version}`));
  }

  function confirmRegeneration() {
    if (!selectedResult || !regenerationSettings || !regenerationSource) return;
    if (!hasPendingChanges) {
      setResultProposal(undefined);
      setResultNotice(l('当前版本没有修改，不需要生成新版本', 'Nothing changed, so a new version is not needed'));
      return;
    }
    if (subtitleDirty) {
      setResultVersions(current => current.map(version => version.value === selectedResult.value
        ? { ...version, savedSubtitleSnapshot: JSON.stringify(version.subtitleCues) }
        : version));
    }
    generateResult(
      regenerationSettings,
      selectedResult.value,
      regenerationSource,
      canReuseSubtitleCues(selectedResult, regenerationSettings, regenerationSource)
        ? selectedResult.subtitleCues
        : undefined
    );
  }

  function undoAgentAction() {
    if (!agentUndo) return;
    switch (agentUndo.type) {
      case 'target_language':
        setTargetLanguage(agentUndo.value);
        break;
      case 'bilingual':
        setBilingual(agentUndo.value);
        break;
      case 'dubbing':
        setDubbing(agentUndo.value);
        break;
      case 'output':
        setComposeVideo(agentUndo.composeVideo);
        setVideoFormat(agentUndo.videoFormat);
        break;
      case 'subtitle_only':
        setDubbing(agentUndo.dubbing);
        setComposeVideo(agentUndo.composeVideo);
        setVideoFormat(agentUndo.videoFormat);
        break;
      case 'task_snapshot':
        applySettingsSnapshot(agentUndo.settings);
        applySourceSnapshot(agentUndo.source);
        break;
      case 'subtitle_text':
        setResultVersions(current => current.map(version => version.value === agentUndo.version
          ? {
              ...version,
              subtitleCues: version.subtitleCues.map(cue => cue.id === agentUndo.cueId
                ? { ...cue, text: agentUndo.value }
                : cue)
            }
          : version));
        setResultVersion(agentUndo.version);
        setWorkspacePhase('result');
        setResultTab('subtitles');
        break;
    }
    setAgentUndo(undefined);
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
          <button type="button" onClick={props.onBack} aria-label={l('返回 Dashboard', 'Back to Dashboard')}>
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
              file={selectedResultSource?.videoFile ?? null}
              sourceType={selectedResultSource?.sourceType ?? 'url'}
              url={selectedResultSource?.videoUrl ?? ''}
              targetLanguage={selectedTargetLanguageLabel}
              outputLabel={selectedOutputLabel}
              dubbing={selectedResultSettings?.dubbing ?? false}
              subtitleCues={selectedSubtitleCues}
              subtitleDirty={subtitleDirty}
              nextVersion={nextVersion}
              affectedArtifacts={regenerationArtifacts}
              hasPendingChanges={hasPendingChanges}
              regenerationPending={resultProposal === 'regenerate'}
              notice={resultNotice}
              onTabChange={tab => {
                setResultTab(tab);
                setResultNotice('');
              }}
              onVersionChange={selectResultVersion}
              onSubtitleChange={(id, text) => {
                setResultVersions(current => current.map(version => version.value === resultVersion
                  ? {
                      ...version,
                      subtitleCues: version.subtitleCues.map(cue => cue.id === id ? { ...cue, text } : cue)
                    }
                  : version));
                setResultNotice('');
              }}
              onSaveSubtitles={saveSubtitles}
              onAdjustSettings={adjustSettingsFromResult}
              onExport={exportResult}
              onRequestRegenerate={() => {
                setResultProposal('regenerate');
                setResultNotice('');
              }}
              onCancelRegenerate={() => setResultProposal(undefined)}
              onConfirmRegenerate={confirmRegeneration}
            />
          ) : null}

          {workspacePhase === 'configure' && currentStep === 0 ? (
            <section
              className="video-translation-step-panel video-translation-source-step"
              aria-label={hasSource ? l('视频预览', 'Video preview') : undefined}
              aria-labelledby={hasSource ? undefined : 'add-video-title'}
            >
              <div
                className={hasSource ? 'video-translation-preview-drop-target' : 'video-translation-dropzone'}
                data-dragging={dragActive}
                onDragEnter={event => { event.preventDefault(); setDragActive(true); }}
                onDragOver={event => event.preventDefault()}
                onDragLeave={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
                }}
                onDrop={dropVideo}
              >
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*,audio/*"
                  onChange={event => chooseVideo(event.target.files?.[0] ?? null)}
                  aria-label={l('上传本地视频', 'Upload a local video')}
                />
                {hasSource ? (
                  <VideoSourcePreview
                    file={videoFile}
                    sourceType={sourceType}
                    url={videoUrl}
                    onChooseFile={openVideoPicker}
                    onClear={clearCurrentSource}
                  />
                ) : (
                  <>
                    <span className="video-translation-dropzone-icon" aria-hidden="true">
                      <UploadCloud size={25} strokeWidth={1.6} />
                    </span>
                    <h2 id="add-video-title">{l('拖放视频到这里', 'Drop a video here')}</h2>
                    <p>{l('支持常见视频与音频格式', 'Supports common video and audio formats')}</p>
                    <button className="video-translation-browse" type="button" onClick={openVideoPicker}>
                      {l('选择本地视频', 'Choose a local video')}
                    </button>
                  </>
                )}
              </div>

              {!hasSource ? (
                <>
                  <div className="video-translation-or"><span>{l('或', 'or')}</span></div>

                  <label className="video-translation-field video-translation-url-field">
                    <span>{l('视频链接', 'Video link')}</span>
                    <div>
                      <Link2 size={17} strokeWidth={1.7} aria-hidden="true" />
                      <input
                        type="url"
                        value={videoUrl}
                        onChange={event => {
                          setVideoUrl(event.target.value);
                          setSourceType('url');
                          setVideoFile(null);
                          setAttemptedContinue(false);
                        }}
                        placeholder={l('粘贴 YouTube、Bilibili 或其他视频链接', 'Paste a YouTube, Bilibili, or other video link')}
                        aria-invalid={attemptedContinue && !hasSource}
                      />
                    </div>
                  </label>
                </>
              ) : null}
            </section>
          ) : null}

          {workspacePhase === 'configure' && currentStep === 1 ? (
            <section className="video-translation-step-panel" aria-labelledby="translation-settings-title">
              <div className="video-translation-step-heading">
                <h2 id="translation-settings-title">{l('设置翻译语言', 'Set translation languages')}</h2>
                <p>{l('选择视频原语言和目标语言，并设置字幕样式', 'Choose source and target languages, then configure subtitles')}</p>
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
                      setAgentUndo(undefined);
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
                    setAgentUndo(undefined);
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
                        setAgentUndo(undefined);
                      }}
                    />
                  </div>
                  {dubbing ? (
                    <div className="video-translation-option-content">
                      <label className="video-translation-field">
                        <span>{l('声音代码', 'Voice code')} <small>{l('选填', 'Optional')}</small></span>
                        <input value={voiceCode} onChange={event => setVoiceCode(event.target.value)} placeholder={l('留空将自动匹配音色', 'Leave blank to auto-match a voice')} />
                      </label>
                      <div className="video-translation-upload is-compact">
                        <input
                          ref={voiceInputRef}
                          type="file"
                          accept="audio/*"
                          onChange={event => setVoiceSample(event.target.files?.[0] ?? null)}
                          aria-label={l('上传音色克隆样本', 'Upload a voice cloning sample')}
                        />
                        <button type="button" onClick={() => voiceInputRef.current?.click()}>
                          <FileAudio size={18} strokeWidth={1.7} />
                          <span>
                            <strong>{voiceSample?.name ?? l('添加音色克隆样本', 'Add a voice cloning sample')}</strong>
                            <small>{l('选填，当前仅阿里云 TTS 支持', 'Optional. Currently supported by Alibaba Cloud TTS only.')}</small>
                          </span>
                        </button>
                      </div>
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
                        setAgentUndo(undefined);
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
                            key={value}
                            onClick={() => {
                              setVideoFormat(value);
                              setAgentUndo(undefined);
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

              <aside className="video-translation-summary" aria-label={l('任务摘要', 'Task summary')}>
                <div className="video-translation-summary-heading">
                  <span><Sparkles size={16} strokeWidth={1.8} aria-hidden="true" /></span>
                  <h2>{l('任务摘要', 'Task summary')}</h2>
                </div>
                <div className="video-translation-source-summary">
                  <FileVideo size={16} strokeWidth={1.7} aria-hidden="true" />
                  <span>
                    <small>{l('视频来源', 'Video source')}</small>
                    <strong title={sourceName}>{sourceName}</strong>
                  </span>
                </div>
                <dl>
                  {summaryItems.map(item => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
                <p><Captions size={14} strokeWidth={1.8} aria-hidden="true" /> {l('配置将带入 Home 对话继续创建', 'These settings will carry into the Home conversation')}</p>
              </aside>
            </div>
          ) : null}
        </div>

        {workspacePhase === 'configure' ? (
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
                <p className="video-translation-error" role="alert">{l('请先添加需要翻译的视频', 'Add a video to translate first')}</p>
              ) : null}
              <button className="video-translation-primary-action" type="button" onClick={continueToSettings}>
                {l('继续', 'Continue')}
                <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          ) : currentStep === 1 ? (
            <button className="video-translation-primary-action" type="button" onClick={() => openWizardStep(2)}>
              {l('继续', 'Continue')}
              <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : (
            <button className="video-translation-primary-action" type="button" onClick={submit}>
              {draftBaseVersion === undefined ? l('开始翻译', 'Start translation') : `${l('生成', 'Generate')} V${nextVersion}`}
              <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          )}
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
            step={workspacePhase === 'result' ? 3 : currentStep}
            stepLabel={workspacePhase === 'result' ? l('项目结果', 'Project results') : localizeStep(steps[currentStep], l)}
            contextSummary={agentContextSummary}
            canRegenerate={workspacePhase === 'result' && hasPendingChanges}
            regenerationPending={resultProposal === 'regenerate'}
            nextVersion={nextVersion}
            promptHint={props.promptHint}
            lastChange={agentUndo?.description}
            onApply={applyAgentAction}
            onUndo={undoAgentAction}
          />
        </div>
      </div>
    </main>
  );
}

function clampPaneWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function localizeStep(step: typeof steps[number], l: LocalizeCopy): string {
  if (step === '添加视频') return l(step, 'Add video');
  if (step === '翻译设置') return l(step, 'Translation');
  return l(step, 'Dubbing & output');
}

function localizeFormatLabel(label: '横屏' | '竖屏' | '全部', l: LocalizeCopy): string {
  if (label === '横屏') return l(label, 'Horizontal');
  if (label === '竖屏') return l(label, 'Vertical');
  return l(label, 'Both');
}
