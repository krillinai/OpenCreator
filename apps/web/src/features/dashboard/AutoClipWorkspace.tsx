import {
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorStageRun
} from '@opencreator/protocol';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileVideo,
  Grid2X2,
  List as ListIcon,
  LoaderCircle,
  Scissors,
  Sparkles
} from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import NativeSelect from '../../components/forms/NativeSelect.js';
import type { VideoMetadataService } from '../../services/video-metadata-service.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import {
  createCreatorArtifactObjectUrl,
  useOptionalCreatorSession
} from './creator-session-store.js';
import VideoSourceInput from './VideoSourceInput.js';

type AutoClipStep = 0 | 1 | 2;
type VideoOrientation = 'landscape' | 'portrait' | 'square';
type AnalysisFocus = 'balanced' | 'viral' | 'knowledge';
type ClipGenre = 'auto' | 'talk' | 'podcast' | 'tutorial' | 'interview' | 'entertainment' | 'sports' | 'gaming' | 'news';
type ClipDuration = '15-30' | '30-60' | '60-90';
type ClipAspectRatio = 'source' | '16:9' | '9:16' | '1:1';
type ClipScoreKey = 'hook' | 'information' | 'emotion' | 'completeness';
type AutoClipResultView = 'list' | 'grid';

type ClipCandidate = {
  id: string;
  title: string;
  start: number;
  end: number;
  transcript: string;
  reason: string;
  scores: Record<ClipScoreKey, number>;
};

type ClipSubtitleCue = {
  id: string;
  start: number;
  end: number;
  text: string;
};

type AutoClipResultVersion = {
  value: number;
  description: string;
  state: Record<string, CreatorJson>;
  artifact: CreatorArtifact;
  sourceArtifact?: CreatorArtifact;
  subtitleArtifact?: CreatorArtifact;
  candidates: ClipCandidate[];
};

const analysisStageIds = new Set(['probe', 'download', 'subtitle', 'analyze']);

