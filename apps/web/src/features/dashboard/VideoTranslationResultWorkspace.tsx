import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type ReactNode
} from 'react';
import {
  Captions,
  ChevronRight,
  ArrowLeft,
  Download,
  FileAudio,
  FileVideo,
  Maximize2,
  MessageSquare,
  Mic2,
  Languages,
  MonitorPlay,
  Headphones,
  PanelRightOpen,
  PanelRightClose,
  PackageOpen,
  RotateCcw,
  Save,
  Search,
  X,
  Redo2,
  Undo2
} from 'lucide-react';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { TranslationEditorContext } from './video-translation-continuation.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import { OriginalErrorDetails } from '../issues/OriginalErrorDetails.js';
import SubtitleTimeline from './SubtitleTimeline.js';
import SubtitleFindReplace from './SubtitleFindReplace.js';
import { sameSubtitleCues, subtitleSeconds } from './subtitle-editing.js';
import { beginPaneResize, paneInlineDirection } from '../../components/layout/pane-resize-2026-07-29.js';
import './subtitle-editor.css';

export type VideoTranslationResultTab = 'video' | 'subtitles' | 'voice';
export type VideoResultVariant = 'horizontal' | 'vertical' | 'dubbed';
export type SubtitleResultVariant = 'horizontal' | 'vertical';
type EditorSettingsPanel = 'language' | 'style' | 'voice' | 'output';

export type VideoTranslationResultExecution = {
  status: 'queued' | 'running' | 'needs_input' | 'failed' | 'canceled' | 'interrupted';
  stageLabel: string;
};

export type SubtitleCue = {
  id: number;
  start: string;
  end: string;
  text: string;
  sourceText?: string;
};

type VersionItem = {
  value: number;
  description: string;
};

export type VideoResultOutput = {
  artifactId: string;
  variant: VideoResultVariant;
  artifactVersion: number;
  fileName?: string;
  src?: string;
  previewLoading?: boolean;
  previewError?: string;
};

export type SubtitleResultOutput = {
  artifactId: string;
  variant: SubtitleResultVariant;
  artifactVersion: number;
  fileName?: string;
  cues: SubtitleCue[];
  readOnly: boolean;
  translationPosition?: 'top' | 'bottom';
};

export type SubtitleVideoPreview = {
  artifactId: string;
  src?: string;
  previewLoading?: boolean;
  previewError?: string;
  source: boolean;
  needsSubtitleOverlay?: boolean;
};

export type VoiceResultOutput = {
  artifactId: string;
  artifactVersion: number;
  fileName?: string;
  src?: string;
  previewLoading?: boolean;
  previewError?: string;
};

const resultTabs: Array<{
  value: VideoTranslationResultTab;
  label: string;
  icon: typeof FileVideo;
}> = [
  { value: 'video', label: '作品', icon: PackageOpen },
  { value: 'subtitles', label: '字幕', icon: Captions },
  { value: 'voice', label: '配音', icon: Mic2 }
];

