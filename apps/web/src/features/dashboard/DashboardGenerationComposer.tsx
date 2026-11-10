import { Captions, Clapperboard, Download, History, Image, Languages, Mic2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './DashboardGenerationComposer.css';

export type DashboardGenerationMode = 'image' | 'image-edit' | 'cover' | 'video' | 'image-to-video' | 'translation' | 'translation-subtitles' | 'voiceover' | 'transcription' | 'audio-transcription' | 'download' | 'clips' | 'speech' | 'script';
export type DashboardGenerationWorkspace = 'image-generation' | 'cover-generator' | 'video-generation' | 'video-translation' | 'transcription' | 'video-download' | 'auto-clips' | 'smart-dubbing' | 'short-video-script';
export type DashboardGenerationGroup = 'video' | 'image' | 'audio' | 'text';

const MODE_STORAGE_KEY = 'opencreator.dashboard-generation-mode';
const MODE_EVENT = 'opencreator:select-generation-mode';
const modes: DashboardGenerationMode[] = ['image', 'image-edit', 'cover', 'video', 'image-to-video', 'translation', 'translation-subtitles', 'voiceover', 'transcription', 'audio-transcription', 'download', 'clips', 'speech', 'script'];

export function selectDashboardGenerationMode(mode: DashboardGenerationMode) {
  try {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // The in-page event still updates an already mounted composer.
  }
  window.dispatchEvent(new Event(MODE_EVENT));
}

export function readPendingDashboardGenerationMode(): DashboardGenerationMode | undefined {
  try {
    const value = window.sessionStorage.getItem(MODE_STORAGE_KEY) as DashboardGenerationMode | null;
    return value !== null && modes.includes(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readDashboardGenerationMode(): DashboardGenerationMode {
  const value = readPendingDashboardGenerationMode();
  try {
    window.sessionStorage.removeItem(MODE_STORAGE_KEY);
  } catch {
    // Use the default image workspace when storage is unavailable.
  }
  return value ?? 'image';
}

export function dashboardGenerationWorkspace(mode: DashboardGenerationMode): DashboardGenerationWorkspace {
  switch (mode) {
    case 'image':
    case 'image-edit': return 'image-generation';
    case 'cover': return 'cover-generator';
    case 'video':
    case 'image-to-video': return 'video-generation';
    case 'translation':
    case 'translation-subtitles':
    case 'voiceover': return 'video-translation';
    case 'transcription':
    case 'audio-transcription': return 'transcription';
    case 'speech': return 'smart-dubbing';
    case 'clips': return 'auto-clips';
    case 'script': return 'short-video-script';
    default: return 'video-download';
  }
}

export function dashboardGenerationGroup(mode: DashboardGenerationMode): DashboardGenerationGroup {
  if (mode === 'image' || mode === 'image-edit' || mode === 'cover') return 'image';
  if (mode === 'speech' || mode === 'audio-transcription') return 'audio';
  if (mode === 'script') return 'text';
  return 'video';
}

export default function DashboardGenerationComposer(props: {
  showExtendedModes?: boolean;
  initialMode?: DashboardGenerationMode;
  modeGroup?: DashboardGenerationGroup;
  onModeChange?(mode: DashboardGenerationMode): void;
  onOpenHistory?(): void;
  renderWorkspace(
    workspace: DashboardGenerationWorkspace,
    tabs: ReactNode,
    mode: DashboardGenerationMode
  ): ReactNode;
}) {
  const l = useLocalizedCopy();
  const [mode, setMode] = useState<DashboardGenerationMode>(() => {
    const storedMode = readDashboardGenerationMode();
    return props.initialMode ?? storedMode;
  });
  useEffect(() => {
    props.onModeChange?.(mode);
  }, [mode, props.onModeChange]);
  useEffect(() => {
    const update = () => setMode(readDashboardGenerationMode());
    window.addEventListener(MODE_EVENT, update);
    return () => window.removeEventListener(MODE_EVENT, update);
  }, []);
  useEffect(() => {
    if (props.initialMode !== undefined) setMode(props.initialMode);
  }, [props.initialMode]);
  const workspace = dashboardGenerationWorkspace(mode);
  const showImageModes = props.modeGroup === undefined || props.modeGroup === 'image';
  const showVideoModes = props.modeGroup === undefined || props.modeGroup === 'video';
  const showAudioModes = props.modeGroup === 'audio';
  const showTextModes = props.modeGroup === 'text';
  const tabs = (
    <div className="dashboard-generation-tabs" role="tablist" aria-label={l('生成类型', 'Generation type')}>
      {showImageModes ? (
        <button
          id="dashboard-generation-image-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'image' || mode === 'image-edit'}
          aria-controls="image-prompt-input"
          onClick={() => setMode('image')}
        >
          <Image size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('图像生成', 'Image Generation')}
        </button>
      ) : null}
      {props.showExtendedModes && showImageModes ? (
        <button
          id="dashboard-generation-cover-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'cover'}
          aria-controls="cover-prompt-input"
          onClick={() => setMode('cover')}
        >
          <Image size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('封面生成', 'Cover Generator')}
        </button>
      ) : null}
      {showVideoModes ? (
        <button
          id="dashboard-generation-translation-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'translation' || mode === 'translation-subtitles' || mode === 'voiceover'}
          aria-controls="dashboard-translation-video-url"
          onClick={() => setMode('translation')}
        >
          <Languages size={17} strokeWidth={1.8} aria-hidden="true" />
          {props.showExtendedModes ? l('视频翻译', 'Video Translation') : l('视频翻译', 'Video Translation')}
        </button>
      ) : null}
      {props.showExtendedModes && showVideoModes ? (
        <>
          <button
            id="dashboard-generation-video-tab"
            type="button"
            role="tab"
            aria-selected={mode === 'video' || mode === 'image-to-video'}
            aria-controls="video-prompt-input"
            onClick={() => setMode('video')}
          >
            <Clapperboard size={17} strokeWidth={1.8} aria-hidden="true" />
            {l('视频生成', 'Video Generation')}
          </button>
        </>
      ) : null}
      {!props.showExtendedModes && showVideoModes ? (
        <button
          id="dashboard-generation-video-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'video'}
          aria-controls="video-prompt-input"
          onClick={() => setMode('video')}
        >
          <Clapperboard size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('视频生成', 'Video Generation')}
        </button>
      ) : null}
      {props.showExtendedModes && (showVideoModes || showAudioModes) ? (
        <button
          id="dashboard-generation-transcription-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'transcription' || mode === 'audio-transcription'}
          aria-controls="dashboard-transcription-video-url"
          onClick={() => setMode(showAudioModes ? 'audio-transcription' : 'transcription')}
        >
          <Captions size={17} strokeWidth={1.8} aria-hidden="true" />
          {showAudioModes ? l('音频转录', 'Audio Transcription') : l('视频转录', 'Video Transcription')}
        </button>
      ) : null}
      {props.showExtendedModes && (props.modeGroup === undefined || showAudioModes) ? (
        <button
          id="dashboard-generation-speech-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'speech'}
          aria-controls="smart-dubbing-script-input"
          onClick={() => setMode('speech')}
        >
          <Mic2 size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('文本转语音', 'Text to Speech')}
        </button>
      ) : null}
      {props.showExtendedModes && showTextModes ? (
        <button
          id="dashboard-generation-script-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'script'}
          aria-controls="short-video-script-topic-input"
          onClick={() => setMode('script')}
        >
          <Captions size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('短视频脚本生成', 'Short Video Script')}
        </button>
      ) : null}
      {showVideoModes ? (
        <button
          id="dashboard-generation-download-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'download'}
          aria-controls="dashboard-download-video-url"
          onClick={() => setMode('download')}
        >
          <Download size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('视频下载', 'Video Downloader')}
          <span className="dashboard-generation-free-badge">{l('免费', 'Free', 'Gratis')}</span>
        </button>
      ) : null}
      {props.showExtendedModes && showVideoModes ? (
        <button
          id="dashboard-generation-clips-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'clips'}
          aria-controls="dashboard-clips-video-url"
          onClick={() => setMode('clips')}
        >
          <Clapperboard size={17} strokeWidth={1.8} aria-hidden="true" />
          {l('视频切片', 'Video Clips')}
        </button>
      ) : null}
    </div>
  );

  return (
    <section className="dashboard-generation" aria-label={l('快速生成', 'Quick generation')}>
      {props.onOpenHistory ? <button type="button" className="dashboard-generation-history-trigger" onClick={props.onOpenHistory}><History size={14} aria-hidden="true" />{l('生成记录', 'Generation history')}</button> : null}
      {props.renderWorkspace(workspace, tabs, mode)}
    </section>
  );
}