export default function AutoClipWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  videoMetadataService?: VideoMetadataService;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const draftInitializedRef = useRef(false);
  const [videoUrl, setVideoUrl] = useState(() => readString(session?.state.sourceUrl));
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [sourceArtifactId, setSourceArtifactId] = useState(() => readString(session?.state.sourceArtifactId));
  const [sourceLanguage, setSourceLanguage] = useState(() => readSourceLanguage(session?.state.sourceLanguage));
  const [genre, setGenre] = useState<ClipGenre>(() => readGenre(session?.state.genre));
  const [focus, setFocus] = useState<AnalysisFocus>(() => readFocus(session?.state.focus));
  const [duration, setDuration] = useState<ClipDuration>(() => readDuration(session?.state.duration));
  const [clipCount, setClipCount] = useState(() => readClipCount(session?.state.clipCount));
  const [aspectRatio, setAspectRatio] = useState<ClipAspectRatio>(() => readAspectRatio(session?.state.aspectRatio));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [currentStep, setCurrentStep] = useState<AutoClipStep>(0);
  const [furthestStep, setFurthestStep] = useState<AutoClipStep>(0);
  const [resultVersion, setResultVersion] = useState<number>();
  const [resultView, setResultView] = useState<AutoClipResultView>('list');
  const [exportUrls, setExportUrls] = useState<Record<string, string>>({});
  const resultVersions = useMemo(
    () => createAutoClipResultVersions(
      session?.job.artifacts ?? [],
      session?.state.resultSnapshots
    ),
    [session?.job.artifacts, session?.state.resultSnapshots]
  );
  const latestVersion = resultVersions.at(-1)?.value;
  const selectedResult = resultVersions.find(version => version.value === resultVersion)
    ?? resultVersions.at(-1);
  const candidates = selectedResult?.candidates ?? [];
  const importedSourceArtifact = findArtifact(
    session?.job.artifacts ?? [],
    sourceArtifactId,
    'source_video'
  );
  const currentSourceArtifact = selectedResult?.sourceArtifact
    ?? importedSourceArtifact
    ?? latestCompletedArtifact(session?.job.artifacts ?? [], 'source_video');
  const currentProbeArtifact = relatedArtifact(
    session?.job.artifacts ?? [],
    currentSourceArtifact,
    'download_probe'
  );
  const importedSourceName = artifactFileName(currentSourceArtifact)
    || l('项目视频', 'Project video');
  const sourceDisplayName = videoFile?.name
    ?? (sourceArtifactId
      ? importedSourceName
      : readString(currentSourceArtifact?.metadata.title)
        || readString(currentProbeArtifact?.metadata.title)
        || videoUrl
        || importedSourceName);
  const hasSource = importedSourceArtifact !== undefined
    || videoFile !== null
    || isValidUrl(videoUrl);
  const latestAnalysisStage = latestStage(session?.job.stages ?? [], analysisStageIds);
  const latestRenderStage = latestStage(session?.job.stages ?? [], new Set(['render']));
  const analyzing = latestAnalysisStage?.status === 'queued' || latestAnalysisStage?.status === 'running';
  const rendering = latestRenderStage?.status === 'queued' || latestRenderStage?.status === 'running';
  const runtimeError = latestFailedStage(session?.job.stages ?? []);
  const visibleError = error || formatClipError(runtimeError ?? session?.error, l);
  const renderedArtifacts = useMemo(
    () => selectedResult === undefined
      ? []
      : latestExportsForCandidateArtifact(
          session?.job.artifacts ?? [],
          selectedResult.artifact.id
        ),
    [selectedResult?.artifact.id, session?.job.artifacts]
  );
  const renderedClipItems = renderedArtifacts.flatMap(artifact => {
    const candidateId = readString(artifact.metadata.candidateId);
    const clip = candidates.find(candidate => candidate.id === candidateId);
    return clip === undefined ? [] : [{ artifact, clip }];
  });

  useEffect(() => {
    if (latestVersion !== undefined) setResultVersion(latestVersion);
  }, [latestVersion]);

  useEffect(() => {
    if (resultVersions.length === 0) return;
    setCurrentStep(2);
    setFurthestStep(2);
  }, [resultVersions.length]);

  useEffect(() => {
    if (session === null) return;
    session.updateDraft({
      sourceUrl: videoUrl,
      sourceType: sourceArtifactId || videoFile ? 'file' : 'url',
      sourceArtifactId: sourceArtifactId || null,
      sourceLanguage,
      preferPlatformCaptions: true,
      genre,
      focus,
      duration,
      clipCount,
      aspectRatio
    }, { persist: draftInitializedRef.current });
    draftInitializedRef.current = true;
  }, [
    aspectRatio,
    clipCount,
    duration,
    focus,
    genre,
    session?.updateDraft,
    sourceArtifactId,
    sourceLanguage,
    videoFile,
    videoUrl
  ]);

  useEffect(() => {
    if (renderedArtifacts.length === 0 || session === null) {
      setExportUrls({});
      return undefined;
    }
    let active = true;
    const objectUrls: string[] = [];
    void Promise.all(renderedArtifacts.map(async artifact => {
      const objectUrl = await createCreatorArtifactObjectUrl(
        session,
        artifact.id,
        'auto-clip.load-result-preview',
        l('视频切片预览加载失败，请稍后重试。', 'Clip previews failed to load. Try again later.')
      );
      objectUrls.push(objectUrl);
      return [artifact.id, objectUrl] as const;
    })).then(entries => {
      if (active) setExportUrls(Object.fromEntries(entries));
    }).catch(() => undefined);
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [renderedArtifacts, l, session?.captureCreatorFailure, session?.openArtifact]);

  useEffect(() => {
    if (latestRenderStage?.status === 'succeeded' && renderedArtifacts.length > 0) {
      setNotice(l(
        `已自动生成 ${renderedArtifacts.length} 个独立视频切片`,
        `${renderedArtifacts.length} standalone video clips were generated automatically`
      ));
    }
  }, [renderedArtifacts.length, l, latestRenderStage?.id, latestRenderStage?.status]);

  const steps = [
    l('添加视频', 'Add video'),
    l('切片设置', 'Clip settings'),
    l('切片结果', 'Clip results')
  ];

  function openStep(step: AutoClipStep) {
    setCurrentStep(step);
    setFurthestStep(previous => Math.max(previous, step) as AutoClipStep);
  }

  function continueToSettings() {
    if (!hasSource) {
      setError(l('请先上传视频或填写公开视频链接', 'Upload a video or enter a public video link first'));
      return;
    }
    setError('');
    setNotice('');
    openStep(1);
  }

  function chooseVideo(file: File | null) {
    setVideoFile(file);
    if (file) {
      setVideoUrl('');
      setSourceArtifactId('');
    }
    setError('');
    setNotice('');
  }

  function clearCurrentSource() {
    setVideoFile(null);
    setVideoUrl('');
    setSourceArtifactId('');
    setError('');
    setNotice('');
  }

  async function analyze() {
    if (analyzing || rendering || session === null) return;
    if (!hasSource) {
      setCurrentStep(0);
      setError(l('请先上传视频或填写公开视频链接', 'Upload a video or enter a public video link first'));
      return;
    }
    setError('');
    setNotice(l('正在分析视频并自动生成切片', 'Analyzing the video and rendering clips automatically'));
    try {
      session.updateDraft({
        sourceUrl: videoUrl,
        sourceType: sourceArtifactId || videoFile ? 'file' : 'url',
        sourceArtifactId: sourceArtifactId || null,
        sourceLanguage,
        preferPlatformCaptions: true,
        genre,
        focus,
        duration,
        clipCount,
        aspectRatio
      }, { semantic: true });
      await session.flush();
      let stageId: 'probe' | 'subtitle' | 'analyze';
      if (videoFile !== null) {
        await session.uploadSourceVideo(videoFile);
        stageId = 'subtitle';
        setVideoFile(null);
      } else {
        const source = matchingSourceArtifact(
          session.job.artifacts,
          sourceArtifactId,
          videoUrl
        );
        const subtitle = source === undefined
          ? undefined
          : matchingSubtitleArtifact(session.job.artifacts, source);
        const sourceLanguageChanged = selectedResult !== undefined
          && readSourceLanguage(selectedResult.state.sourceLanguage) !== sourceLanguage;
        stageId = subtitle !== undefined && !sourceLanguageChanged
          ? 'analyze'
          : source !== undefined
            ? 'subtitle'
            : 'probe';
      }
      const updatedJob = await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: {
          stageId,
          workflow: true
        }
      });
      const completedInResponse = updatedJob.artifacts.some(artifact => (
        artifact.kind === 'clip_candidates' && artifact.status === 'completed'
      ));
      const nextStep: AutoClipStep = completedInResponse ? 2 : 1;
      setCurrentStep(nextStep);
      setFurthestStep(previous => Math.max(previous, nextStep) as AutoClipStep);
    } catch {}
  }

  function selectVersion(version: number) {
    const result = resultVersions.find(item => item.value === version);
    if (result === undefined) return;
    setResultVersion(version);
    setSourceLanguage(readSourceLanguage(result.state.sourceLanguage));
    setGenre(readGenre(result.state.genre));
    setFocus(readFocus(result.state.focus));
    setDuration(readDuration(result.state.duration));
    setClipCount(readClipCount(result.state.clipCount));
    setAspectRatio(readAspectRatio(result.state.aspectRatio));
    setVideoUrl(readString(result.state.sourceUrl));
    setVideoFile(null);
    setSourceArtifactId(result.sourceArtifact?.id ?? '');
    setCurrentStep(2);
    setFurthestStep(2);
  }

  function downloadArtifact(artifact: CreatorArtifact) {
    const url = exportUrls[artifact.id];
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = artifactFileName(artifact) || `OpenCreator-video-clip-${artifact.version}.mp4`;
    link.click();
    setNotice(l('视频切片已开始下载', 'The video clip download has started'));
  }

  const quickActions = selectedResult === undefined
    ? [{
        id: 'analyze-video-clips',
        label: l('一键自动切片', 'Auto-clip now'),
        kind: 'action' as const,
        onAction: () => void analyze(),
        disabled: !hasSource || analyzing || rendering
      }]
    : [];

  return (
    <CreatorToolShell
      title={l('视频切片', 'Video Clips')}
      subtitle={l(
        '自动识别长视频中的高光时刻，并直接生成独立短视频',
        'Find the strongest moments in long videos and automatically render standalone clips'
      )}
      context={selectedResult
        ? l(
            `V${selectedResult.value}，${candidates.length} 个视频切片`,
            `V${selectedResult.value}, ${candidates.length} video clips`
          )
        : analyzing
          ? l('正在识别视频高光', 'Finding video highlights')
          : l('等待添加长视频', 'Waiting for a long video')}
      suggestions={[]}
      quickActions={quickActions}
      placeholder={props.promptHint ?? l(
        '询问切片进度，或描述内容重点、时长和画幅要求',
        'Ask about progress or describe the focus, duration, and format you need'
      )}
      stepLabel={rendering
        ? l('生成视频切片', 'Rendering video clips')
        : analyzing
          ? l('识别视频高光', 'Finding video highlights')
          : currentStep === 2
            ? l('切片结果', 'Clip results')
            : steps[currentStep]!}
      currentIssue={visibleError || undefined}
      onCancelTask={analyzing || rendering
        ? () => void session?.cancelJob().catch(() => undefined)
        : undefined}
      onResumeTask={session?.job.status === 'canceled'
        ? () => void session.resumeJob().catch(() => undefined)
        : undefined}
      onBack={props.onBack}
    >
      <div className="creator-tool-stack auto-clip-tool-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('视频切片流程', 'Video clip workflow')}>
          <ol>{steps.map((step, index) => {
            const active = index === currentStep;
            const completed = index < currentStep;
            return (
              <li key={step} data-active={active} data-completed={completed}>
                <button
                  type="button"
                  disabled={index > furthestStep || analyzing || rendering}
                  aria-current={active ? 'step' : undefined}
                  onClick={() => openStep(index as AutoClipStep)}
                >
                  <span>{completed ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : index + 1}</span>
                  <strong>{step}</strong>
                </button>
              </li>
            );
          })}</ol>
        </nav>

        {currentStep === 0 ? (
          <>
            {importedSourceArtifact === undefined ? (
              <VideoSourceInput
                file={videoFile}
                sourceType={videoFile ? 'file' : 'url'}
                url={videoUrl}
                hasSource={hasSource}
                metadataService={props.videoMetadataService}
                onFileChange={chooseVideo}
                onUrlChange={url => {
                  setVideoUrl(url);
                  setVideoFile(null);
                  setSourceArtifactId('');
                  setError('');
                  setNotice('');
                }}
                onClear={clearCurrentSource}
              />
            ) : (
              <section className="creator-tool-panel" aria-labelledby="video-clips-imported-source-title">
                <div className="creator-tool-panel-heading">
                  <div>
                    <h2 id="video-clips-imported-source-title">{l('项目视频', 'Project video')}</h2>
                    <p>{l('已从项目产出导入，无需重新下载', 'Imported from a project output without downloading it again')}</p>
                  </div>
                </div>
                <div className="video-result-file-row">
                  <span><FileVideo size={18} strokeWidth={1.7} /></span>
                  <div>
                    <strong>{importedSourceName}</strong>
                    <small>{l('已关联到当前视频切片任务', 'Attached to this video clip job')}</small>
                  </div>
                  <button type="button" onClick={clearCurrentSource}>{l('更换', 'Change')}</button>
                </div>
              </section>
            )}
            <div className="creator-tool-actions">
              <button className="creator-tool-primary" type="button" disabled={!hasSource} onClick={continueToSettings}>
                {l('下一步：切片设置', 'Next: Clip settings')}
              </button>
            </div>
          </>
        ) : null}

        {currentStep === 1 ? (
          <div className="creator-task-final-grid">
            <section className="creator-tool-panel" aria-labelledby="video-clips-settings-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="video-clips-settings-title">{l('设置切片目标', 'Set clip goals')}</h2>
                  <p>{l('AI 会根据内容重点、目标时长和传播完整度寻找最佳片段', 'AI finds the best moments using your focus, duration, and standalone clarity')}</p>
                </div>
              </div>
              <div className="auto-clip-setting-sections">
                <section className="auto-clip-setting-section" aria-labelledby="auto-clip-content-settings-title">
                  <header>
                    <h3 id="auto-clip-content-settings-title">{l('内容识别', 'Content analysis')}</h3>
                  </header>
                  <div className="creator-tool-form-row auto-clip-settings-grid">
                    <label className="creator-tool-field">
                      <span>{l('原视频语言', 'Source language')}</span>
                      <NativeSelect aria-label={l('原视频语言', 'Source language')} value={sourceLanguage} onChange={event => setSourceLanguage(event.target.value)}>
                        <option value="auto">{l('自动检测（优先平台字幕）', 'Auto detect (prefer platform captions)')}</option>
                        <option value="zh_cn">{l('简体中文', 'Simplified Chinese')}</option>
                        <option value="zh_tw">{l('繁體中文', 'Traditional Chinese')}</option>
                        <option value="en">English</option>
                        <option value="ja">日本語</option>
                        <option value="ko">한국어</option>
                        <option value="es">Español</option>
                        <option value="fr">Français</option>
                        <option value="de">Deutsch</option>
                        <option value="pt">Português</option>
                        <option value="ru">Русский</option>
                      </NativeSelect>
                    </label>
                    <label className="creator-tool-field">
                      <span>{l('内容类型', 'Content type')}</span>
                      <NativeSelect aria-label={l('内容类型', 'Content type')} value={genre} onChange={event => setGenre(event.target.value as ClipGenre)}>
                        <option value="auto">{l('自动判断', 'Auto detect')}</option>
                        <option value="talk">{l('演讲 / 观点', 'Talk / commentary')}</option>
                        <option value="podcast">{l('播客对谈', 'Podcast')}</option>
                        <option value="tutorial">{l('教程 / 知识', 'Tutorial / education')}</option>
                        <option value="interview">{l('人物访谈', 'Interview')}</option>
                        <option value="entertainment">{l('娱乐内容', 'Entertainment')}</option>
                        <option value="sports">{l('体育内容', 'Sports')}</option>
                        <option value="gaming">{l('游戏内容', 'Gaming')}</option>
                        <option value="news">{l('新闻 / 时事', 'News / current affairs')}</option>
                      </NativeSelect>
                    </label>
                    <label className="creator-tool-field">
                      <span>{l('内容重点', 'Content focus')}</span>
                      <NativeSelect aria-label={l('内容重点', 'Content focus')} value={focus} onChange={event => setFocus(event.target.value as AnalysisFocus)}>
                        <option value="balanced">{l('综合表现', 'Balanced')}</option>
                        <option value="viral">{l('传播潜力优先', 'Shareability first')}</option>
                        <option value="knowledge">{l('知识完整度优先', 'Knowledge completeness')}</option>
                      </NativeSelect>
                    </label>
                  </div>
                </section>

                <section className="auto-clip-setting-section" aria-labelledby="auto-clip-output-settings-title">
                  <header>
                    <h3 id="auto-clip-output-settings-title">{l('切片输出', 'Clip output')}</h3>
                  </header>
                  <div className="creator-tool-form-row auto-clip-settings-grid">
                    <label className="creator-tool-field">
                      <span>{l('目标时长', 'Target duration')}</span>
                      <NativeSelect aria-label={l('目标时长', 'Target duration')} value={duration} onChange={event => setDuration(event.target.value as ClipDuration)}>
                        <option value="15-30">15-30 {l('秒', 'sec')}</option>
                        <option value="30-60">30-60 {l('秒', 'sec')}</option>
                        <option value="60-90">60-90 {l('秒', 'sec')}</option>
                      </NativeSelect>
                    </label>
                    <label className="creator-tool-field">
                      <span>{l('切片数量', 'Number of clips')}</span>
                      <input type="number" min="1" max="20" step="1" aria-label={l('切片数量', 'Number of clips')} value={clipCount} onChange={event => setClipCount(clampClipCount(Number(event.target.value)))} />
                    </label>
                    <label className="creator-tool-field">
                      <span>{l('输出画幅', 'Output format')}</span>
                      <NativeSelect aria-label={l('输出画幅', 'Output format')} value={aspectRatio} onChange={event => setAspectRatio(event.target.value as ClipAspectRatio)}>
                        <option value="9:16">{l('竖屏', 'Portrait')} 9:16</option>
                        <option value="1:1">{l('方形', 'Square')} 1:1</option>
                        <option value="16:9">{l('横屏', 'Landscape')} 16:9</option>
                        <option value="source">{l('跟随原视频', 'Match source')}</option>
                      </NativeSelect>
                    </label>
                  </div>
                </section>
              </div>
              <div className="auto-clip-analysis-note">
                <Sparkles size={18} strokeWidth={1.7} />
                <div>
                  <strong>{l(`自动生成最多 ${clipCount} 个独立视频切片`, `Automatically render up to ${clipCount} standalone video clips`)}</strong>
                  <p>{l('分析完成后直接生成全部片段，每条包含完整字幕、推荐理由和四维评分', 'Every analyzed moment is rendered automatically with its transcript, rationale, and four scores')}</p>
                </div>
              </div>
              <div className="creator-tool-actions">
                <button className="creator-tool-primary" type="button" disabled={analyzing || rendering} onClick={() => void analyze()}>
                  {analyzing || rendering ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}
                  {analyzing
                    ? l('正在识别高光', 'Finding highlights')
                    : rendering
                      ? l('正在生成切片', 'Rendering clips')
                    : selectedResult
                      ? l('重新分析并自动生成新版本', 'Reanalyze and render a new version')
                      : l('开始自动切片', 'Start automatic clipping')}
                </button>
              </div>
            </section>
            <CreatorTaskSummary
              sourceIcon={FileVideo}
              sourceLabel={l('视频来源', 'Video source')}
              sourceValue={sourceDisplayName}
              items={[
                { label: l('原视频语言', 'Source language'), value: sourceLanguageLabel(sourceLanguage, l) },
                { label: l('内容类型', 'Content type'), value: genreLabel(genre, l) },
                { label: l('内容重点', 'Content focus'), value: focusLabel(focus, l) },
                { label: l('目标时长', 'Target duration'), value: `${duration} ${l('秒', 'sec')}` },
                { label: l('切片数量', 'Clip count'), value: String(clipCount) },
                { label: l('输出画幅', 'Output format'), value: aspectRatioLabel(aspectRatio, l) }
              ]}
            />
          </div>
        ) : null}

        {currentStep === 2 && selectedResult ? (
          <section className="video-result-workspace auto-clip-result-workspace" aria-label={l('视频切片项目产出', 'Video clip project outputs')}>
            <div className="video-result-toolbar">
              <div className="auto-clip-result-heading">
                <h2>{l('切片结果', 'Clip results')}</h2>
                <span>{l(`${renderedClipItems.length} 个切片`, `${renderedClipItems.length} clips`)}</span>
              </div>
              <div className="auto-clip-result-controls">
                <div className="auto-clip-view-switch" role="group" aria-label={l('结果视图', 'Result view')}>
                  <button
                    type="button"
                    aria-label={l('列表视图', 'List view')}
                    aria-pressed={resultView === 'list'}
                    title={l('列表视图', 'List view')}
                    onClick={() => setResultView('list')}
                  >
                    <ListIcon size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={l('网格视图', 'Grid view')}
                    aria-pressed={resultView === 'grid'}
                    title={l('网格视图', 'Grid view')}
                    onClick={() => setResultView('grid')}
                  >
                    <Grid2X2 size={15} />
                  </button>
                </div>
                <CreatorResultVersionMenu
                  version={selectedResult.value}
                  versions={resultVersions.map(version => ({ value: version.value, description: version.description }))}
                  onVersionChange={selectVersion}
                />
              </div>
            </div>
            <div className="auto-clip-result-content">
              <div className="video-result-pane" data-view={resultView}>
                {rendering ? (
                  <div className="video-result-empty" role="status"><LoaderCircle className="smart-dubbing-spinner" size={26} /><strong>{l('正在自动生成视频切片', 'Rendering video clips automatically')}</strong><span>{readProgressText(latestRenderStage, l)}</span></div>
                ) : renderedClipItems.length > 0 ? (
                  resultView === 'grid' ? (
                    <section className="auto-clip-grid" aria-label={l('视频切片网格', 'Video clip grid')}>
                      {renderedClipItems.map(({ artifact, clip }, index) => (
                        <AutoClipGridItem
                          key={artifact.id}
                          index={index}
                          clip={clip}
                          artifact={artifact}
                          videoUrl={exportUrls[artifact.id] ?? ''}
                          onDownload={() => downloadArtifact(artifact)}
                        />
                      ))}
                    </section>
                  ) : (
                    <section className="auto-clip-compact-list" aria-label={l('视频切片列表', 'Video clip list')}>
                      {renderedClipItems.map(({ artifact, clip }, index) => (
                        <AutoClipResultItem
                          key={artifact.id}
                          index={index}
                          clip={clip}
                          artifact={artifact}
                          videoUrl={exportUrls[artifact.id] ?? ''}
                          subtitleCues={selectedResult.subtitleArtifact?.metadata.cues}
                          onDownload={() => downloadArtifact(artifact)}
                        />
                      ))}
                    </section>
                  )
                ) : (
                  <div className="video-result-empty"><Scissors size={26} strokeWidth={1.5} /><strong>{l('视频切片尚未生成', 'Video clips are not ready yet')}</strong><span>{l('分析完成后会自动生成全部片段', 'All analyzed moments will be rendered automatically')}</span></div>
                )}
              </div>

            </div>
          </section>
        ) : null}

        {analyzing && currentStep !== 2 ? (
          <p className="creator-tool-notice" role="status"><LoaderCircle className="smart-dubbing-spinner" size={14} />{readProgressText(latestAnalysisStage, l)}</p>
        ) : notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        {error ? <p className="creator-tool-error" role="alert">{error}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function AutoClipGridItem(props: {
  index: number;
  clip: ClipCandidate;
  artifact: CreatorArtifact;
  videoUrl: string;
  onDownload(): void;
}) {
  const l = useLocalizedCopy();
  const orientation = readOrientation(props.artifact)
    ?? aspectRatioOrientation(readAspectRatio(props.artifact.metadata.aspectRatio))
    ?? 'landscape';
  const sequence = String(props.index + 1).padStart(2, '0');
  return (
    <article className="auto-clip-grid-item" aria-label={`${l('网格切片', 'Grid clip')} ${props.index + 1}: ${props.clip.title}`}>
      <div className="auto-clip-grid-preview" data-orientation={orientation}>
        {props.videoUrl ? (
          <video
            controls
            playsInline
            preload="metadata"
            src={props.videoUrl}
            aria-label={`${l('网格切片预览', 'Grid clip preview')} ${props.index + 1}`}
          />
        ) : <div className="auto-clip-export-loading"><LoaderCircle className="smart-dubbing-spinner" size={22} /></div>}
      </div>
      <div className="auto-clip-grid-meta">
        <div>
          <strong>{totalScore(props.clip)}<small>/100</small></strong>
          <span>#{sequence}</span>
          <button
            type="button"
            disabled={!props.videoUrl}
            onClick={props.onDownload}
            title={l('下载切片', 'Download clip')}
            aria-label={`${l('下载视频切片', 'Download video clip')} ${props.clip.title}`}
          >
            <Download size={15} />
          </button>
        </div>
        <h3>{props.clip.title}</h3>
        <p>{formatTimeRange(props.clip)} · {formatDuration(props.clip.end - props.clip.start)}</p>
      </div>
    </article>
  );
}

function AutoClipResultItem(props: {
  index: number;
  clip: ClipCandidate;
  artifact: CreatorArtifact;
  videoUrl: string;
  subtitleCues: CreatorJson | undefined;
  onDownload(): void;
}) {
  const l = useLocalizedCopy();
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const cueRefs = useRef(new Map<string, HTMLElement>());
  const [playbackTime, setPlaybackTime] = useState(0);
  const cues = useMemo(
    () => readClipSubtitleCues(props.subtitleCues, props.clip),
    [props.clip, props.subtitleCues]
  );
  const absoluteTime = props.clip.start + playbackTime;
  const activeCueIds = new Set(cues
    .filter(cue => absoluteTime >= cue.start && absoluteTime < cue.end)
    .map(cue => cue.id));
  const activeCueKey = [...activeCueIds].join('|');
  const orientation = readOrientation(props.artifact)
    ?? aspectRatioOrientation(readAspectRatio(props.artifact.metadata.aspectRatio))
    ?? 'landscape';

  useEffect(() => {
    setPlaybackTime(0);
  }, [props.clip.id, props.videoUrl]);

  useEffect(() => {
    const activeCueId = activeCueIds.values().next().value;
    if (typeof activeCueId !== 'string') return;
    const container = transcriptScrollRef.current;
    const cue = cueRefs.current.get(activeCueId);
    if (container === null || cue === undefined) return;
    const containerRect = container.getBoundingClientRect();
    const cueRect = cue.getBoundingClientRect();
    if (cueRect.top < containerRect.top) {
      container.scrollTop -= containerRect.top - cueRect.top;
    } else if (cueRect.bottom > containerRect.bottom) {
      container.scrollTop += cueRect.bottom - containerRect.bottom;
    }
  }, [activeCueKey]);

  function seekToCue(cue: ClipSubtitleCue) {
    const targetTime = Math.max(0, cue.start - props.clip.start);
    if (videoRef.current !== null) videoRef.current.currentTime = targetTime;
    setPlaybackTime(targetTime);
  }

  const sequence = String(props.index + 1).padStart(2, '0');
  return (
    <article className="auto-clip-compact-item" aria-label={`${l('切片', 'Clip')} ${props.index + 1}: ${props.clip.title}`}>
      <header className="auto-clip-compact-header">
        <span>#{sequence}</span>
        <div>
          <h3>{props.clip.title}</h3>
          <small>{formatTimeRange(props.clip)} · {formatDuration(props.clip.end - props.clip.start)}</small>
        </div>
        <button
          type="button"
          disabled={!props.videoUrl}
          onClick={props.onDownload}
          title={l('下载切片', 'Download clip')}
          aria-label={`${l('下载视频切片', 'Download video clip')} ${props.clip.title}`}
        >
          <Download size={16} />
        </button>
      </header>
      <div className="auto-clip-compact-body">
        <section className="auto-clip-compact-score" aria-label={`${l('切片评分', 'Clip score')} ${props.index + 1}`}>
          <span>{l('综合评分', 'Score')}</span>
          <strong>{totalScore(props.clip)}<small>/100</small></strong>
          <dl>
            {Object.entries(props.clip.scores).map(([key, score]) => (
              <div key={key}><dt>{scoreLabel(key as ClipScoreKey, l)}</dt><dd>{score}</dd></div>
            ))}
          </dl>
        </section>
        <div className="auto-clip-compact-preview" data-orientation={orientation}>
          {props.videoUrl ? (
            <video
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              src={props.videoUrl}
              onLoadedMetadata={event => setPlaybackTime(event.currentTarget.currentTime)}
              onSeeked={event => setPlaybackTime(event.currentTarget.currentTime)}
              onTimeUpdate={event => setPlaybackTime(event.currentTarget.currentTime)}
              aria-label={`${l('切片预览', 'Clip preview')} ${props.index + 1}`}
            />
          ) : <div className="auto-clip-export-loading"><LoaderCircle className="smart-dubbing-spinner" size={22} /></div>}
        </div>
        <section className="auto-clip-compact-transcript" aria-label={`${l('切片字幕', 'Clip transcript')} ${props.index + 1}`}>
          <header><h4>{l('字幕', 'Transcript')}</h4><span>{cues.length} {l('条', 'lines')}</span></header>
          <div ref={transcriptScrollRef}>
            {cues.map((cue, cueIndex) => {
              const active = activeCueIds.has(cue.id);
              return (
                <button
                  type="button"
                  key={cue.id}
                  ref={node => {
                    if (node === null) cueRefs.current.delete(cue.id);
                    else cueRefs.current.set(cue.id, node);
                  }}
                  data-active={active}
                  data-subtitle-cue="true"
                  aria-current={active ? 'true' : undefined}
                  aria-label={l(
                    `跳转到切片 ${props.index + 1} 字幕 ${cueIndex + 1}，${formatTimestamp(cue.start - props.clip.start)}`,
                    `Jump to clip ${props.index + 1} transcript ${cueIndex + 1}, ${formatTimestamp(cue.start - props.clip.start)}`
                  )}
                  onClick={() => seekToCue(cue)}
                >
                  <span>{formatTimestamp(cue.start - props.clip.start)}</span>
                  <strong>{cue.text}</strong>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </article>
  );
}

function createAutoClipResultVersions(
  artifacts: CreatorArtifact[],
  resultSnapshots: CreatorJson | undefined
): AutoClipResultVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const versions = readCreatorResultSnapshots(resultSnapshots).flatMap(snapshot => {
    const artifact = (snapshot.artifactRefs.clip_candidates ?? [])
      .map(id => byId.get(id))
      .find((candidate): candidate is CreatorArtifact => candidate !== undefined);
    if (artifact === undefined) return [];
    const candidates = readCandidates(artifact.metadata.candidates);
    if (candidates.length === 0) return [];
    const sourceArtifact = (snapshot.artifactRefs.source_video ?? [])
      .map(id => byId.get(id))
      .find((candidate): candidate is CreatorArtifact => candidate !== undefined);
    const subtitleArtifact = (snapshot.artifactRefs.target_subtitle ?? [])
      .map(id => byId.get(id))
      .find((candidate): candidate is CreatorArtifact => candidate !== undefined);
    return [{
      value: snapshot.version,
      description: snapshot.description,
      state: snapshot.state,
      artifact,
      ...(sourceArtifact === undefined ? {} : { sourceArtifact }),
      ...(subtitleArtifact === undefined ? {} : { subtitleArtifact }),
      candidates
    }];
  });
  if (versions.length > 0) return versions.sort((left, right) => left.value - right.value);
  return artifacts
    .filter(artifact => artifact.kind === 'clip_candidates')
    .flatMap(artifact => {
      const candidates = readCandidates(artifact.metadata.candidates);
      if (candidates.length === 0) return [];
      return [{
        value: readPositiveInteger(artifact.metadata.resultVersion) ?? artifact.version,
        description: '识别视频高光片段',
        state: {},
        artifact,
        sourceArtifact: artifacts.find(candidate => (
          candidate.kind === 'source_video'
          && artifact.sourceArtifactIds.includes(candidate.id)
        )),
        subtitleArtifact: artifact.sourceArtifactIds
          .map(id => byId.get(id))
          .find(candidate => candidate?.kind === 'target_subtitle'),
        candidates
      }];
    })
    .sort((left, right) => left.value - right.value);
}

function readCandidates(value: CreatorJson | undefined): ClipCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item)) return [];
    const scores = isRecord(item.scores) ? item.scores : undefined;
    const id = readString(item.id);
    const title = readString(item.title);
    const transcript = readString(item.transcript);
    const reason = readString(item.reason);
    const start = readNumber(item.start);
    const end = readNumber(item.end);
    if (!id || !title || !transcript || !reason || end <= start || scores === undefined) return [];
    return [{
      id,
      title,
      transcript,
      reason,
      start,
      end,
      scores: {
        hook: scoreValue(scores.hook),
        information: scoreValue(scores.information),
        emotion: scoreValue(scores.emotion),
        completeness: scoreValue(scores.completeness)
      }
    }];
  });
}

function readClipSubtitleCues(
  value: CreatorJson | undefined,
  clip: ClipCandidate
): ClipSubtitleCue[] {
  const cues = Array.isArray(value)
    ? value.flatMap((item, index) => {
        if (!isRecord(item)) return [];
        const start = subtitleTimestampSeconds(item.start);
        const end = subtitleTimestampSeconds(item.end);
        const text = readString(item.text);
        if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
        const clippedStart = Math.max(clip.start, start);
        const clippedEnd = Math.min(clip.end, end);
        if (clippedEnd <= clippedStart) return [];
        const rawId = typeof item.id === 'string' || typeof item.id === 'number'
          ? String(item.id)
          : String(index + 1);
        return [{
          id: `${rawId}-${index}`,
          start: clippedStart,
          end: clippedEnd,
          text
        }];
      })
    : [];
  return cues.length > 0 ? cues : approximateSubtitleCues(clip);
}

function approximateSubtitleCues(clip: ClipCandidate): ClipSubtitleCue[] {
  const segments = clip.transcript
    .match(/[^。！？!?；;\n.]+[。！？!?；;.]?/g)
    ?.map(text => text.trim())
    .filter(Boolean) ?? [];
  if (segments.length === 0) return [];
  const totalWeight = segments.reduce((total, text) => total + text.length, 0);
  const duration = clip.end - clip.start;
  let cursor = clip.start;
  return segments.map((text, index) => {
    const start = cursor;
    const end = index === segments.length - 1
      ? clip.end
      : Math.min(clip.end, start + duration * text.length / totalWeight);
    cursor = end;
    return { id: `approximate-${index}`, start, end, text };
  });
}

function subtitleTimestampSeconds(value: CreatorJson | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return Number.NaN;
  const match = /^(\d+):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/.exec(value.trim());
  if (match === null) return Number.NaN;
  return Number(match[1]) * 3600
    + Number(match[2]) * 60
    + Number(match[3])
    + Number((match[4] ?? '').padEnd(3, '0')) / 1000;
}

function totalScore(clip: ClipCandidate): number {
  const values = Object.values(clip.scores);
  return Math.round(values.reduce((sum, score) => sum + score, 0) / values.length);
}

function scoreValue(value: CreatorJson | undefined): number {
  return Math.max(0, Math.min(100, Math.round(readNumber(value))));
}

function formatTimeRange(clip: ClipCandidate): string {
  return `${formatTimestamp(clip.start)} - ${formatTimestamp(clip.end)}`;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const remaining = total % 60;
  return hours > 0
    ? [hours, minutes, remaining].map(value => String(value).padStart(2, '0')).join(':')
    : [minutes, remaining].map(value => String(value).padStart(2, '0')).join(':');
}

function formatDuration(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return value >= 60
    ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
    : `${value}s`;
}

function focusLabel(value: AnalysisFocus, l: ReturnType<typeof useLocalizedCopy>): string {
  if (value === 'viral') return l('传播潜力优先', 'Shareability first');
  if (value === 'knowledge') return l('知识完整度优先', 'Knowledge completeness');
  return l('综合表现', 'Balanced');
}

function genreLabel(value: ClipGenre, l: ReturnType<typeof useLocalizedCopy>): string {
  if (value === 'talk') return l('演讲 / 观点', 'Talk / commentary');
  if (value === 'podcast') return l('播客对谈', 'Podcast');
  if (value === 'tutorial') return l('教程 / 知识', 'Tutorial / education');
  if (value === 'interview') return l('人物访谈', 'Interview');
  if (value === 'entertainment') return l('娱乐内容', 'Entertainment');
  if (value === 'sports') return l('体育内容', 'Sports');
  if (value === 'gaming') return l('游戏内容', 'Gaming');
  if (value === 'news') return l('新闻 / 时事', 'News / current affairs');
  return l('自动判断', 'Auto detect');
}

function sourceLanguageLabel(value: string, l: ReturnType<typeof useLocalizedCopy>): string {
  if (value === 'zh_cn') return l('简体中文', 'Simplified Chinese');
  if (value === 'zh_tw') return l('繁體中文', 'Traditional Chinese');
  if (value === 'ja') return '日本語';
  if (value === 'ko') return '한국어';
  if (value === 'es') return 'Español';
  if (value === 'fr') return 'Français';
  if (value === 'de') return 'Deutsch';
  if (value === 'pt') return 'Português';
  if (value === 'ru') return 'Русский';
  if (value === 'en') return 'English';
  return l('自动检测', 'Auto detect');
}

function aspectRatioLabel(value: ClipAspectRatio, l: ReturnType<typeof useLocalizedCopy>): string {
  if (value === '16:9') return l('横屏 16:9', 'Landscape 16:9');
  if (value === '9:16') return l('竖屏 9:16', 'Portrait 9:16');
  if (value === '1:1') return l('方形 1:1', 'Square 1:1');
  return l('跟随原视频', 'Match source');
}

function scoreLabel(value: ClipScoreKey, l: ReturnType<typeof useLocalizedCopy>): string {
  if (value === 'hook') return l('开头', 'Hook');
  if (value === 'information') return l('信息', 'Information');
  if (value === 'emotion') return l('情绪', 'Emotion');
  return l('完整度', 'Completeness');
}

function readProgressText(
  stage: CreatorStageRun | undefined,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (stage?.stageId === 'probe') return l('正在读取视频信息', 'Reading video information');
  if (stage?.stageId === 'download') return l('正在下载源视频', 'Downloading the source video');
  if (stage?.stageId === 'subtitle') return l('正在生成视频字幕', 'Generating the transcript');
  if (stage?.stageId === 'analyze') return l('正在识别最适合独立传播的高光片段', 'Finding the strongest standalone moments');
  if (stage?.stageId === 'render') {
    const completed = readNumber(stage.progress.completed);
    const total = readNumber(stage.progress.total);
    return total > 0
      ? l(`正在生成切片 ${completed}/${total}`, `Rendering clips ${completed}/${total}`)
      : l('正在生成视频切片', 'Rendering video clips');
  }
  return l('正在准备任务', 'Preparing the task');
}

function readFocus(value: CreatorJson | undefined): AnalysisFocus {
  return value === 'viral' || value === 'knowledge' ? value : 'balanced';
}

function readGenre(value: CreatorJson | undefined): ClipGenre {
  return value === 'talk'
    || value === 'podcast'
    || value === 'tutorial'
    || value === 'interview'
    || value === 'entertainment'
    || value === 'sports'
    || value === 'gaming'
    || value === 'news'
    ? value
    : 'auto';
}

function readSourceLanguage(value: CreatorJson | undefined): string {
  return typeof value === 'string' && [
    'auto',
    'zh_cn',
    'zh_tw',
    'en',
    'ja',
    'ko',
    'es',
    'fr',
    'de',
    'pt',
    'ru'
  ].includes(value) ? value : 'auto';
}

function readDuration(value: CreatorJson | undefined): ClipDuration {
  return value === '15-30' || value === '60-90' ? value : '30-60';
}

function readAspectRatio(value: CreatorJson | undefined): ClipAspectRatio {
  return value === 'source' || value === '16:9' || value === '9:16' || value === '1:1' ? value : 'source';
}

function aspectRatioOrientation(value: ClipAspectRatio): VideoOrientation | undefined {
  if (value === '9:16') return 'portrait';
  if (value === '16:9') return 'landscape';
  if (value === '1:1') return 'square';
  return undefined;
}

function readClipCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' ? clampClipCount(value) : 3;
}

function clampClipCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.round(value)));
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: CreatorJson | undefined): value is Record<string, CreatorJson> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function findArtifact(
  artifacts: CreatorArtifact[],
  artifactId: string,
  kind: string
): CreatorArtifact | undefined {
  return artifacts.find(artifact => (
    artifact.id === artifactId
    && artifact.kind === kind
    && artifact.status === 'completed'
  ));
}

function latestCompletedArtifact(
  artifacts: CreatorArtifact[],
  kind: string
): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => (
    artifact.kind === kind && artifact.status === 'completed'
  ));
}

function matchingSourceArtifact(
  artifacts: CreatorArtifact[],
  artifactId: string,
  sourceUrl: string
): CreatorArtifact | undefined {
  const selected = findArtifact(artifacts, artifactId, 'source_video');
  if (selected !== undefined) return selected;
  const normalizedUrl = sourceUrl.trim();
  return [...artifacts].reverse().find(artifact => {
    if (
      artifact.kind !== 'source_video'
      || artifact.status !== 'completed'
      || normalizedUrl.length === 0
    ) return false;
    const probe = relatedArtifact(artifacts, artifact, 'download_probe');
    return [
      artifact.metadata.sourceUrl,
      artifact.metadata.requestedUrl,
      artifact.metadata.webpageUrl,
      probe?.metadata.url,
      probe?.metadata.requestedUrl
    ].some(value => typeof value === 'string' && value.trim() === normalizedUrl);
  });
}

