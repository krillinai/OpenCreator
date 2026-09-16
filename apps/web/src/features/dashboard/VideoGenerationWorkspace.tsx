import {
  defaultVideoGenerationModels,
  readCreatorResultSnapshots,
  videoGenerationModelIds,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorServicesConfig,
  type CreatorStageRun,
  type VideoGenerationDuration,
  type VideoGenerationProvider,
  type VideoGenerationSize
} from '@opencreator/protocol';
import {
  Check,
  Clapperboard,
  Download,
  Film,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  WandSparkles,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

type VideoStep = 0 | 1 | 2;
type VideoResultVersion = {
  value: number;
  description: string;
  artifact: CreatorArtifact;
  state: Record<string, CreatorJson>;
};
type VideoModelOption = {
  value: string;
  label: string;
};

const sizes: Array<{ value: VideoGenerationSize; zh: string; en: string; ratio: string }> = [
  { value: '1280x720', zh: '横屏', en: 'Landscape', ratio: '16:9' },
  { value: '720x1280', zh: '竖屏', en: 'Portrait', ratio: '9:16' },
  { value: '1024x1024', zh: '方形', en: 'Square', ratio: '1:1' }
];

const providers: Array<{ value: VideoGenerationProvider; zh: string; en: string }> = [
  { value: 'seedance', zh: 'Seedance', en: 'Seedance' },
  { value: 'kling', zh: '可灵', en: 'Kling' },
  { value: 'veo', zh: 'Veo', en: 'Veo' }
];

const providerDurations: Record<VideoGenerationProvider, VideoGenerationDuration[]> = {
  seedance: [5, 10],
  kling: [5, 10],
  veo: [4, 6, 8]
};
const modelLabels: Record<string, string> = {
  'doubao-seedance-2-5-260628': 'Seedance 2.5',
  'doubao-seedance-2-0-260128': 'Seedance 2.0',
  'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
  'doubao-seedance-2-0-mini-260615': 'Seedance 2.0 Mini',
  'doubao-seedance-1-5-pro-251215': 'Seedance 1.5 Pro',
  'doubao-seedance-1-0-pro-fast-251015': 'Seedance 1.0 Pro Fast',
  'doubao-seedance-1-0-pro-250528': 'Seedance 1.0 Pro',
  'kling-v2-1-master': 'Kling 2.1 Master',
  'veo-3.1-generate-preview': 'Veo 3.1'
};

const samplePromptZh = '一辆复古红色跑车沿着海岸公路行驶，黄昏金色阳光，低机位跟拍，海风吹动路边植物，电影级真实质感，镜头运动平稳';
const samplePromptEn = 'A vintage red sports car driving along a coastal road at golden hour, low-angle tracking shot, sea breeze moving roadside plants, cinematic realism, smooth camera motion';
const referenceImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxReferenceImageBytes = 5 * 1024 * 1024;

export default function VideoGenerationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  creatorServicesService?: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const restoredResults = session?.job.artifacts.some(artifact => (
    artifact.kind === 'generated_video' && artifact.status === 'completed'
  )) === true;
  const restoredStep = restoredResults ? 2 : readVideoStep(session?.state.currentStep, 0);
  const [currentStep, setCurrentStep] = useState<VideoStep>(restoredStep);
  const [furthestStep, setFurthestStep] = useState<VideoStep>(() => (
    Math.max(
      restoredStep,
      readVideoStep(session?.state.furthestStep, restoredStep),
      restoredResults ? 2 : 0
    ) as VideoStep
  ));
  const [prompt, setPrompt] = useState(() => readString(session?.state.prompt));
  const [referenceImageFile, setReferenceImageFile] = useState<File>();
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  const initialProvider = readProvider(session?.state.provider);
  const settingsRevision = useRef(0);
  const [modelDefaults, setModelDefaults] = useState<Record<VideoGenerationProvider, string>>(
    () => ({ ...defaultVideoGenerationModels })
  );
  const [provider, setProvider] = useState<VideoGenerationProvider>(() => (
    initialProvider
  ));
  const [model, setModel] = useState(() => readModel(session?.state.model, initialProvider));
  const [size, setSize] = useState<VideoGenerationSize>(() => readSize(session?.state.size));
  const [duration, setDuration] = useState<VideoGenerationDuration>(() => (
    readDuration(session?.state.duration, readProvider(session?.state.provider))
  ));
  const resultVersion = session?.job.state.resultVersion;
  const [videoUrl, setVideoUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const characterCount = useMemo(() => [...prompt.trim()].length, [prompt]);
  const selectedSize = sizes.find(item => item.value === size) ?? sizes[0]!;
  const selectedProvider = providers.find(item => item.value === provider) ?? providers[0]!;
  const modelOptions = useMemo(
    () => createVideoModelOptions(provider, modelDefaults[provider], model),
    [model, modelDefaults, provider]
  );
  const selectedModelLabel = videoModelLabel(model);
  const durations = providerDurations[provider];
  const resultVersions = useMemo(
    () => createVideoResultVersions(session?.job.artifacts ?? [], session?.state.resultSnapshots),
    [session?.job.artifacts, session?.state.resultSnapshots]
  );
  const latestVersion = resultVersions.at(-1)?.value;
  const selectedResult = resultVersions.find(version => version.value === resultVersion)
    ?? resultVersions.at(-1);
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'generate').at(-1);
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const resumable = latestStage?.status === 'canceled'
    || latestStage?.status === 'interrupted'
    || isRecoverableVideoStage(latestStage);
  const runtimeError = latestStage?.status === 'failed'
    ? formatVideoError(
        { code: latestStage.errorCode, message: latestStage.errorMessage },
        l,
        selectedModelLabel,
        provider
      )
    : session?.error === null || session?.error === undefined
      ? ''
      : formatVideoError(session.error, l, selectedModelLabel, provider);
  const visibleError = error || runtimeError || previewError;
  const settingsDeepLink = readNeedsInputDeepLink(session?.state.needsInput);
  const activeReferenceArtifact = findArtifact(
    session?.job.artifacts ?? [],
    session?.state.referenceImageArtifactId,
    'reference_image'
  );
  const currentReferenceName = referenceImageFile?.name
    ?? readArtifactString(activeReferenceArtifact, 'fileName');
  const followsReferenceRatio = provider === 'seedance' && Boolean(currentReferenceName);
  const resultSettings = selectedResult?.state;
  const resultProvider = providers.find(item => (
    item.value === readProvider(resultSettings?.provider)
  )) ?? providers[0]!;
  const resultSize = readSize(resultSettings?.size);
  const resultSizeOption = sizes.find(item => item.value === resultSize) ?? sizes[0]!;
  const resultWidth = readArtifactNumber(selectedResult?.artifact, 'width');
  const resultHeight = readArtifactNumber(selectedResult?.artifact, 'height');
  const resultRatio = resultWidth !== undefined && resultHeight !== undefined
    ? formatAspectRatio(resultWidth, resultHeight)
    : resultSizeOption.ratio;
  const resultResolution = resultWidth !== undefined && resultHeight !== undefined
    ? `${resultWidth}x${resultHeight}`
    : resultSize;
  const resultFormatLabel = resultWidth !== undefined && resultHeight !== undefined
    ? videoFormatLabel(resultWidth, resultHeight, l)
    : l(resultSizeOption.zh, resultSizeOption.en);
  const resultDuration = readDuration(resultSettings?.duration, resultProvider.value);
  const resultModel = readArtifactString(selectedResult?.artifact, 'model')
    ?? readOptionalModel(resultSettings?.model)
    ?? modelDefaults[resultProvider.value];
  const resultModelLabel = videoModelLabel(resultModel);
  const progressPercent = readProgressPercent(latestStage?.progress.percent);
  const progressLabel = latestStage === undefined
    ? l('正在准备任务', 'Preparing the task')
    : videoPhaseLabel(readString(latestStage.progress.phase), l);

  useEffect(() => {
    if (props.creatorServicesService === null || props.creatorServicesService === undefined) {
      return undefined;
    }
    let active = true;
    const revision = settingsRevision.current;
    void props.creatorServicesService.getConfig()
      .then(response => {
        if (!active) return;
        const defaults = videoModelDefaults(response.config);
        setModelDefaults(defaults);
        if (settingsRevision.current !== revision) return;
        const savedProvider = readOptionalProvider(session?.state.provider);
        const nextProvider = savedProvider ?? response.config.video.provider;
        const nextModel = readOptionalModel(session?.state.model) ?? defaults[nextProvider];
        const nextDuration = readDuration(session?.state.duration, nextProvider);
        setProvider(nextProvider);
        setModel(nextModel);
        setDuration(nextDuration);
        session?.updateDraft({
          provider: nextProvider,
          model: nextModel,
          duration: nextDuration
        }, { persist: false });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [props.creatorServicesService, session?.job.id]);

  useEffect(() => {
    if (referenceImageFile !== undefined) {
      const url = URL.createObjectURL(referenceImageFile);
      setReferenceImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (activeReferenceArtifact === undefined || session === null) {
      setReferenceImageUrl('');
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    void session.openArtifact(activeReferenceArtifact.id)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setReferenceImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setReferenceImageUrl('');
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeReferenceArtifact?.id, referenceImageFile, session?.openArtifact]);

  useEffect(() => {
    if (selectedResult === undefined || session === null) {
      setVideoUrl('');
      setPreviewError('');
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    setVideoUrl('');
    setPreviewError('');
    void session.openArtifact(selectedResult.artifact.id)
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setVideoUrl(objectUrl);
      })
      .catch(cause => {
        if (active) {
          setPreviewError(l(
            '视频预览加载失败，可以稍后重试或直接下载',
            `The video preview failed to load: ${cause instanceof Error ? cause.message : String(cause)}`
          ));
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [l, selectedResult?.artifact.id, session?.openArtifact]);

  useEffect(() => {
    if (latestVersion !== undefined && !generating) {
      setNotice(l('视频已生成，可以预览或下载', 'The video is ready to preview or download'));
    }
  }, [generating, l, latestVersion]);

  function openStep(step: VideoStep) {
    const nextFurthestStep = Math.max(furthestStep, step) as VideoStep;
    setCurrentStep(step);
    setFurthestStep(nextFurthestStep);
    session?.updateDraft({
      currentStep: step,
      furthestStep: nextFurthestStep
    });
  }

  function nextStep() {
    setError('');
    if (currentStep === 0 && characterCount === 0) {
      setError(l('请先描述需要生成的视频', 'Describe the video you want to create'));
      return;
    }
    openStep(Math.min(2, currentStep + 1) as VideoStep);
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    session?.updateDraft({ prompt: value });
    setError('');
  }

  function updateProvider(nextProvider: VideoGenerationProvider) {
    settingsRevision.current += 1;
    const nextDurations = providerDurations[nextProvider];
    const nextDuration = nextDurations.includes(duration) ? duration : nextDurations[0]!;
    const nextModel = modelDefaults[nextProvider] || defaultVideoGenerationModels[nextProvider];
    setProvider(nextProvider);
    setModel(nextModel);
    setDuration(nextDuration);
    session?.updateDraft({
      provider: nextProvider,
      model: nextModel,
      duration: nextDuration
    });
    setError('');
  }

  function updateModel(nextModel: string) {
    settingsRevision.current += 1;
    setModel(nextModel);
    session?.updateDraft({ model: nextModel });
    setError('');
  }

  function updateSize(nextSize: VideoGenerationSize) {
    setSize(nextSize);
    session?.updateDraft({ size: nextSize });
    setError('');
  }

  function updateDuration(nextDuration: VideoGenerationDuration) {
    settingsRevision.current += 1;
    setDuration(nextDuration);
    session?.updateDraft({ duration: nextDuration });
    setError('');
  }

  function updateReferenceImage(file: File | null) {
    if (!file) return;
    if (
      !(referenceImageTypes as readonly string[]).includes(file.type)
      || file.size > maxReferenceImageBytes
    ) {
      setError(l(
        '请上传 5MB 以内的 JPG、PNG 或 WebP 图片',
        'Upload a JPG, PNG, or WebP image up to 5 MB'
      ));
      return;
    }
    setReferenceImageFile(file);
    setError('');
    setNotice(l('参考图已添加，将在生成时上传', 'Reference image added and will be uploaded when generation starts'));
  }

  function removeReferenceImage() {
    setReferenceImageFile(undefined);
    setReferenceImageUrl('');
    session?.updateDraft({ referenceImageArtifactId: null }, { semantic: true });
    setError('');
    setNotice(l('参考图已移除', 'Reference image removed'));
  }

  async function generate() {
    if (generating) return;
    if (session === null) {
      setError(l(
        '视频生成服务暂不可用，请检查 Runtime 连接',
        'Video generation is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    if (!prompt.trim()) {
      setError(l('请先描述需要生成的视频', 'Describe the video you want to create'));
      openStep(0);
      return;
    }
    setError('');
    setNotice('');
    session.updateDraft({
      prompt: prompt.trim(),
      provider,
      model,
      size,
      duration
    }, { semantic: true });
    try {
      await session.flush();
      if (
        referenceImageFile !== undefined
        && !artifactMatchesFile(activeReferenceArtifact, referenceImageFile)
      ) {
        setNotice(l('正在上传参考图...', 'Uploading the reference image...'));
        await session.uploadReferenceImage(referenceImageFile);
        setReferenceImageFile(undefined);
      }
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'generate' }
      });
      setNotice(l(
        '视频生成任务已提交，可以离开当前页面，完成后会保留在项目中',
        'Video generation started. You can leave this page and return to the saved result later.'
      ));
    } catch (caught) {
      setError(formatVideoError(caught, l, selectedModelLabel, provider));
    }
  }

  async function download() {
    if (selectedResult === undefined || session === null) return;
    try {
      let temporaryUrl: string | undefined;
      if (!videoUrl) {
        const response = await session.openArtifact(selectedResult.artifact.id);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        temporaryUrl = URL.createObjectURL(await response.blob());
      }
      const link = document.createElement('a');
      link.href = videoUrl || temporaryUrl!;
      link.download = artifactFileName(selectedResult.artifact, selectedResult.value);
      link.click();
      if (temporaryUrl !== undefined) {
        window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
      }
      setNotice(l('视频已开始下载', 'Video download started'));
    } catch (caught) {
      setError(formatVideoError(caught, l, selectedModelLabel, provider));
    }
  }

  async function cancelTask() {
    if (session === null || !generating || taskControlPending !== undefined) return;
    setTaskControlPending('canceling');
    setError('');
    try {
      await session.cancelJob();
      setNotice(l('已停止跟踪当前视频生成任务', 'Stopped tracking the current video generation task'));
    } catch (caught) {
      setError(formatVideoError(caught, l, selectedModelLabel, provider));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || !resumable || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    setError('');
    try {
      if (isRecoverableVideoStage(latestStage)) {
        await session.applyAction({
          actor: 'user',
          action: 'run-stage',
          input: { stageId: 'generate' }
        });
      } else {
        await session.resumeJob();
      }
      setNotice(l('正在继续查询原视频生成任务', 'Resuming the existing video generation task'));
    } catch (caught) {
      setError(formatVideoError(caught, l, selectedModelLabel, provider));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  function selectVersion(version: number) {
    openStep(2);
    setNotice(l(`正在查看 V${version}`, `Viewing V${version}`));
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn));
      openStep(0);
      return l('示例提示词已填入，可以继续设置画幅和时长。', 'The sample prompt is ready. Continue with format and duration.');
    }
    if (/横屏|横版|landscape|16:9/i.test(command)) {
      updateSize('1280x720');
      openStep(1);
      return l('视频画幅已改为横屏 16:9。', 'Video format changed to landscape 16:9.');
    }
    if (/竖屏|竖版|portrait|9:16/i.test(command)) {
      updateSize('720x1280');
      openStep(1);
      return l('视频画幅已改为竖屏 9:16。', 'Video format changed to portrait 9:16.');
    }
    const normalized = command.toLowerCase();
    const providerMatch = providers.find(item => (
      normalized.includes(item.value)
      || command.includes(item.zh)
      || normalized.includes(item.en.toLowerCase())
    ));
    if (providerMatch) {
      updateProvider(providerMatch.value);
      openStep(1);
      return l(
        `视频服务已改为${providerMatch.zh}。`,
        `Video provider changed to ${providerMatch.en}.`
      );
    }
    if (command.trim().length > 8) {
      updatePrompt(command.trim());
      openStep(0);
      return l('视频描述已同步，可以继续设置生成参数。', 'The video description is synchronized. Continue with generation settings.');
    }
    return l('请描述主体动作、场景、镜头运动、光线和视觉风格。', 'Describe the action, scene, camera movement, lighting, and visual style.');
  }

  return (
    <CreatorToolShell
      title={l('视频生成', 'Video Generation')}
      subtitle={l('根据文字或参考图生成 AI 视频片段', 'Generate an AI video clip from text or a reference image')}
      context={selectedResult
        ? l(
            `V${selectedResult.value} · ${resultModelLabel} · ${resultRatio} · ${resultDuration} 秒`,
            `V${selectedResult.value} · ${resultModelLabel} · ${resultRatio} · ${resultDuration} seconds`
          )
        : generating
          ? progressPercent === null
            ? progressLabel
            : `${progressLabel} · ${progressPercent}%`
          : currentStep === 0
            ? l('正在编辑视频描述', 'Editing video description')
            : currentStep === 1
              ? `${selectedModelLabel} · ${followsReferenceRatio
                ? l('跟随参考图', 'Match reference image')
                : l(selectedSize.zh, selectedSize.en)} · ${duration}s`
              : l('等待生成', 'Ready to generate')}
      initialMessage={l(
        '描述你想生成的视频，包括主体动作、镜头和画面风格。',
        'Describe the video, including subject movement, camera direction, and visual style.'
      )}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('生成竖屏视频', 'Create a portrait video')]}
      placeholder={props.promptHint ?? l('描述需要生成的视频', 'Describe the video to generate')}
      onBack={props.onBack}
      onCommand={handleCommand}
      pageClassName="video-generation-workspace-page"
      contentClassName="media-generation-workspace-content"
      currentIssue={visibleError || undefined}
      onCancelTask={generating ? () => void cancelTask() : undefined}
      onResumeTask={resumable ? () => void resumeTask() : undefined}
      taskControlPending={taskControlPending}
    >
      <div className="creator-tool-stack media-generation-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('视频生成流程', 'Video generation workflow')}>
          <ol>
            {[l('视频描述', 'Prompt'), l('生成设置', 'Settings'), l('生成视频', 'Generate')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return (
                <li key={label} data-active={active} data-completed={completed}>
                  <button
                    type="button"
                    disabled={index > furthestStep}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => openStep(index as VideoStep)}
                  >
                    <span>{completed ? <Check size={13} strokeWidth={2.2} /> : index + 1}</span>
                    <strong>{label}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="media-generation-step-scroll">
          {currentStep === 0 ? (
            <section className="creator-tool-panel media-generation-prompt-panel" aria-labelledby="video-prompt-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="video-prompt-title">{l('视频描述', 'Video prompt')}</h2>
                  <p>{l(
                    '写清主体动作、环境、镜头运动、光线和风格，最多 4000 字',
                    'Describe action, setting, camera movement, lighting, and style, up to 4,000 characters'
                  )}</p>
                </div>
                <small>{characterCount} / 4000</small>
              </div>
              <div className="video-generation-prompt-inputs">
                <div className="video-reference-field">
                  <span className="video-reference-label">{l('参考图', 'Reference')}</span>
                  <div className="video-reference-upload-wrap">
                    <label className="video-reference-upload" title={l('上传 JPG、PNG 或 WebP 图片，最大 5MB', 'Upload a JPG, PNG, or WebP image up to 5 MB')}>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label={l('上传视频参考图', 'Upload video reference image')}
                        onChange={event => updateReferenceImage(event.target.files?.[0] ?? null)}
                      />
                      <span className="video-reference-thumbnail" data-loaded={currentReferenceName ? 'true' : 'false'}>
                        {referenceImageUrl
                          ? <img src={referenceImageUrl} alt={l('视频参考图预览', 'Video reference preview')} />
                          : (
                            <>
                              <Plus size={22} strokeWidth={1.6} />
                              <small>{l('添加图片', 'Add image')}</small>
                            </>
                          )}
                      </span>
                    </label>
                    {currentReferenceName ? (
                      <button
                        className="video-reference-remove"
                        type="button"
                        onClick={removeReferenceImage}
                        aria-label={l('移除参考图', 'Remove reference image')}
                        title={l('移除参考图', 'Remove reference image')}
                      >
                        <X size={15} strokeWidth={1.8} />
                      </button>
                    ) : null}
                  </div>
                  <small className="video-reference-meta" title={currentReferenceName ?? l('支持 JPG、PNG、WebP，最大 5MB', 'JPG, PNG, or WebP, up to 5 MB')}>
                    {currentReferenceName ?? l('选填', 'Optional')}
                  </small>
                </div>
                <label className="creator-tool-field">
                  <span>{l('提示词', 'Prompt')}</span>
                  <textarea
                    rows={12}
                    maxLength={4000}
                    value={prompt}
                    onChange={event => updatePrompt(event.target.value)}
                    placeholder={l(
                      '例如：低机位跟随一辆红色跑车驶过海岸公路，黄昏金色光线，镜头平稳',
                      'For example: A low-angle tracking shot following a red sports car along a coastal road at golden hour, smooth camera motion'
                    )}
                  />
                </label>
              </div>
              <button className="smart-dubbing-sample" type="button" onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn))}>
                <WandSparkles size={14} strokeWidth={1.8} />
                {l('填入示例提示词', 'Use sample prompt')}
              </button>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="video-settings-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="video-settings-title">{l('生成设置', 'Generation settings')}</h2>
                  <p>{l('设置视频服务、模型版本、画幅、分辨率和时长', 'Set the video provider, model version, format, resolution, and duration')}</p>
                </div>
              </div>
              <div className="video-generation-settings-grid">
                <label className="creator-tool-field">
                  <span>{l('视频服务', 'Video provider')}</span>
                  <select value={provider} onChange={event => updateProvider(event.target.value as VideoGenerationProvider)}>
                    {providers.map(item => <option key={item.value} value={item.value}>{l(item.zh, item.en)}</option>)}
                  </select>
                </label>
                <label className="creator-tool-field">
                  <span>{l('模型版本', 'Model version')}</span>
                  <select value={model} onChange={event => updateModel(event.target.value)}>
                    {modelOptions.map(item => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>
                <label className="creator-tool-field">
                  <span>{l('画幅', 'Format')}</span>
                  <select
                    value={size}
                    disabled={followsReferenceRatio}
                    title={followsReferenceRatio
                      ? l('Seedance 参考图模式会跟随参考图画幅', 'Seedance matches the reference image aspect ratio')
                      : undefined}
                    onChange={event => updateSize(event.target.value as VideoGenerationSize)}
                  >
                    {followsReferenceRatio ? (
                      <option value={size}>{l('跟随参考图', 'Match reference image')}</option>
                    ) : sizes.map(item => <option key={item.value} value={item.value}>{l(item.zh, item.en)} · {item.ratio} · {item.value}</option>)}
                  </select>
                </label>
                <label className="creator-tool-field">
                  <span>{l('视频时长', 'Video duration')}</span>
                  <select value={duration} onChange={event => updateDuration(Number(event.target.value) as VideoGenerationDuration)}>
                    {durations.map(value => <option key={value} value={value}>{value} {l('秒', 'seconds')}</option>)}
                  </select>
                </label>
              </div>
              <div className="media-generation-setting-note">
                <Film size={17} strokeWidth={1.7} />
                <span>
                  <strong>{l('后台生成', 'Background generation')}</strong>
                  <small>{l(
                    '任务提交后可以离开当前页面，生成状态和结果会保留在项目中',
                    'You can leave after submission. Progress and results remain available in the project.'
                  )}</small>
                </span>
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <div className="creator-task-final-grid media-generation-final-grid">
              <section className="creator-tool-panel media-generation-output-panel" aria-labelledby="video-output-title">
                <div className="creator-tool-panel-heading">
                  <div>
                    <h2 id="video-output-title">{selectedResult ? l('生成结果', 'Generated video') : l('生成视频', 'Generate video')}</h2>
                    <p>{selectedResult
                      ? l('预览历史版本并下载需要的成片', 'Preview previous versions and download the video you need')
                      : generating
                        ? l('任务正在后台生成，完成后会自动显示', 'The task is running in the background and will appear automatically')
                        : l('确认设置后提交视频生成任务', 'Review the settings, then submit the generation job')}</p>
                  </div>
                  {selectedResult ? (
                    <CreatorResultVersionMenu
                      version={selectedResult.value}
                      versions={resultVersions.map((version, index) => ({
                        value: version.value,
                        description: index === 0
                          ? l('初次生成', 'Initial generation')
                          : l(`第 ${index + 1} 次生成`, `Generation ${index + 1}`)
                      }))}
                      onVersionChange={selectVersion}
                    />
                  ) : null}
                </div>
                {selectedResult ? (
                  <div className="video-generation-result" data-ratio={resultRatio}>
                    {videoUrl ? (
                      <video controls src={videoUrl} aria-label={l('生成视频预览', 'Generated video preview')} />
                    ) : (
                      <div className="video-result-player-status" role="status">
                        <LoaderCircle className="smart-dubbing-spinner" size={18} />
                        {l('正在加载视频预览', 'Loading video preview')}
                      </div>
                    )}
                    <div>
                      <span>
                        <strong>{artifactFileName(selectedResult.artifact, selectedResult.value)}</strong>
                        <small>
                          {formatBytes(readArtifactBytes(selectedResult.artifact))}
                          {' · '}{resultModelLabel}
                        </small>
                      </span>
                      <div>
                        <button type="button" onClick={() => void generate()} disabled={generating}>
                          {generating
                            ? <LoaderCircle className="smart-dubbing-spinner" size={15} />
                            : <RotateCcw size={15} />}
                          {generating ? l('正在生成', 'Generating') : l('重新生成', 'Regenerate')}
                        </button>
                        <button className="creator-tool-primary" type="button" onClick={() => void download()}>
                          <Download size={15} />
                          {l('下载视频', 'Download video')}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : generating ? (
                  <div className="video-generation-progress" role="status">
                    <span><LoaderCircle className="smart-dubbing-spinner" size={25} /></span>
                    <strong>{progressLabel}</strong>
                    <p>{l(
                      '任务已保存在项目中，可以离开当前页面',
                      'The task is saved in the project, so you can leave this page'
                    )}</p>
                    {progressPercent === null ? null : (
                      <>
                        <div><span style={{ width: `${Math.max(4, progressPercent)}%` }} /></div>
                        <small>{progressPercent}%</small>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="smart-dubbing-ready">
                    <span><Clapperboard size={24} strokeWidth={1.6} /></span>
                    <strong>{resumable ? l('视频生成已暂停', 'Video generation paused') : l('准备生成视频', 'Ready to generate video')}</strong>
                    <p>{l(
                      `${l(selectedProvider.zh, selectedProvider.en)} · ${selectedModelLabel} · ${followsReferenceRatio
                        ? l('跟随参考图', 'Match reference image')
                        : selectedSize.ratio} · ${duration} 秒${followsReferenceRatio ? '' : ` · ${size}`}`,
                      `${selectedProvider.en} · ${selectedModelLabel} · ${followsReferenceRatio
                        ? 'Match reference image'
                        : selectedSize.ratio} · ${duration} seconds${followsReferenceRatio ? '' : ` · ${size}`}`
                    )}</p>
                    {resumable ? (
                      <button className="creator-tool-primary" type="button" onClick={() => void resumeTask()} disabled={taskControlPending !== undefined}>
                        {taskControlPending === 'resuming'
                          ? <LoaderCircle className="smart-dubbing-spinner" size={16} />
                          : <Sparkles size={16} />}
                        {l('继续任务', 'Resume task')}
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
              <CreatorTaskSummary
                sourceIcon={Clapperboard}
                sourceLabel={l('视频描述', 'Prompt')}
                sourceValue={selectedResult ? readString(resultSettings?.prompt) : prompt.trim()}
                items={selectedResult ? [
                  { label: l('视频服务', 'Provider'), value: l(resultProvider.zh, resultProvider.en) },
                  { label: l('模型版本', 'Model version'), value: resultModelLabel },
                  { label: l('画幅', 'Format'), value: `${resultFormatLabel} · ${resultRatio}` },
                  { label: l('分辨率', 'Resolution'), value: resultResolution },
                  { label: l('时长', 'Duration'), value: l(`${resultDuration} 秒`, `${resultDuration} seconds`) },
                  { label: l('当前版本', 'Version'), value: `V${selectedResult.value}` }
                ] : [
                  ...(currentReferenceName
                    ? [{ label: l('参考图', 'Reference image'), value: currentReferenceName }]
                    : []),
                  { label: l('视频服务', 'Provider'), value: l(selectedProvider.zh, selectedProvider.en) },
                  { label: l('模型版本', 'Model version'), value: selectedModelLabel },
                  { label: l('画幅', 'Format'), value: followsReferenceRatio
                    ? l('跟随参考图', 'Match reference image')
                    : `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` },
                  { label: l('分辨率', 'Resolution'), value: followsReferenceRatio
                    ? l('由模型根据参考图决定', 'Determined from the reference image')
                    : size },
                  { label: l('时长', 'Duration'), value: l(`${duration} 秒`, `${duration} seconds`) },
                  { label: l('输出格式', 'Output format'), value: 'MP4' }
                ]}
              />
            </div>
          ) : null}
          {visibleError ? (
            <p className="creator-tool-error" role="alert">
              {visibleError}
              {settingsDeepLink ? (
                <>
                  {' '}
                  <a href={settingsDeepLink}>{l('打开 AI 服务设置', 'Open AI service settings')}</a>
                </>
              ) : null}
            </p>
          ) : null}
          {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        <footer className="video-translation-wizard-actions media-generation-actions" aria-label={l('视频生成操作', 'Video generation actions')}>
          <button
            className="video-translation-secondary-action"
            type="button"
            onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as VideoStep)}
          >
            {currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}
          </button>
          {currentStep < 2 ? (
            <button className="video-translation-primary-action" type="button" onClick={nextStep}>
              {l('继续', 'Continue')}
            </button>
          ) : null}
          {currentStep === 2 && selectedResult === undefined && !generating && !resumable ? (
            <button className="video-translation-primary-action" type="button" onClick={() => void generate()}>
              <Sparkles size={16} />
              {l('开始生成', 'Generate')}
            </button>
          ) : null}
        </footer>
      </div>
    </CreatorToolShell>
  );
}

function createVideoResultVersions(
  artifacts: CreatorArtifact[],
  resultSnapshots: CreatorJson | undefined
): VideoResultVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const snapshots = readCreatorResultSnapshots(resultSnapshots);
  const fromSnapshots = snapshots.flatMap(snapshot => {
    const artifact = (snapshot.artifactRefs.generated_video ?? [])
      .map(id => byId.get(id))
      .find((candidate): candidate is CreatorArtifact => candidate !== undefined);
    return artifact === undefined ? [] : [{
      value: snapshot.version,
      description: snapshot.description,
      artifact,
      state: snapshot.state
    }];
  });
  if (fromSnapshots.length > 0) return fromSnapshots;

  return artifacts
    .filter(artifact => (
      artifact.kind === 'generated_video'
      && artifact.path !== null
      && artifact.status !== 'stale'
    ))
    .map(artifact => ({
      value: readPositiveInteger(artifact.metadata.resultVersion) ?? artifact.version,
      description: '生成视频',
      artifact,
      state: {}
    }))
    .sort((left, right) => left.value - right.value);
}

function readVideoStep(value: CreatorJson | undefined, fallback: VideoStep): VideoStep {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readProvider(value: CreatorJson | undefined): VideoGenerationProvider {
  return value === 'kling' || value === 'veo' ? value : 'seedance';
}

function readOptionalProvider(
  value: CreatorJson | undefined
): VideoGenerationProvider | undefined {
  return value === 'seedance' || value === 'kling' || value === 'veo'
    ? value
    : undefined;
}

function readModel(
  value: CreatorJson | undefined,
  provider: VideoGenerationProvider
): string {
  return readOptionalModel(value) ?? defaultVideoGenerationModels[provider];
}

function readOptionalModel(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function videoModelDefaults(
  config: CreatorServicesConfig
): Record<VideoGenerationProvider, string> {
  return {
    seedance: config.video.seedance.model.trim() || defaultVideoGenerationModels.seedance,
    kling: config.video.kling.model.trim() || defaultVideoGenerationModels.kling,
    veo: config.video.veo.model.trim() || defaultVideoGenerationModels.veo
  };
}

function createVideoModelOptions(
  provider: VideoGenerationProvider,
  configuredDefault: string,
  current: string
): VideoModelOption[] {
  const ids = [
    configuredDefault,
    ...videoGenerationModelIds[provider],
    current
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  return ids.map(value => ({
    value,
    label: videoModelLabel(value)
  }));
}

function videoModelLabel(model: string): string {
  return modelLabels[model] ?? model;
}

function readSize(value: CreatorJson | undefined): VideoGenerationSize {
  return value === '720x1280' || value === '1024x1024' ? value : '1280x720';
}

function readDuration(
  value: CreatorJson | undefined,
  provider: VideoGenerationProvider
): VideoGenerationDuration {
  const allowed = providerDurations[provider];
  return typeof value === 'number' && allowed.includes(value as VideoGenerationDuration)
    ? value as VideoGenerationDuration
    : allowed[0]!;
}

function findArtifact(
  artifacts: CreatorArtifact[],
  artifactId: CreatorJson | undefined,
  kind: string
): CreatorArtifact | undefined {
  return typeof artifactId === 'string'
    ? artifacts.find(artifact => (
        artifact.id === artifactId
        && artifact.kind === kind
        && artifact.status === 'completed'
      ))
    : undefined;
}

function artifactMatchesFile(artifact: CreatorArtifact | undefined, file: File): boolean {
  return artifact !== undefined
    && artifact.metadata.fileName === file.name
    && artifact.metadata.size === file.size
    && artifact.metadata.lastModified === file.lastModified;
}

function readArtifactString(
  artifact: CreatorArtifact | undefined,
  key: string
): string | undefined {
  const value = artifact?.metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readArtifactBytes(artifact: CreatorArtifact): number {
  const bytes = artifact.metadata.bytes ?? artifact.metadata.size;
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function readArtifactNumber(
  artifact: CreatorArtifact | undefined,
  key: string
): number | undefined {
  const value = artifact?.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function formatAspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.max(1, Math.round(left));
  let b = Math.max(1, Math.round(right));
  while (b > 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function videoFormatLabel(
  width: number,
  height: number,
  l: (zh: string, en: string) => string
): string {
  if (width === height) return l('方形', 'Square');
  return width > height ? l('横屏', 'Landscape') : l('竖屏', 'Portrait');
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readProgressPercent(value: CreatorJson | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function isRecoverableVideoStage(
  stage: CreatorStageRun | undefined
): boolean {
  return stage?.status === 'failed'
    && stage.errorCode === 'creator_video_upstream_error'
    && typeof stage.progress.videoGenerationResultId === 'string'
    && stage.progress.videoGenerationResultId.length > 0;
}

function readNeedsInputDeepLink(value: CreatorJson | undefined): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  return typeof value.deepLink === 'string' ? value.deepLink : '';
}

function artifactFileName(artifact: CreatorArtifact, version: number): string {
  return readArtifactString(artifact, 'fileName')
    ?? `OpenCreator-video-V${version}.mp4`;
}

function videoPhaseLabel(
  phase: string,
  l: (zh: string, en: string) => string
): string {
  const labels: Record<string, string> = {
    validating: l('检查视频生成设置', 'Checking video generation settings'),
    preparing_reference: l('准备视频参考图', 'Preparing the reference image'),
    submitting: l('提交视频生成任务', 'Submitting the video generation task'),
    queued: l('视频生成任务排队中', 'Video generation task queued'),
    generating: l('视频生成中', 'Generating video'),
    downloading: l('下载生成的视频', 'Downloading the generated video'),
    collecting_output: l('整理视频文件', 'Collecting the video file'),
    validating_output: l('检查视频文件', 'Checking the video file'),
    completed: l('视频已生成', 'Video generated')
  };
  return labels[phase] ?? l('正在处理视频生成任务', 'Processing the video generation task');
}

function formatBytes(size: number) {
  if (size <= 0) return 'MP4';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatVideoError(
  error: unknown,
  l: (zh: string, en: string) => string,
  modelLabel = '',
  provider: VideoGenerationProvider = 'seedance'
) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error
      ? error.message
      : '';
  if (code === 'creator_video_config_missing' || code === 'VIDEO_GENERATION_CONFIG_REQUIRED') {
    return l(
      '请先在设置的 AI 服务中配置视频生成服务',
      'Configure a video generation provider in AI Services first'
    );
  }
  if (code === 'creator_stage_interrupted_on_restart') {
    return l(
      'Runtime 重启中断了任务，可以继续查询原视频生成任务',
      'The Runtime restart interrupted this task. Resume it to continue checking the existing generation.'
    );
  }
  if (
    code === 'creator_video_model_unavailable'
    || isUnavailableModelMessage(message)
  ) {
    const selected = modelLabel || l('所选模型', 'the selected model');
    const consoleName = provider === 'seedance'
      ? l('方舟控制台', 'Ark Console')
      : l('服务商控制台', 'the provider console');
    return l(
      `当前账号未开通 ${selected}，请切换模型版本或前往${consoleName}开通`,
      `${selected} is not enabled for this account. Switch models or enable it in ${consoleName}.`
    );
  }
  if (code === 'creator_video_upstream_error' || code === 'VIDEO_GENERATION_UPSTREAM_ERROR') {
    return l(
      '视频生成请求失败，请检查模型服务配置和网络后重试',
      'Video generation failed. Check the provider configuration and network, then retry.'
    );
  }
  return message || l('视频生成失败，请稍后重试', 'Video generation failed. Try again later.');
}

function isUnavailableModelMessage(message: string): boolean {
  return /(?:not activated|not enabled|not subscribed|no permission|permission denied|access denied).{0,80}(?:model|service)|(?:model|service).{0,80}(?:not activated|not enabled|not subscribed|no permission|permission denied|access denied)/i
    .test(message);
}
