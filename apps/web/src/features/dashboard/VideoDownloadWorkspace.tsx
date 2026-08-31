import type {
  CreatorArtifact,
  CreatorJson,
  CreatorStageRun,
  DownloadMediaType,
  DownloadOption,
  DownloadProbe
} from '@opencreator/protocol';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileAudio,
  FileVideo,
  Link2,
  LoaderCircle,
  Music2,
  RefreshCw,
  Settings2,
  Video,
  XCircle
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useOptionalCreatorSession } from './creator-session-store.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';

type DownloadStep = 0 | 1;
type DownloadResultTab = 'info' | 'formats' | 'history';
type DownloadHistoryItem = {
  option?: DownloadOption;
  stage?: CreatorStageRun;
  artifact?: CreatorArtifact;
};

export default function VideoDownloadWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  runtimeDependencies?: RuntimeDependenciesController;
  onOpenRuntimeComponents?(): void;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [url, setUrl] = useState(() => readString(session?.state.sourceUrl) ?? '');
  const [mediaType, setMediaType] = useState<DownloadMediaType>(
    () => session?.state.mediaType === 'audio' ? 'audio' : 'video'
  );
  const [selectedOptionId, setSelectedOptionId] = useState(
    () => readString(session?.state.selectedOptionId) ?? ''
  );
  const [currentStep, setCurrentStep] = useState<DownloadStep>(0);
  const [resultTab, setResultTab] = useState<DownloadResultTab>('formats');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submittingOptionIds, setSubmittingOptionIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const submittingOptionIdsRef = useRef(new Set<string>());
  const downloadSubmissionTailRef = useRef<Promise<void>>(Promise.resolve());
  const [taskControlPending, setTaskControlPending] = useState<
    'canceling' | 'resuming'
  >();
  const [ytDlpRecoveryError, setYtDlpRecoveryError] = useState('');

  const probeArtifact = useMemo(
    () => latestMatchingProbe(session?.job.artifacts ?? [], url),
    [session?.job.artifacts, url]
  );
  const probe = useMemo(
    () => probeArtifact === undefined
      ? undefined
      : readDownloadProbe(probeArtifact.metadata),
    [probeArtifact]
  );
  const legacy = (session?.job.templateVersion ?? 2) < 2;
  const options = useMemo(() => (
    (probe?.options ?? []).filter(option => !legacy || option.mediaType === 'video')
  ), [legacy, probe?.options]);
  const visibleOptions = options.filter(option => option.mediaType === mediaType);
  const selectedOption = options.find(option => option.id === selectedOptionId);
  const downloadArtifacts = useMemo(
    () => (session?.job.artifacts ?? [])
      .filter(artifact => (
        artifact.status === 'completed'
        && (artifact.kind === 'source_video' || artifact.kind === 'source_audio')
      ))
      .sort(compareArtifactFreshness),
    [session?.job.artifacts]
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
    () => downloadHistoryItems(
      options,
      downloadStages,
      downloadArtifacts,
      probeArtifact,
      probe
    ),
    [downloadArtifacts, downloadStages, options, probe, probeArtifact]
  );
  const latestTaskStage = session?.job.stages.at(-1);
  const resumableStage = latestTaskStage?.status === 'canceled'
    || latestTaskStage?.status === 'interrupted'
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
      : 'YouTube';
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
    if (sourceUrl !== undefined && sourceUrl !== url && !url.trim()) {
      setUrl(sourceUrl);
    }
  }, [session?.state.sourceUrl, url]);

  useEffect(() => {
    if (probe === undefined) return;
    setCurrentStep(1);
    setResultTab('formats');
  }, [probeArtifact?.id]);

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

  function updateUrl(value: string) {
    setUrl(value);
    setSelectedOptionId('');
    setCurrentStep(0);
    setResultTab('formats');
    setNotice('');
    setError('');
    session?.updateDraft({
      sourceUrl: value,
      selectedOptionId: null
    });
  }

  async function analyze() {
    if (probing || hasActiveDownloads) return;
    if (!validUrl) {
      setError(l(
        '请输入有效的 YouTube 或 Bilibili 公公开视频链接',
        'Enter a valid public YouTube or Bilibili video URL'
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
        setResultTab('history');
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

  async function downloadArtifact(artifact: CreatorArtifact) {
    if (session === null) return;
    try {
      const response = await session.openArtifact(artifact.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
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
      || (mediaType !== 'video' && mediaType !== 'audio')
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
    setResultTab('history');
  }

  return (
    <CreatorToolShell
      title={l('视频下载', 'Video Downloader')}
      subtitle={l(
        '解析公开链接并把视频或音频保存到项目',
        'Analyze a public link and save video or audio to the project'
      )}
      context={context}
      suggestions={probe === undefined
        ? [l('这个链接支持哪些规格', 'Which formats are available?')]
        : [l('下载最高画质视频', 'Download the highest-quality video'), l('提取 MP3 音频', 'Extract MP3 audio')]}
      placeholder={props.promptHint ?? l(
        '粘贴 YouTube 或 Bilibili 公公开视频链接',
        'Paste a public YouTube or Bilibili video URL'
      )}
      stepLabel={activeStage?.stageId === 'probe'
        ? l('解析视频信息', 'Analyze video information')
        : activeStage?.stageId === 'download'
          ? l('下载到项目', 'Download to project')
          : l('视频下载', 'Video download')}
      currentIssue={currentIssue}
      onCancelTask={activeStage === undefined ? undefined : cancelTask}
      onResumeTask={resumableStage === undefined ? undefined : resumeTask}
      taskControlPending={taskControlPending}
      onBack={props.onBack}
    >
      <div className="creator-tool-stack">
        <nav
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
        </nav>

        {ytDlpUpdateSuggested ? (
          <div
            className="video-download-runtime-notice"
            data-tone={ytDlpRecoveryError ? 'danger' : 'warning'}
            role={ytDlpRecoveryError ? 'alert' : 'status'}
          >
            <span aria-hidden="true">
              {props.runtimeDependencies?.phase === 'updating'
                ? <LoaderCircle className="smart-dubbing-spinner" size={17} />
                : <AlertCircle size={17} strokeWidth={1.8} />}
            </span>
            <div>
              <strong>{l(
                '视频平台规则可能已变化',
                'The video platform may have changed'
              )}</strong>
              <small>
                {ytDlpRecoveryError || l(
                  '建议更新解析器后重新执行刚才的任务',
                  'Update the extractor and retry the failed task'
                )}
              </small>
            </div>
            <div className="video-download-runtime-actions">
              <button
                type="button"
                disabled={
                  props.runtimeDependencies === undefined
                  || props.runtimeDependencies.phase !== 'idle'
                }
                onClick={() => void updateYtDlpAndRetry()}
              >
                {props.runtimeDependencies?.phase === 'updating'
                  ? <LoaderCircle className="smart-dubbing-spinner" size={15} />
                  : <RefreshCw size={15} strokeWidth={1.8} />}
                {ytDlpRecoveryError
                  ? l('重试更新', 'Retry update')
                  : l('更新并重试', 'Update and retry')}
              </button>
              <button
                type="button"
                onClick={props.onOpenRuntimeComponents}
                disabled={props.onOpenRuntimeComponents === undefined}
              >
                <Settings2 size={15} strokeWidth={1.8} />
                {l('前往本机组件', 'Open local components')}
              </button>
            </div>
          </div>
        ) : null}

        {currentStep === 0 ? (
          <section
            className="creator-tool-panel"
            aria-labelledby="video-download-source-title"
          >
            <div className="creator-tool-panel-heading">
              <div>
                <h2 id="video-download-source-title">
                  {l('公开视频链接', 'Public video link')}
                </h2>
                <p>
                  {l(
                    '当前支持 YouTube 和 Bilibili 单个公开视频',
                    'Supports individual public YouTube and Bilibili videos'
                  )}
                </p>
              </div>
            </div>
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

        {currentStep === 1 && probe !== undefined ? (
          <section
            className="video-result-workspace download-result-workspace"
            aria-label={l('视频下载结果', 'Video download results')}
          >
            <div className="video-result-toolbar">
              <div
                className="video-result-tabs"
                role="tablist"
                aria-label={l('下载结果类型', 'Download result types')}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultTab === 'info'}
                  onClick={() => setResultTab('info')}
                >
                  <Video size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('视频信息', 'Video info')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultTab === 'formats'}
                  onClick={() => setResultTab('formats')}
                >
                  <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('下载规格', 'Formats')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultTab === 'history'}
                  onClick={() => setResultTab('history')}
                >
                  <CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('项目文件', 'Project files')}
                </button>
              </div>
            </div>
            <div className="creator-result-layout">
              {resultTab === 'info' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div>
                      <h2>{l('视频信息', 'Video information')}</h2>
                      <p>{l('来自真实链接解析结果', 'From the live URL analysis')}</p>
                    </div>
                    <button type="button" onClick={() => setCurrentStep(0)}>
                      <Link2 size={15} strokeWidth={1.8} aria-hidden="true" />
                      {l('更换链接', 'Change link')}
                    </button>
                  </header>
                  <div className="video-download-preview">
                    {probe.thumbnailUrl
                      ? <img src={probe.thumbnailUrl} alt={probe.title} />
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
              ) : null}

              {resultTab === 'formats' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div>
                      <h2>{l('下载规格', 'Download formats')}</h2>
                      <p>
                        {legacy
                          ? l('旧版任务仅支持视频下载', 'Legacy jobs support video downloads only')
                          : l('选择视频清晰度或提取 MP3 音频', 'Choose video quality or extract MP3 audio')}
                      </p>
                    </div>
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
                  </div>
                  {visibleOptions.length > 0 ? (
                    <div className="video-download-options">
                      {visibleOptions.map((option, index) => {
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
                              <small>{optionDetail(option)}</small>
                            </span>
                            {index === 0
                              ? <small>{l('推荐', 'Recommended')}</small>
                              : null}
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
                      <button type="button" onClick={() => setCurrentStep(0)}>
                        {l('重新解析', 'Analyze again')}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              {resultTab === 'history' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div>
                      <h2>{l('项目文件', 'Project files')}</h2>
                      <p>
                        {hasActiveDownloads
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
                        const preparing = status === 'running'
                          && stage?.progress.phase === 'preparing_download';
                        return (
                          <div
                            className="video-result-file-row video-download-progress-row"
                            data-status={status}
                            key={artifact?.id ?? stage?.id ?? `${option?.id ?? 'download'}-${index}`}
                          >
                            <span aria-hidden="true">
                              {downloadHistoryIcon(item)}
                            </span>
                            <div>
                              <strong>
                                {artifact === undefined
                                  ? downloadPendingTitle(probe.title, option, l)
                                  : artifactFileName(artifact)}
                              </strong>
                              <small>
                                {artifact === undefined
                                  ? downloadStageDescription(stage, option, l)
                                  : artifactDescription(artifact, l)}
                              </small>
                              {status === 'queued' || status === 'running' ? (
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
                              <span className="video-download-row-status">
                                {status === 'failed'
                                  ? l('失败', 'Failed')
                                  : status === 'canceled'
                                    ? l('已取消', 'Canceled')
                                    : status === 'interrupted'
                                      ? l('已中断', 'Interrupted')
                                      : preparing
                                        ? l('准备中', 'Preparing')
                                        : `${Math.round(percent)}%`}
                              </span>
                            ) : (
                              <div className="video-download-file-actions">
                                <button
                                  type="button"
                                  onClick={() => void downloadArtifact(artifact)}
                                  aria-label={`${l('保存到本机', 'Save locally')} ${artifactFileName(artifact)}`}
                                  title={l('保存到本机', 'Save locally')}
                                >
                                  <Download size={16} strokeWidth={1.8} />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="video-result-empty">
                      <Download size={26} strokeWidth={1.5} aria-hidden="true" />
                      <strong>{l('还没有项目文件', 'No project files yet')}</strong>
                      <button type="button" onClick={() => setResultTab('formats')}>
                        {l('选择下载规格', 'Choose a format')}
                      </button>
                    </div>
                  )}
                </div>
              ) : null}

              <CreatorTaskSummary
                sourceIcon={Link2}
                sourceLabel={l('视频链接', 'Video link')}
                sourceValue={url}
                items={[
                  { label: l('来源平台', 'Platform'), value: platform },
                  {
                    label: l('可用规格', 'Formats'),
                    value: String(options.length)
                  },
                  {
                    label: l('当前选择', 'Selected'),
                    value: selectedOption === undefined
                      ? l('未选择', 'Not selected')
                      : optionLabel(selectedOption, l)
                  },
                  {
                    label: l('项目文件', 'Project files'),
                    value: String(downloadArtifacts.length)
                  }
                ]}
              />
            </div>
          </section>
        ) : null}

        {notice ? (
          <p className="creator-tool-notice" role="status">
            <CheckCircle2 size={15} strokeWidth={1.9} />
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="creator-tool-notice" data-tone="danger" role="alert">
            <AlertCircle size={15} strokeWidth={1.9} />
            {error}
          </p>
        ) : null}
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
    || (metadata.platform !== 'youtube' && metadata.platform !== 'bilibili')
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
    || (value.mediaType !== 'video' && value.mediaType !== 'audio')
    || !['mp4', 'mp3', 'm4a', 'webm'].includes(String(value.container))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    mediaType: value.mediaType,
    container: value.container as DownloadOption['container'],
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
  return Math.min(100, Math.max(0, percent));
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
  const detail = option === undefined ? undefined : optionDetail(option);
  const status = stage === undefined || stage.status === 'queued'
    ? l('等待前面的规格下载完成', 'Waiting for earlier formats')
    : stage.status === 'running'
      ? downloadPhaseLabel(stage, l)
      : stage.status === 'succeeded'
        ? l('已保存到项目', 'Saved to project')
        : stage.status === 'failed'
          ? formatDownloadError(
              new Error(`${stage.errorCode ?? ''}: ${stage.errorMessage ?? ''}`),
              l
            )
          : stage.status === 'canceled'
            ? l('下载已取消，可返回规格列表重新提交', 'Canceled. Submit it again from formats.')
            : l('下载已中断，可返回规格列表重新提交', 'Interrupted. Submit it again from formats.');
  return [detail, status].filter(Boolean).join(' · ');
}

function downloadPhaseLabel(
  stage: CreatorStageRun,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  switch (stage.progress.phase) {
    case 'preparing_download':
      return l('正在准备下载', 'Preparing download');
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
  if (item.artifact !== undefined) {
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
  if (option.mediaType === 'audio') {
    return `${option.bitrateKbps ?? 192}kbps`;
  }
  if (option.height !== undefined) return `${option.height}p`;
  return l('原始画质', 'Source quality');
}

function optionDetail(option: DownloadOption): string {
  const parts = [option.container.toUpperCase()];
  if (option.width !== undefined && option.height !== undefined) {
    parts.push(`${option.width} x ${option.height}`);
  }
  if (option.fps !== undefined) parts.push(`${Math.round(option.fps)} FPS`);
  if (option.estimatedBytes !== undefined) parts.push(formatBytes(option.estimatedBytes));
  return parts.join(' · ');
}

function artifactDescription(
  artifact: CreatorArtifact,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const parts = [
    artifact.kind === 'source_audio' ? 'MP3' : 'MP4',
    readNumber(artifact.metadata.size) === undefined
      ? undefined
      : formatBytes(readNumber(artifact.metadata.size)!),
    formatDimensions(
      readNumber(artifact.metadata.width) ?? null,
      readNumber(artifact.metadata.height) ?? null
    ),
    l('已保存到项目', 'Saved to project')
  ];
  return parts.filter(Boolean).join(' · ');
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
    Math.floor(Math.log(bytes) / Math.log(1_024)),
    units.length - 1
  );
  const value = bytes / 1_024 ** unit;
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function isSupportedUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && (
        host === 'youtu.be'
        || host === 'youtube.com'
        || host.endsWith('.youtube.com')
        || host === 'b23.tv'
        || host === 'bilibili.com'
        || host.endsWith('.bilibili.com')
      );
  } catch {
    return false;
  }
}

function platformFor(
  value: string,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (/youtu(?:\.be|be\.com)/i.test(value)) return 'YouTube';
  if (/bilibili\.com|b23\.tv/i.test(value)) return 'Bilibili';
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
      '当前仅支持 YouTube 和 Bilibili 公公开视频',
      'Only public YouTube and Bilibili videos are supported'
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
    return l('该视频需要登录后访问，当前无法下载', 'This video requires a signed-in session.');
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
  return message;
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