function matchingSubtitleArtifact(
  artifacts: CreatorArtifact[],
  source: CreatorArtifact
): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => (
    artifact.kind === 'target_subtitle'
    && artifact.status === 'completed'
    && artifact.sourceArtifactIds.includes(source.id)
  ));
}

function latestStage(stages: CreatorStageRun[], stageIds: Set<string>): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => stageIds.has(stage.stageId));
}

function latestFailedStage(stages: CreatorStageRun[]): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => stage.status === 'failed');
}

function latestExportsForCandidateArtifact(
  artifacts: CreatorArtifact[],
  candidateArtifactId: string
): CreatorArtifact[] {
  const latestByCandidate = new Map<string, CreatorArtifact>();
  for (const artifact of artifacts) {
    if (
      artifact.kind !== 'auto_clip_video'
      || artifact.status !== 'completed'
      || artifact.metadata.candidateArtifactId !== candidateArtifactId
    ) continue;
    const candidateId = readString(artifact.metadata.candidateId) || artifact.id;
    latestByCandidate.set(candidateId, artifact);
  }
  return [...latestByCandidate.values()].sort((left, right) => (
    readNumber(left.metadata.start) - readNumber(right.metadata.start)
  ));
}

function artifactFileName(artifact: CreatorArtifact | undefined): string {
  if (artifact === undefined) return '';
  const value = artifact.metadata.fileName;
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function relatedArtifact(
  artifacts: CreatorArtifact[],
  artifact: CreatorArtifact | undefined,
  kind: string
): CreatorArtifact | undefined {
  if (artifact === undefined) return undefined;
  const sourceIds = new Set(artifact.sourceArtifactIds);
  return artifacts.find(candidate => candidate.kind === kind && sourceIds.has(candidate.id));
}

function readOrientation(artifact: CreatorArtifact | undefined): VideoOrientation | undefined {
  const width = readNumber(artifact?.metadata.width);
  const height = readNumber(artifact?.metadata.height);
  if (width <= 0 || height <= 0) return undefined;
  if (Math.abs(width - height) / Math.max(width, height) < 0.02) return 'square';
  return height > width ? 'portrait' : 'landscape';
}

function formatClipError(
  error: unknown,
  l: (zh: string, en: string) => string
): string {
  if (error === null || error === undefined) return '';
  const candidate = error as { code?: unknown; errorCode?: unknown; message?: unknown; errorMessage?: unknown };
  const code = typeof candidate.code === 'string'
    ? candidate.code
    : typeof candidate.errorCode === 'string'
      ? candidate.errorCode
      : '';
  if (code === 'creator_llm_config_missing') return l('请先在设置中配置文本模型', 'Configure the text model in Settings first');
  if (code === 'creator_transcription_config_missing') return l('请先在设置中配置视频转录服务', 'Configure video transcription in Settings first');
  if (code === 'unsupported_source') return l('目前仅支持公开视频链接或本地视频文件', 'Use a supported public video URL or a local video file');
  if (code === 'creator_clip_candidates_missing') return l('没有可生成的视频片段，请重新分析', 'No clips are available. Run the analysis again.');
  if (code === 'creator_stage_canceled') return l('视频切片任务已取消', 'The video clip task was canceled');
  return l('视频切片未完成，请检查来源与服务配置后重试', 'Video clipping did not complete. Check the source and service settings, then retry.');
}
