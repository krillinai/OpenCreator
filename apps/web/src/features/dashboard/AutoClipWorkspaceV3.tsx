import { readCreatorResultSnapshots, safePublicErrorCode, safePublicErrorMessage, type CreatorArtifact, type CreatorJson } from '@opencreator/protocol';
import { Download, FileVideo, Link2, LoaderCircle, Plus, RefreshCw, Scissors, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatRoute, parseRoute } from '../../app/routes.js';
import NativeSelect from '../../components/forms/NativeSelect.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import { CreatorTaskProgressNotice, useCreatorTaskProgress } from './CreatorCollaborationPanel.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorToolShell from './CreatorToolShell.js';
import DashboardVideoTranslationSettings from './DashboardVideoTranslationSettings.js';
import SupportedVideoSources from './SupportedVideoSources.js';
import { VideoTranslationSubtitleImport } from './VideoTranslationSubtitleImport.js';
import VideoSourcePreview from './VideoSourcePreview.js';
import { creatorSystemIssueText } from './creator-panel-adapters.js';
import { useCreatorRecoveryCopy } from './creator-recovery-copy.js';
import { createCreatorArtifactObjectUrl, useOptionalCreatorSession } from './creator-session-store.js';

type ClipDuration = '15-30' | '30-60' | '60-90' | '90-180';
type ClipVersion = { value: number; description: string; artifacts: CreatorArtifact[]; source?: string };

const durations: ClipDuration[] = ['15-30', '30-60', '60-90', '90-180'];
const emptyClips: CreatorArtifact[] = [];

