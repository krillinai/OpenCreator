import {
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorStageRun,
  type ImageGenerationQuality
} from '@opencreator/protocol';
import {
  Check,
  CircleStop,
  Download,
  ImagePlus,
  Images,
  Link2,
  LoaderCircle,
  RotateCcw,
  Settings2,
  Sparkles,
  UploadCloud
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

type CoverRatio = '16:9' | '1:1' | '9:16';
type CoverCandidateCount = 1 | 2 | 3 | 4;
type CoverStep = 0 | 1 | 2;
type CoverResultTab = 'options' | 'references' | 'settings';
type CoverResultVersion = {
  value: number;
  description: string;
  artifacts: CreatorArtifact[];
  state: Record<string, CreatorJson>;
  artifactRefs: Record<string, string[]>;
};

const samplePromptZh = '主体清晰，强视觉层级，电影级光线，高对比配色，适合视频平台封面，不生成文字';
const samplePromptEn = 'A clear subject, strong visual hierarchy, cinematic lighting, high-contrast colors, designed for a video thumbnail, no generated text';

export default function CoverGeneratorWorkspace(props: {
  onBack(): void;
  promptHint?: string;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const restoredResults = session?.job.artifacts.some(artifact => (
    artifact.kind === 'cover_image' && artifact.status === 'completed'
  )) === true;
  const restoredStep = readStep(session?.state.currentStep, restoredResults ? 2 : 0);
  const [currentStep, setCurrentStep] = useState<CoverStep>(restoredStep);
  const [furthestStep, setFurthestStep] = useState<CoverStep>(() => (
    Math.max(
      restoredStep,
      readStep(session?.state.furthestStep, restoredStep),
      restoredResults ? 2 : 0
    ) as CoverStep
  ));
  const [prompt, setPrompt] = useState(() => readString(session?.state.prompt));
  const [youtubeUrl, setYoutubeUrl] = useState(() => readString(session?.state.sourceUrl));
  const [ratio, setRatio] = useState<CoverRatio>(() => readRatio(session?.state.ratio));
  const [quality, setQuality] = useState<ImageGenerationQuality>(() => (
    readQuality(session?.state.quality)
  ));
  const [candidateCount, setCandidateCount] = useState<CoverCandidateCount>(() => (
    readCandidateCount(session?.state.candidateCount)
  ));
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState('');
  const [resultTab, setResultTab] = useState<CoverResultTab>(() => (
    readResultTab(session?.state.resultTab)
  ));
  const [resultVersion, setResultVersion] = useState<number>();
  const [artifactUrls, setArtifactUrls] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [taskControlPending, setTaskControlPending] = useState<
    'canceling' | 'resuming'
  >();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const resultVersions = useMemo(
    () => createCoverResultVersions(
      session?.job.artifacts ?? [],
      session?.state.resultSnapshots
    ),
    [session?.job.artifacts, session?.state.resultSnapshots]
  );
  const latestResult = resultVersions.at(-1);
  const latestResultValueRef = useRef(latestResult?.value);
  latestResultValueRef.current = latestResult?.value;
  const selectedResult = resultVersions.find(version => version.value === resultVersion)
    ?? latestResult;
  const reachableFurthestStep = latestResult === undefined ? furthestStep : 2;
  const activeStage = [...(session?.job.stages ?? [])].reverse().find(stage => (
    stage.status === 'queued' || stage.status === 'running'
  ));
  const latestStage = session?.job.stages.at(-1);
  const resumableStage = activeStage === undefined
    && (latestStage?.status === 'canceled' || latestStage?.status === 'interrupted')
    ? latestStage
    : undefined;
  const generating = activeStage !== undefined;
  const activeReferenceArtifact = findArtifact(
    session?.job.artifacts ?? [],
    session?.state.referenceImageArtifactId,
    'reference_image'
  );
  const selectedReferenceArtifact = selectedResult === undefined
    ? activeReferenceArtifact
    : artifactFromRefs(
        session?.job.artifacts ?? [],
        selectedResult.artifactRefs,
        'reference_image'
      );
  const selectedKeyframeArtifact = selectedResult === undefined
    ? undefined
    : artifactFromRefs(
        session?.job.artifacts ?? [],
        selectedResult.artifactRefs,
        'source_keyframe'
      );
  const issue = readIssue(session, latestStage, l);
  const canContinue = prompt.trim().length > 0 || isYoutubeUrl(youtubeUrl);
  const showRunNotice = Boolean(
    issue.message || error || (currentStep !== 2 && notice)
  );
  const currentReferenceName = referenceFile?.name
    ?? readArtifactString(activeReferenceArtifact, 'fileName');

  useEffect(() => {
    if (latestResult !== undefined) {
      setResultVersion(latestResult.value);
      setCurrentStep(2);
      setFurthestStep(2);
      setResultTab('options');
    }
  }, [latestResult?.value]);

  useEffect(() => {
    if (referenceFile === null) {
      if (activeReferenceArtifact === undefined || session === null) {
        setReferencePreview('');
        return undefined;
      }
      let active = true;
      let objectUrl = '';
      void session.openArtifact(activeReferenceArtifact.id)
        .then(async response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          objectUrl = URL.createObjectURL(await response.blob());
          if (active) setReferencePreview(objectUrl);
        })
        .catch(() => {
          if (active) setReferencePreview('');
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    const objectUrl = URL.createObjectURL(referenceFile);
    setReferencePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [activeReferenceArtifact?.id, referenceFile, session?.openArtifact]);

  useEffect(() => {
    const artifacts = uniqueArtifacts([
      ...(selectedResult?.artifacts ?? []),
      ...(selectedReferenceArtifact === undefined ? [] : [selectedReferenceArtifact]),
      ...(selectedKeyframeArtifact === undefined ? [] : [selectedKeyframeArtifact])
    ]);
    if (session === null || artifacts.length === 0) {
      setArtifactUrls({});
      return undefined;
    }
    let active = true;
    const objectUrls: string[] = [];
    setArtifactUrls({});
    void Promise.all(artifacts.map(async artifact => {
      const response = await session.openArtifact(artifact.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrls.push(objectUrl);
      return [artifact.id, objectUrl] as const;
    })).then(entries => {
      if (active) setArtifactUrls(Object.fromEntries(entries));
    }).catch(cause => {
      if (active) setError(formatCoverError(cause, l));
    });
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [
    selectedKeyframeArtifact?.id,
    selectedReferenceArtifact?.id,
    selectedResult?.artifacts,
    session?.openArtifact
  ]);

  function openStep(step: CoverStep) {
    const nextFurthest = Math.max(reachableFurthestStep, step) as CoverStep;
    setCurrentStep(step);
    setFurthestStep(nextFurthest);
    if (step < 2) setNotice('');
    session?.updateDraft({
      currentStep: step,
      furthestStep: nextFurthest,
      workspacePhase: step === 2 ? 'result' : 'configure'
    });
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    session?.updateDraft({ prompt: value });
    setError('');
  }

  function updateYoutubeUrl(value: string) {
    setYoutubeUrl(value);
    session?.updateDraft({
      sourceUrl: value,
      sourceType: value.trim() ? 'youtube' : 'prompt'
    });
    setError('');
  }

  function updateRatio(value: CoverRatio) {
    setRatio(value);
    session?.updateDraft({ ratio: value });
  }

  function updateQuality(value: ImageGenerationQuality) {
    setQuality(value);
    session?.updateDraft({ quality: value });
  }

  function updateCandidateCount(value: CoverCandidateCount) {
    setCandidateCount(value);
    session?.updateDraft({ candidateCount: value });
  }

  function chooseReference(file: File | null) {
    setReferenceFile(file);
    setError('');
  }

  function clearReference() {
    setReferenceFile(null);
    setReferencePreview('');
    session?.updateDraft({ referenceImageArtifactId: null }, { semantic: true });
  }

  function continueToSettings() {
    if (!canContinue) {
      setError(l(
        '请填写封面提示词或有效的 YouTube 链接',
        'Enter a thumbnail prompt or a valid YouTube link'
      ));
      return;
    }
    openStep(1);
  }

  async function generate() {
    if (submitting || generating) return;
    if (session === null) {
      setError(l(
        '封面生成服务暂不可用，请检查 Runtime 连接',
        'Thumbnail generation is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    const sourceType = youtubeUrl.trim() ? 'youtube' : 'prompt';
    if (!prompt.trim() && (sourceType !== 'youtube' || !isYoutubeUrl(youtubeUrl))) {
      setError(l(
        '请填写封面提示词或有效的 YouTube 链接',
        'Enter a thumbnail prompt or a valid YouTube link'
      ));
      openStep(0);
      return;
    }
    const resultVersionBeforeRun = latestResultValueRef.current;
    setSubmitting(true);
    setCurrentStep(2);
    setFurthestStep(2);
    setResultTab('options');
    setError('');
    setNotice(l(
      '正在创建任务并连接图像生成服务...',
      'Creating the task and connecting to the image service...'
    ));
    session.clearError();
    try {
      session.updateDraft({
        sourceType,
        sourceUrl: sourceType === 'youtube' ? youtubeUrl.trim() : '',
        prompt: prompt.trim(),
        ratio,
        quality,
        candidateCount,
        workspacePhase: 'result',
        currentStep: 2,
        furthestStep: 2,
        resultTab: 'options',
        draftBaseVersion: selectedResult?.value ?? null
      }, { semantic: true });
      await session.flush();
      if (referenceFile !== null && !artifactMatchesFile(activeReferenceArtifact, referenceFile)) {
        setNotice(l('正在上传参考图...', 'Uploading the reference image...'));
        await session.uploadReferenceImage(referenceFile);
        setReferenceFile(null);
      }
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: {
          stageId: sourceType === 'youtube' ? 'analyze-source' : 'generate',
          workflow: true
        }
      });
      openStep(2);
      setResultTab('options');
      if (latestResultValueRef.current === resultVersionBeforeRun) {
        setNotice(sourceType === 'youtube'
          ? l('正在分析视频内容，完成后会自动生成封面', 'Analyzing the video. Thumbnail generation will start automatically.')
          : l('封面生成任务已提交，结果会自动显示', 'Thumbnail generation started. Results will appear automatically.'));
      }
    } catch (cause) {
      setError(formatCoverError(cause, l));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelTask() {
    if (session === null || activeStage === undefined || taskControlPending) return;
    setTaskControlPending('canceling');
    try {
      await session.cancelJob();
      setNotice(l('任务终止请求已发送', 'The stop request was sent'));
    } catch (cause) {
      setError(formatCoverError(cause, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || resumableStage === undefined || taskControlPending) return;
    setTaskControlPending('resuming');
    try {
      await session.resumeJob();
      setNotice(l('任务已继续', 'The task resumed'));
    } catch (cause) {
      setError(formatCoverError(cause, l));
    } finally {
      setTaskControlPending(undefined);
    }
  }

  async function download(artifact: CreatorArtifact, index: number) {
    if (session === null) return;
    try {
      let url = artifactUrls[artifact.id];
      let temporaryUrl = '';
      if (!url) {
        const response = await session.openArtifact(artifact.id);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        temporaryUrl = URL.createObjectURL(await response.blob());
        url = temporaryUrl;
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = coverFileName(artifact, selectedResult?.value ?? 1, index + 1);
      link.click();
      if (temporaryUrl) window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
      setNotice(l(`封面方案 ${index + 1} 已开始下载`, `Thumbnail option ${index + 1} download started`));
    } catch (cause) {
      setError(formatCoverError(cause, l));
    }
  }

  function selectVersion(version: number) {
    setResultVersion(version);
    setResultTab('options');
    openStep(2);
  }

  function returnToResult() {
    if (selectedResult === undefined) return;
    setResultVersion(selectedResult.value);
    setResultTab('options');
    openStep(2);
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn));
      openStep(0);
      return l('示例提示词已填入。', 'The sample prompt is ready.');
    }
    if (/竖版|竖向|9:16|vertical/i.test(command)) {
      updateRatio('9:16');
      openStep(1);
      return l('封面比例已改为 9:16。', 'The thumbnail ratio is now 9:16.');
    }
    if (/方形|1:1|square/i.test(command)) {
      updateRatio('1:1');
      openStep(1);
      return l('封面比例已改为 1:1。', 'The thumbnail ratio is now 1:1.');
    }
    if (command.trim().length > 8) {
      updatePrompt(command.trim());
      openStep(0);
      return l('封面描述已同步。', 'The thumbnail prompt is synchronized.');
    }
    return l('请描述封面的主体、构图、风格和色彩。', 'Describe the subject, composition, style, and colors.');
  }

  const resultRatio = readRatio(selectedResult?.state.ratio);
  const resultQuality = readQuality(selectedResult?.state.quality);
  const workflowProgress = coverWorkflowProgress(
    session?.job.stages ?? [],
    readString(session?.state.sourceType) || (youtubeUrl.trim() ? 'youtube' : 'prompt')
  );
  const progressText = workflowProgress.percent === null
    ? ''
    : `${workflowProgress.percent}%`;
  const progressDetail = workflowProgress.total !== null
    && workflowProgress.total > 0
    && workflowProgress.completed !== null
    ? l(
        `已完成 ${workflowProgress.completed}/${workflowProgress.total}`,
        `${workflowProgress.completed}/${workflowProgress.total} completed`
      )
    : '';
  const panelStepLabel = generating
    ? stageLabel(activeStage?.stageId, l)
    : submitting
      ? l('正在创建生成任务', 'Creating generation task')
      : currentStep === 2
        ? l('查看封面方案', 'Review thumbnail options')
        : currentStep === 1
          ? l('配置封面参数', 'Configure thumbnail settings')
          : l('确定封面内容', 'Define thumbnail content');
  const panelQuickActions = [
    {
      id: 'cover-adjust',
      label: l('调整设置', 'Adjust settings'),
      kind: 'action' as const,
      onAction: () => openStep(0)
    },
    generating
      ? {
          id: 'cover-cancel',
          label: taskControlPending === 'canceling'
            ? l('正在终止...', 'Stopping...')
            : l('终止任务', 'Stop task'),
          kind: 'action' as const,
          onAction: () => void cancelTask(),
          disabled: taskControlPending !== undefined
        }
      : resumableStage
        ? {
            id: 'cover-resume',
            label: taskControlPending === 'resuming'
              ? l('正在继续...', 'Resuming...')
              : l('继续任务', 'Resume task'),
            kind: 'action' as const,
            onAction: () => void resumeTask(),
            disabled: taskControlPending !== undefined
          }
        : {
            id: 'cover-generate',
            label: selectedResult
              ? l('生成新版本', 'Generate new version')
              : l('开始生成', 'Generate'),
            kind: 'action' as const,
            onAction: () => void generate(),
            disabled: !canContinue || submitting
          },
    {
      id: 'cover-agent-check',
      label: l('让 Agent 检查设置', 'Ask Agent to review settings'),
      kind: 'agent' as const,
      prompt: l(
        '请检查当前封面设置、生成状态和可能影响效果的问题，并给出具体建议。',
        'Review the current thumbnail settings, generation status, and any issues that may affect the result.'
      )
    }
  ];

  return (
    <CreatorToolShell
      title={l('封面生成', 'Thumbnail Generator')}
      subtitle={l('从提示词、参考图或 YouTube 内容生成真实封面', 'Generate real thumbnails from a prompt, reference image, or YouTube content')}
      pageClassName="cover-generation-workspace-page"
      contentClassName="media-generation-workspace-content"
      context={selectedResult
        ? l(`V${selectedResult.value} · ${selectedResult.artifacts.length} 个方案 · ${resultRatio}`, `V${selectedResult.value} · ${selectedResult.artifacts.length} options · ${resultRatio}`)
        : generating
          ? l(`正在处理 ${progressText}`.trim(), `Processing ${progressText}`.trim())
          : submitting
            ? l('正在连接 Runtime 并创建任务', 'Connecting to Runtime and creating the task')
            : l(`等待生成 · ${ratio} · ${candidateCount} 个方案`, `Ready · ${ratio} · ${candidateCount} options`)}
      initialMessage={l('先确定封面依据和画面要求，再选择比例并生成真实方案。', 'Choose the source and visual direction, then set a ratio and generate real options.')}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('改为竖版封面', 'Use a vertical thumbnail')]}
      placeholder={props.promptHint ?? l('描述封面画面', 'Describe the thumbnail')}
      stepLabel={panelStepLabel}
      currentIssue={error || issue.message || undefined}
      quickActions={panelQuickActions}
      onCancelTask={cancelTask}
      onResumeTask={resumeTask}
      taskControlPending={taskControlPending}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack media-generation-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('封面生成流程', 'Thumbnail workflow')}>
          <ol>
            {[l('生成依据', 'Source'), l('封面设置', 'Settings'), l('封面方案', 'Options')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              const visited = index <= reachableFurthestStep;
              return (
                <li
                  key={label}
                  data-active={active}
                  data-completed={completed}
                  data-visited={visited}
                  data-next-reachable={index < reachableFurthestStep}
                >
                  <button
                    type="button"
                    disabled={index > reachableFurthestStep}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => openStep(index as CoverStep)}
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
            <section className="creator-tool-panel" aria-labelledby="cover-source-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="cover-source-title">{l('生成依据', 'Thumbnail source')}</h2>
                  <p>{l('提示词和 YouTube 链接至少填写一项，参考图可选', 'Enter a prompt or YouTube link. A reference image is optional.')}</p>
                </div>
              </div>
              <label className="creator-tool-field">
                <span>{l('封面提示词', 'Thumbnail prompt')}</span>
                <textarea
                  rows={7}
                  maxLength={4000}
                  value={prompt}
                  onChange={event => updatePrompt(event.target.value)}
                  placeholder={l('描述主题、主体、构图、光线、风格和色彩', 'Describe the topic, subject, composition, lighting, style, and colors')}
                />
              </label>
              <button className="smart-dubbing-sample" type="button" onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn))}>
                <Sparkles size={14} />
                {l('填入示例提示词', 'Use sample prompt')}
              </button>
              <label className="creator-tool-field cover-youtube-field">
                <span>YouTube {l('链接', 'link')} <small>{l('选填', 'Optional')}</small></span>
                <div>
                  <Link2 size={16} strokeWidth={1.8} />
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={event => updateYoutubeUrl(event.target.value)}
                    placeholder={l('根据视频标题、简介和缩略图提取主题', 'Use the video title, description, and thumbnail as context')}
                  />
                </div>
              </label>
              <label className="creator-tool-upload cover-reference-upload">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={l('上传封面参考图', 'Upload a thumbnail reference image')}
                  onChange={event => chooseReference(event.target.files?.[0] ?? null)}
                />
                {currentReferenceName ? (
                  <>
                    {referencePreview
                      ? <img src={referencePreview} alt={l('封面参考图', 'Thumbnail reference')} />
                      : <ImagePlus size={23} />}
                    <strong>{currentReferenceName}</strong>
                    <span>{l('点击更换参考图', 'Click to replace the reference')}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud size={23} strokeWidth={1.5} />
                    <strong>{l('添加参考图', 'Add reference image')}</strong>
                    <span>{l('支持 PNG、JPEG、WebP，最大 20 MB', 'PNG, JPEG, or WebP, up to 20 MB')}</span>
                  </>
                )}
              </label>
              {currentReferenceName ? (
                <div className="cover-reference-actions">
                  <button type="button" onClick={clearReference}>{l('移除参考图', 'Remove reference')}</button>
                </div>
              ) : null}
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="cover-settings-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="cover-settings-title">{l('封面设置', 'Thumbnail settings')}</h2>
                  <p>{l(
                    `每次生成 ${candidateCount} 个真实候选方案`,
                    `Each run creates ${candidateCount} real thumbnail options`
                  )}</p>
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('封面比例', 'Thumbnail ratio')}</span>
                <div className="creator-tool-segmented cover-ratio-tabs" role="radiogroup" aria-label={l('封面比例', 'Thumbnail ratio')}>
                  {(['16:9', '1:1', '9:16'] as const).map(value => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={ratio === value}
                      aria-selected={ratio === value}
                      key={value}
                      onClick={() => updateRatio(value)}
                    >
                      <span data-ratio={value} aria-hidden="true" />
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('生成数量', 'Number of options')}</span>
                <div className="creator-tool-segmented" role="radiogroup" aria-label={l('生成数量', 'Number of options')}>
                  {([1, 2, 3, 4] as const).map(value => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={candidateCount === value}
                      aria-selected={candidateCount === value}
                      key={value}
                      onClick={() => updateCandidateCount(value)}
                    >
                      {l(`${value} 张`, `${value}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('生成质量', 'Quality')}</span>
                <div className="creator-tool-segmented" role="radiogroup" aria-label={l('生成质量', 'Quality')}>
                  {([
                    ['low', l('快速', 'Fast')],
                    ['medium', l('标准', 'Standard')],
                    ['high', l('高清', 'High')]
                  ] as const).map(([value, label]) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={quality === value}
                      aria-selected={quality === value}
                      key={value}
                      onClick={() => updateQuality(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <CreatorTaskSummary
                sourceIcon={youtubeUrl.trim() ? Link2 : ImagePlus}
                sourceLabel={youtubeUrl.trim() ? 'YouTube' : l('封面描述', 'Prompt')}
                sourceValue={youtubeUrl.trim() || prompt.trim()}
                items={[
                  { label: l('封面比例', 'Ratio'), value: ratio },
                  { label: l('生成数量', 'Options'), value: l(`${candidateCount} 张`, String(candidateCount)) },
                  { label: l('生成质量', 'Quality'), value: qualityLabel(quality, l) },
                  { label: l('参考图', 'Reference'), value: currentReferenceName ?? l('未添加', 'Not added') }
                ]}
              />
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="video-result-workspace cover-result-workspace" aria-label={l('封面生成项目产出', 'Thumbnail project outputs')}>
              <div className="video-result-toolbar">
                <div className="video-result-tabs" role="tablist" aria-label={l('封面结果类型', 'Thumbnail result types')}>
                  <button type="button" role="tab" aria-selected={resultTab === 'options'} onClick={() => setResultTab('options')}>
                    <Images size={15} />{l('封面方案', 'Options')}
                  </button>
                  <button type="button" role="tab" aria-selected={resultTab === 'references'} onClick={() => setResultTab('references')}>
                    <ImagePlus size={15} />{l('参考素材', 'References')}
                  </button>
                  <button type="button" role="tab" aria-selected={resultTab === 'settings'} onClick={() => setResultTab('settings')}>
                    <Settings2 size={15} />{l('任务设置', 'Settings')}
                  </button>
                </div>
                {selectedResult ? (
                  <CreatorResultVersionMenu
                    version={selectedResult.value}
                    versions={resultVersions.map(version => ({
                      value: version.value,
                      description: version.description
                    }))}
                    onVersionChange={selectVersion}
                  />
                ) : null}
              </div>
              <div className="creator-result-layout">
                <div className="video-result-pane">
                  {resultTab === 'options' ? (
                    <>
                      <header className="video-result-pane-heading">
                        <div>
                          <h2>{selectedResult ? l('封面方案', 'Thumbnail options') : l('正在生成封面', 'Generating thumbnails')}</h2>
                          <p>{selectedResult
                            ? l(`V${selectedResult.value}，选择、下载或继续调整`, `V${selectedResult.value}. Select, download, or refine an option.`)
                            : stageLabel(activeStage?.stageId, l)}</p>
                        </div>
                        {selectedResult ? (
                          <button type="button" onClick={() => openStep(0)}>
                            <Settings2 size={15} />{l('调整并生成新版本', 'Adjust and create version')}
                          </button>
                        ) : null}
                      </header>
                      {selectedResult ? (
                        <div className="cover-result-grid" data-ratio={resultRatio}>
                          {selectedResult.artifacts.map((artifact, index) => (
                            <article key={artifact.id}>
                              <div>
                                {artifactUrls[artifact.id] ? (
                                  <img src={artifactUrls[artifact.id]} alt={`${l('封面方案', 'Thumbnail option')} ${index + 1}`} />
                                ) : (
                                  <div className="cover-result-loading" role="status">
                                    <LoaderCircle className="smart-dubbing-spinner" size={20} />
                                    {l('正在加载预览', 'Loading preview')}
                                  </div>
                                )}
                              </div>
                              <footer>
                                <strong>{l('方案', 'Option')} {readCandidate(artifact, index + 1)}</strong>
                                <span>
                                  <button
                                    type="button"
                                    onClick={() => void download(artifact, index)}
                                    aria-label={`${l('下载封面方案', 'Download thumbnail option')} ${index + 1}`}
                                    title={l('下载', 'Download')}
                                  >
                                    <Download size={15} />
                                  </button>
                                </span>
                              </footer>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="cover-empty-state">
                          {generating || submitting
                            ? <LoaderCircle className="smart-dubbing-spinner" size={24} />
                            : <Images size={26} />}
                          <strong>{generating
                            ? stageLabel(activeStage?.stageId, l)
                            : submitting
                              ? l('正在启动封面生成', 'Starting thumbnail generation')
                              : l('尚未生成封面', 'No thumbnails yet')}</strong>
                          <p>{generating
                            ? l(
                                `任务正在后台处理 ${progressDetail || progressText}`.trim(),
                                `The task is running ${progressDetail || progressText}`.trim()
                              )
                            : submitting
                              ? l('正在创建任务，Runtime 响应后会自动显示真实进度', 'Creating the task. Live progress will appear when Runtime responds.')
                            : l('返回设置后启动真实生成任务', 'Return to settings to start a real generation task')}</p>
                          {generating && workflowProgress.percent !== null ? (
                            <div className="cover-workflow-progress">
                              <div
                                role="progressbar"
                                aria-label={l('封面生成总进度', 'Overall thumbnail generation progress')}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={workflowProgress.percent}
                              >
                                <span style={{ width: `${workflowProgress.percent}%` }} />
                              </div>
                              <small>{progressDetail || progressText}</small>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </>
                  ) : null}

                  {resultTab === 'references' ? (
                    <>
                      <header className="video-result-pane-heading">
                        <div>
                          <h2>{l('参考素材', 'Reference material')}</h2>
                          <p>{l('当前版本实际使用的来源和参考图片', 'Sources and images actually used for this version')}</p>
                        </div>
                      </header>
                      <div className="cover-reference-results">
                        {readString(selectedResult?.state.sourceUrl) ? (
                          <div className="video-result-file-row">
                            <span><Link2 size={18} /></span>
                            <div>
                              <strong>YouTube {l('视频来源', 'video source')}</strong>
                              <small>{readString(selectedResult?.state.sourceUrl)}</small>
                            </div>
                          </div>
                        ) : null}
                        {selectedKeyframeArtifact ? (
                          <div className="cover-reference-preview-row">
                            {artifactUrls[selectedKeyframeArtifact.id]
                              ? <img src={artifactUrls[selectedKeyframeArtifact.id]} alt={l('视频缩略图', 'Video thumbnail')} />
                              : <ImagePlus size={20} />}
                            <div>
                              <strong>{l('视频缩略图', 'Video thumbnail')}</strong>
                              <small>{readArtifactString(selectedKeyframeArtifact, 'sourceTitle') ?? ''}</small>
                            </div>
                          </div>
                        ) : null}
                        {selectedReferenceArtifact ? (
                          <div className="cover-reference-preview-row">
                            {artifactUrls[selectedReferenceArtifact.id]
                              ? <img src={artifactUrls[selectedReferenceArtifact.id]} alt={l('封面参考图', 'Thumbnail reference')} />
                              : <ImagePlus size={20} />}
                            <div>
                              <strong>{readArtifactString(selectedReferenceArtifact, 'fileName') ?? l('封面参考图', 'Thumbnail reference')}</strong>
                              <small>{l('图片参考', 'Image reference')}</small>
                            </div>
                          </div>
                        ) : null}
                        {!readString(selectedResult?.state.sourceUrl)
                          && selectedKeyframeArtifact === undefined
                          && selectedReferenceArtifact === undefined ? (
                            <div className="video-result-empty">
                              <ImagePlus size={26} />
                              <strong>{l('当前版本没有参考素材', 'No reference material in this version')}</strong>
                              <p>{l('封面仅根据提示词生成', 'This version was generated from the prompt only')}</p>
                            </div>
                          ) : null}
                      </div>
                    </>
                  ) : null}

                  {resultTab === 'settings' ? (
                    <>
                      <header className="video-result-pane-heading">
                        <div>
                          <h2>{l('当前版本设置', 'Current version settings')}</h2>
                          <p>{l('这些设置来自生成成功时的任务快照', 'These settings come from the successful generation snapshot')}</p>
                        </div>
                      </header>
                      <dl className="video-result-settings">
                        <div><dt>{l('封面比例', 'Ratio')}</dt><dd>{resultRatio}</dd></div>
                        <div><dt>{l('生成数量', 'Options')}</dt><dd>{selectedResult?.artifacts.length ?? 0}</dd></div>
                        <div><dt>{l('生成质量', 'Quality')}</dt><dd>{qualityLabel(resultQuality, l)}</dd></div>
                        <div><dt>{l('参考图', 'Reference')}</dt><dd>{readArtifactString(selectedReferenceArtifact, 'fileName') ?? l('未添加', 'Not added')}</dd></div>
                        <div className="cover-result-prompt-setting">
                          <dt>{l('封面提示词', 'Thumbnail prompt')}</dt>
                          <dd>{readString(selectedResult?.state.prompt) || l('根据视频内容生成', 'Generated from video content')}</dd>
                        </div>
                      </dl>
                    </>
                  ) : null}
                </div>
                <CreatorTaskSummary
                  sourceIcon={readString(selectedResult?.state.sourceUrl) ? Link2 : ImagePlus}
                  sourceLabel={readString(selectedResult?.state.sourceUrl) ? 'YouTube' : l('封面描述', 'Prompt')}
                  sourceValue={readString(selectedResult?.state.sourceUrl) || readString(selectedResult?.state.prompt)}
                  items={[
                    { label: l('封面比例', 'Ratio'), value: resultRatio },
                    { label: l('生成数量', 'Options'), value: String(selectedResult?.artifacts.length ?? 0) },
                    { label: l('生成质量', 'Quality'), value: qualityLabel(resultQuality, l) },
                    { label: l('当前版本', 'Version'), value: selectedResult ? `V${selectedResult.value}` : '-' }
                  ]}
                />
              </div>
            </section>
          ) : null}

          {showRunNotice ? (
            <div className={`video-translation-run-notice${issue.message || error ? ' is-error' : ''}`} role={issue.message || error ? 'alert' : 'status'}>
              <span>{error || issue.message || notice}</span>
              {issue.deepLink ? <a href={issue.deepLink}>{l('打开 AI 服务设置', 'Open AI service settings')}</a> : null}
            </div>
          ) : null}
        </div>

        <footer className="video-translation-wizard-actions media-generation-actions">
          <button
            className="video-translation-secondary-action"
            type="button"
            onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as CoverStep)}
          >
            {currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}
          </button>
          <div className="video-translation-action-group">
            {currentStep < 2 && selectedResult ? (
              <button className="video-translation-secondary-action" type="button" onClick={returnToResult}>
                <Images size={16} />
                {l(`返回 V${selectedResult.value} 方案`, `Return to V${selectedResult.value}`)}
              </button>
            ) : null}
            {currentStep === 0 ? (
              <button className="video-translation-primary-action" type="button" onClick={continueToSettings}>
                {l('继续', 'Continue')}
              </button>
            ) : null}
            {currentStep === 1 ? (
              <button className="video-translation-primary-action" type="button" disabled={submitting} onClick={() => void generate()}>
                {submitting ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}
                {submitting ? l('正在启动...', 'Starting...') : selectedResult ? l('生成新版本', 'Generate new version') : l('开始生成', 'Generate')}
              </button>
            ) : null}
            {currentStep === 2 && generating ? (
              <button className="video-translation-primary-action" data-intent="danger" type="button" disabled={taskControlPending !== undefined} onClick={() => void cancelTask()}>
                <CircleStop size={16} />
                {taskControlPending === 'canceling' ? l('正在终止...', 'Stopping...') : l('终止任务', 'Stop task')}
              </button>
            ) : null}
            {currentStep === 2 && submitting && !generating ? (
              <button className="video-translation-primary-action" type="button" disabled>
                <LoaderCircle className="smart-dubbing-spinner" size={16} />
                {l('正在启动...', 'Starting...')}
              </button>
            ) : null}
            {currentStep === 2 && resumableStage ? (
              <button className="video-translation-primary-action" type="button" disabled={taskControlPending !== undefined} onClick={() => void resumeTask()}>
                <RotateCcw size={16} />
                {taskControlPending === 'resuming' ? l('正在继续...', 'Resuming...') : l('继续任务', 'Resume task')}
              </button>
            ) : null}
            {currentStep === 2 && !generating && !resumableStage && selectedResult ? (
              <button className="video-translation-primary-action" type="button" onClick={() => openStep(0)}>
                <Settings2 size={16} />
                {l('调整设置', 'Adjust settings')}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </CreatorToolShell>
  );
}

function createCoverResultVersions(
  artifacts: CreatorArtifact[],
  resultSnapshots: CreatorJson | undefined
): CoverResultVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const snapshots = readCreatorResultSnapshots(resultSnapshots);
  const fromSnapshots = snapshots.flatMap(snapshot => {
    const coverArtifacts = (snapshot.artifactRefs.cover_image ?? [])
      .map(id => byId.get(id))
      .filter((artifact): artifact is CreatorArtifact => (
        artifact !== undefined && artifact.path !== null
      ))
      .sort(compareCandidates);
    return coverArtifacts.length === 0 ? [] : [{
      value: snapshot.version,
      description: snapshot.description,
      artifacts: coverArtifacts,
      state: snapshot.state,
      artifactRefs: snapshot.artifactRefs
    }];
  });
  if (fromSnapshots.length > 0) return fromSnapshots;

  const grouped = new Map<number, CreatorArtifact[]>();
  for (const artifact of artifacts) {
    if (
      artifact.kind !== 'cover_image'
      || artifact.path === null
      || artifact.status === 'stale'
    ) {
      continue;
    }
    const version = readPositiveInteger(artifact.metadata.resultVersion) ?? artifact.version;
    grouped.set(version, [...(grouped.get(version) ?? []), artifact]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([value, versionArtifacts]) => ({
      value,
      description: '生成封面',
      artifacts: versionArtifacts.sort(compareCandidates),
      state: {},
      artifactRefs: { cover_image: versionArtifacts.map(artifact => artifact.id) }
    }));
}

function readIssue(
  session: ReturnType<typeof useOptionalCreatorSession>,
  latestStage: ReturnType<NonNullable<ReturnType<typeof useOptionalCreatorSession>>['job']['stages']['at']>,
  l: (zh: string, en: string) => string
): { message: string; deepLink: string } {
  const needsInput = session?.state.needsInput;
  if (needsInput !== null && typeof needsInput === 'object' && !Array.isArray(needsInput)) {
    return {
      message: typeof needsInput.message === 'string'
        ? formatCoverError(needsInput, l)
        : formatCoverError({ code: needsInput.code }, l),
      deepLink: typeof needsInput.deepLink === 'string' ? needsInput.deepLink : ''
    };
  }
  if (latestStage?.status === 'failed') {
    return {
      message: formatCoverError({
        code: latestStage.errorCode,
        message: latestStage.errorMessage
      }, l),
      deepLink: latestStage.errorCode === 'creator_image_config_missing'
        ? '#/settings?tab=ai-services&section=image'
        : latestStage.errorCode === 'creator_llm_config_missing'
          ? '#/settings?tab=ai-services&section=text'
          : ''
    };
  }
  if (session?.error) return { message: formatCoverError(session.error, l), deepLink: '' };
  return { message: '', deepLink: '' };
}

function formatCoverError(error: unknown, l: (zh: string, en: string) => string): string {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  if (code === 'creator_image_config_missing') {
    return l('请先配置图像生成服务', 'Configure the image generation service first');
  }
  if (code === 'creator_llm_config_missing') {
    return l('使用 YouTube 来源前，请先配置文本模型', 'Configure the text model before using a YouTube source');
  }
  if (code === 'unsupported_capability') {
    return l('当前图像服务不支持参考图，请移除参考图或切换服务', 'The current image provider does not support reference images');
  }
  if (code === 'unsupported_source') {
    return l('目前仅支持公开的 YouTube 链接', 'Only public YouTube links are supported');
  }
  if (code === 'image_generation_failed') {
    return l('封面生成失败，请检查图像服务和网络后重试', 'Thumbnail generation failed. Check the provider and network, then retry.');
  }
  if (code === 'creator_stage_canceled') {
    return l('封面生成任务已终止', 'Thumbnail generation was stopped');
  }
  return typeof candidate?.message === 'string'
    ? candidate.message
    : error instanceof Error
      ? error.message
      : l('封面生成失败，请稍后重试', 'Thumbnail generation failed. Try again later.');
}

function stageLabel(
  stageId: string | undefined,
  l: (zh: string, en: string) => string
): string {
  return stageId === 'analyze-source'
    ? l('正在分析 YouTube 视频内容', 'Analyzing the YouTube video')
    : l('正在生成封面方案', 'Generating thumbnail options');
}

function coverWorkflowProgress(
  stages: CreatorStageRun[],
  sourceType: string
): {
  percent: number | null;
  completed: number | null;
  total: number | null;
} {
  const active = [...stages].reverse().find(stage => (
    stage.status === 'queued' || stage.status === 'running'
  ));
  if (active === undefined) {
    return { percent: null, completed: null, total: null };
  }
  const stagePercent = finiteProgressNumber(active.progress.percent);
  const completed = finiteProgressNumber(active.progress.completed);
  const total = finiteProgressNumber(active.progress.total);
  if (stagePercent === null) return { percent: null, completed, total };

  const normalized = Math.max(0, Math.min(100, stagePercent));
  const workflowPercent = sourceType === 'youtube'
    ? active.stageId === 'analyze-source'
      ? normalized * 0.35
      : active.stageId === 'generate'
        ? 35 + normalized * 0.65
        : normalized
    : normalized;
  return {
    percent: Math.round(Math.max(0, Math.min(100, workflowPercent))),
    completed,
    total
  };
}

function finiteProgressNumber(value: CreatorJson | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function artifactFromRefs(
  artifacts: CreatorArtifact[],
  refs: Record<string, string[]>,
  kind: string
): CreatorArtifact | undefined {
  const ids = refs[kind] ?? [];
  for (const id of [...ids].reverse()) {
    const artifact = artifacts.find(candidate => candidate.id === id);
    if (artifact !== undefined && ['completed', 'stale'].includes(artifact.status)) {
      return artifact;
    }
  }
  return undefined;
}

function artifactMatchesFile(artifact: CreatorArtifact | undefined, file: File): boolean {
  return artifact !== undefined
    && artifact.metadata.fileName === file.name
    && artifact.metadata.size === file.size
    && artifact.metadata.lastModified === file.lastModified;
}

function uniqueArtifacts(artifacts: CreatorArtifact[]): CreatorArtifact[] {
  return [...new Map(artifacts.map(artifact => [artifact.id, artifact])).values()];
}

function compareCandidates(left: CreatorArtifact, right: CreatorArtifact) {
  return readCandidate(left, left.version) - readCandidate(right, right.version);
}

function readCandidate(artifact: CreatorArtifact, fallback: number): number {
  return readPositiveInteger(artifact.metadata.candidate) ?? fallback;
}

function readArtifactString(
  artifact: CreatorArtifact | undefined,
  key: string
): string | undefined {
  const value = artifact?.metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function coverFileName(artifact: CreatorArtifact, version: number, candidate: number): string {
  const fileName = readArtifactString(artifact, 'fileName');
  if (fileName) return fileName;
  const extension = artifact.metadata.mimeType === 'image/jpeg'
    ? 'jpg'
    : artifact.metadata.mimeType === 'image/webp'
      ? 'webp'
      : 'png';
  return `OpenCreator-cover-V${version}-${candidate}.${extension}`;
}

function qualityLabel(
  quality: ImageGenerationQuality,
  l: (zh: string, en: string) => string
) {
  if (quality === 'low') return l('快速', 'Fast');
  if (quality === 'high') return l('高清', 'High');
  return l('标准', 'Standard');
}

function readStep(value: CreatorJson | undefined, fallback: CoverStep): CoverStep {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readRatio(value: CreatorJson | undefined): CoverRatio {
  return value === '1:1' || value === '9:16' ? value : '16:9';
}

function readQuality(value: CreatorJson | undefined): ImageGenerationQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function readCandidateCount(value: CreatorJson | undefined): CoverCandidateCount {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 2;
}

function readResultTab(value: CreatorJson | undefined): CoverResultTab {
  return value === 'references' || value === 'settings' ? value : 'options';
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function isYoutubeUrl(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com');
  } catch {
    return false;
  }
}
