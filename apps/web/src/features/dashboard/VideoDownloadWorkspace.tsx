import type {
  CreatorArtifact,
  CreatorJson,
  CreatorStageRun,
  DownloadMediaType,
  DownloadOption,
  DownloadProbe
} from '@opencreator/protocol';
import { extractDouyinShareUrl, supportedVideoSourcePlatform } from '@opencreator/protocol';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronUp,
  Clock3,
  Download,
  FileAudio,
  FileVideo,
  Link2,
  LoaderCircle,
  Music2,
  PackageOpen,
  Pause,
  Play,
  RefreshCw,
  Subtitles,
  Video,
  XCircle
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import NativeSelect from '../../components/forms/NativeSelect.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import SupportedVideoSources from './SupportedVideoSources.js';
import VideoDownloadThumbnail from './VideoDownloadThumbnail.js';
import {
  createCreatorArtifactObjectUrl,
  useOptionalCreatorSession
} from './creator-session-store.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import type { VideoDownloadBatchView } from './VideoDownloadBatchWorkspace.js';

type DownloadStep = 0 | 1;
type DownloadResultTab = 'formats' | 'outputs';
type DownloadHistoryItem = {
  ownerJobId?: string;
  sourceTitle?: string;
  option?: DownloadOption;
  stage?: CreatorStageRun;
  artifact?: CreatorArtifact;
};
type DownloadArtifactPreview = {
  artifactId: string;
  status: 'loading' | 'ready' | 'failed';
  objectUrl?: string;
};