export default function VideoTranslationResultWorkspace(props: {
  workbench?: boolean;
  onBack?(): void;
  onRequestOutput?(type: 'video' | 'voice'): void;
  outputUpToDate?: boolean;
  outputActionDetail?: string;
  generationLabel?: string;
  outputBusyLabel?: string;
  taskProgress?: ReactNode;
  videoPreviewRequest?: { key: string; version: number };
  outputDisabled?: boolean;
  configurationAction?: ReactNode;
  initialEditorContext?: TranslationEditorContext;
  onEditorContextChange?(context: TranslationEditorContext): void;
  generationSummary?: string;
  staleOutputs?: string[];
  subtitleAutosave?: boolean;
  subtitleSaveError?: string;
  subtitleOnly?: boolean;
  subtitleDownloads?: Array<{ artifactId: string; label: string }>;
  activeTab: VideoTranslationResultTab;
  version: number;
  versions: VersionItem[];
  targetLanguage: string;
  outputLabel: string;
  subtitleStyleLabel: string;
  dubbing: boolean;
  hasVoiceArtifact: boolean;
  videoOutputs: VideoResultOutput[];
  preferCompletedVideoPreview?: boolean;
  subtitleOutputs: SubtitleResultOutput[];
  subtitleVideoPreviews: Partial<Record<SubtitleResultVariant, SubtitleVideoPreview>>;
  previewPreparation?: { pending: boolean; blocked?: boolean; error?: string; errorDetail?: string; progress?: ReactNode };
  voiceOutput?: VoiceResultOutput;
  subtitleDirty: boolean;
  subtitleDirtyByVariant: Partial<Record<SubtitleResultVariant, boolean>>;
  subtitleSavePending?: boolean;
  subtitleReadOnly?: boolean;
  immersive?: boolean;
  assistantOpen?: boolean;
  editorSettings?: {
    language?: ReactNode; style: ReactNode; voice: ReactNode; output?: ReactNode;
    previewFormat?: SubtitleResultVariant; previewTitles?: ReactNode;
    disabled: boolean; onOpen(): void;
  };
  renderSubtitlePreview?(cues: SubtitleCue[], width: number, height: number, videoRef: RefObject<HTMLVideoElement>, variant: SubtitleResultVariant): ReactNode;
  onImmersiveChange?(value: boolean): void;
  onToggleAssistant?(): void;
  onSubtitleCuesChange?(variant: SubtitleResultVariant, cues: SubtitleCue[]): void;
  nextVersion: number;
  affectedArtifacts: string[];
  hasPendingChanges: boolean;
  regenerationPending: boolean;
  execution?: VideoTranslationResultExecution;
  notice?: string;
  onTabChange(tab: VideoTranslationResultTab): void;
  onVersionChange(version: number): void;
  onSubtitleChange(variant: SubtitleResultVariant, id: number, text: string, field?: 'text' | 'sourceText'): void;
  onSaveSubtitles(variant: SubtitleResultVariant): void;
  onAdjustSettings(): void;
  onExport(type: 'video' | 'subtitles' | 'voice', artifactId?: string): void;
  onReloadVoice(): void;
  onPrepareSourceVideo?(): void;
  onRequestRegenerate(): void;
  onCancelRegenerate(): void;
  onConfirmRegenerate(): void;
}) {
  const l = useLocalizedCopy();
  const availableSubtitleVariants = props.subtitleOutputs.map(output => output.variant);
  const availableSubtitleVariantKey = availableSubtitleVariants.join('|');
  const [selectedSubtitleVariant, setSelectedSubtitleVariant] = useState<SubtitleResultVariant>('horizontal');
  const [subtitlePlaybackTime, setSubtitlePlaybackTime] = useState(props.initialEditorContext?.time ?? 0);
  const [subtitleDuration, setSubtitleDuration] = useState(0);
  const [subtitlePlaying, setSubtitlePlaying] = useState(false);
  const [editorPanel, setEditorPanel] = useState<EditorSettingsPanel | undefined>(props.initialEditorContext?.panel ?? (props.workbench && props.editorSettings ? 'style' : undefined));
  const [settingsRailExpanded, setSettingsRailExpanded] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const settingsOpen = Boolean(editorPanel) && !settingsCollapsed;
  const timelineLayoutRef = useRef({ collapsed: false, height: 200 });
  const editorPanels = (props.workbench ? ['style', 'voice', 'output', 'language'] as const : ['language', 'output', 'style', 'voice'] as const)
    .filter(panel => props.editorSettings?.[panel] !== undefined);
  const editorPanelLabel = (panel: EditorSettingsPanel) => panel === 'language'
    ? props.workbench ? l('任务设置', 'Task settings') : l('翻译语言', 'Languages') : panel === 'style' ? l('字幕样式', 'Subtitle style')
    : panel === 'voice' ? l('配音', 'Dubbing') : props.workbench ? l('视频输出', 'Video output') : l('输出格式', 'Output format');
  const [subtitleVideoSize, setSubtitleVideoSize] = useState({ width: 16, height: 9 });
  const [auditionVoice, setAuditionVoice] = useState(false);
  const [voicePlaybackFailed, setVoicePlaybackFailed] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<number | undefined>(props.initialEditorContext?.cueId);
  const [findOpen, setFindOpen] = useState(false);
  const findButtonRef = useRef<HTMLButtonElement>(null);
  const findPanelRef = useRef<HTMLDivElement>(null);
  const [editorWidth, setEditorWidth] = useState(45);
  const maxEditorWidth = props.editorSettings ? 60 : 75;
  const [, setHistoryRevision] = useState(0);
  const history = useRef(new Map<string, { past: SubtitleCue[][]; future: SubtitleCue[][] }>());
  const rootRef = useRef<HTMLElement>(null);
  const previewLayoutRef = useRef<HTMLDivElement>(null);
  const immersiveButtonRef = useRef<HTMLButtonElement>(null);
  const returnButtonRef = useRef<HTMLButtonElement>(null);
  const subtitleVideoRef = useRef<HTMLVideoElement>(null);
  const subtitleFrameRef = useRef<HTMLDivElement>(null);
  const subtitleAudioRef = useRef<HTMLAudioElement>(null);
  const subtitleCueRefs = useRef(new Map<number, HTMLElement>());
  const activeSubtitleVariant = availableSubtitleVariants.includes(selectedSubtitleVariant)
    ? selectedSubtitleVariant
    : availableSubtitleVariants.includes('horizontal')
      ? 'horizontal'
      : availableSubtitleVariants[0];
  const activeSubtitleOutput = props.subtitleOutputs.find(output => output.variant === activeSubtitleVariant);
  const historyKey = `${props.version}:${activeSubtitleVariant}`;
  const currentHistory = history.current.get(historyKey);
  const editReadOnly = props.subtitleReadOnly === true || activeSubtitleOutput?.readOnly === true || (!props.subtitleAutosave && props.subtitleSavePending === true)
    || (props.workbench && props.editorSettings?.disabled && !props.subtitleSavePending) === true;
  const activeSubtitleLabel = props.subtitleOnly ? l('字幕', 'Subtitles')
    : subtitleVariantLabel(activeSubtitleOutput?.variant ?? 'horizontal', l);
  const activeSubtitleDirty = activeSubtitleVariant === undefined
    ? false
    : props.subtitleDirtyByVariant[activeSubtitleVariant] === true;
  const hasSubtitleDrafts = Object.values(props.subtitleDirtyByVariant).some(Boolean);
  const sourceSubtitleVideo = activeSubtitleVariant === undefined
    ? undefined
    : props.subtitleVideoPreviews[activeSubtitleVariant];
  // undefined follows the completed render; null keeps the editable dubbing preview.
  const [generatedPreviewId, setGeneratedPreviewId] = useState<string | null>();
  useEffect(() => { setGeneratedPreviewId(undefined); }, [props.version, props.outputBusyLabel]);
  const requestedVideo = props.videoOutputs.find(output => output.variant === activeSubtitleVariant) ?? props.videoOutputs[0];
  useEffect(() => {
    if (props.videoPreviewRequest?.version !== props.version || !requestedVideo) return;
    subtitleVideoRef.current?.pause();
    setGeneratedPreviewId(requestedVideo.artifactId);
    setAuditionVoice(false);
  }, [props.videoPreviewRequest?.key, props.videoPreviewRequest?.version, props.version, requestedVideo?.artifactId]);
  const previewId = generatedPreviewId === undefined && props.preferCompletedVideoPreview && !props.execution && !props.outputBusyLabel
    ? requestedVideo?.artifactId
    : generatedPreviewId;
  const generatedPreview = props.videoOutputs.find(output => output.artifactId === previewId);
  // Saved subtitles need the same live composition as drafts. A rendered
  // output may contain older text or styles and must not replace the source.
  const activeSubtitleVideo = generatedPreview ? { ...generatedPreview, source: false } : sourceSubtitleVideo;
  const showLiveSubtitles = !generatedPreview && (sourceSubtitleVideo?.source === true || sourceSubtitleVideo?.needsSubtitleOverlay === true);
  const draftVideoPreview = props.immersive && showLiveSubtitles;
  const canSwitchVideoPreview = requestedVideo !== undefined && requestedVideo.variant === activeSubtitleVariant
    && sourceSubtitleVideo !== undefined && sourceSubtitleVideo.artifactId !== requestedVideo.artifactId;
  const videoPreviewVariant = draftVideoPreview ? props.editorSettings?.previewFormat ?? activeSubtitleVariant : activeSubtitleVariant;
  const sourceWidth = subtitleVideoSize.width <= 32 ? 1920 : subtitleVideoSize.width;
  const sourceHeight = subtitleVideoSize.height <= 32 ? 1080 : subtitleVideoSize.height;
  const convertedPreview = videoPreviewVariant === 'vertical' && sourceWidth > sourceHeight;
  const subtitlePreviewSize = convertedPreview ? { width: 720, height: 1280 } : { width: sourceWidth, height: sourceHeight };
  const sourcePreviewStyle = convertedPreview ? { position: 'absolute', left: 0, top: `${250 / 1280 * 100}%`, width: '100%', height: `${Math.round(sourceHeight * 720 / sourceWidth / 2) * 2 / 1280 * 100}%`, objectFit: 'fill' } as CSSProperties : undefined;
  const playbackPositionRef = useRef(props.initialEditorContext?.time ?? 0);
  const contextRestoredRef = useRef<string>();
  const playbackSourceRef = useRef(activeSubtitleVideo?.src);
  const pendingPlaybackPositionRef = useRef<number>();
  if (playbackSourceRef.current !== activeSubtitleVideo?.src) {
    pendingPlaybackPositionRef.current = playbackPositionRef.current;
    playbackSourceRef.current = activeSubtitleVideo?.src;
  }
  playbackPositionRef.current = subtitlePlaybackTime;
  const activeSubtitleCues = activeSubtitleOutput?.cues.filter(cue => (
    subtitlePlaybackTime >= subtitleTimestampSeconds(cue.start)
    && subtitlePlaybackTime < subtitleTimestampSeconds(cue.end)
  )) ?? [];
  const activeSubtitleCueIds = new Set(activeSubtitleCues.map(cue => cue.id));
  const activeSubtitleCueKey = activeSubtitleCues.map(cue => cue.id).join('|');
  const focusedSubtitleCueIds = subtitlePlaying || selectedCueId === undefined
    ? activeSubtitleCueIds
    : new Set([selectedCueId]);
  const subtitleCueGroups = activeSubtitleOutput === undefined
    ? []
    : groupSubtitleCues(activeSubtitleOutput.cues, activeSubtitleOutput.variant);
  const generatedArtifactCount = props.videoOutputs.length
    + props.subtitleOutputs.length
    + (props.voiceOutput === undefined ? 0 : 1);
  const outputEmptyTitle = emptyResultTitle('video', props.execution?.status, l);
  const subtitleEmptyTitle = emptyResultTitle('subtitles', props.execution?.status, l);
  const voiceEmptyTitle = props.dubbing
    ? emptyResultTitle('voice', props.execution?.status, l)
    : l('此版本未开启配音', 'Dubbing is disabled for this version');
  const executionDetail = props.execution === undefined ? undefined
    : props.execution.status === 'failed'
      ? l('查看任务面板中的错误详情后重试。', 'Check the error in the task panel and retry.')
      : props.execution.status === 'needs_input'
        ? l('请先处理任务面板中的待办事项。', 'Resolve the pending action in the task panel to continue.')
        : props.execution.status === 'canceled' || props.execution.status === 'interrupted'
          ? l('可在任务面板中继续任务。', 'Resume the task from the task panel.')
          : l(`当前阶段：${props.execution.stageLabel}`, `Current stage: ${props.execution.stageLabel}`);

  useEffect(() => {
    setSelectedSubtitleVariant(availableSubtitleVariants.includes('horizontal')
      ? 'horizontal'
      : availableSubtitleVariants[0] ?? 'horizontal');
  }, [availableSubtitleVariantKey, props.version]);

  useEffect(() => {
    const key = `${props.version}:${activeSubtitleVariant}`;
    if (contextRestoredRef.current === key) return;
    const context = contextRestoredRef.current === undefined ? props.initialEditorContext : undefined;
    contextRestoredRef.current = key;
    setSubtitlePlaybackTime(context?.time ?? 0);
    setSubtitleDuration(0);
    setSubtitlePlaying(false);
    setSelectedCueId(context?.cueId);
    if (!props.workbench || context) setEditorPanel(context?.panel ?? (props.workbench && props.editorSettings ? 'style' : undefined));
    setFindOpen(false);
    playbackPositionRef.current = context?.time ?? 0;
    if (pendingPlaybackPositionRef.current !== undefined) pendingPlaybackPositionRef.current = context?.time ?? 0;
  }, [activeSubtitleVariant, props.version]);

  useEffect(() => {
    props.onEditorContextChange?.({ panel: editorPanel, time: subtitlePlaybackTime, cueId: selectedCueId });
  }, [editorPanel, subtitlePlaybackTime, selectedCueId]);
  useEffect(() => {
    if (props.workbench && props.editorSettings) props.editorSettings.onOpen();
  }, [props.version, Boolean(props.editorSettings)]);

  useEffect(() => { setSubtitlePlaying(false); }, [activeSubtitleVideo?.src, props.activeTab, props.immersive]);

  useEffect(() => {
    if (!props.immersive || props.activeTab !== 'subtitles') setEditorPanel(undefined);
    else if (props.workbench && props.editorSettings) setEditorPanel(panel => panel ?? props.initialEditorContext?.panel ?? 'style');
  }, [props.immersive, props.activeTab]);

  function collapseEditorSettings() {
    setSettingsCollapsed(true);
    if (!props.workbench) setEditorPanel(undefined);
  }

  function openEditorSettings(panel: EditorSettingsPanel) {
    setGeneratedPreviewId(null);
    if (subtitleVideoRef.current && !subtitleVideoRef.current.paused) subtitleVideoRef.current.pause();
    props.editorSettings?.onOpen();
    setEditorPanel(panel);
    setSettingsCollapsed(false);
  }

  useEffect(() => { setAuditionVoice(false); setVoicePlaybackFailed(false); }, [props.voiceOutput?.src, props.version]);

  useLayoutEffect(() => {
    if (!findOpen) return;
    const place = () => {
      const root = rootRef.current?.getBoundingClientRect();
      const button = findButtonRef.current?.getBoundingClientRect();
      const panel = findPanelRef.current;
      if (!root || !button || !panel) return;
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const left = Math.max(root.left, viewportLeft) + 12;
      const right = Math.min(root.right, viewportLeft + (viewport?.width ?? window.innerWidth)) - 12;
      const bottom = Math.min(root.bottom, viewportTop + (viewport?.height ?? window.innerHeight)) - 12;
      const width = Math.max(0, Math.min(440, right - left));
      const start = getComputedStyle(findButtonRef.current!).direction === 'rtl' ? button.right - width : button.left;
      const top = button.bottom + 8;
      Object.assign(panel.style, {
        left: `${Math.max(left, Math.min(start, right - width)) - root.left}px`,
        top: `${top - root.top}px`, width: `${width}px`, maxHeight: `${Math.max(0, bottom - top)}px`
      });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    for (const node of [rootRef.current, findButtonRef.current?.closest('.video-result-pane-heading'), findButtonRef.current?.parentElement]) {
      if (node) observer?.observe(node);
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [findOpen, props.activeTab, props.immersive, editorPanel, props.hasPendingChanges, props.regenerationPending, props.subtitleSavePending, props.subtitleDirty]);

  useEffect(() => {
    const video = subtitleVideoRef.current;
    if (!props.immersive || !auditionVoice || !props.voiceOutput?.src || !video) return;
    const muted = video.muted;
    video.muted = true;
    return () => { video.muted = muted; };
  }, [props.immersive, auditionVoice, props.voiceOutput?.src, activeSubtitleVideo?.src, activeSubtitleVariant, props.version]);

  useEffect(() => {
    const audio = subtitleAudioRef.current;
    if (!audio) return;
    let active = true;
    if (props.immersive && auditionVoice && subtitlePlaying) {
      audio.currentTime = subtitleVideoRef.current?.currentTime ?? 0;
      audio.playbackRate = subtitleVideoRef.current?.playbackRate ?? 1;
      void audio.play().catch(() => { if (active) { setVoicePlaybackFailed(true); setAuditionVoice(false); } });
    } else audio.pause();
    return () => { active = false; audio.pause(); };
  }, [props.immersive, auditionVoice, subtitlePlaying, props.voiceOutput?.src, activeSubtitleVideo?.src, activeSubtitleVariant, props.version]);

  useEffect(() => {
    if (!props.immersive) return;
    returnButtonRef.current?.focus();
    const main = rootRef.current?.closest('.video-translation-page');
    const siblings: HTMLElement[] = [];
    let node: Element | null | undefined = main;
    while (node && node !== document.body) {
      for (const sibling of Array.from(node.parentElement?.children ?? [])) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.hasAttribute('inert')
          && !sibling.matches('.desktop-titlebar-drag-region, .opencreator-main-titlebar')) {
          sibling.setAttribute('inert', ''); siblings.push(sibling);
        }
      }
      node = node.parentElement;
    }
    return () => {
      siblings.forEach(sibling => sibling.removeAttribute('inert'));
      immersiveButtonRef.current?.focus();
    };
  }, [props.immersive]);

  useEffect(() => {
    if (!props.workbench && props.immersive && (props.activeTab !== 'subtitles' || !activeSubtitleOutput)) props.onImmersiveChange?.(false);
  }, [props.immersive, props.activeTab, activeSubtitleOutput === undefined]);

  useEffect(() => {
    if (activeSubtitleCues.length === 0) return;
    subtitleCueRefs.current.get(activeSubtitleCues[0]!.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeSubtitleCueKey]);

  useEffect(() => {
    if (subtitlePlaying) setSelectedCueId(activeSubtitleCues[0]?.id);
  }, [subtitlePlaying, activeSubtitleCueKey]);

  const seekToSubtitleCue = (cue: SubtitleCue) => {
    setSelectedCueId(cue.id);
    const start = subtitleTimestampSeconds(cue.start);
    seekSubtitle(start);
  };

  function seekSubtitle(time: number) {
    if (!Number.isFinite(time)) return;
    if (pendingPlaybackPositionRef.current !== undefined) pendingPlaybackPositionRef.current = time;
    if (subtitleVideoRef.current !== null) subtitleVideoRef.current.currentTime = Math.min(time, subtitleDuration || time);
    syncVoiceTime(time, true);
    setSubtitlePlaybackTime(time);
  }

  function syncVoiceTime(time: number, force = false) {
    const audio = subtitleAudioRef.current;
    if (audio && (force || auditionVoice) && Math.abs(audio.currentTime - time) > .25) {
      audio.currentTime = Math.min(time, Number.isFinite(audio.duration) ? audio.duration : time);
    }
  }

  function updatePlaybackTime(video: HTMLVideoElement, seeked = false) {
    // Source changes briefly report zero before the saved position can be restored.
    if (pendingPlaybackPositionRef.current !== undefined) return;
    setSubtitlePlaybackTime(video.currentTime);
    syncVoiceTime(video.currentTime, seeked);
  }

  function replaceCues(cues: SubtitleCue[]) {
    if (!activeSubtitleOutput || editReadOnly || !props.onSubtitleCuesChange || sameSubtitleCues(activeSubtitleOutput.cues, cues)) return;
    setGeneratedPreviewId(null);
    const entry = history.current.get(historyKey) ?? { past: [], future: [] };
    entry.past = [...entry.past.slice(-59), activeSubtitleOutput.cues];
    entry.future = [];
    history.current.set(historyKey, entry);
    setHistoryRevision(value => value + 1);
    props.onSubtitleCuesChange(activeSubtitleOutput.variant, cues);
  }

  function editText(cue: SubtitleCue, text: string, field: 'text' | 'sourceText' = 'text') {
    if (!activeSubtitleOutput || editReadOnly) return;
    setGeneratedPreviewId(null);
    if (props.onSubtitleCuesChange) replaceCues(activeSubtitleOutput.cues.map(item => item.id === cue.id ? { ...item, [field]: text } : item));
    else if (field === 'sourceText') props.onSubtitleChange(activeSubtitleOutput.variant, cue.id, text, field);
    else props.onSubtitleChange(activeSubtitleOutput.variant, cue.id, text);
  }

  function travelHistory(direction: 'past' | 'future') {
    if (!activeSubtitleOutput || editReadOnly || !props.onSubtitleCuesChange) return;
    setGeneratedPreviewId(null);
    const entry = history.current.get(historyKey);
    const next = entry?.[direction].pop();
    if (!next || !entry) return;
    entry[direction === 'past' ? 'future' : 'past'].push(activeSubtitleOutput.cues);
    setHistoryRevision(value => value + 1);
    props.onSubtitleCuesChange(activeSubtitleOutput.variant, next);
  }

  function closeFind() {
    setFindOpen(false);
    findButtonRef.current?.focus();
  }

  const workbenchOutputAction = props.workbench && !props.subtitleOnly && editorPanel !== 'language';
  const enablingDubbing = editorPanel === 'voice' && !props.dubbing;
  const outputActionLabel = enablingDubbing
    ? l('配音并合成视频', 'Dub and compose video')
    : props.generationLabel ?? (props.videoOutputs.length ? l('重新合成视频', 'Recompose video') : l('合成视频', 'Compose video'));
  const outputActionDisabled = props.outputDisabled || props.subtitleSavePending || props.editorSettings?.disabled
    || (props.subtitleAutosave && hasSubtitleDrafts) || (workbenchOutputAction && props.outputUpToDate && !enablingDubbing);
  const regenerationControls = (props.hasPendingChanges || props.regenerationPending || workbenchOutputAction) ? (
    <div className="video-result-regenerate" data-confirming={props.regenerationPending}
      role={props.regenerationPending ? 'group' : 'region'}
      aria-label={props.regenerationPending ? l('确认生成新版本', 'Confirm new version') : l('生成新版本', 'Generate new version')}>
      {props.configurationAction}
      {props.regenerationPending ? <>
        <span className={props.immersive ? 'subtitle-editor-regenerate-summary' : 'app-visually-hidden'}>
          {props.workbench ? props.generationSummary : l(`将更新${props.affectedArtifacts.join('、')}，V${props.version} 的全部产出会保留`,
            `Will update ${props.affectedArtifacts.join(', ')}. All V${props.version} outputs will be preserved`)}
        </span>
        <div className="video-result-regenerate-actions">
          <button type="button" onClick={props.onCancelRegenerate}>{l('取消', 'Cancel')}</button>
          <button type="button" disabled={props.outputDisabled || props.subtitleSavePending || props.editorSettings?.disabled || (props.subtitleAutosave && hasSubtitleDrafts)} onClick={props.onConfirmRegenerate}>{props.workbench
            ? l(`确认${props.generationLabel ?? '生成'}`, `Confirm: ${props.generationLabel ?? 'Generate'}`)
            : l(`确认生成 V${props.nextVersion}`, `Confirm and generate V${props.nextVersion}`)}</button>
        </div>
    </> : <button type="button" disabled={outputActionDisabled}
      onClick={() => workbenchOutputAction ? props.onRequestOutput?.(editorPanel === 'voice' ? 'voice' : 'video') : props.onRequestRegenerate()}>
        {props.outputBusyLabel ?? (props.workbench ? workbenchOutputAction ? outputActionLabel : props.generationLabel
          : props.subtitleDirty ? l(`保存并生成 V${props.nextVersion}`, `Save and generate V${props.nextVersion}`) : l(`生成 V${props.nextVersion}`, `Generate V${props.nextVersion}`))}
      </button>}
    </div>
  ) : null;

  const editingAction = !props.immersive && activeSubtitleOutput && props.onImmersiveChange ? (
    <div className="video-result-pane-actions">
      <button ref={immersiveButtonRef} type="button" onClick={() => props.onImmersiveChange?.(true)}>
        <Maximize2 size={15} aria-hidden="true" />{props.workbench ? l('返回工作区', 'Back to workspace') : l('深度编辑', 'Advanced editing')}
      </button>
    </div>
  ) : null;

  const subtitleVideoPreview = activeSubtitleOutput && !props.subtitleOnly ? (
    <section className={props.activeTab === 'video' ? 'video-result-output-column' : 'video-result-subtitle-video'} aria-label={l('同步视频预览', 'Synchronized video preview')}>
      {props.immersive && props.voiceOutput?.src ? <audio ref={subtitleAudioRef} src={props.voiceOutput.src} preload="metadata" hidden
        onLoadedMetadata={() => syncVoiceTime(subtitlePlaybackTime, true)}
        onError={() => { setVoicePlaybackFailed(true); setAuditionVoice(false); }} /> : null}
      <div
        ref={subtitleFrameRef}
        className="video-result-player-frame"
        data-ratio={videoPreviewVariant === 'vertical' ? '9:16' : '16:9'}
        style={{ '--video-preview-ratio': `${subtitlePreviewSize.width} / ${subtitlePreviewSize.height}`, '--video-preview-aspect': subtitlePreviewSize.width / subtitlePreviewSize.height } as CSSProperties}
        data-preview-empty={activeSubtitleVideo?.src === undefined || undefined}
      >
        {activeSubtitleVideo?.src !== undefined ? (
          <div className="video-result-preview-composition">
            <video
              className="video-result-player"
              style={sourcePreviewStyle}
              key={`${props.version}-${activeSubtitleVariant}`}
              ref={subtitleVideoRef}
              src={activeSubtitleVideo.src}
              controls
              controlsList="nofullscreen"
              disablePictureInPicture
              playsInline
              preload="metadata"
              onLoadedMetadata={event => {
                const video = event.currentTarget;
                const duration = Number.isFinite(video.duration) ? video.duration : 0;
                const time = pendingPlaybackPositionRef.current ?? playbackPositionRef.current;
                video.currentTime = Math.min(time, duration || time);
                pendingPlaybackPositionRef.current = undefined;
                setSubtitlePlaybackTime(video.currentTime);
                setSubtitleDuration(duration);
                setSubtitleVideoSize({ width: video.videoWidth || 16, height: video.videoHeight || 9 });
              }}
              onDurationChange={event => setSubtitleDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
              onPlay={() => setSubtitlePlaying(true)}
              onPause={() => setSubtitlePlaying(false)}
              onEnded={() => setSubtitlePlaying(false)}
              onRateChange={event => { if (subtitleAudioRef.current) subtitleAudioRef.current.playbackRate = event.currentTarget.playbackRate; }}
              onSeeked={event => updatePlaybackTime(event.currentTarget, true)}
              onTimeUpdate={event => updatePlaybackTime(event.currentTarget)}
              aria-label={l(
                `${subtitleVariantLabel(videoPreviewVariant ?? activeSubtitleOutput.variant, l)}视频预览`,
                `${subtitleVariantLabel(videoPreviewVariant ?? activeSubtitleOutput.variant, l)} video preview`
              )}
            />
            {showLiveSubtitles && props.renderSubtitlePreview ? <div className="subtitle-editor-styled-overlay" key={`${props.version}-${activeSubtitleVariant}-${activeSubtitleVideo.src}`}>
              {props.renderSubtitlePreview(activeSubtitleOutput.cues, subtitlePreviewSize.width, subtitlePreviewSize.height, subtitleVideoRef, videoPreviewVariant ?? activeSubtitleOutput.variant)}
            </div> : showLiveSubtitles && activeSubtitleCues.length > 0 ? (
              <div className="video-result-subtitle-overlay" aria-hidden="true">
                {activeSubtitleCues.map(cue => (
                  <span key={cue.id}>
                    {subtitleCueDisplayText(cue, activeSubtitleOutput.translationPosition)}
                  </span>
                ))}
              </div>
            ) : null}
            {draftVideoPreview && videoPreviewVariant === 'vertical' && !props.renderSubtitlePreview ? props.editorSettings?.previewTitles : null}
          </div>
        ) : (
          <div className="video-result-player-status" role="status">
            {props.onPrepareSourceVideo !== undefined && !generatedPreview && !activeSubtitleVideo?.previewLoading ? (
              <div className="video-result-preview-empty">
                <strong>{l('字幕已翻译完成', 'Subtitle translation is complete')}</strong>
                <p>{props.previewPreparation?.pending
                  ? l('原视频下载中，字幕可以继续编辑。', 'Downloading the source video. You can continue editing subtitles.')
                  : props.previewPreparation?.error ?? (activeSubtitleVideo?.previewError
                    ? l('视频预览加载失败，请检查诊断信息后重试。', 'Video preview failed to load. Check the diagnostics and retry.', 'Det gick inte att läsa in videoförhandsvisningen. Kontrollera diagnostiken och försök igen.') : undefined)
                    ?? (props.workbench ? l('字幕可直接编辑和下载。加载原视频后，可以边播放边校对字幕。', 'Edit and download your subtitles now. Load the source video to review them during playback.')
                      : l('为节省下载时间，尚未下载原视频。下载后可同步播放和校对字幕，不影响字幕编辑与下载。', 'The source video has not been downloaded to save time. Download it to play and review subtitles in sync. Subtitle editing and export remain available.'))}</p>
                {props.previewPreparation?.pending ? props.previewPreparation.progress : null}
                {!props.previewPreparation?.pending ? <OriginalErrorDetails detail={props.previewPreparation?.errorDetail ?? activeSubtitleVideo?.previewError} /> : null}
                <button className="video-translation-secondary-action" type="button"
                  disabled={props.previewPreparation?.pending || props.previewPreparation?.blocked}
                  onClick={props.onPrepareSourceVideo}>
                  <Download size={15} aria-hidden="true" />
                  {props.previewPreparation?.pending ? l('正在准备…', 'Preparing…')
                    : props.previewPreparation?.error || activeSubtitleVideo?.previewError
                      ? l('重试下载原视频', 'Retry source video download')
                      : props.workbench ? l('下载原视频并预览', 'Download source video and preview') : l('下载原视频并预览', 'Download source video and preview')}
                </button>
                {props.previewPreparation?.blocked && !props.previewPreparation.pending
                  ? <small>{l('请等待当前任务结束后再准备预览视频', 'Wait for the current task to finish before preparing the preview')}</small> : null}
              </div>
            ) : (
              <>
                {activeSubtitleVideo?.previewLoading
                  ? l('正在加载视频...', 'Loading video...')
                  : activeSubtitleVideo?.previewError
                    ?? (generatedPreview ? l('成片预览暂时不可用，可直接下载文件。', 'Video preview is unavailable. You can still download the file.')
                      : l('当前版本没有可用于字幕同步预览的视频。', 'This version has no video available for synchronized subtitle preview.'))}
              </>
            )}
          </div>
        )}
        {activeSubtitleVideo?.src && document.fullscreenEnabled ? <button className="video-result-composition-fullscreen" type="button"
          title={l('全屏预览', 'Fullscreen preview')} aria-label={l('全屏预览', 'Fullscreen preview')}
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void subtitleFrameRef.current?.requestFullscreen();
          }}><Maximize2 size={16} aria-hidden="true" /></button> : null}
      </div>
      {canSwitchVideoPreview ? <div className="creator-tool-segmented video-result-preview-modes" role="group" aria-label={l('视频预览模式', 'Video preview mode')}>
        <button type="button" aria-pressed={generatedPreview !== undefined} onClick={() => {
          if (requestedVideo) setGeneratedPreviewId(requestedVideo.artifactId);
        }}>
          {l('已生成成片', 'Rendered video')}
        </button>
        <button type="button" aria-pressed={generatedPreview === undefined} onClick={() => setGeneratedPreviewId(null)}>
          {l('当前样式', 'Current style')}
        </button>
      </div> : generatedPreview ? <small>{l('成片预览', 'Completed video preview')} · V{props.version}</small> : activeSubtitleVideo?.source ? (
        <small>{l('当前使用原视频同步预览', 'Using the source video for synchronized preview')}</small>
      ) : props.immersive && showLiveSubtitles ? (
        <small>{l('当前样式', 'Current style')} · V{props.version}</small>
      ) : null}
    </section>
  ) : null;

  return (
    <section ref={rootRef} className="video-result-workspace" data-immersive={props.immersive || undefined}
      data-workbench={props.workbench || undefined}
      data-preview-unavailable={props.workbench && !props.subtitleOnly && !activeSubtitleVideo?.src || undefined}
      data-settings-open={props.immersive && Boolean(props.editorSettings) && settingsOpen || undefined}
      aria-label={l('视频翻译项目产出', 'Video translation project outputs')}
      onKeyDown={event => {
        if (!props.immersive || event.defaultPrevented) return;
        const findShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f'
          || event.ctrlKey && event.key.toLowerCase() === 'h';
        if (props.activeTab === 'subtitles' && activeSubtitleOutput && findShortcut
          && !(event.target as HTMLElement).closest('.subtitle-editor-settings')) {
          event.preventDefault(); setFindOpen(true);
          rootRef.current?.querySelector<HTMLInputElement>('.subtitle-editor-find input')?.focus();
          return;
        }
        if (event.key === 'Escape' && !document.querySelector('[role="dialog"], dialog[open]')) {
          event.preventDefault();
          if (findOpen) closeFind();
          else if (settingsOpen) collapseEditorSettings();
          else if (!props.workbench) props.onImmersiveChange?.(false);
        }
        const target = event.target as HTMLElement;
        if (target.closest('.subtitle-editor-settings')) return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !target.matches('input, textarea, [contenteditable="true"]')) {
          event.preventDefault(); travelHistory(event.shiftKey ? 'future' : 'past');
        }
      }}>
      {findOpen && activeSubtitleOutput && props.activeTab === 'subtitles' ? <div ref={findPanelRef} id="subtitle-editor-find-panel" className="subtitle-editor-find-anchor">
        <SubtitleFindReplace key={historyKey} cues={activeSubtitleOutput.cues} readOnly={editReadOnly || !props.onSubtitleCuesChange}
          onChange={replaceCues} onClose={closeFind} onLocate={match => {
            if (!match) return;
            const cue = activeSubtitleOutput.cues[match.cueIndex];
            if (!cue) return;
            subtitleVideoRef.current?.pause();
            seekToSubtitleCue(cue);
            const row = subtitleCueRefs.current.get(cue.id);
            row?.scrollIntoView?.({ block: 'nearest' });
            const group = subtitleCueGroups.find(items => items.some(item => item.cue.id === cue.id));
            const cueIndex = group?.findIndex(item => item.cue.id === cue.id) ?? 0;
            const pair = row?.querySelectorAll('.video-subtitle-cue-pair')[cueIndex];
            const field = pair?.querySelector<HTMLTextAreaElement>(`textarea[data-subtitle-field="${match.field}"]`);
            field?.setSelectionRange(match.start, match.end);
          }} />
      </div> : null}
      <div className="video-result-toolbar">
        <div className="video-result-tabs" role="tablist" aria-label={l('产出物类型', 'Output types')}>
          {resultTabs.filter(tab => tab.value === (props.subtitleOnly ? 'subtitles' : 'video')).map(tab => {
            const Icon = tab.icon;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={props.activeTab === tab.value}
                key={tab.value}
                onClick={() => props.onTabChange(tab.value)}
              >
                <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                {localizeResultTab(tab.label, l)}
                {tab.value === (props.subtitleOnly ? 'subtitles' : 'video') && hasSubtitleDrafts ? (
                  <span className="video-result-unsaved" aria-label={l('有未保存的字幕修改', 'Unsaved subtitle changes')} />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="video-result-toolbar-actions">
          <CreatorResultVersionMenu
            showCompletion={props.execution === undefined && generatedArtifactCount > 0}
            version={props.version}
            versions={props.versions}
            onVersionChange={props.onVersionChange}
          />
          {!props.immersive ? props.subtitleOnly ? regenerationControls : editingAction : null}
        </div>
      </div>

      {props.notice ? <p className="video-result-notice" role="status">{props.notice}</p> : null}
      {props.activeTab !== 'subtitles' ? props.taskProgress : null}

      {props.activeTab === 'video' ? (
        <div className="video-result-pane">
          {generatedArtifactCount > 0 && props.execution ? (
            <p className="video-result-notice" role="status">{outputEmptyTitle} · {executionDetail}</p>
          ) : null}
          {generatedArtifactCount > 0 ? (
            <div className="video-result-generated-sections">
              {props.videoOutputs.length === 0 && subtitleVideoPreview ? (
                <section className="video-result-generated-section">
                  <div className="video-result-video-grid">{subtitleVideoPreview}</div>
                </section>
              ) : null}
              {props.videoOutputs.length > 0 ? (
                <section className="video-result-generated-section" aria-label={l('成片', 'Videos')}>
                  <div className="video-result-video-grid">
                    {props.videoOutputs.map(output => {
                      const artifactLabel = videoVariantArtifactLabel(output.variant, l);
                      return (
                        <section className="video-result-output-column" aria-label={artifactLabel} data-variant={output.variant} key={output.artifactId}>
                          <div className="video-result-player-frame" data-ratio={output.variant === 'vertical' ? '9:16' : '16:9'}>
                            {output.src !== undefined ? (
                              <video
                                className="video-result-player"
                                src={output.src}
                                controls
                                preload="metadata"
                                onLoadedMetadata={event => {
                                  const video = event.currentTarget;
                                  if (video.videoWidth && video.videoHeight) video.parentElement?.style.setProperty('--video-preview-ratio', `${video.videoWidth} / ${video.videoHeight}`);
                                }}
                                aria-label={l(`${artifactLabel}预览`, `${artifactLabel} preview`)}
                              />
                            ) : (
                              <div className="video-result-player-status" role="status">
                                {output.previewLoading
                                  ? l(`正在加载${artifactLabel}...`, `Loading ${artifactLabel}...`)
                                  : output.previewError ?? l('成片预览暂时不可用，可直接下载文件。', 'Video preview is unavailable. You can still download the file.')}
                              </div>
                            )}
                          </div>
                          <div className="video-result-file-row">
                            <span aria-hidden="true"><FileVideo size={19} strokeWidth={1.7} /></span>
                            <div>
                              <strong title={output.fileName}>{output.fileName ?? `${artifactLabel}-${props.targetLanguage}-V${props.version}.mp4`}</strong>
                              <small>{videoVariantFormatLabel(output.variant, l)}</small>
                            </div>
                            <button
                              type="button"
                              onClick={() => props.onExport('video', output.artifactId)}
                              aria-label={l(`下载${artifactLabel}`, `Download ${artifactLabel}`)}
                              title={l(`下载${artifactLabel}`, `Download ${artifactLabel}`)}
                            >
                              <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                            </button>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {props.subtitleOutputs.length > 0 ? (
                <section className="video-result-generated-section">
                  <h3>{l('字幕', 'Subtitles')}</h3>
                  <div className="video-result-generated-file-grid">
                    {props.subtitleOutputs.map(output => {
                      const variantLabel = subtitleVariantLabel(output.variant, l);
                      return (
                        <div className="video-result-file-row" key={output.artifactId}>
                          <span aria-hidden="true"><Captions size={19} strokeWidth={1.7} /></span>
                          <div>
                            <strong title={output.fileName}>{output.fileName ?? `${variantLabel}-V${props.version}.srt`}</strong>
                            <small>{variantLabel}</small>
                          </div>
                          <button
                            type="button"
                            onClick={() => props.onExport('subtitles', output.artifactId)}
                            aria-label={l(`下载${variantLabel}`, `Download ${variantLabel}`)}
                            title={l(`下载${variantLabel}`, `Download ${variantLabel}`)}
                          >
                            <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {props.voiceOutput !== undefined ? (
                <section className="video-result-generated-section">
                  <h3>{l('配音', 'Dubbing')}</h3>
                  <div className="video-result-generated-file-grid">
                    <div className="video-result-file-row">
                      <span aria-hidden="true"><FileAudio size={19} strokeWidth={1.7} /></span>
                      <div>
                        <strong title={props.voiceOutput.fileName}>{props.voiceOutput.fileName ?? `${l('目标语言配音', 'Target-language-dubbing')}-V${props.version}.wav`}</strong>
                      </div>
                      <button
                        type="button"
                        onClick={() => props.onExport('voice', props.voiceOutput?.artifactId)}
                        aria-label={l('下载配音文件', 'Download dubbing file')}
                        title={l('下载配音文件', 'Download dubbing file')}
                      >
                        <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="video-result-empty" role="status">
              <PackageOpen size={26} strokeWidth={1.5} aria-hidden="true" />
              <strong>{outputEmptyTitle}</strong>
              {executionDetail ? <p>{executionDetail}</p> : null}
            </div>
          )}
        </div>
      ) : null}

      {props.activeTab === 'subtitles' ? (
        <div className="video-result-pane video-result-subtitle-pane" data-task-progress={Boolean(props.taskProgress) || undefined}>
          <header className="video-result-pane-heading">
            <div>
              {props.immersive ? <button ref={returnButtonRef} type="button" className="subtitle-editor-back"
                disabled={props.subtitleSavePending} onClick={() => props.workbench ? props.onBack?.() : props.onImmersiveChange?.(false)}>
                <ArrowLeft size={17} />{props.workbench ? l('返回', 'Back') : l('返回项目', 'Back to project')}
              </button> : null}
              <h2>{props.workbench ? props.subtitleOnly ? l('字幕翻译工作区', 'Subtitle translation workspace') : l('视频翻译工作区', 'Video translation workspace')
                : props.immersive ? l('字幕编辑', 'Subtitle editor') : l('字幕', 'Subtitles')}</h2>
              <p role={props.subtitleAutosave ? 'status' : undefined}>
                {props.workbench ? props.targetLanguage : `${l('项目', 'Project')} V${props.version}`}
                {' · '}{activeSubtitleOutput?.cues.length ?? 0} {l('条字幕', 'subtitles')}
                {activeSubtitleOutput === undefined
                  ? ''
                  : ` · ${props.subtitleSaveError ? l('保存失败', 'Save failed') : props.subtitleSavePending ? l('保存中…', 'Saving…') : (props.subtitleAutosave ? hasSubtitleDrafts : activeSubtitleDirty)
                    ? props.subtitleAutosave ? l('等待自动保存', 'Waiting to save') : l('有未保存修改', 'Unsaved changes')
                    : l('已保存', 'Saved')}`}
                {activeSubtitleOutput?.readOnly ? ` · ${l('只读', 'Read only')}` : ''}
              </p>
              {props.workbench && Boolean(props.staleOutputs?.length) ? <p className="subtitle-editor-stale" role="status">
                {l(`${props.staleOutputs!.join('、')}待更新，已有文件仍为修改前的内容。`, `${props.staleOutputs!.join(', ')} needs updating. Existing files contain the previous content.`)}
              </p> : null}
              {props.subtitleSaveError ? <p className="subtitle-editor-save-error" role="alert">{props.subtitleSaveError}</p> : null}
            </div>
            <div className="video-result-pane-actions">
              {props.workbench && props.immersive ? <>
                <CreatorResultVersionMenu label={l('历史版本', 'Version history')} disabled={hasSubtitleDrafts || props.subtitleSavePending}
                  showCompletion={false} version={props.version} versions={props.versions} onVersionChange={props.onVersionChange} />
                {!props.subtitleOnly ? <button type="button" onClick={() => props.onImmersiveChange?.(false)}>
                  <PackageOpen size={15} />{l('产出文件', 'Output files')}
                </button> : null}
              </> : null}
              {activeSubtitleOutput ? <button ref={findButtonRef} type="button" aria-label={l('查找与替换', 'Find and replace')}
                title={l('查找与替换', 'Find and replace')} aria-expanded={findOpen} aria-controls="subtitle-editor-find-panel"
                aria-keyshortcuts={props.immersive ? 'Control+f Meta+f Control+h' : undefined}
                onClick={() => findOpen ? closeFind() : setFindOpen(true)}><Search size={16} /></button> : null}
              {props.immersive ? <>
                <div className="subtitle-editor-history">
                  <button type="button" aria-label={l('撤销', 'Undo')} title={l('撤销', 'Undo')} disabled={editReadOnly || !currentHistory?.past.length} onClick={() => travelHistory('past')}><Undo2 size={16} /></button>
                  <button type="button" aria-label={l('重做', 'Redo')} title={l('重做', 'Redo')} disabled={editReadOnly || !currentHistory?.future.length} onClick={() => travelHistory('future')}><Redo2 size={16} /></button>
                </div>
                {props.onToggleAssistant ? <button type="button" aria-pressed={props.assistantOpen} onClick={props.onToggleAssistant}>
                  <MessageSquare size={15} />{props.workbench ? l('AI 助手', 'AI assistant') : l('Agent模式', 'Agent Mode')}
                </button> : null}
              </> : props.subtitleOnly && activeSubtitleOutput && props.onImmersiveChange ? <button ref={immersiveButtonRef} type="button" onClick={() => props.onImmersiveChange?.(true)}>
                <Maximize2 size={15} />{l('深度编辑', 'Advanced editing')}
              </button> : null}
              {props.immersive && !props.subtitleDownloads?.length && activeSubtitleOutput ? <button type="button" className="subtitle-editor-export"
                aria-label={props.workbench ? l('下载字幕', 'Download subtitles') : l('导出字幕', 'Export subtitles')}
                title={props.workbench ? l('下载字幕', 'Download subtitles') : l('导出字幕', 'Export subtitles')} disabled={hasSubtitleDrafts || props.subtitleSavePending}
                onClick={() => props.onExport('subtitles', activeSubtitleOutput.artifactId)}><Download size={15} /><span>{props.workbench ? l('下载字幕', 'Download subtitles') : l('导出字幕', 'Export subtitles')}</span></button> : null}
              {props.workbench && Boolean(props.subtitleDownloads?.length) ? <details className="subtitle-download-menu">
                <summary><Download size={15} aria-hidden="true" />{l('下载字幕', 'Download subtitles')}</summary>
                <div>{props.subtitleDownloads!.map(download => <button key={download.artifactId} type="button"
                  disabled={hasSubtitleDrafts || props.subtitleSavePending} onClick={event => {
                    event.currentTarget.closest('details')?.removeAttribute('open');
                    props.onExport('subtitles', download.artifactId);
                  }}>{download.label}</button>)}</div>
              </details> : props.subtitleDownloads?.map(download => <button key={download.artifactId} type="button" className="subtitle-editor-export" aria-label={download.label} title={download.label}
                disabled={hasSubtitleDrafts || props.subtitleSavePending}
                onClick={() => props.onExport('subtitles', download.artifactId)}>
                <Download size={15} aria-hidden="true" /><span>{download.label}</span>
              </button>)}
              {availableSubtitleVariants.length > 1 && !(props.immersive && props.editorSettings?.output !== undefined) ? (
                <div className="video-result-subtitle-variants" role="radiogroup" aria-label={l('字幕画幅', 'Subtitle format')}>
                  {availableSubtitleVariants.map(variant => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={activeSubtitleVariant === variant}
                      key={variant}
                      onClick={() => setSelectedSubtitleVariant(variant)}
                    >
                      {variant === 'horizontal' ? l('横屏', 'Horizontal') : l('竖屏', 'Vertical')}
                    </button>
                  ))}
                </div>
              ) : null}
              {activeSubtitleOutput !== undefined && !activeSubtitleOutput.readOnly && (!props.subtitleAutosave || props.subtitleSaveError) ? (
                <button
                  type="button"
                  disabled={!hasSubtitleDrafts || props.subtitleSavePending}
                  onClick={() => props.onSaveSubtitles(props.subtitleAutosave && props.subtitleDirtyByVariant.horizontal ? 'horizontal' : activeSubtitleOutput.variant)}
                >
                  <Save size={15} strokeWidth={1.8} aria-hidden="true" />
                  {props.subtitleSavePending
                    ? l('正在保存...', 'Saving...')
                    : props.subtitleAutosave ? l('重试保存', 'Retry saving') : props.subtitleOnly || props.immersive ? l('保存字幕', 'Save subtitles') : l(
                        `保存${activeSubtitleOutput.variant === 'horizontal' ? '横屏' : '竖屏'}字幕`,
                        `Save ${activeSubtitleOutput.variant === 'horizontal' ? 'horizontal' : 'vertical'} subtitles`
                      )}
                </button>
              ) : null}
              {props.immersive && !settingsOpen ? regenerationControls : null}
            </div>
          </header>
          {props.taskProgress}
          {activeSubtitleOutput !== undefined ? (
            <div className="video-result-subtitle-preview-layout" ref={previewLayoutRef} data-subtitle-only={props.subtitleOnly || undefined}
              data-editor-settings={props.immersive && Boolean(props.editorSettings) && !props.subtitleOnly || undefined}
              style={props.immersive ? { '--subtitle-editor-width': `${props.workbench && !activeSubtitleVideo?.src ? 65 : editorWidth}%` } as CSSProperties : undefined}>
              {subtitleVideoPreview}

              {props.immersive && props.editorSettings && !props.subtitleOnly ? <div className="subtitle-editor-settings-nav" role="group" aria-label={l('项目设置', 'Project settings')}
                data-expanded={!props.workbench && settingsRailExpanded || undefined}>
                <button type="button" className="subtitle-editor-settings-toggle" aria-expanded={props.workbench ? settingsOpen : settingsRailExpanded}
                  aria-controls={props.workbench ? 'subtitle-editor-settings-panel' : undefined}
                  aria-label={props.workbench ? l('展开设置', 'Expand settings') : settingsRailExpanded ? l('收起侧栏', 'Collapse sidebar') : l('展开侧栏', 'Expand sidebar')}
                  title={props.workbench ? l('展开设置', 'Expand settings') : settingsRailExpanded ? l('收起侧栏', 'Collapse sidebar') : l('展开侧栏', 'Expand sidebar')}
                  onClick={() => props.workbench ? openEditorSettings(editorPanel ?? editorPanels[0] ?? 'style') : setSettingsRailExpanded(value => !value)}>
                  {!props.workbench && settingsRailExpanded ? <PanelRightClose size={18} aria-hidden="true" /> : <PanelRightOpen size={18} aria-hidden="true" />}
                  <span>{l('收起侧栏', 'Collapse sidebar')}</span>
                </button>
                {editorPanels.map(panel => {
                  const Icon = panel === 'language' ? Languages : panel === 'style' ? Captions : panel === 'voice' ? Mic2 : MonitorPlay;
                  return <button key={panel} type="button" aria-expanded={settingsOpen && editorPanel === panel}
                    aria-label={editorPanelLabel(panel)} title={editorPanelLabel(panel)}
                    disabled={props.editorSettings?.disabled}
                    aria-controls="subtitle-editor-settings-panel" onClick={() => openEditorSettings(panel)}>
                    <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                    <span>{editorPanelLabel(panel)}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>;
                })}
                {props.voiceOutput?.src && !generatedPreview ? <button type="button" className="subtitle-editor-voice-toggle" aria-pressed={auditionVoice}
                  title={l('目标语言配音试听', 'Target-language dubbing preview')} aria-label={l('目标语言配音试听', 'Target-language dubbing preview')}
                  onClick={() => { setVoicePlaybackFailed(false); setAuditionVoice(value => !value); }}>
                  <Headphones size={17} aria-hidden="true" /><span>{l('目标语言配音', 'Target-language dubbing')}</span>
                </button> : null}
              </div> : null}

              {props.immersive && !props.subtitleOnly ? <div className="subtitle-editor-divider" role="separator" aria-orientation="vertical" tabIndex={0}
                aria-label={l('调整字幕和预览宽度', 'Resize subtitles and preview')} aria-valuemin={35} aria-valuemax={maxEditorWidth} aria-valuenow={editorWidth}
                onKeyDown={event => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault(); setEditorWidth(value => Math.max(35, Math.min(maxEditorWidth, value + (event.key === 'ArrowRight' ? 2 : -2) * paneInlineDirection(previewLayoutRef.current))));
                  }
                }} onMouseDown={event => beginPaneResize(event, clientX => {
                  const rect = previewLayoutRef.current?.getBoundingClientRect();
                  if (rect) setEditorWidth(Math.max(35, Math.min(maxEditorWidth, (paneInlineDirection(previewLayoutRef.current) === -1 ? rect.right - clientX : clientX - rect.left) / rect.width * 100)));
                })} /> : null}

              <section className="video-result-output-column" data-variant={activeSubtitleOutput.variant}>
                {props.immersive ? <div className="subtitle-editor-column-labels">
                  <span>{l('时间', 'Time')}</span>
                  {activeSubtitleOutput.cues.some(cue => cue.sourceText !== undefined) ? <span>{l('原文', 'Original text')}</span> : null}
                  <span>{l('译文', 'Translation')}</span>
                </div> : null}
                {activeSubtitleOutput.cues.length > 0 ? (
                  <div
                    className="video-subtitle-editor"
                    role="list"
                    aria-label={l(
                      `${activeSubtitleLabel}内容`,
                      `${activeSubtitleLabel} content`
                    )}
                  >
                    {subtitleCueGroups.map((group, groupIndex) => {
                      const firstCue = group[0]!.cue;
                      return (
                        <div
                          className="video-subtitle-cue"
                          role="listitem"
                          data-active={group.some(({ cue }) => activeSubtitleCueIds.has(cue.id))}
                          data-selected={group.some(({ cue }) => selectedCueId === cue.id)}
                          data-focused={group.some(({ cue }) => focusedSubtitleCueIds.has(cue.id))}
                          data-subtitle-cue="true"
                          key={firstCue.id}
                          onFocusCapture={() => setSelectedCueId(firstCue.id)}
                          ref={node => {
                            for (const { cue } of group) {
                              if (node === null) subtitleCueRefs.current.delete(cue.id);
                              else subtitleCueRefs.current.set(cue.id, node);
                            }
                          }}
                        >
                          <button
                            type="button"
                            className="video-subtitle-cue-time"
                            onClick={() => seekToSubtitleCue(firstCue)}
                            aria-label={l(`跳转到 ${firstCue.start}`, `Jump to ${firstCue.start}`)}
                          >
                            <span>{String(groupIndex + 1).padStart(2, '0')}</span>
                            <small dir="ltr" title={`${firstCue.start} - ${firstCue.end}`}>
                              {subtitleCueShortTime(firstCue.start)}–{subtitleCueShortTime(firstCue.end)}
                            </small>
                          </button>
                          <div className="video-subtitle-cue-lines">
                            {group.map(({ cue, index }, lineIndex) => {
                              const sourceLine = cue.sourceText === undefined ? null : (
                                <textarea
                                  className="video-subtitle-cue-source"
                                  data-subtitle-field="sourceText"
                                  rows={1}
                                  value={cue.sourceText}
                                  dir="auto"
                                  readOnly={editReadOnly}
                                  onFocus={() => setSelectedCueId(cue.id)}
                                  onChange={editReadOnly ? undefined : event => editText(cue, event.target.value, 'sourceText')}
                                  aria-label={l(
                                    `${activeSubtitleLabel}原文 ${index + 1}`,
                                    `${activeSubtitleLabel} source ${index + 1}`
                                  )}
                                />
                              );
                              const translationLine = (
                                <textarea
                                  className={lineIndex > 0 ? 'video-subtitle-cue-source' : 'video-subtitle-cue-translation'}
                                  data-subtitle-field="text"
                                  rows={1}
                                  value={cue.text}
                                  dir="auto"
                                  readOnly={editReadOnly}
                                  onFocus={() => setSelectedCueId(cue.id)}
                                  onChange={editReadOnly
                                    ? undefined
                                    : event => editText(cue, event.target.value)}
                                  aria-label={props.subtitleOnly ? `${activeSubtitleLabel} ${index + 1}` : `${subtitleVariantLabel(activeSubtitleOutput.variant, l)} ${index + 1}`}
                                />
                              );
                              return (
                                <div className="video-subtitle-cue-pair" key={cue.id}>
                                  {props.immersive || activeSubtitleOutput.translationPosition === 'bottom' ? sourceLine : null}
                                  {translationLine}
                                  {!props.immersive && activeSubtitleOutput.translationPosition !== 'bottom' ? sourceLine : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="video-result-subtitle-empty" role="status">{l('字幕文件中没有可显示的内容', 'The subtitle file contains no cues')}</div>
                )}
              </section>
            </div>
          ) : (
            <div className="video-result-subtitle-empty" role="status">
              <strong>{subtitleEmptyTitle}</strong>
              {executionDetail ? <p>{executionDetail}</p> : null}
            </div>
          )}
        </div>
      ) : null}

      {props.immersive && props.activeTab === 'subtitles' && activeSubtitleOutput ? <SubtitleTimeline
        key={`${props.version}-${activeSubtitleVariant}`}
        defaultCollapsed={timelineLayoutRef.current.collapsed}
        defaultHeight={timelineLayoutRef.current.height}
        onLayoutChange={layout => { timelineLayoutRef.current = layout; }}
        cues={activeSubtitleOutput.cues} src={sourceSubtitleVideo?.src ?? activeSubtitleVideo?.src}
        voiceSrc={props.voiceOutput?.src}
        currentTime={subtitlePlaybackTime} duration={subtitleDuration} playing={subtitlePlaying}
        selectedId={selectedCueId} readOnly={editReadOnly || !props.onSubtitleCuesChange}
        onSelect={id => { setSelectedCueId(id); subtitleCueRefs.current.get(id)?.scrollIntoView?.({ block: 'nearest' }); }}
        onSeek={seekSubtitle} onChange={replaceCues}
        onPlaybackChange={playing => {
          const video = subtitleVideoRef.current;
          if (!video) return;
          if (playing) void video.play().catch(() => setSubtitlePlaying(false));
          else video.pause();
        }}
        onTogglePlay={() => {
          const video = subtitleVideoRef.current;
          if (!video) return;
          if (video.paused) void video.play().catch(() => setSubtitlePlaying(false));
          else video.pause();
        }}
      /> : null}

      {props.activeTab === 'voice' ? (
        <div className="video-result-pane">
          <header className="video-result-pane-heading">
            <div>
              <h2>{l('目标语言配音', 'Target-language dubbing')}</h2>
              {props.hasVoiceArtifact ? <p>{l('配音文件已生成', 'Dubbing file generated')}</p> : null}
            </div>
          </header>
          {props.hasVoiceArtifact && props.voiceOutput !== undefined ? (
            <div className="video-result-voice-output">
              <div className="video-result-audio-preview">
                {props.voiceOutput.src !== undefined ? (
                  <audio
                    controls
                    preload="metadata"
                    src={props.voiceOutput.src}
                    aria-label={l('目标语言配音试听', 'Target-language dubbing preview')}
                  />
                ) : (
                  <div className="video-result-audio-status" role="status">
                    <span>
                      {props.voiceOutput.previewLoading
                        ? l('正在加载配音...', 'Loading dubbing...')
                        : props.voiceOutput.previewError ?? l('配音试听暂时不可用，可直接下载文件。', 'Dubbing preview is unavailable. You can still download the file.')}
                    </span>
                    {!props.voiceOutput.previewLoading && props.voiceOutput.previewError !== undefined ? (
                      <button type="button" onClick={props.onReloadVoice}>
                        <RotateCcw size={15} strokeWidth={1.8} aria-hidden="true" />
                        {l('重新加载配音', 'Reload dubbing')}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="video-result-file-row">
                <span aria-hidden="true"><FileAudio size={19} strokeWidth={1.7} /></span>
                <div>
                  <strong>{props.voiceOutput.fileName ?? `${l('目标语言配音', 'Target-language-dubbing')}-V${props.version}.wav`}</strong>
                  <small>
                    {l('配音', 'Dubbing')} V{props.voiceOutput.artifactVersion}
                    {' · '}{l('项目', 'Project')} V{props.version}
                  </small>
                </div>
                <button
                  type="button"
                  onClick={() => props.onExport('voice', props.voiceOutput?.artifactId)}
                  aria-label={l('下载配音文件', 'Download dubbing file')}
                  title={l('下载配音文件', 'Download dubbing file')}
                >
                  <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div className="video-result-empty" role="status">
              <FileAudio size={26} strokeWidth={1.5} aria-hidden="true" />
              <strong>{voiceEmptyTitle}</strong>
              {props.dubbing && executionDetail ? <p>{executionDetail}</p> : null}
              {props.execution === undefined ? (
                <button type="button" onClick={props.onAdjustSettings}>{props.dubbing
                  ? l('调整配音设置', 'Adjust dubbing settings')
                  : l('开启配音并生成新版本', 'Enable dubbing and generate a new version')}</button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {props.immersive && props.editorSettings && editorPanel ? <SubtitleEditorSettingsPanel
        open={settingsOpen}
        title={editorPanelLabel(editorPanel)}
        context={props.workbench ? props.outputActionDetail ?? l('设置自动保存，点击合成后开始生成', 'Settings save automatically. Generation requires confirmation.') : l(`正在基于 V${props.version} 调整`, `Adjusting from V${props.version}`)}
        onClose={collapseEditorSettings}
        onInteract={() => setGeneratedPreviewId(null)}
        actions={regenerationControls}
        footer={props.workbench ? undefined : <button type="button" onClick={collapseEditorSettings}>{l('完成', 'Done')}</button>}>
        <div className="subtitle-editor-settings-tabs" role="tablist" aria-label={l('项目设置', 'Project settings')}>
          {editorPanels.map(panel => <button key={panel} type="button" role="tab" aria-selected={editorPanel === panel}
            id={`subtitle-editor-settings-tab-${panel}`} aria-controls="subtitle-editor-settings-content" tabIndex={editorPanel === panel ? 0 : -1}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const direction = paneInlineDirection(event.currentTarget);
              const delta = (event.key === 'ArrowRight' ? 1 : -1) * direction;
              const next = event.key === 'Home' ? editorPanels[0]! : event.key === 'End' ? editorPanels.at(-1)!
                : editorPanels[(editorPanels.indexOf(panel) + delta + editorPanels.length) % editorPanels.length]!;
              setEditorPanel(next);
              document.getElementById(`subtitle-editor-settings-tab-${next}`)?.focus();
            }}
            onClick={() => setEditorPanel(panel)}>{editorPanelLabel(panel)}</button>)}
        </div>
        <fieldset disabled={props.editorSettings.disabled} id="subtitle-editor-settings-content" role="tabpanel" aria-labelledby={`subtitle-editor-settings-tab-${editorPanel}`}>
          {props.editorSettings[editorPanel]}
        </fieldset>
        {editorPanel === 'voice' && props.voiceOutput ? <div className="subtitle-editor-voice-status">
          <span>{props.voiceOutput.fileName ?? l('目标语言配音', 'Target-language dubbing')} · V{props.voiceOutput.artifactVersion}</span>
          {props.voiceOutput.previewLoading ? <p role="status">{l('正在加载配音...', 'Loading dubbing...')}</p> : null}
          {props.voiceOutput.previewError || voicePlaybackFailed ? <>
            <p role="status">{l('配音试听暂时不可用，可直接下载文件。', 'Dubbing preview is unavailable. You can still download the file.')}</p>
            <button type="button" onClick={props.onReloadVoice}>{l('重新加载配音', 'Reload dubbing')}</button>
          </> : null}
        </div> : null}
      </SubtitleEditorSettingsPanel> : null}
    </section>
  );
}

function SubtitleEditorSettingsPanel(props: {
  onInteract?(): void;
  open: boolean;
  title: string;
  context: string;
  children: ReactNode;
  actions: ReactNode;
  footer?: ReactNode;
  onClose(): void;
}) {
  const l = useLocalizedCopy();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const workspace = panel?.parentElement;
    closeRef.current?.focus();
    return () => {
      if (document.activeElement === document.body || panel?.contains(document.activeElement)) {
        const destination = trigger?.matches(':disabled') ? workspace?.querySelector<HTMLElement>('.subtitle-editor-back')
          : trigger && trigger !== document.body ? trigger : workspace?.querySelector<HTMLElement>('.subtitle-editor-settings-toggle');
        destination?.focus();
      }
    };
  }, [props.open]);
  return (
    <aside className="subtitle-editor-settings" id="subtitle-editor-settings-panel" ref={panelRef} hidden={!props.open}
      onPointerDownCapture={props.onInteract} onFocusCapture={props.onInteract}
      aria-label={props.title}>
      <header><div><h2>{props.title}</h2><p>{props.context}</p></div>
        {props.actions}
        <button ref={closeRef} type="button" className="subtitle-editor-settings-collapse" aria-label={l('收起设置', 'Collapse settings')}
          title={l('收起设置', 'Collapse settings')} aria-expanded={props.open} aria-controls="subtitle-editor-settings-panel"
          onClick={props.onClose}><PanelRightClose size={18} aria-hidden="true" /></button>
      </header>
      <div className="subtitle-editor-settings-body">{props.children}</div>
      {props.footer ? <footer>{props.footer}</footer> : null}
    </aside>
  );
}

function videoVariantFormatLabel(variant: VideoResultVariant, l: LocalizeCopy): string {
  return ({
    horizontal: l('横屏 16:9', 'Horizontal 16:9'),
    vertical: l('竖屏 9:16', 'Vertical 9:16'),
    dubbed: l('无字幕配音底片', 'Dubbed video without subtitles')
  } as const)[variant];
}

function videoVariantArtifactLabel(variant: VideoResultVariant, l: LocalizeCopy): string {
  return ({
    horizontal: l('横屏成片', 'Horizontal video'),
    vertical: l('竖屏成片', 'Vertical video'),
    dubbed: l('配音视频', 'Dubbed video')
  } as const)[variant];
}

function subtitleVariantLabel(variant: SubtitleResultVariant, l: LocalizeCopy): string {
  return variant === 'horizontal'
    ? l('横屏字幕', 'Horizontal subtitles')
    : l('竖屏字幕', 'Vertical subtitles');
}

function subtitleCueDisplayText(
  cue: SubtitleCue,
  translationPosition: SubtitleResultOutput['translationPosition']
): string {
  if (cue.sourceText === undefined) return cue.text;
  return translationPosition === 'bottom'
    ? `${cue.sourceText}\n${cue.text}`
    : `${cue.text}\n${cue.sourceText}`;
}

function localizeResultTab(label: string, l: LocalizeCopy): string {
  const labels: Record<string, string> = {
    '作品': 'Outputs',
    '字幕': 'Subtitles',
    '配音': 'Dubbing'
  };
  return l(label, labels[label] ?? label);
}

function emptyResultTitle(
  tab: 'video' | 'subtitles' | 'voice',
  status: VideoTranslationResultExecution['status'] | undefined,
  l: LocalizeCopy
): string {
  if (status === 'failed') return l('翻译任务失败', 'Translation failed');
  if (status === 'needs_input') return l('翻译任务等待处理', 'Translation needs your attention');
  if (status === 'canceled') return l('翻译任务已终止', 'Translation stopped');
  if (status === 'interrupted') return l('翻译任务已中断', 'Translation interrupted');
  if (status === 'queued') return ({
    video: l('翻译任务等待执行', 'Translation is queued'),
    subtitles: l('字幕等待生成', 'Subtitles are pending'),
    voice: l('配音等待生成', 'Dubbing is pending')
  })[tab];
  if (status === 'running') return ({
    video: l('翻译进行中', 'Translation in progress'),
    subtitles: l('字幕尚未就绪', 'Subtitles are not ready yet'),
    voice: l('配音尚未就绪', 'Dubbing is not ready yet')
  })[tab];
  return ({
    video: l('此版本暂无生成结果', 'No outputs available for this version'),
    subtitles: l('此版本尚未生成字幕', 'Subtitles have not been generated for this version'),
    voice: l('此版本尚未生成配音', 'Dubbing has not been generated for this version')
  })[tab];
}

function subtitleTimestampSeconds(value: string): number {
  return subtitleSeconds(value);
}

function subtitleCueShortTime(value: string): string {
  const match = /^(\d+):(\d{2}):(\d{2})/.exec(value.trim());
  if (match === null) return value;
  return Number(match[1]) === 0
    ? `${match[2]}:${match[3]}`
    : `${match[1]}:${match[2]}:${match[3]}`;
}

function groupSubtitleCues(cues: SubtitleCue[], variant: SubtitleResultVariant) {
  const groups: Array<Array<{ cue: SubtitleCue; index: number }>> = [];
  cues.forEach((cue, index) => {
    const previous = groups[groups.length - 1];
    const firstCue = previous?.[0]?.cue;
    const firstStart = subtitleTimestampSeconds(firstCue?.start ?? '');
    const firstEnd = subtitleTimestampSeconds(firstCue?.end ?? '');
    const start = subtitleTimestampSeconds(cue.start);
    const end = subtitleTimestampSeconds(cue.end);
    const sameTime = firstStart === start && firstEnd === end;
    if (variant === 'vertical' && previous !== undefined
      && Number.isFinite(firstStart) && Number.isFinite(firstEnd)
      && Number.isFinite(start) && Number.isFinite(end) && end > start
      && start >= firstStart && end <= firstEnd
      && (!sameTime || previous.length === 1)) {
      previous.push({ cue, index });
    } else {
      groups.push([{ cue, index }]);
    }
  });
  return groups;
}