export default function AutoClipWorkspaceV3(props: {
  onBack(): void;
  onNewClip?(): void;
  onRetryStarted?(): void;
  promptHint?: string;
  videoMetadataService?: VideoMetadataService;
  embedded?: boolean;
  embeddedTabs?: ReactNode;
  forceComposer?: boolean;
  startInResults?: boolean;
  service?: CreatorWebService;
  onGenerated?(jobId?: string): void;
}) {
  const { language } = useAppLanguage();
  const hasSpecificCopy = language === 'zh-CN' || language === 'en-US' || language === 'sv-SE';
  const l = useLocalizedCopy();
  const recoveryCopy = useCreatorRecoveryCopy();
  const session = useOptionalCreatorSession();
  const task = useCreatorTaskProgress();
  const [videoUrl, setVideoUrl] = useState(() => readString(session?.state.sourceUrl));
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [sourceArtifactId, setSourceArtifactId] = useState(() => readString(session?.state.sourceArtifactId));
  const [duration, setDuration] = useState<ClipDuration>(() => readDuration(session?.state.duration));
  const [clipCount, setClipCount] = useState(() => readCount(session?.state.clipCount));
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [clipOrder, setClipOrder] = useState<'source' | 'score'>('source');
  const [preview, setPreview] = useState<{ key: string; url?: string }>();
  const [mediaDuration, setMediaDuration] = useState<{ url: string; seconds: number }>();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const fileInputRef = useRef<File | null>(null);
  const playerRef = useRef<HTMLVideoElement>(null);

  const uploadedSourceId = readString(session?.state.sourceArtifactId);
  const importedSource = session?.job.artifacts.find(artifact => (
    artifact.id === sourceArtifactId && artifact.kind === 'source_video' && artifact.status === 'completed'
  ));
  const hasSource = videoFile !== null || importedSource !== undefined || isValidUrl(videoUrl);
  const sourceName = videoFile?.name || readString(importedSource?.metadata.fileName) || videoUrl;
  const latestStage = task?.stage;
  const stageRunning = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const running = submitting || stageRunning;
  const failedStage = latestStage?.status === 'failed' ? latestStage : undefined;
  const issue = failedStage && session?.issues.find(candidate => candidate.stageRunId === failedStage.id && candidate.status !== 'resolved');
  const failure = failedStage && clipFailureRecovery(failedStage.errorCode,
    [issue?.publicFacts?.upstreamMessage, failedStage.errorMessage].filter(Boolean).join('\n'), l, hasSpecificCopy);
  const errorCode = safePublicErrorCode(failedStage?.errorCode);
  const failureDetails = safePublicErrorMessage(issue?.technicalDetail) ?? safePublicErrorMessage(failedStage?.errorMessage);
  const canRetry = task && (issue === undefined || issue.repairActions.some(action =>
    action.kind === 'retry-operation' && action.operationId === 'creator.retry-stage' && !action.requiresConfirmation && action.risk === 'normal'));
  const retryDisabled = !canRetry || task?.retryPending || task?.retryBlocked || issue?.status === 'resolving';
  const route = failure?.settingsTab ? parseRoute(window.location.hash) : undefined;
  const settingsLink = failure?.settingsTab && session ? {
    href: formatRoute({ view: 'settings', tab: failure.settingsTab, returnPath: formatRoute({
      view: 'workbench', tool: 'auto-clips', jobId: session.job.id, returnTo: route?.view === 'workbench' ? route.returnTo : undefined
    }) }),
    label: failure.settingsLabel
  } : undefined;
  const completed = session?.job.status === 'completed';
  const versions = useMemo(() => collectVersions(
    session?.job.artifacts ?? [], session?.state.resultSnapshots
  ), [session?.job.artifacts, session?.state.resultSnapshots]);
  const selected = versions.find(version => version.value === selectedVersion) ?? versions.at(-1);
  const clips = selected?.artifacts ?? emptyClips;
  const clipEntries = [...clips].sort((first, second) => readNumber(first.metadata.start) - readNumber(second.metadata.start))
    .map((artifact, index) => ({ artifact, number: index + 1, score: clipScore(artifact) }));
  const activeEntry = clipEntries.find(entry => entry.artifact.id === selectedClipId) ?? clipEntries[0];
  const activeClip = activeEntry?.artifact;
  const canSortByScore = clipEntries.length > 1 && clipEntries.some(entry => entry.score !== undefined);
  const displayClips = canSortByScore && clipOrder === 'score'
    ? [...clipEntries].sort((first, second) => (second.score ?? -1) - (first.score ?? -1) || first.number - second.number)
    : clipEntries;
  const previewKey = JSON.stringify([session?.job.id, activeClip?.id]);
  const activePreview = preview?.key === previewKey ? preview : undefined;
  const selectionReason = activeClip ? clipSelectionReason(activeClip) : undefined;
  const anchorTime = selectionReason ? formatTime(Math.floor(selectionReason.offsetMs / 1000)).padStart(5, '0') : '';
  const canSeekToReason = selectionReason !== undefined && mediaDuration !== undefined
    && mediaDuration.url === activePreview?.url && Number.isFinite(mediaDuration.seconds)
    && selectionReason.offsetMs / 1000 < mediaDuration.seconds;
  const resultSource = selected?.source || readString(session?.state.title) || readString(session?.state.sourceFileName) || sourceName;
  const previewContext = useRef({ session, l, artifactId: activeClip?.id });
  previewContext.current = { session, l, artifactId: activeClip?.id };

  useEffect(() => {
    if (uploadedSourceId && videoFile === null) setSourceArtifactId(uploadedSourceId);
  }, [uploadedSourceId, videoFile]);

  useEffect(() => {
    const { session, l, artifactId } = previewContext.current;
    if (session === null || artifactId === undefined) return undefined;
    let active = true;
    let objectUrl: string | undefined;
    void createCreatorArtifactObjectUrl(session, artifactId,
      'auto-clip.load-result-preview', l('切片预览加载失败，请稍后重试。', 'Clip previews failed to load. Try again later.')).then(url => {
      if (!active) URL.revokeObjectURL(url);
      else {
        objectUrl = url;
        setPreview({ key: previewKey, url });
      }
    }).catch(() => {
      if (active) setPreview({ key: previewKey });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreview(previous => previous?.key === previewKey ? undefined : previous);
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
            duration,
            reasonLocale: language
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
        duration,
        reasonLocale: language
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
    const url = activePreview?.url;
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = readString(artifact.metadata.fileName) || `clip-${artifact.version}.mp4`;
    link.click();
  }

  function renderComposer(recovering = false) {
    return (
      <div className="creator-tool-embedded">
        <div className="creator-tool-stack image-generation-studio">
          <form className="image-generation-composer dashboard-clips-composer" data-recovery={recovering || undefined} aria-label={l('视频切片', 'Video Clips')} onSubmit={event => {
            event.preventDefault();
            if (!recovering) void startClip();
            else if (task && !retryDisabled) void task.retry().then(started => {
              if (started) (props.onRetryStarted ?? props.onBack)();
            });
          }}>
            <fieldset className="image-generation-fields" disabled={submitting}>
              <div className="image-generation-editor">
                <div className="image-generation-composer-heading">{recovering
                  ? <h2><Scissors size={18} aria-hidden="true" />{l('视频切片', 'Video Clips')}</h2> : props.embeddedTabs}</div>
                <div className="dashboard-translation-source-row">
                  {!recovering ? <div className="image-generation-reference dashboard-translation-source" data-loaded={hasSource}>
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
                  </div> : null}
                  {!recovering ? <span className="dashboard-translation-source-divider" aria-hidden="true">{l('或', 'or')}</span> : null}
                  <div className="image-generation-prompt-field dashboard-translation-url-field">
                    {recovering && (importedSource || videoFile) ? <div className="video-translation-failure-source-file">
                      <FileVideo size={18} aria-hidden="true" />
                      <span><strong>{l('本地视频已上传', 'Local video uploaded')}</strong><small title={sourceName}>{sourceName}</small></span>
                    </div> : <div className="dashboard-translation-url-input">
                      <Link2 size={18} strokeWidth={1.8} aria-hidden="true" />
                      <input
                        id="dashboard-clips-video-url"
                        type="url"
                        aria-label={l('视频链接', 'Video link')}
                        placeholder={l('粘贴视频链接', 'Paste a video URL')}
                        disabled={videoFile !== null || submitting}
                        readOnly={recovering}
                        value={videoUrl}
                        onChange={event => changeUrl(event.target.value)}
                      />
                      {videoUrl && !recovering ? <button className="dashboard-translation-url-clear" type="button" aria-label={l('清除视频链接', 'Clear video link')} onClick={clearSource}><X size={16} /></button> : null}
                    </div>}
                    {!recovering ? <SupportedVideoSources compact label={l('支持平台', 'Supported platforms')} /> : null}
                  </div>
                </div>
                {(recovering ? task?.controlError : localError) ? <p className="dashboard-translation-message is-error" role="alert">{recovering ? task?.controlError : localError}</p> : null}
              </div>
              <div className="image-generation-action-bar">
                <DashboardVideoTranslationSettings
                  label={l('切片设置', 'Clip settings')}
                  summary={[`${duration} ${l('秒', 'sec')}`, l(`${clipCount} 个切片`, `${clipCount} clips`)]}
                  disabled={submitting}
                >
                  <label className="creator-tool-field video-translation-field">
                    <span>{l('切片时长', 'Clip duration')}</span>
                    <NativeSelect aria-label={l('切片时长', 'Clip duration')} value={duration} disabled={recovering} onChange={event => setDuration(event.target.value as ClipDuration)}>
                      {durations.map(value => <option key={value} value={value}>{value} {l('秒', 'sec')}</option>)}
                    </NativeSelect>
                  </label>
                  <label className="creator-tool-field video-translation-field">
                    <span>{l('切片数量', 'Number of clips')}</span>
                    <input aria-label={l('切片数量', 'Number of clips')} type="number" min={1} max={20} step={1} value={clipCount} readOnly={recovering} onChange={event => setClipCount(readCount(Number(event.target.value)))} />
                  </label>
                </DashboardVideoTranslationSettings>
                <div className="image-generation-submit-row">
                  {recovering ? canRetry ? <button className="creator-tool-primary" type="submit" disabled={retryDisabled}>
                    <RefreshCw aria-hidden="true" size={16} />
                    {task.retryPending ? hasSpecificCopy ? l('正在重试…', 'Retrying…', 'Försöker igen…') : `${recoveryCopy.retryStage}…` : recoveryCopy.retryStage}
                  </button> : null : <button className="creator-tool-primary" type="submit" disabled={!hasSource || submitting}>
                    {submitting ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Scissors size={16} />}
                    {submitting ? l('正在生成切片', 'Creating clips') : l('开始切片', 'Create clips')}
                  </button>}
                </div>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    );
  }

  if (props.embedded && (props.forceComposer || !selected || !completed)) return renderComposer();

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
      currentIssue={failure?.title ?? (localError || session?.error?.message)}
      fillWorkspace={failure !== undefined || (completed && selected !== undefined)}
      workspaceIssue={failure && {
        title: failure.title,
        description: failure.reason,
        nextStep: failure.nextStep,
        detail: [errorCode, failureDetails].filter(Boolean).join('\n'),
        settingsLink
      }}
      onCancelTask={running && !submitting ? () => void session?.cancelJob().catch(() => undefined) : undefined}
      onResumeTask={session?.job.status === 'canceled' ? () => void session.resumeJob().catch(() => undefined) : undefined}
      onBack={props.onBack}
    >
      <div className="creator-tool-stack auto-clip-v3">
        {failure ? renderComposer(true) : null}
        {stageRunning ? <CreatorTaskProgressNotice stageId="clip" /> : null}
        {selected && activeEntry && activeClip ? (
          <section className="auto-clip-v3-results" aria-label={l('切片结果', 'Clip results')}>
            <div className="auto-clip-v3-results-heading">
              <div className="auto-clip-v3-results-context">
                <div className="auto-clip-v3-results-summary">
                  <h2>{l('切片结果', 'Clip results')}</h2>
                  <span>{l(`${clips.length} 个切片`, `${clips.length} clips`)}</span>
                </div>
                {resultSource ? <p title={resultSource}>{l('视频来源', 'Video source')}: {resultSource}</p> : null}
              </div>
              <div className="auto-clip-v3-results-actions">
                <CreatorResultVersionMenu version={selected.value}
                  versions={versions.map(version => ({ value: version.value, description: version.description }))}
                  onVersionChange={version => { setSelectedVersion(version); setSelectedClipId(undefined); }} />
                {completed && props.onNewClip ? <button type="button" className="auto-clip-v3-new" onClick={props.onNewClip}>
                  <Plus size={16} aria-hidden="true" />{l('新建切片', 'Start automatic clipping')}
                </button> : null}
              </div>
            </div>
            <div className="auto-clip-v3-stage">
              <div className="auto-clip-v3-main-preview">
                <div className="auto-clip-v3-preview">
                  {activePreview?.url ? <video key={previewKey} ref={playerRef} controls playsInline preload="metadata" src={activePreview.url}
                    onLoadedMetadata={({ currentTarget }) => setMediaDuration({ url: currentTarget.currentSrc || currentTarget.src, seconds: currentTarget.duration })}
                    onDurationChange={({ currentTarget }) => setMediaDuration({ url: currentTarget.currentSrc || currentTarget.src, seconds: currentTarget.duration })}
                    onError={() => setMediaDuration(undefined)} />
                    : <div className="auto-clip-v3-preview-loading" role="status">
                      {activePreview ? l('切片预览加载失败，请稍后重试。', 'Clip previews failed to load. Try again later.')
                        : <><LoaderCircle className="smart-dubbing-spinner" size={20} aria-hidden="true" />{l('正在载入视频预览', 'Loading video preview')}</>}
                    </div>}
                </div>
                <div className="auto-clip-v3-selection">
                  <div>
                    <strong>{l('片段', 'Clip', 'Klipp')} {activeEntry.number}</strong>
                    <span><bdi>{clipRange(activeClip)}</bdi></span>
                  </div>
                  <button type="button" className="creator-tool-primary" disabled={!activePreview?.url} onClick={() => download(activeClip)}>
                    <Download size={16} aria-hidden="true" />{l('下载片段', 'Download clip')}
                  </button>
                </div>
                <div className="auto-clip-v3-reason">
                  <strong>{l('选段理由', 'Selection reason', 'Varför klippet valdes')}</strong>
                  {selectionReason ? (
                    <div className="auto-clip-v3-reason-detail">
                      <button type="button" className="auto-clip-v3-anchor" disabled={!canSeekToReason}
                        aria-label={l(`跳转到 ${anchorTime}`, `Jump to ${anchorTime}`, `Hoppa till ${anchorTime}`)}
                        onClick={() => {
                          if (canSeekToReason && playerRef.current) playerRef.current.currentTime = selectionReason.offsetMs / 1000;
                        }}><bdi>{anchorTime}</bdi></button>
                      <span lang={selectionReason.locale} dir="auto">{selectionReason.text}</span>
                    </div>
                  ) : <span>{l('此片段暂无选段理由。', 'No selection reason is available for this clip.')}</span>}
                </div>
              </div>
              <div className="auto-clip-v3-library">
                <div className="auto-clip-v3-library-heading">
                  <h3>{l('片段列表', 'Video Clips', 'Videoklipp')}</h3>
                  {canSortByScore ? <NativeSelect aria-label={l('排序', 'Sort clips', 'Sortera klipp')}
                    value={clipOrder} onChange={event => setClipOrder(event.target.value === 'score' ? 'score' : 'source')}>
                    <option value="source">{l('原片顺序', 'Source order', 'Källordning')}</option>
                    <option value="score">{l('按评分排序', 'By score', 'Efter poäng')}</option>
                  </NativeSelect> : null}
                </div>
                <div className="auto-clip-v3-list" role="group" aria-label={l('片段列表', 'Video Clips', 'Videoklipp')}>
                  {displayClips.map(({ artifact, number, score }) => {
                    const duration = clipDuration(artifact);
                    const scoreLabel = l('AI 选段评分', 'AI clip score', 'AI-poäng för klipp');
                    return (
                      <button key={artifact.id} type="button" aria-pressed={artifact.id === activeClip.id} onClick={() => setSelectedClipId(artifact.id)}>
                        <strong>{l('片段', 'Clip', 'Klipp')} {number}</strong>
                        <span className="auto-clip-v3-list-time">
                          <bdi>{clipRange(artifact)}</bdi>{duration > 0 ? <bdi>{formatTime(duration)}</bdi> : null}
                        </span>
                        {score === undefined ? null : <span className="auto-clip-v3-score">
                          <span className="sr-only">{scoreLabel}{' '}</span><bdi title={scoreLabel}>{score}</bdi>
                        </span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </CreatorToolShell>
  );
}

function clipFailureRecovery(code: string | null, message: string, l: LocalizeCopy, hasSpecificCopy: boolean) {
  const title = hasSpecificCopy ? l('视频切片失败', 'Video clips failed', 'Det gick inte att skapa videoklipp')
    : `${l('视频切片', 'Video Clips')} · ${l('失败', 'Failed')}`;
  if (code === 'clip_subtitle_failed' && /(?:downloadYouTubeSubtitle|\[youtube\])/i.test(message)
    && /sign in to confirm|cookies? (?:are )?no longer valid|cookies? (?:have |has )?expired/i.test(message)) {
    return {
      title,
      reason: hasSpecificCopy
        ? l('YouTube 要求重新登录，未能读取视频字幕。', 'YouTube requires you to sign in again. Video captions could not be read.', 'YouTube kräver att du loggar in igen. Videons undertexter kunde inte läsas.')
        : `${l('获取平台字幕', 'Fetching platform captions')} · YouTube: ${l('请重新登录', 'Sign in again')}`,
      nextStep: hasSpecificCopy
        ? l('重新连接 YouTube 后，返回此任务重试。', 'Reconnect YouTube, then return to this task and retry.', 'Återanslut YouTube och återgå sedan till uppgiften för att försöka igen.')
        : `YouTube · ${l('重新连接', 'Reconnect')}`,
      settingsTab: 'platform-connections' as const,
      settingsLabel: l('平台连接', 'Platform connections')
    };
  }
  const fallback = l('视频切片未完成，请检查视频来源和服务设置后重试。', 'Video clipping did not complete. Check the source and service settings, then retry.');
  if (!hasSpecificCopy) return { title, reason: fallback };
  const reasons: Record<string, string> = {
    clip_subtitle_failed: l('未能准备原视频或生成原文字幕。', 'The source video or its captions could not be prepared.', 'Det gick inte att förbereda källvideon eller dess undertexter.'),
    clip_video_too_short: l('原视频短于所选的最短切片时长。', 'The source video is shorter than the selected minimum clip duration.', 'Källvideon är kortare än den valda minsta klipplängden.'),
    clip_no_candidates: l('未找到符合所选时长的片段。', 'No clips matched the selected duration.', 'Inga klipp matchade den valda längden.'),
    clip_analysis_failed: l('未能分析可切分的视频片段。', 'The video could not be analyzed for clips.', 'Det gick inte att analysera videon för att hitta klipp.'),
    clip_render_failed: l('未能导出视频切片。', 'The video clips could not be exported.', 'Videoklippen kunde inte exporteras.')
  };
  return { title, reason: creatorSystemIssueText(code, l) ?? (code === null ? undefined : reasons[code]) ?? fallback };
}

function collectVersions(artifacts: CreatorArtifact[], snapshotsValue: CreatorJson | undefined): ClipVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const snapshots = readCreatorResultSnapshots(snapshotsValue);
  const fromSnapshots = snapshots.flatMap(snapshot => {
    const clips = (snapshot.artifactRefs.auto_clip_video ?? [])
      .map(id => byId.get(id))
      .filter((artifact): artifact is CreatorArtifact => artifact?.kind === 'auto_clip_video');
    const source = readString(snapshot.state.title) || readString(snapshot.state.sourceFileName) || readString(snapshot.state.sourceUrl);
    return clips.length ? [{ value: snapshot.version, description: snapshot.description, artifacts: clips, source }] : [];
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

function clipRange(clip: CreatorArtifact): string {
  return `${formatTime(readNumber(clip.metadata.start))} – ${formatTime(readNumber(clip.metadata.end))}`;
}

function clipDuration(clip: CreatorArtifact): number {
  return readNumber(clip.metadata.duration) || readNumber(clip.metadata.end) - readNumber(clip.metadata.start);
}

function clipScore(clip: CreatorArtifact): number | undefined {
  const { score } = clip.metadata;
  return typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1 ? Math.round(score * 100) : undefined;
}

function clipSelectionReason(clip: CreatorArtifact) {
  const value = clip.metadata.selectionReason;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { text, offsetMs, locale } = value;
  if (typeof text !== 'string' || !text.trim() || typeof locale !== 'string' || !locale
    || typeof offsetMs !== 'number' || !Number.isInteger(offsetMs) || offsetMs < 0 || offsetMs / 1000 >= clipDuration(clip)) return undefined;
  return { text, offsetMs, locale };
}