export default function VideoDownloadWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  runtimeDependencies?: RuntimeDependenciesController;
  onOpenRuntimeComponents?(): void;
  batch?: VideoDownloadBatchView;
}) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const session = useOptionalCreatorSession();
  const [url, setUrl] = useState(() => readString(session?.state.sourceUrl) ?? '');
  const [mediaType, setMediaType] = useState<DownloadMediaType>(
    () => session?.state.mediaType === 'subtitle' ? 'subtitle' : session?.state.mediaType === 'audio' ? 'audio' : 'video'
  );
  const [selectedOptionId, setSelectedOptionId] = useState(
    () => readString(session?.state.selectedOptionId) ?? ''
  );
  const [currentStep, setCurrentStep] = useState<DownloadStep>(0);
  const [resultTab, setResultTab] = useState<DownloadResultTab>('formats');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [thumbnailDownloading, setThumbnailDownloading] = useState(false);
  const thumbnailDownloadPendingRef = useRef(false);
  const [submittingOptionIds, setSubmittingOptionIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const submittingOptionIdsRef = useRef(new Set<string>());
  const downloadSubmissionTailRef = useRef<Promise<void>>(Promise.resolve());
  const downloadControlsRef = useRef(new Set<string>());
  const [downloadControlsPending, setDownloadControlsPending] = useState<ReadonlySet<string>>(() => new Set());
  const [taskControlPending, setTaskControlPending] = useState<
    'canceling' | 'resuming'
  >();
  const [ytDlpRecoveryError, setYtDlpRecoveryError] = useState('');
  const [artifactPreview, setArtifactPreview] = useState<DownloadArtifactPreview>();
  const artifactPreviewRequestRef = useRef(0);
  const artifactPreviewUrlRef = useRef<string>();
  const artifactPreviewMediaRef = useRef<HTMLMediaElement | null>(null);

  const probeArtifact = useMemo(
    () => latestMatchingProbe(session?.job.artifacts ?? [], url),
    [session?.job.artifacts, url]
  );
  const probe = useMemo(
    () => probeArtifact === undefined || props.batch?.hasSelectedSource === false
      ? undefined
      : readDownloadProbe(probeArtifact.metadata),
    [probeArtifact, props.batch?.hasSelectedSource]
  );
  const legacy = (session?.job.templateVersion ?? 2) < 2;
  const options = useMemo(() => {
    const available = (probe?.options ?? []).filter(option => !legacy || option.mediaType === 'video');
    return [
      ...available.filter(option => option.mediaType !== 'subtitle'),
      ...prioritizeSubtitleOptions(available.filter(option => option.mediaType === 'subtitle'), language)
    ];
  }, [language, legacy, probe?.options]);
  const selectedOption = options.find(option => option.id === selectedOptionId);
  const mediaOptions = options.filter(option => option.mediaType === mediaType);
  const audioLanguages = availableAudioLanguages(mediaOptions);
  const selectedAudioLanguage = selectedOption?.mediaType === mediaType
    && selectedOption.audioLanguage !== undefined
    && audioLanguages.includes(selectedOption.audioLanguage)
    ? selectedOption.audioLanguage
    : audioLanguages[0];
  const visibleOptions = selectedAudioLanguage === undefined
    ? mediaOptions
    : mediaOptions.filter(option => option.audioLanguage === selectedAudioLanguage);
  const downloadArtifacts = useMemo(
    () => (session?.job.artifacts ?? [])
      .filter(artifact => (
        artifact.status === 'completed'
        && (artifact.kind === 'source_video' || artifact.kind === 'source_audio' || artifact.kind === 'source_subtitle')
      ))
      .sort(compareArtifactFreshness),
    [session?.job.artifacts]
  );
  const seenDownloadArtifactIdsRef = useRef(
    new Set(downloadArtifacts.map(artifact => artifact.id))
  );
  const downloadedOptionIds = useMemo(
    () => downloadedOptionsForProbe(
      downloadArtifacts,
      probeArtifact,
      probe
    ),
    [downloadArtifacts, probe, probeArtifact]
  );
  const activeStages = useMemo(
    () => (session?.job.stages ?? []).filter(stage => (
      stage.status === 'queued' || stage.status === 'running'
    )),
    [session?.job.stages]
  );
  const activeStage = activeStages.at(-1);
  const downloadStages = useMemo(
    () => (session?.job.stages ?? []).filter(stage => (
      stage.stageId === 'download'
      && downloadStageMatchesProbe(stage, probeArtifact, probe)
    )),
    [probe, probeArtifact, session?.job.stages]
  );
  const latestDownloadStageByOption = useMemo(
    () => downloadStageByOption(downloadStages),
    [downloadStages]
  );
  const activeDownloadStages = downloadStages.filter(stage => (
    stage.status === 'queued' || stage.status === 'running'
  ));
  const hasActiveDownloads = activeDownloadStages.length > 0
    || submittingOptionIds.size > 0;
  const historyItems = useMemo(
    () => props.batch === undefined ? downloadHistoryItems(
      options,
      downloadStages,
      downloadArtifacts,
      probeArtifact,
      probe
    ) : props.batch.jobs.flatMap(job => {
      const sourceUrl = readString(job.state.sourceUrl) ?? '';
      const sourceProbeArtifact = latestMatchingProbe(job.artifacts, sourceUrl);
      const sourceProbe = sourceProbeArtifact === undefined ? undefined : readDownloadProbe(sourceProbeArtifact.metadata);
      const artifacts = job.artifacts.filter(artifact => artifact.status === 'completed'
        && (artifact.kind === 'source_video' || artifact.kind === 'source_audio' || artifact.kind === 'source_subtitle')).sort(compareArtifactFreshness);
      return downloadHistoryItems(sourceProbe?.options ?? [],
        job.stages.filter(stage => stage.stageId === 'download'), artifacts, sourceProbeArtifact, sourceProbe)
        .map(item => ({ ...item, ownerJobId: job.id, sourceTitle: sourceProbe?.title ?? sourceUrl }));
    }),
    [downloadArtifacts, downloadStages, options, probe, probeArtifact, props.batch?.jobs]
  );
  const latestTaskStage = session?.job.stages.at(-1);
  const resumableStage = ((latestTaskStage?.progress.downloadControl === 'paused' && latestTaskStage.status === 'running') || latestTaskStage?.status === 'canceled'
    || latestTaskStage?.status === 'interrupted') && latestTaskStage.progress.downloadControl !== 'canceled'
    ? latestTaskStage
    : undefined;
  const failedStage = latestTaskStage?.status === 'failed'
    ? latestTaskStage
    : undefined;
  const ytDlpUpdateSuggested = shouldSuggestYtDlpUpdate(failedStage);
  const probing = activeStages.some(stage => stage.stageId === 'probe');
  const validUrl = isSupportedUrl(url);
  const platform = probe === undefined
    ? platformFor(url, l)
    : probe.platform === 'bilibili'
      ? 'Bilibili'
      : probe.platform === 'x' ? 'X'
        : probe.platform === 'tiktok' ? 'TikTok'
          : probe.platform === 'instagram' ? 'Instagram'
            : probe.platform === 'douyin' ? l('抖音', 'Douyin')
              : probe.platform === 'facebook' ? 'Facebook'
                : probe.platform === 'xiaohongshu' ? l('小红书', 'Xiaohongshu')
                  : probe.platform === 'pinterest' ? 'Pinterest'
                    : probe.platform === 'reddit' ? 'Reddit' : 'YouTube';
  const context = probe === undefined
    ? validUrl
      ? `${platform} · ${probing ? l('正在解析', 'Analyzing') : l('待解析', 'Waiting to analyze')}`
      : l('等待公开视频链接', 'Waiting for a public video link')
    : `${platform} · ${formatDuration(probe.duration)} · ${options.length} ${l('种规格', 'formats')}`;
  const currentIssue = error
    || session?.error?.message
    || (failedStage === undefined
      ? undefined
      : formatDownloadError(
          new Error(`${failedStage.errorCode ?? ''}: ${failedStage.errorMessage ?? ''}`),
          l
        ));

  useEffect(() => {
    const sourceUrl = readString(session?.state.sourceUrl);
    if (sourceUrl !== undefined && sourceUrl !== url) {
      setUrl(sourceUrl);
    }
  }, [session?.state.sourceUrl, url]);

  useEffect(() => {
    if (probe === undefined) return;
    setCurrentStep(1);
    setResultTab('formats');
  }, [probeArtifact?.id]);

  useEffect(() => {
    if (probe === undefined || probeArtifact === undefined) return;
    const newArtifacts = downloadArtifacts.filter(artifact => (
      !seenDownloadArtifactIdsRef.current.has(artifact.id)
      && artifactMatchesProbe(artifact, probeArtifact, probe)
    ));
    if (newArtifacts.length === 0) return;
    for (const artifact of newArtifacts) {
      seenDownloadArtifactIdsRef.current.add(artifact.id);
    }
    setCurrentStep(1);
    setResultTab('outputs');
  }, [downloadArtifacts, probe, probeArtifact]);

  useEffect(() => {
    if (probe === undefined) return;
    if (selectedOption !== undefined) return;
    const preferred = options.find(option => option.mediaType === mediaType)
      ?? options[0];
    if (preferred === undefined) return;
    setMediaType(preferred.mediaType);
    setSelectedOptionId(preferred.id);
    if (legacy) {
      session?.updateDraft({
        mediaType: preferred.mediaType,
        selectedOptionId: preferred.id,
        ...(preferred.videoFormatId === undefined
          ? {}
          : { formatId: preferred.videoFormatId })
      }, { semantic: true });
    }
  }, [
    legacy,
    mediaType,
    options,
    probe,
    selectedOption,
    session?.updateDraft
  ]);

  useEffect(() => {
    if (resultTab === 'outputs') return;
    artifactPreviewRequestRef.current += 1;
    releaseArtifactPreviewUrl();
    setArtifactPreview(undefined);
  }, [resultTab]);

  useEffect(() => () => {
    artifactPreviewRequestRef.current += 1;
    releaseArtifactPreviewUrl();
  }, []);

  useEffect(() => {
    if (artifactPreview?.status !== 'ready') return;
    const playback = artifactPreviewMediaRef.current?.play();
    if (playback !== undefined) void playback.catch(() => undefined);
  }, [
    artifactPreview?.artifactId,
    artifactPreview?.objectUrl,
    artifactPreview?.status
  ]);

  function updateUrl(value: string) {
    const sourceUrl = extractDouyinShareUrl(value);
    setUrl(sourceUrl);
    setSelectedOptionId('');
    setCurrentStep(0);
    setResultTab('formats');
    setNotice('');
    setError('');
    session?.updateDraft({
      sourceUrl,
      selectedOptionId: null
    });
  }

  async function analyze() {
    if (probing || hasActiveDownloads) return;
    if (!validUrl) {
      setError(l(
        '请输入有效的 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书、Pinterest 或 Reddit 公开视频链接',
        'Enter a valid public YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, or Reddit video URL'
      ));
      return;
    }
    if (session === null) {
      setError(l(
        '视频下载服务暂不可用，请检查 Runtime 连接',
        'Video download is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    setError('');
    setNotice('');
    session.updateDraft({
      sourceUrl: url.trim(),
      selectedOptionId: null
    }, { semantic: true });
    try {
      await session.flush();
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'probe' }
      });
      setNotice(l(
        '解析任务已提交，真实规格返回后会自动显示',
        'Analysis started. Available formats will appear automatically.'
      ));
    } catch (caught) {
      setError(formatDownloadError(caught, l));
    }
  }

  function selectMediaType(next: DownloadMediaType) {
    const preferred = options.find(option => option.mediaType === next);
    if (preferred === undefined) return;
    selectOption(preferred);
  }

  function selectAudioLanguage(next: string) {
    const candidates = options.filter(option => (
      option.mediaType === mediaType
      && option.audioLanguage === next
    ));
    const preferred = candidates.find(option => sameDownloadProfile(
      option,
      selectedOption
    )) ?? candidates[0];
    if (preferred !== undefined) selectOption(preferred);
  }

  function selectOption(option: DownloadOption) {
    setMediaType(option.mediaType);
    setSelectedOptionId(option.id);
    setError('');
    if (legacy) {
      session?.updateDraft({
        mediaType: option.mediaType,
        selectedOptionId: option.id,
        ...(option.videoFormatId === undefined
          ? {}
          : { formatId: option.videoFormatId })
      }, { semantic: true });
    }
  }

  function startDownload(option: DownloadOption) {
    const latestStageForOption = latestDownloadStageByOption.get(option.id);
    if (
      probing
      || session === null
      || downloadedOptionIds.has(option.id)
      || submittingOptionIdsRef.current.has(option.id)
      || latestStageForOption?.status === 'queued'
      || latestStageForOption?.status === 'running'
    ) {
      return;
    }
    submittingOptionIdsRef.current.add(option.id);
    setSubmittingOptionIds(new Set(submittingOptionIdsRef.current));
    setMediaType(option.mediaType);
    setSelectedOptionId(option.id);
    setError('');
    setNotice('');
    const sourceUrl = probe?.requestedUrl ?? url.trim();
    const work = downloadSubmissionTailRef.current
      .catch(() => undefined)
      .then(async () => {
        await session.applyAction({
          actor: 'user',
          action: 'run-stage',
          input: {
            stageId: 'download',
            optionId: option.id,
            mediaType: option.mediaType,
            sourceUrl
          }
        });
        setResultTab('outputs');
        setNotice(l(
          '下载任务已加入队列，完成后文件会保存到当前项目',
          'Download queued. The file will be saved to this project.'
        ));
      })
      .catch(caught => {
        setError(formatDownloadError(caught, l));
      })
      .finally(() => {
        submittingOptionIdsRef.current.delete(option.id);
        setSubmittingOptionIds(new Set(submittingOptionIdsRef.current));
      });
    downloadSubmissionTailRef.current = work;
  }

  async function downloadThumbnail() {
    if (session === null || probeArtifact === undefined || probe?.thumbnailUrl == null || thumbnailDownloadPendingRef.current) return;
    thumbnailDownloadPendingRef.current = true;
    setThumbnailDownloading(true);
    setError('');
    try {
      const response = await session.openDownloadThumbnail(probeArtifact.id);
      if (!response.ok) throw new Error('thumbnail_download_failed');
      const blob = await response.blob();
      if (!blob.size || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('thumbnail_download_failed');
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
      const title = probe.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'thumbnail';
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${title}-thumbnail.${extension}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice(l('封面下载已开始', 'Thumbnail download started'));
    } catch (cause) {
      const message = l('封面下载失败，请稍后重试', 'Could not download the thumbnail. Try again.');
      session.captureCreatorFailure('video-download.download-thumbnail', cause, message);
      setError(message);
    } finally {
      thumbnailDownloadPendingRef.current = false;
      setThumbnailDownloading(false);
    }
  }

  async function downloadArtifact(artifact: CreatorArtifact) {
    try {
      const owner = artifactSession(artifact);
      const objectUrl = await createCreatorArtifactObjectUrl(
        owner,
        artifact.id,
        'video-download.download-artifact',
        l('文件下载失败，请稍后重试。', 'The file download failed. Try again later.')
      );
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = artifactFileName(artifact);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice(l('文件下载已开始', 'File download started'));
    } catch (caught) {
      setError(formatDownloadError(caught, l));
    }
  }

  function artifactSession(artifact: CreatorArtifact) {
    const owner = props.batch === undefined ? session : props.batch.resolveSession(artifact.jobId);
    if (owner === null || owner === undefined) throw new Error(l('文件所属任务尚未加载，请稍后重试', 'The file task is still loading. Try again shortly.'));
    return owner;
  }

  function releaseArtifactPreviewUrl() {
    if (artifactPreviewUrlRef.current === undefined) return;
    URL.revokeObjectURL(artifactPreviewUrlRef.current);
    artifactPreviewUrlRef.current = undefined;
  }

  function closeArtifactPreview() {
    artifactPreviewRequestRef.current += 1;
    releaseArtifactPreviewUrl();
    setArtifactPreview(undefined);
  }

  async function openArtifactPreview(artifact: CreatorArtifact) {
    const requestId = artifactPreviewRequestRef.current + 1;
    artifactPreviewRequestRef.current = requestId;
    releaseArtifactPreviewUrl();
    setArtifactPreview({
      artifactId: artifact.id,
      status: 'loading'
    });
    try {
      const objectUrl = await createCreatorArtifactObjectUrl(
        artifactSession(artifact),
        artifact.id,
        'video-download.load-artifact-preview',
        l('文件预览加载失败，请稍后重试。', 'The file preview failed to load. Try again later.')
      );
      if (artifactPreviewRequestRef.current !== requestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      artifactPreviewUrlRef.current = objectUrl;
      setArtifactPreview({
        artifactId: artifact.id,
        status: 'ready',
        objectUrl
      });
    } catch (caught) {
      if (artifactPreviewRequestRef.current !== requestId) return;
      setError(formatDownloadError(caught, l));
      setArtifactPreview({
        artifactId: artifact.id,
        status: 'failed'
      });
    }
  }

  function toggleArtifactPreview(artifact: CreatorArtifact) {
    if (artifactPreview?.artifactId === artifact.id) {
      closeArtifactPreview();
      return;
    }
    void openArtifactPreview(artifact);
  }

  function handleArtifactPreviewError(artifact: CreatorArtifact) {
    const artifactId = artifact.id;
    if (artifactPreview?.artifactId !== artifactId) return;
    artifactSession(artifact).captureCreatorFailure(
      'video-download.play-artifact-preview',
      new Error('artifact_preview_playback_failed'),
      l('文件预览播放失败，可重新加载或保存到本机。', 'The preview could not play. Reload it or save the file locally.')
    );
    artifactPreviewRequestRef.current += 1;
    releaseArtifactPreviewUrl();
    setArtifactPreview({
      artifactId,
      status: 'failed'
    });
  }

  function downloadSession(item: DownloadHistoryItem) {
    return item.ownerJobId === undefined ? session : props.batch?.resolveSession(item.ownerJobId);
  }

  async function controlDownload(item: DownloadHistoryItem, action: 'pause' | 'resume' | 'cancel') {
    const owner = downloadSession(item);
    const stage = item.stage;
    if (!owner?.controlDownload || !stage || downloadControlsRef.current.has(stage.id)) return;
    downloadControlsRef.current.add(stage.id);
    setDownloadControlsPending(new Set(downloadControlsRef.current));
    setError('');
    setNotice('');
    try {
      await owner.controlDownload(stage.id, action);
    } catch (caught) {
      setError(formatDownloadError(caught, l));
    } finally {
      downloadControlsRef.current.delete(stage.id);
      setDownloadControlsPending(new Set(downloadControlsRef.current));
    }
  }

  async function cancelTask() {
    if (session === null || activeStage === undefined || taskControlPending) return;
    setTaskControlPending('canceling');
    setError('');
    try {
      await session.cancelJob();
    } catch (caught) {
      setError(formatDownloadError(caught, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || resumableStage === undefined || taskControlPending) return;
    setTaskControlPending('resuming');
    setError('');
    try {
      await session.resumeJob();
    } catch (caught) {
      setError(formatDownloadError(caught, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function updateYtDlpAndRetry() {
    if (
      props.runtimeDependencies === undefined
      || props.runtimeDependencies.phase !== 'idle'
      || failedStage === undefined
    ) {
      return;
    }
    const previousVersion = props.runtimeDependencies.ytDlpStatus?.currentVersion;
    setYtDlpRecoveryError('');
    setError('');
    setNotice('');
    try {
      const status = await props.runtimeDependencies.updateYtDlp();
      const updated = previousVersion !== undefined
        && previousVersion !== status.currentVersion;
      await retryYtDlpStage(failedStage);
      setNotice(updated
        ? l(
            `yt-dlp 已更新到 ${status.currentVersion}，任务已重新提交`,
            `yt-dlp was updated to ${status.currentVersion} and the task was retried`
          )
        : l(
            'yt-dlp 已是最新版本，任务已重新提交',
            'yt-dlp is current and the task was retried'
          ));
    } catch (caught) {
      session?.captureCreatorFailure('video-download.update-yt-dlp', caught, formatYtDlpUpdateError(caught, l));
      setYtDlpRecoveryError(formatYtDlpUpdateError(caught, l));
    }
  }

  async function retryYtDlpStage(stage: CreatorStageRun) {
    if (session === null) throw new Error('creator runtime unavailable');
    if (stage.stageId === 'probe') {
      session.updateDraft({
        sourceUrl: url.trim(),
        selectedOptionId: null
      }, { semantic: true });
      await session.flush();
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'probe' }
      });
      return;
    }
    const optionId = readString(stage.progress.optionId);
    const mediaType = stage.progress.mediaType;
    const sourceUrl = readString(stage.progress.sourceUrl) ?? url.trim();
    if (
      stage.stageId !== 'download'
      || optionId === undefined
      || (mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'subtitle')
    ) {
      throw new Error('failed download stage cannot be retried');
    }
    await session.applyAction({
      actor: 'user',
      action: 'run-stage',
      input: {
        stageId: 'download',
        optionId,
        mediaType,
        sourceUrl
      }
    });
    setResultTab('outputs');
  }

  const resultToolbar = (
    <div className="video-result-toolbar video-download-result-toolbar">
      <div className="video-result-tabs" role="tablist" aria-label={l('下载结果类型', 'Download result types')}>
        <button type="button" role="tab" aria-selected={resultTab === 'formats'} onClick={() => setResultTab('formats')}>
          <Download size={15} strokeWidth={1.8} aria-hidden="true" />
          {l('下载规格', 'Formats')}
        </button>
        <button type="button" role="tab" aria-selected={resultTab === 'outputs'} onClick={() => setResultTab('outputs')}>
          <PackageOpen size={15} strokeWidth={1.8} aria-hidden="true" />
          {l('作品', 'Works')}
        </button>
      </div>
      {props.batch?.toolbarActions}
    </div>
  );

  return (
    <CreatorToolShell
      title={l('视频下载', 'Video Downloader')}
      pageClassName="video-download-workspace-page"
      subtitle={l(
        '解析公开链接并把视频或音频保存到项目',
        'Analyze a public link and save video or audio to the project'
      )}
      context={context}
      taskSummary={probe === undefined ? undefined : <CreatorTaskSummary
        sourceIcon={Link2}
        sourceLabel={l('视频链接', 'Video link')}
        sourceValue={url}
        items={[
          { label: l('来源平台', 'Platform'), value: platform },
          { label: l('可用规格', 'Formats'), value: String(options.length) },
          {
            label: l('当前选择', 'Selected'),
            value: selectedOption === undefined
              ? l('未选择', 'Not selected')
              : optionLabel(selectedOption, l)
          },
          { label: l('作品', 'Works'), value: String(downloadArtifacts.length) }
        ]}
        compactSummary={`${platform} · ${selectedOption === undefined ? l('未选择', 'Not selected') : optionLabel(selectedOption, l)}`}
      />}
      suggestions={probe === undefined
        ? [l('这个链接支持哪些规格', 'Which formats are available?')]
        : [l('下载最高画质视频', 'Download the highest-quality video'), l('提取 MP3 音频', 'Extract MP3 audio')]}
      placeholder={props.promptHint ?? l(
        '粘贴 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书、Pinterest 或 Reddit 公开视频链接',
        'Paste a public YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, or Reddit video URL'
      )}
      stepLabel={activeStage?.stageId === 'probe'
        ? l('解析视频信息', 'Analyze video information')
        : activeStage?.stageId === 'download'
          ? l('下载到项目', 'Download to project')
          : l('视频下载', 'Video download')}
      currentIssue={currentIssue}
      quickActions={ytDlpUpdateSuggested ? [{
        id: 'update-yt-dlp',
        label: ytDlpRecoveryError ? l('重试更新', 'Retry update') : l('更新并重试', 'Update and retry'),
        kind: 'action',
        onAction: () => void updateYtDlpAndRetry(),
        disabled: props.runtimeDependencies?.phase !== 'idle'
      }, {
        id: 'open-runtime-components',
        label: l('前往第三方组件', 'Open third-party components'),
        kind: 'action',
        onAction: props.onOpenRuntimeComponents,
        disabled: props.onOpenRuntimeComponents === undefined
      }] : undefined}
      onCancelTask={activeStage === undefined ? undefined : cancelTask}
      onResumeTask={resumableStage === undefined ? undefined : resumeTask}
      taskControlPending={taskControlPending}
      onBack={props.onBack}
    >
      <div className="creator-tool-stack">
        {props.batch === undefined ? null : resultToolbar}
        {props.batch?.editor}
        {props.batch !== undefined && resultTab === 'formats' && probe === undefined ? props.batch.sourceList : null}
        {props.batch === undefined ? <nav
          className="video-translation-steps creator-tool-steps creator-tool-steps-two"
          aria-label={l('视频下载流程', 'Video download steps')}
        >
          <ol>
            {[l('添加链接', 'Add link'), l('选择并下载', 'Choose and download')]
              .map((step, index) => {
                const active = index === currentStep;
                const completed = index < currentStep;
                return (
                  <li key={step} data-active={active} data-completed={completed}>
                    <button
                      type="button"
                      disabled={index === 1 && probe === undefined}
                      aria-current={active ? 'step' : undefined}
                      onClick={() => setCurrentStep(index as DownloadStep)}
                    >
                      <span>
                        {completed
                          ? <Check size={13} strokeWidth={2.2} aria-hidden="true" />
                          : index + 1}
                      </span>
                      <strong>{step}</strong>
                    </button>
                  </li>
                );
              })}
          </ol>
        </nav> : null}


        {currentStep === 0 && props.batch === undefined ? (
          <section
            className="creator-tool-panel"
            aria-labelledby="video-download-source-title"
          >
            <div className="creator-tool-panel-heading">
              <div>
                <h2 id="video-download-source-title">
                  {l('公开视频链接', 'Public video link')}
                </h2>
              </div>
            </div>
            <SupportedVideoSources />
            <label className="creator-tool-url-input">
              <Link2 size={17} strokeWidth={1.8} aria-hidden="true" />
              <input
                type="url"
                value={url}
                onChange={event => updateUrl(event.target.value)}
                placeholder={l('粘贴视频链接', 'Paste a video URL')}
                aria-label={l('待下载视频链接', 'Video URL to download')}
              />
              <button
                type="button"
                disabled={probing || hasActiveDownloads}
                onClick={() => void analyze()}
              >
                {probing
                  ? <LoaderCircle className="smart-dubbing-spinner" size={15} />
                  : null}
                {probing ? l('正在解析', 'Analyzing') : l('解析链接', 'Analyze')}
              </button>
            </label>
          </section>
        ) : null}

        {(props.batch === undefined ? currentStep === 1 && probe !== undefined
          : props.batch.hasSelectedSource || historyItems.length > 0 || resultTab === 'outputs') ? (
          <section
            className="video-result-workspace download-result-workspace"
            aria-label={l('视频下载结果', 'Video download results')}
          >
            {props.batch === undefined ? resultToolbar : null}
            <div className="creator-result-layout">
              {resultTab === 'formats' && probe !== undefined ? (
                <div className="video-result-pane video-download-formats-pane">
                  <div className="video-download-formats-layout">
                    <div className="video-download-source-column">
                    {props.batch?.sourceList}
                    <div className="video-download-preview">
                      {probe.thumbnailUrl
                        ? <div className="video-download-thumbnail">
                            <VideoDownloadThumbnail key={probeArtifact?.id} src={probe.thumbnailUrl} alt={probe.title}
                              load={session && probeArtifact ? () => session.openDownloadThumbnail(probeArtifact.id) : undefined} />
                            <button type="button" className="video-download-thumbnail-button"
                              disabled={thumbnailDownloading || session === null}
                              aria-busy={thumbnailDownloading}
                              aria-label={l('下载封面', 'Download thumbnail')}
                              title={l('下载封面', 'Download thumbnail')}
                              onClick={() => void downloadThumbnail()}>
                              {thumbnailDownloading ? <LoaderCircle size={16} className="smart-dubbing-spinner" aria-hidden="true" />
                                : <Download size={16} aria-hidden="true" />}
                              <span>{l('下载封面', 'Thumbnail')}</span>
                            </button>
                          </div>
                        : (
                            <span className="video-download-preview-placeholder">
                              <FileVideo size={30} strokeWidth={1.5} />
                            </span>
                          )}
                      <div>
                        <span>{platform}</span>
                        <h2>{probe.title}</h2>
                        <p>
                          {[
                            probe.uploader,
                            formatDuration(probe.duration),
                            formatDimensions(probe.width, probe.height)
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>
                    </div>
                    <div className="video-download-format-list">
                      <header className="video-result-pane-heading">
                        <h2>{l('下载规格', 'Download formats')}</h2>
                        {props.batch === undefined ? <button type="button" onClick={() => setCurrentStep(0)}>
                          <Link2 size={15} strokeWidth={1.8} aria-hidden="true" />
                          {l('更换链接', 'Change link')}
                        </button> : null}
                      </header>
                      <div
                        className="creator-tool-segmented"
                        role="tablist"
                        aria-label={l('下载格式', 'Download format')}
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={mediaType === 'video'}
                          disabled={!options.some(option => option.mediaType === 'video')}
                          onClick={() => selectMediaType('video')}
                        >
                          <Video size={15} strokeWidth={1.8} aria-hidden="true" />
                          MP4 {l('视频', 'video')}
                        </button>
                        {!legacy ? (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={mediaType === 'audio'}
                            disabled={!options.some(option => option.mediaType === 'audio')}
                            onClick={() => selectMediaType('audio')}
                          >
                            <Music2 size={15} strokeWidth={1.8} aria-hidden="true" />
                            MP3 {l('音频', 'audio')}
                          </button>
                        ) : null}
                        {!legacy && options.some(option => option.mediaType === 'subtitle') ? (
                          <button
                            type="button"
                            role="tab"
                            aria-selected={mediaType === 'subtitle'}
                            onClick={() => selectMediaType('subtitle')}
                          >
                            <Subtitles size={15} strokeWidth={1.8} aria-hidden="true" />
                            SRT {l('字幕', 'Subtitles')}
                          </button>
                        ) : null}
                      </div>
                      {audioLanguages.length > 1 && selectedAudioLanguage !== undefined ? (
                        <label className="creator-tool-field video-download-language-field">
                          <span>{l('音频语言', 'Audio language')}</span>
                          <NativeSelect
                            aria-label={l('音频语言', 'Audio language')}
                            value={selectedAudioLanguage}
                            onChange={event => selectAudioLanguage(event.target.value)}
                          >
                            {audioLanguages.map(language => (
                              <option key={language} value={language}>
                                {audioLanguageLabel(language, l)}
                              </option>
                            ))}
                          </NativeSelect>
                        </label>
                      ) : null}
                      {visibleOptions.length > 0 ? (
                        <div className="video-download-options">
                          {visibleOptions.map(option => {
                            const downloaded = downloadedOptionIds.has(option.id);
                            const stage = latestDownloadStageByOption.get(option.id);
                            const submitting = submittingOptionIds.has(option.id);
                            const queued = submitting || stage?.status === 'queued';
                            const running = stage?.status === 'running';
                            const normalizing = running
                              && stage.progress.phase === 'normalizing_media';
                            const inProgress = queued || running;
                            return (
                              <label
                                key={option.id}
                                data-downloaded={downloaded}
                                data-status={downloaded
                                  ? 'completed'
                                  : inProgress
                                    ? 'active'
                                    : stage?.status}
                              >
                                <input
                                  type="radio"
                                  name="download-option"
                                  checked={selectedOptionId === option.id}
                                  onChange={() => selectOption(option)}
                                />
                                <span>
                                  <strong>{optionLabel(option, l)}</strong>
                                  <small>{optionDetail(option, l)}</small>
                                </span>
                                {downloaded ? (
                                  <span
                                    className="video-download-option-complete"
                                    aria-label={`${l('已完成', 'Completed')} ${optionLabel(option, l)}`}
                                  >
                                    <CheckCircle2 size={16} strokeWidth={1.9} aria-hidden="true" />
                                    {l('已完成', 'Completed')}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={probing || inProgress}
                                    onClick={() => startDownload(option)}
                                    aria-label={`${l('下载', 'Download')} ${optionLabel(option, l)}`}
                                  >
                                    {inProgress
                                      ? <LoaderCircle className="smart-dubbing-spinner" size={16} />
                                      : <Download size={16} strokeWidth={1.8} aria-hidden="true" />}
                                    {normalizing
                                      ? l('转换中', 'Converting')
                                      : running
                                        ? l('下载中', 'Downloading')
                                        : queued
                                          ? l('排队中', 'Queued')
                                      : l('下载', 'Download')}
                                  </button>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="video-result-empty">
                          <AlertCircle size={26} strokeWidth={1.5} aria-hidden="true" />
                          <strong>{l('当前没有可用规格', 'No formats are available')}</strong>
                          <button type="button" disabled={probing || hasActiveDownloads} onClick={() => props.batch === undefined ? setCurrentStep(0) : void analyze()}>
                            {l('重新解析', 'Analyze again')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {resultTab === 'formats' && probe === undefined && props.batch !== undefined ? <div className="video-result-empty" role="status">
                {probing ? <LoaderCircle size={26} className="smart-dubbing-spinner" /> : <FileVideo size={26} />}
                <strong>{probing ? l('正在解析视频', 'Analyzing video') : props.batch.hasSelectedSource
                  ? l('尚无可用规格', 'No formats available yet') : l('添加视频链接', 'Add a video link')}</strong>
              </div> : null}

              {resultTab === 'outputs' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div>
                      <h2>{l('作品', 'Works')}</h2>
                      <p>
                        {props.batch !== undefined ? l('所有链接的下载结果', 'Downloads from all links') : hasActiveDownloads
                          ? l('各规格会按队列依次下载，并在这里显示进度', 'Formats download in order and show progress here')
                          : l('当前任务保存的真实下载产物', 'Downloaded artifacts saved by this job')}
                      </p>
                    </div>
                  </header>
                  {historyItems.length > 0 ? (
                    <div className="download-record-list">
                      {historyItems.map((item, index) => {
                        const { artifact, option, stage } = item;
                        const status = artifact === undefined
                          ? stage?.status ?? 'queued'
                          : 'succeeded';
                        const percent = downloadProgressPercent(stage, artifact);
                        const active = status === 'queued' || status === 'running';
                        const paused = stage?.progress.downloadControl === 'paused' && (status === 'running' || status === 'interrupted');
                        const resumable = paused || ((status === 'canceled' || status === 'interrupted') && stage?.progress.downloadControl !== 'canceled');
                        const controllable = !legacy && stage !== undefined && downloadSession(item)?.controlDownload !== undefined;
                        const controlPending = stage !== undefined && (downloadControlsPending.has(stage.id)
                          || (active && stage.progress.cancelRequested === true));
                        const restoring = status === 'running' && !paused && stage?.progress.phase === 'preparing_download'
                          && typeof stage.progress.resumedFromStageRunId === 'string';
                        const preparing = !paused && !restoring && status === 'running'
                          && stage?.progress.phase === 'preparing_download';
                        const previewOpen = artifact !== undefined
                          && artifactPreview?.artifactId === artifact.id;
                        const fileName = artifact === undefined
                          ? undefined
                          : artifactFileName(artifact);
                        return (
                          <Fragment key={`${item.ownerJobId ?? ''}:${artifact?.id ?? stage?.id ?? `${option?.id ?? 'download'}-${index}`}`}>
                          {item.ownerJobId !== undefined && historyItems[index - 1]?.ownerJobId !== item.ownerJobId
                            ? <h3 className="video-download-work-source">{item.sourceTitle}</h3> : null}
                          <div
                            className="video-result-file-row video-download-progress-row"
                            data-status={paused ? 'paused' : status}
                            key={artifact?.id ?? stage?.id ?? `${option?.id ?? 'download'}-${index}`}
                          >
                            <span aria-hidden="true">
                              {downloadHistoryIcon(item)}
                            </span>
                            <div>
                              <strong>
                                {artifact === undefined
                                  ? downloadPendingTitle(item.sourceTitle ?? probe?.title ?? url, option, l)
                                  : artifactFileName(artifact)}
                              </strong>
                              <small>
                                {artifact === undefined
                                  ? downloadStageDescription(stage, option, l)
                                  : artifactDescription(artifact, l)}
                              </small>
                              {active || resumable ? (
                                <div
                                  className="video-download-row-progress"
                                  data-indeterminate={preparing || undefined}
                                  role="progressbar"
                                  aria-label={preparing
                                    ? l('正在准备下载', 'Preparing download')
                                    : `${l('下载进度', 'Download progress')} ${Math.round(percent)}%`}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={preparing
                                    ? undefined
                                    : Math.round(percent)}
                                  aria-valuetext={preparing
                                    ? l('正在准备下载', 'Preparing download')
                                    : undefined}
                                >
                                  <span style={preparing
                                    ? undefined
                                    : { width: `${percent}%` }} />
                                </div>
                              ) : null}
                            </div>
                            {artifact === undefined ? (
                              <div className="video-download-row-controls">
                              <span className="video-download-row-status">
                                {active && stage?.progress.cancelRequested === true
                                  ? stage.progress.downloadControl === 'paused' ? l('暂停中', 'Pausing') : l('取消中', 'Canceling')
                                  : paused ? l('已暂停', 'Paused') : status === 'failed'
                                  ? l('失败', 'Failed')
                                  : status === 'canceled'
                                    ? resumable ? l('已停止', 'Stopped') : l('已取消', 'Canceled')
                                    : status === 'interrupted'
                                      ? l('已中断', 'Interrupted')
                                      : preparing
                                        ? l('准备中', 'Preparing')
                                        : `${Math.round(percent)}%`}
                              </span>
                              {paused ? <span className="video-download-row-status">{Math.round(percent)}%</span> : null}
                              {controllable && (active || resumable) ? <>
                                <button type="button" disabled={controlPending}
                                  onClick={() => void controlDownload(item, resumable ? 'resume' : 'pause')}
                                  aria-label={`${resumable ? l('继续下载', 'Resume download') : l('暂停下载', 'Pause download')} ${downloadPendingTitle(item.sourceTitle ?? probe?.title ?? url, option, l)}`}>
                                  {controlPending ? <LoaderCircle size={14} className="smart-dubbing-spinner" />
                                    : resumable ? <Play size={14} /> : <Pause size={14} />}
                                  {resumable ? l('继续', 'Resume') : l('暂停', 'Pause')}
                                </button>
                                <button type="button" disabled={controlPending} className="video-download-cancel-button"
                                  onClick={() => void controlDownload(item, 'cancel')}
                                  aria-label={`${l('取消下载', 'Cancel download')} ${downloadPendingTitle(item.sourceTitle ?? probe?.title ?? url, option, l)}`}>
                                  {l('取消', 'Cancel')}
                                </button>
                              </> : null}
                              </div>
                            ) : (
                              <div className="video-download-file-actions">
                                {artifact.kind !== 'source_subtitle' ? <button
                                  type="button"
                                  onClick={() => toggleArtifactPreview(artifact)}
                                  aria-label={previewOpen
                                    ? `${l('收起预览', 'Close preview')} ${fileName}`
                                    : artifact.kind === 'source_audio'
                                      ? `${l('播放音频', 'Play audio')} ${fileName}`
                                      : `${l('预览视频', 'Preview video')} ${fileName}`}
                                  title={previewOpen
                                    ? l('收起预览', 'Close preview')
                                    : artifact.kind === 'source_audio'
                                      ? l('播放音频', 'Play audio')
                                      : l('预览视频', 'Preview video')}
                                >
                                  {previewOpen && artifactPreview.status === 'loading'
                                    ? <LoaderCircle className="smart-dubbing-spinner" size={16} />
                                    : previewOpen
                                      ? <ChevronUp size={16} strokeWidth={1.8} />
                                      : <Play size={16} strokeWidth={1.8} />}
                                </button> : null}
                                <button
                                  type="button"
                                  onClick={() => void downloadArtifact(artifact)}
                                  aria-label={`${l('保存到本机', 'Save locally')} ${fileName}`}
                                  title={l('保存到本机', 'Save locally')}
                                >
                                  <Download size={16} strokeWidth={1.8} />
                                </button>
                              </div>
                            )}
                            {artifact !== undefined && previewOpen ? (
                              <div
                                className="video-download-media-preview"
                                data-media={artifact.kind === 'source_audio' ? 'audio' : 'video'}
                              >
                                {artifactPreview.status === 'loading' ? (
                                  <div
                                    className="video-download-media-status"
                                    role="status"
                                  >
                                    <LoaderCircle
                                      className="smart-dubbing-spinner"
                                      size={18}
                                      aria-hidden="true"
                                    />
                                    <span>
                                      {artifact.kind === 'source_audio'
                                        ? l('正在加载音频...', 'Loading audio...')
                                        : l('正在加载视频预览...', 'Loading video preview...')}
                                    </span>
                                  </div>
                                ) : artifactPreview.status === 'failed' ? (
                                  <div className="video-download-media-status" role="status">
                                    <span>
                                      {l(
                                        '可重新加载预览或保存到本机',
                                        'Reload the preview or save the file locally.'
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => void openArtifactPreview(artifact)}
                                    >
                                      <RefreshCw size={15} strokeWidth={1.8} aria-hidden="true" />
                                      {l('重新加载', 'Reload')}
                                    </button>
                                  </div>
                                ) : artifact.kind === 'source_audio' ? (
                                  <audio
                                    ref={element => {
                                      artifactPreviewMediaRef.current = element;
                                    }}
                                    autoPlay
                                    controls
                                    preload="metadata"
                                    src={artifactPreview.objectUrl}
                                    aria-label={`${l('音频播放', 'Audio playback')} ${fileName}`}
                                    onError={() => handleArtifactPreviewError(artifact)}
                                  />
                                ) : (
                                  <video
                                    ref={element => {
                                      artifactPreviewMediaRef.current = element;
                                    }}
                                    autoPlay
                                    controls
                                    preload="metadata"
                                    src={artifactPreview.objectUrl}
                                    aria-label={`${l('视频预览', 'Video preview')} ${fileName}`}
                                    onError={() => handleArtifactPreviewError(artifact)}
                                  />
                                )}
                              </div>
                            ) : null}
                          </div>
                          </Fragment>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="video-result-empty">
                      <Download size={26} strokeWidth={1.5} aria-hidden="true" />
                      <strong>{l('还没有作品', 'No works yet')}</strong>
                      <button type="button" onClick={() => setResultTab('formats')}>
                        {l('选择下载规格', 'Choose a format')}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

            </div>
          </section>
        ) : null}

        {notice ? (
          <p className="creator-tool-notice" role="status">
            <CheckCircle2 size={15} strokeWidth={1.9} />
            {notice}
          </p>
        ) : null}
        {error && !validUrl ? <p className="creator-tool-notice" role="alert">{error}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function latestMatchingProbe(
  artifacts: CreatorArtifact[],
  sourceUrl: string
): CreatorArtifact | undefined {
  const normalized = sourceUrl.trim();
  const latest = [...artifacts].reverse().find(artifact => (
    artifact.kind === 'download_probe'
    && artifact.status === 'completed'
    && readDownloadProbe(artifact.metadata) !== undefined
  ));
  return readString(latest?.metadata.requestedUrl)?.trim() === normalized
    ? latest
    : undefined;
}

function readDownloadProbe(
  metadata: Record<string, CreatorJson>
): DownloadProbe | undefined {
  if (
    typeof metadata.id !== 'string'
    || typeof metadata.title !== 'string'
    || typeof metadata.requestedUrl !== 'string'
    || typeof metadata.url !== 'string'
    || (metadata.platform !== 'youtube' && metadata.platform !== 'bilibili' && metadata.platform !== 'x' && metadata.platform !== 'tiktok' && metadata.platform !== 'instagram' && metadata.platform !== 'douyin' && metadata.platform !== 'facebook' && metadata.platform !== 'xiaohongshu' && metadata.platform !== 'pinterest' && metadata.platform !== 'reddit')
    || !Array.isArray(metadata.formats)
    || !Array.isArray(metadata.options)
  ) {
    return undefined;
  }
  const options = metadata.options
    .map(readDownloadOption)
    .filter((option): option is DownloadOption => option !== undefined);
  return {
    id: metadata.id,
    title: metadata.title,
    requestedUrl: metadata.requestedUrl,
    url: metadata.url,
    platform: metadata.platform,
    uploader: readString(metadata.uploader) ?? null,
    thumbnailUrl: readString(metadata.thumbnailUrl) ?? null,
    duration: readNumber(metadata.duration) ?? null,
    width: readNumber(metadata.width) ?? null,
    height: readNumber(metadata.height) ?? null,
    formats: [],
    options
  };
}

function readDownloadOption(value: CreatorJson): DownloadOption | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }
  if (
    typeof value.id !== 'string'
    || (value.mediaType !== 'video' && value.mediaType !== 'audio' && value.mediaType !== 'subtitle')
    || !['mp4', 'mp3', 'm4a', 'webm', 'srt'].includes(String(value.container))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    mediaType: value.mediaType,
    container: value.container as DownloadOption['container'],
    ...(typeof value.subtitleLanguage === 'string' ? { subtitleLanguage: value.subtitleLanguage } : {}),
    ...(typeof value.subtitleName === 'string' ? { subtitleName: value.subtitleName } : {}),
    ...(value.subtitleSource === 'manual' || value.subtitleSource === 'automatic' ? { subtitleSource: value.subtitleSource } : {}),
    ...(readString(value.audioLanguage) === undefined
      ? {}
      : { audioLanguage: readString(value.audioLanguage) }),
    ...(readNumber(value.width) === undefined ? {} : { width: readNumber(value.width) }),
    ...(readNumber(value.height) === undefined ? {} : { height: readNumber(value.height) }),
    ...(readNumber(value.fps) === undefined ? {} : { fps: readNumber(value.fps) }),
    ...(readNumber(value.bitrateKbps) === undefined
      ? {}
      : { bitrateKbps: readNumber(value.bitrateKbps) }),
    ...(readNumber(value.estimatedBytes) === undefined
      ? {}
      : { estimatedBytes: readNumber(value.estimatedBytes) }),
    ...(readString(value.videoFormatId) === undefined
      ? {}
      : { videoFormatId: readString(value.videoFormatId) }),
    ...(readString(value.audioFormatId) === undefined
      ? {}
      : { audioFormatId: readString(value.audioFormatId) }),
    ...(Number.isSafeInteger(value.playlistIndex) && Number(value.playlistIndex) > 0
      ? { playlistIndex: Number(value.playlistIndex) }
      : {}),
    ...(value.transcode === 'mp3' ? { transcode: 'mp3' as const } : {})
  };
}

function latestStage(
  stages: CreatorStageRun[],
  statuses: CreatorStageRun['status'][]
): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => statuses.includes(stage.status));
}

function compareArtifactFreshness(
  left: CreatorArtifact,
  right: CreatorArtifact
): number {
  return (
    Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || right.version - left.version
  );
}

function downloadedOptionsForProbe(
  artifacts: CreatorArtifact[],
  probeArtifact: CreatorArtifact | undefined,
  probe: DownloadProbe | undefined
): ReadonlySet<string> {
  if (probeArtifact === undefined || probe === undefined) return new Set();
  const requestedUrl = probe.requestedUrl.trim();
  return new Set(artifacts.flatMap(artifact => {
    const optionId = readString(artifact.metadata.optionId);
    if (optionId === undefined) return [];
    const artifactUrl = readString(artifact.metadata.requestedUrl)
      ?? readString(artifact.metadata.sourceUrl);
    const matchesProbe = artifactUrl === undefined
      ? artifact.sourceArtifactIds.includes(probeArtifact.id)
      : artifactUrl.trim() === requestedUrl;
    return matchesProbe ? [optionId] : [];
  }));
}

function downloadStageMatchesProbe(
  stage: CreatorStageRun,
  probeArtifact: CreatorArtifact | undefined,
  probe: DownloadProbe | undefined
): boolean {
  if (probeArtifact === undefined || probe === undefined) return false;
  if (stage.progress.probeArtifactId === probeArtifact.id) return true;
  const sourceUrl = readString(stage.progress.sourceUrl);
  return sourceUrl !== undefined
    && sourceUrl.trim() === probe.requestedUrl.trim();
}

function downloadStageByOption(
  stages: CreatorStageRun[]
): ReadonlyMap<string, CreatorStageRun> {
  const result = new Map<string, CreatorStageRun>();
  for (const stage of stages) {
    const optionId = readString(stage.progress.optionId);
    if (optionId !== undefined) result.set(optionId, stage);
  }
  return result;
}

function downloadHistoryItems(
  options: DownloadOption[],
  stages: CreatorStageRun[],
  artifacts: CreatorArtifact[],
  probeArtifact: CreatorArtifact | undefined,
  probe: DownloadProbe | undefined
): DownloadHistoryItem[] {
  const optionById = new Map(options.map(option => [option.id, option]));
  const currentArtifactsByOption = new Map<string, CreatorArtifact>();
  for (const artifact of artifacts) {
    const optionId = readString(artifact.metadata.optionId);
    if (
      optionId !== undefined
      && artifactMatchesProbe(artifact, probeArtifact, probe)
      && !currentArtifactsByOption.has(optionId)
    ) {
      currentArtifactsByOption.set(optionId, artifact);
    }
  }

  const items: DownloadHistoryItem[] = [];
  const representedOptionIds = new Set<string>();
  const representedArtifactIds = new Set<string>();
  for (const stage of [...stages].reverse()) {
    const optionId = readString(stage.progress.optionId);
    if (optionId === undefined || representedOptionIds.has(optionId)) continue;
    const artifact = currentArtifactsByOption.get(optionId);
    items.push({
      option: optionById.get(optionId),
      stage,
      ...(artifact === undefined ? {} : { artifact })
    });
    representedOptionIds.add(optionId);
    if (artifact !== undefined) representedArtifactIds.add(artifact.id);
  }
  for (const artifact of artifacts) {
    if (representedArtifactIds.has(artifact.id)) continue;
    const optionId = readString(artifact.metadata.optionId);
    items.push({
      ...(optionId === undefined ? {} : { option: optionById.get(optionId) }),
      artifact
    });
  }
  return items;
}

function artifactMatchesProbe(
  artifact: CreatorArtifact,
  probeArtifact: CreatorArtifact | undefined,
  probe: DownloadProbe | undefined
): boolean {
  if (probeArtifact === undefined || probe === undefined) return false;
  const sourceUrl = readString(artifact.metadata.requestedUrl)
    ?? readString(artifact.metadata.sourceUrl);
  return sourceUrl === undefined
    ? artifact.sourceArtifactIds.includes(probeArtifact.id)
    : sourceUrl.trim() === probe.requestedUrl.trim();
}

function downloadProgressPercent(
  stage: CreatorStageRun | undefined,
  artifact: CreatorArtifact | undefined
): number {
  if (artifact !== undefined || stage?.status === 'succeeded') return 100;
  const percent = readNumber(stage?.progress.percent);
  if (percent === undefined) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function downloadPendingTitle(
  title: string,
  option: DownloadOption | undefined,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  return option === undefined
    ? title
    : `${title} · ${optionLabel(option, l)}`;
}

function downloadStageDescription(
  stage: CreatorStageRun | undefined,
  option: DownloadOption | undefined,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const detail = option === undefined ? undefined : optionDetail(option, l);
  const status = stage?.progress.downloadControl === 'paused' && stage.progress.cancelRequested !== true
    && (stage.status === 'running' || stage.status === 'interrupted')
    ? l('下载已暂停，可继续下载', 'Download paused. Resume when ready.')
    : stage === undefined || stage.status === 'queued'
    ? l('等待前面的规格下载完成', 'Waiting for earlier formats')
    : stage.status === 'running'
      ? stage.progress.cancelRequested === true
        ? stage.progress.downloadControl === 'paused' ? l('正在暂停下载', 'Pausing download') : l('正在取消下载', 'Canceling download')
        : downloadPhaseLabel(stage, l)
      : stage.status === 'succeeded'
        ? l('已保存到项目', 'Saved to project')
        : stage.status === 'failed'
          ? l('下载未完成', 'Download did not complete')
          : stage.progress.downloadControl === 'paused'
            ? l('下载已暂停，可继续下载', 'Download paused. Resume when ready.')
            : stage.progress.downloadControl === 'canceled'
              ? l('下载已取消', 'Download canceled')
              : l('下载已停止，可继续下载', 'Download stopped. Resume when ready.');
  const bytesPerSecond = stage?.status === 'running' && stage.progress.downloadControl !== 'paused'
    && stage.progress.phase === 'downloading' && stage.progress.cancelRequested !== true
    ? readNumber(stage.progress.bytesPerSecond)
    : undefined;
  const speed = bytesPerSecond !== undefined && bytesPerSecond >= 0
    ? `${formatBytes(bytesPerSecond)}/s`
    : undefined;
  return [detail, status, speed].filter(Boolean).join(' · ');
}

function downloadPhaseLabel(
  stage: CreatorStageRun,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  switch (stage.progress.phase) {
    case 'preparing_download':
      return typeof stage.progress.resumedFromStageRunId === 'string'
        ? l('正在恢复下载', 'Reconnecting to resume download')
        : l('正在准备下载', 'Preparing download');
    case 'merging_media':
      return l('正在合并音视频', 'Merging video and audio');
    case 'extracting_audio':
      return l('正在提取 MP3 音频', 'Extracting MP3 audio');
    case 'normalizing_media':
      return l('正在转换为本机兼容格式', 'Converting for local playback');
    case 'validating_output':
      return l('正在检查下载文件', 'Checking the downloaded file');
    default:
      return l('正在下载到项目', 'Downloading to project');
  }
}

function downloadHistoryIcon(item: DownloadHistoryItem) {
  if (item.stage?.progress.downloadControl === 'paused' && ['running', 'interrupted'].includes(item.stage.status)) return <Pause size={18} />;
  if (item.artifact !== undefined) {
    if (item.artifact.kind === 'source_subtitle') return <Subtitles size={18} strokeWidth={1.7} />;
    return item.artifact.kind === 'source_audio'
      ? <FileAudio size={18} strokeWidth={1.7} />
      : <FileVideo size={18} strokeWidth={1.7} />;
  }
  if (item.stage?.status === 'failed') {
    return <XCircle size={18} strokeWidth={1.8} />;
  }
  if (item.stage?.status === 'canceled' || item.stage?.status === 'interrupted') {
    return <AlertCircle size={18} strokeWidth={1.8} />;
  }
  if (item.stage?.status === 'succeeded') {
    return <CheckCircle2 size={18} strokeWidth={1.8} />;
  }
  if (item.stage?.status === 'running') {
    return <LoaderCircle className="smart-dubbing-spinner" size={18} />;
  }
  return <Clock3 size={18} strokeWidth={1.8} />;
}

function optionLabel(
  option: DownloadOption,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const prefix = option.playlistIndex === undefined
    ? ''
    : `${l('视频', 'Video')} ${option.playlistIndex} · `;
  if (option.mediaType === 'subtitle') {
    return `${prefix}${option.subtitleName ?? audioLanguageLabel(option.subtitleLanguage ?? 'und', l)}`;
  }
  if (option.mediaType === 'audio') {
    return `${prefix}${option.bitrateKbps ?? 192}kbps`;
  }
  if (option.height !== undefined) return `${prefix}${option.height}p`;
  return `${prefix}${l('原始画质', 'Source quality')}`;
}

function optionDetail(
  option: DownloadOption,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const parts = [option.container.toUpperCase()];
  if (option.mediaType === 'subtitle') {
    parts.push(option.subtitleSource === 'automatic' ? l('自动字幕', 'Automatic captions') : l('人工字幕', 'Manual subtitles'));
    if (option.subtitleLanguage !== undefined) parts.push(option.subtitleLanguage);
  }
  if (option.width !== undefined && option.height !== undefined) {
    parts.push(`${option.width} x ${option.height}`);
  }
  if (option.fps !== undefined) parts.push(`${Math.round(option.fps)} FPS`);
  if (option.audioLanguage !== undefined) {
    parts.push(`${l('音频', 'Audio')}: ${audioLanguageLabel(option.audioLanguage, l)}`);
  }
  if (option.estimatedBytes !== undefined) parts.push(formatBytes(option.estimatedBytes));
  return parts.join(' · ');
}

function artifactDescription(
  artifact: CreatorArtifact,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const parts = [
    artifact.kind === 'source_subtitle' ? 'SRT' : artifact.kind === 'source_audio' ? 'MP3' : 'MP4',
    readString(artifact.metadata.subtitleLanguage) === undefined ? undefined
      : audioLanguageLabel(readString(artifact.metadata.subtitleLanguage)!, l),
    artifact.kind !== 'source_subtitle' ? undefined : artifact.metadata.subtitleSource === 'automatic'
      ? l('自动字幕', 'Automatic captions') : l('人工字幕', 'Manual subtitles'),
    readNumber(artifact.metadata.size) === undefined
      ? undefined
      : formatBytes(readNumber(artifact.metadata.size)!),
    formatDimensions(
      readNumber(artifact.metadata.width) ?? null,
      readNumber(artifact.metadata.height) ?? null
    ),
    readString(artifact.metadata.audioLanguage) === undefined
      ? undefined
      : `${l('音频', 'Audio')}: ${audioLanguageLabel(
          readString(artifact.metadata.audioLanguage)!,
          l
        )}`,
    l('已保存到项目', 'Saved to project')
  ];
  return parts.filter(Boolean).join(' · ');
}

function prioritizeSubtitleOptions(options: DownloadOption[], language: string): DownloadOption[] {
  const appLocale = subtitleLocale(language);
  const english = options.findIndex(option => subtitleLocale(option.subtitleLanguage)?.language === 'en');
  const localized = appLocale === undefined || appLocale.language === 'en' ? -1 : options.findIndex(option => {
    const locale = subtitleLocale(option.subtitleLanguage);
    return locale?.language === appLocale.language && locale.script === appLocale.script;
  });
  const promoted = [english, localized].filter(index => index >= 0);
  return [
    ...promoted.map(index => options[index]!),
    ...options.filter((_option, index) => !promoted.includes(index))
  ];
}

function subtitleLocale(language: string | undefined): Intl.Locale | undefined {
  if (language === undefined) return undefined;
  try {
    return new Intl.Locale(language.trim().replaceAll('_', '-').replace(/-orig$/i, '')).maximize();
  } catch {
    return undefined;
  }
}

function availableAudioLanguages(options: DownloadOption[]): string[] {
  const languages = new Map<string, string>();
  for (const option of options) {
    const language = option.audioLanguage?.trim();
    if (!language) continue;
    const key = language.toLocaleLowerCase();
    if (!languages.has(key)) languages.set(key, language);
  }
  return [...languages.values()];
}

function sameDownloadProfile(
  left: DownloadOption,
  right: DownloadOption | undefined
): boolean {
  if (right === undefined || left.mediaType !== right.mediaType) return false;
  return left.mediaType === 'video'
    ? left.videoFormatId === right.videoFormatId
    : left.bitrateKbps === right.bitrateKbps;
}

function audioLanguageLabel(
  language: string,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const normalized = language.trim();
  if (!normalized || normalized.toLocaleLowerCase() === 'und') {
    return l('未知', 'Unknown');
  }
  try {
    const name = new Intl.DisplayNames([l('zh-CN', 'en-US')], {
      type: 'language'
    }).of(normalized);
    return name === undefined ? normalized : `${name} (${normalized})`;
  } catch {
    return normalized;
  }
}

function artifactFileName(artifact: CreatorArtifact): string {
  return readString(artifact.metadata.fileName)
    ?? `OpenCreator-${artifact.kind}-${artifact.version}`;
}

function formatDimensions(
  width: number | null,
  height: number | null
): string {
  return width === null || height === null ? '' : `${width} x ${height}`;
}

function formatDuration(duration: number | null): string {
  if (duration === null || !Number.isFinite(duration)) return '--:--';
  const total = Math.max(0, Math.round(duration));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
    : [minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unit = Math.min(
    Math.max(0, Math.floor(Math.log(bytes) / Math.log(1_024))),
    units.length - 1
  );
  const value = bytes / 1_024 ** unit;
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function isSupportedUrl(value: string): boolean {
  return supportedVideoSourcePlatform(value) !== null;
}

function platformFor(
  value: string,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (/youtu(?:\.be|be\.com)/i.test(value)) return 'YouTube';
  if (/bilibili\.com|b23\.tv/i.test(value)) return 'Bilibili';
  if (/^https:\/\/(?:[^/]+\.)?(?:x|twitter)\.com\//i.test(value)) return 'X';
  if (/^https:\/\/(?:[^/]+\.)?tiktok\.com\//i.test(value)) return 'TikTok';
  if (/^https:\/\/(?:www\.)?instagram\.com\//i.test(value)) return 'Instagram';
  if (/^https:\/\/(?:v|www)\.douyin\.com\//i.test(value)) return l('抖音', 'Douyin');
  if (/^https:\/\/(?:www\.|m\.)?facebook\.com\//i.test(value) || /^https:\/\/fb\.watch\//i.test(value)) return 'Facebook';
  if (/^https:\/\/(?:www\.)?xiaohongshu\.com\//i.test(value)) return l('小红书', 'Xiaohongshu');
  if (/^https:\/\/(?:www\.)?pinterest\.com\//i.test(value)) return 'Pinterest';
  if (supportedVideoSourcePlatform(value) === 'reddit') return 'Reddit';
  return l('公开视频', 'Public video');
}

function readString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatDownloadError(
  caught: unknown,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/unsupported_source/i.test(message)) {
    return l(
      '当前仅支持 YouTube、Bilibili、X、TikTok、Instagram、抖音、Facebook、小红书、Pinterest 和 Reddit 公开视频',
      'Only public YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, and Reddit videos are supported'
    );
  }
  if (/download_probe_stale/i.test(message)) {
    return l('链接已变化，请重新解析后再下载', 'The URL changed. Analyze it again before downloading.');
  }
  if (/already queued or running/i.test(message)) {
    return l('该规格已在下载队列中', 'This format is already queued or running.');
  }
  if (/already been downloaded/i.test(message)) {
    return l('该规格已经下载完成', 'This format has already been downloaded.');
  }
  if (/login_required/i.test(message)) {
    return l('平台要求登录或有效 Cookie，当前无法下载', 'This video requires sign-in or fresh platform cookies.');
  }
  if (/platform_session_required/i.test(message)) {
    return l('抖音未接受浏览器会话或需要网页验证，请在设置的平台连接中重新连接抖音后重试', 'Douyin did not accept the browser session or requires website verification. Reconnect Douyin in Settings > Platform connections and retry.');
  }
  if (/platform_request_signature_required/i.test(message)) {
    return l('当前下载器尚未兼容抖音请求签名校验，请使用本地视频文件继续', 'The downloader does not yet support Douyin request signatures. Use a local video file to continue.');
  }
  if (/region_or_copyright_restricted/i.test(message)) {
    return l('该视频受地区或版权限制，当前无法下载', 'This video is region or copyright restricted.');
  }
  if (/disk_full/i.test(message)) {
    return l('磁盘空间不足，无法保存下载文件', 'There is not enough disk space to save the file.');
  }
  if (/download_playback_conversion_failed/i.test(message)) {
    return l(
      '视频兼容格式转换失败，请重新下载或选择其他清晰度',
      'The video could not be converted for local playback. Try another quality.'
    );
  }
  if (/network_unavailable/i.test(message)) {
    return l(
      '无法连接视频平台，请检查网络或代理设置后重试',
      'Unable to connect to the video platform. Check the network or proxy settings and try again.'
    );
  }
  if (/yt_dlp_update_recommended/i.test(message)) {
    return l(
      '视频平台规则可能已变化，请更新 yt-dlp 后重试',
      'The video platform may have changed. Update yt-dlp and try again.'
    );
  }
  return l('视频下载失败，请在 Agent 区域查看诊断后重试', 'Video download failed. Review the diagnosis in the Agent panel and retry.');
}

function shouldSuggestYtDlpUpdate(stage: CreatorStageRun | undefined): boolean {
  return stage?.errorCode === 'yt_dlp_update_recommended';
}

function formatYtDlpUpdateError(
  caught: unknown,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/creator_yt_dlp_update_download_failed/i.test(message)) {
    return l(
      '无法下载 yt-dlp 更新，请检查网络或代理设置',
      'Unable to download the yt-dlp update. Check the network or proxy settings.'
    );
  }
  if (/creator_yt_dlp_update_verification_failed/i.test(message)) {
    return l(
      'yt-dlp 更新校验失败，已继续使用当前版本',
      'The yt-dlp update failed verification. The current version is still active.'
    );
  }
  if (/creator_yt_dlp_update_storage_failed/i.test(message)) {
    return l(
      '无法保存 yt-dlp 更新，请检查本机存储权限和剩余空间',
      'Unable to save the yt-dlp update. Check storage permissions and free space.'
    );
  }
  return l(
    '暂时无法检查 yt-dlp 更新，请稍后重试',
    'Unable to check for yt-dlp updates right now. Try again later.'
  );
}
