import { readCreatorResultSnapshots, type CreatorArtifact, type CreatorJson } from '@opencreator/protocol';
import { Download, Link2, LoaderCircle, Scissors, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import NativeSelect from '../../components/forms/NativeSelect.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorToolShell from './CreatorToolShell.js';
import DashboardVideoTranslationSettings from './DashboardVideoTranslationSettings.js';
import SupportedVideoSources from './SupportedVideoSources.js';
import { VideoTranslationSubtitleImport } from './VideoTranslationSubtitleImport.js';
import VideoSourcePreview from './VideoSourcePreview.js';
import { createCreatorArtifactObjectUrl, useOptionalCreatorSession } from './creator-session-store.js';

type ClipDuration = '15-30' | '30-60' | '60-90' | '90-180';
type ClipVersion = { value: number; description: string; artifacts: CreatorArtifact[] };

const durations: ClipDuration[] = ['15-30', '30-60', '60-90', '90-180'];
const emptyClips: CreatorArtifact[] = [];

export default function AutoClipWorkspaceV3(props: {
  onBack(): void;
  promptHint?: string;
  videoMetadataService?: VideoMetadataService;
  embedded?: boolean;
  embeddedTabs?: ReactNode;
  forceComposer?: boolean;
  startInResults?: boolean;
  service?: CreatorWebService;
  onGenerated?(jobId?: string): void;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [videoUrl, setVideoUrl] = useState(() => readString(session?.state.sourceUrl));
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [sourceArtifactId, setSourceArtifactId] = useState(() => readString(session?.state.sourceArtifactId));
  const [duration, setDuration] = useState<ClipDuration>(() => readDuration(session?.state.duration));
  const [clipCount, setClipCount] = useState(() => readCount(session?.state.clipCount));
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const fileInputRef = useRef<File | null>(null);
  const previewListRef = useRef<HTMLDivElement | null>(null);

  const uploadedSourceId = readString(session?.state.sourceArtifactId);
  const importedSource = session?.job.artifacts.find(artifact => (
    artifact.id === sourceArtifactId && artifact.kind === 'source_video' && artifact.status === 'completed'
  ));
  const hasSource = videoFile !== null || importedSource !== undefined || isValidUrl(videoUrl);
  const sourceName = videoFile?.name || readString(importedSource?.metadata.fileName) || videoUrl;
  const latestStage = [...(session?.job.stages ?? [])].reverse().find(stage => stage.stageId === 'clip');
  const stageRunning = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const running = submitting || stageRunning;
  const completed = session?.job.status === 'completed';
  const versions = useMemo(() => collectVersions(
    session?.job.artifacts ?? [], session?.state.resultSnapshots
  ), [session?.job.artifacts, session?.state.resultSnapshots]);
  const selected = versions.find(version => version.value === selectedVersion) ?? versions.at(-1);
  const clips = selected?.artifacts ?? emptyClips;
  const previewKey = JSON.stringify([session?.job.id, selected?.value, ...clips.map(artifact => artifact.id)]);
  const previewContext = useRef({ session, l, clipIds: clips.map(artifact => artifact.id) });
  previewContext.current = { session, l, clipIds: clips.map(artifact => artifact.id) };

  useEffect(() => {
    if (uploadedSourceId && videoFile === null) setSourceArtifactId(uploadedSourceId);
  }, [uploadedSourceId, videoFile]);

  useEffect(() => {
    const { session, l, clipIds } = previewContext.current;
    if (session === null || clipIds.length === 0) {
      setPreviewUrls(previous => Object.keys(previous).length === 0 ? previous : {});
      return undefined;
    }
    let active = true;
    const urls: string[] = [];
    void Promise.all(clipIds.map(async artifactId => {
      const url = await createCreatorArtifactObjectUrl(session, artifactId,
        'auto-clip.load-result-preview', l('切片预览加载失败', 'Could not load the clip preview'));
      if (!active) {
        URL.revokeObjectURL(url);
        return [artifactId, ''] as const;
      }
      urls.push(url);
      return [artifactId, url] as const;
    })).then(entries => {
      if (active) setPreviewUrls(Object.fromEntries(entries));
    }).catch(() => undefined);
    return () => {
      active = false;
      urls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewKey]);

  function chooseFile(file: File | null) {
    fileInputRef.current = file;
    setVideoFile(file);
    if (file) {
      setVideoUrl('');
      setSourceArtifactId('');
      session?.updateDraft({ sourceType: 'file', sourceUrl: '', sourceArtifactId: null });
    }
    setLocalError('');
  }

  function changeUrl(url: string) {
    fileInputRef.current = null;
    setVideoFile(null);
    setSourceArtifactId('');
    setVideoUrl(url);
    session?.updateDraft({ sourceType: 'url', sourceUrl: url, sourceArtifactId: null });
    setLocalError('');
  }

  function clearSource() {
    changeUrl('');
  }

  async function startClip() {
    if (session === null || submitting) return;
    if (stageRunning && !props.embedded) return;
    if (!hasSource) {
      setLocalError(l('请添加本地视频或公开视频链接', 'Add a local video or public video link'));
      return;
    }
    setSubmitting(true);
    setLocalError('');
    try {
      if (stageRunning) {
        if (!props.service) return;
        const { job: next } = await props.service.createJob({
          projectId: session.job.projectId,
          templateId: session.job.templateId,
          templateVersion: session.job.templateVersion,
          state: {
            ...session.state,
            sourceType: videoFile || sourceArtifactId ? 'file' : 'url',
            sourceUrl: videoFile || sourceArtifactId ? '' : videoUrl.trim(),
            sourceArtifactId: videoFile ? null : sourceArtifactId || null,
            clipCount,
            duration
          }
        });
        if (fileInputRef.current !== null) {
          await props.service.uploadSourceVideo(next.id, { file: fileInputRef.current, expectedRevision: next.revision });
          fileInputRef.current = null;
          setVideoFile(null);
        }
        await props.service.applyAction(next.id, { actor: 'user', action: 'run-stage', input: { stageId: 'clip' }, expectedRevision: next.revision });
        props.onGenerated?.(next.id);
        return;
      }
      session.updateDraft({
        sourceType: videoFile || sourceArtifactId ? 'file' : 'url',
        sourceUrl: videoFile || sourceArtifactId ? '' : videoUrl.trim(),
        sourceArtifactId: videoFile ? null : sourceArtifactId || null,
        clipCount,
        duration
      }, { semantic: true });
      await session.flush();
      if (fileInputRef.current !== null) {
        await session.uploadSourceVideo(fileInputRef.current);
        fileInputRef.current = null;
        setVideoFile(null);
      }
      await session.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'clip' } });
      props.onGenerated?.();
    } catch {
      // The shared Creator session presents API and upload failures.
    } finally {
      setSubmitting(false);
    }
  }

  function download(artifact: CreatorArtifact) {
    const url = previewUrls[artifact.id];
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = readString(artifact.metadata.fileName) || `clip-${artifact.version}.mp4`;
    link.click();
  }

  function pauseOtherPreviews(playingVideo: HTMLVideoElement) {
    previewListRef.current?.querySelectorAll('video').forEach(video => {
      if (video !== playingVideo) video.pause();
    });
  }

  if (props.embedded && (props.forceComposer || !selected || !completed)) {
    return (
      <div className="creator-tool-embedded">
        <div className="creator-tool-stack image-generation-studio">
          <form className="image-generation-composer dashboard-clips-composer" aria-label={l('视频切片', 'Video Clips')} onSubmit={event => {
            event.preventDefault();
            void startClip();
          }}>
            <fieldset className="image-generation-fields" disabled={submitting}>
              <div className="image-generation-editor">
                <div className="image-generation-composer-heading">{props.embeddedTabs}</div>
                <div className="dashboard-translation-source-row">
                  <div className="image-generation-reference dashboard-translation-source" data-loaded={hasSource}>
                    {hasSource ? (
                      <VideoSourcePreview
                        file={videoFile}
                        registeredFile={importedSource ? {
                          name: sourceName,
                          size: readNumber(importedSource.metadata.bytes ?? importedSource.metadata.size),
                          mime: readString(importedSource.metadata.mimeType ?? importedSource.metadata.mime) || 'video/mp4'
                        } : undefined}
                        sourceType={videoFile || importedSource ? 'file' : 'url'}
                        url={videoUrl}
                        metadataService={props.videoMetadataService}
                        onChooseFile={clearSource}
                        onClear={clearSource}
                      />
                    ) : (
                      <VideoTranslationSubtitleImport
                        compact
                        mediaOnly
                        sourceOnly
                        sourceLanguage="auto"
                        targetLanguage="auto"
                        accept="video/*,.mp4,.mov,.m4v,.webm,.mkv,.avi"
                        disabled={hasSource || videoUrl.trim().length > 0 || submitting}
                        onMediaFile={chooseFile}
                        onError={setLocalError}
                      />
                    )}
                  </div>
                  <span className="dashboard-translation-source-divider" aria-hidden="true">{l('或', 'or')}</span>
                  <div className="image-generation-prompt-field dashboard-translation-url-field">
                    <div className="dashboard-translation-url-input">
                      <Link2 size={18} strokeWidth={1.8} aria-hidden="true" />
                      <input
                        id="dashboard-clips-video-url"
                        type="url"
                        aria-label={l('视频链接', 'Video link')}
                        placeholder={l('粘贴视频链接', 'Paste a video URL')}
                        disabled={videoFile !== null || submitting}
                        value={videoUrl}
                        onChange={event => changeUrl(event.target.value)}
                      />
                      {videoUrl ? <button className="dashboard-translation-url-clear" type="button" aria-label={l('清除视频链接', 'Clear video link')} onClick={clearSource}><X size={16} /></button> : null}
                    </div>
                    <SupportedVideoSources compact label={l('支持平台', 'Supported platforms')} />
                  </div>
                </div>
                {localError ? <p className="dashboard-translation-message is-error" role="alert">{localError}</p> : null}
              </div>
              <div className="image-generation-action-bar">
                <DashboardVideoTranslationSettings
                  label={l('切片设置', 'Clip settings')}
                  summary={[`${duration} ${l('秒', 'sec')}`, l(`${clipCount} 个切片`, `${clipCount} clips`)]}
                  disabled={submitting}
                >
                  <label className="creator-tool-field video-translation-field">
                    <span>{l('切片时长', 'Clip duration')}</span>
                    <NativeSelect aria-label={l('切片时长', 'Clip duration')} value={duration} onChange={event => setDuration(event.target.value as ClipDuration)}>
                      {durations.map(value => <option key={value} value={value}>{value} {l('秒', 'sec')}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="creator-tool-field video-translation-field">
                    <span>{l('切片数量', 'Number of clips')}</span>
                    <input aria-label={l('切片数量', 'Number of clips')} type="number" min={1} max={20} step={1} value={clipCount} onChange={event => setClipCount(readCount(Number(event.target.value)))} />
                  </label>
                </DashboardVideoTranslationSettings>
                <div className="image-generation-submit-row">
                  <button className="creator-tool-primary" type="submit" disabled={!hasSource || submitting}>
                    {submitting ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Scissors size={16} />}
                    {submitting ? l('正在生成切片', 'Creating clips') : l('开始切片', 'Create clips')}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    );
  }

  return (
    <CreatorToolShell
      title={l('视频切片', 'Video Clips')}
      subtitle={l('从长视频生成独立短视频', 'Create standalone short videos from a long video')}
      context={selected ? l(`V${selected.value}，${clips.length} 个切片`, `V${selected.value}, ${clips.length} clips`)
        : running ? l('正在生成切片', 'Creating clips') : l('等待视频来源', 'Waiting for a video')}
      suggestions={[]}
      quickActions={[]}
      placeholder={props.promptHint ?? l('询问任务进度或切片结果', 'Ask about clip progress or results')}
      stepLabel={running ? l('正在生成切片', 'Creating clips') : selected ? l('切片结果', 'Clip results') : l('切片设置', 'Clip settings')}
      currentIssue={localError || (latestStage?.status === 'failed' ? latestStage.errorMessage ?? undefined : session?.error?.message)}
      onCancelTask={running && !submitting ? () => void session?.cancelJob().catch(() => undefined) : undefined}
      onResumeTask={session?.job.status === 'canceled' ? () => void session.resumeJob().catch(() => undefined) : undefined}
      onBack={props.onBack}
    >
      <div className="creator-tool-stack auto-clip-v3">
        {selected ? (
          <section className="auto-clip-v3-results" aria-label={l('切片结果', 'Clip results')}>
            <div className="auto-clip-v3-results-heading">
              <div><h2>{l('切片结果', 'Clip results')}</h2><span>{l(`${clips.length} 个视频`, `${clips.length} videos`)}</span></div>
              <CreatorResultVersionMenu version={selected.value}
                versions={versions.map(version => ({ value: version.value, description: version.description }))}
                onVersionChange={setSelectedVersion} />
            </div>
            <div className="auto-clip-v3-list" ref={previewListRef}>
              {clips.map((artifact, index) => {
                const start = readNumber(artifact.metadata.start);
                const end = readNumber(artifact.metadata.end);
                return (
                  <article key={artifact.id} className="auto-clip-v3-item">
                    <div className="auto-clip-v3-item-heading">
                      <div><strong>{l(`片段 ${index + 1}`, `Clip ${index + 1}`)}</strong><span>{formatTime(start)} - {formatTime(end)}</span></div>
                      <button type="button" title={l('下载视频', 'Download video')} aria-label={l(`下载片段 ${index + 1}`, `Download clip ${index + 1}`)}
                        disabled={!previewUrls[artifact.id]} onClick={() => download(artifact)}><Download size={17} aria-hidden="true" /></button>
                    </div>
                    {previewUrls[artifact.id] ? <video controls preload="metadata" src={previewUrls[artifact.id]}
                      onPlay={event => pauseOtherPreviews(event.currentTarget)} />
                      : <div className="auto-clip-v3-preview-loading" role="status"><LoaderCircle className="smart-dubbing-spinner" size={20} /><span>{l('正在载入视频', 'Loading video')}</span></div>}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </CreatorToolShell>
  );
}

function collectVersions(artifacts: CreatorArtifact[], snapshotsValue: CreatorJson | undefined): ClipVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const snapshots = readCreatorResultSnapshots(snapshotsValue);
  const fromSnapshots = snapshots.flatMap(snapshot => {
    const clips = (snapshot.artifactRefs.auto_clip_video ?? [])
      .map(id => byId.get(id))
      .filter((artifact): artifact is CreatorArtifact => artifact?.kind === 'auto_clip_video');
    return clips.length ? [{ value: snapshot.version, description: snapshot.description, artifacts: clips }] : [];
  });
  if (fromSnapshots.length) return fromSnapshots.sort((a, b) => a.value - b.value);
  const groups = new Map<number, CreatorArtifact[]>();
  for (const artifact of artifacts) {
    if (artifact.kind !== 'auto_clip_video') continue;
    const version = readNumber(artifact.metadata.resultVersion) || artifact.version;
    groups.set(version, [...(groups.get(version) ?? []), artifact]);
  }
  return [...groups].map(([value, clips]) => ({ value, description: '', artifacts: clips }))
    .sort((a, b) => a.value - b.value);
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(20, Math.max(1, Math.round(value))) : 3;
}

function readDuration(value: CreatorJson | undefined): ClipDuration {
  return durations.find(duration => duration === value) ?? '90-180';
}

function isValidUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

function formatTime(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}
