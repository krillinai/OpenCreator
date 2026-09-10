import {
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorStageRun,
  type CreatorTtsProvider,
  type CreatorVisualAssetRef,
  type CreatorVisualAssetSummary
} from '@opencreator/protocol';
import {
  ArrowLeft,
  ArrowRight,
  Captions,
  Check,
  Circle,
  Clock3,
  Download,
  Eye,
  FileAudio,
  FileText,
  FileVideo,
  Film,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  PersonStanding,
  RefreshCw,
  Settings2,
  Sparkles,
  Volume2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TtsVoicePicker } from '../../components/tts/TtsVoicePicker.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { CreatorWebService } from '../../services/creator-service.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useCreatorSession } from './creator-session-store.js';

type ScriptManifest = {
  contract: 'stickman-narration-script-v2';
  reviewStatus: 'needs_review' | 'approved';
  contentLocked: boolean;
  title: string;
  language: string;
  targetDurationSeconds: number;
  narrationBudget: {
    unit: 'characters' | 'words';
    unitsPerMinute: number;
    minUnits: number;
    maxUnits: number;
  };
  segmentCount: number;
  totalNarrationUnits: number;
  estimatedTotalDurationSeconds: number;
  segments: Array<{
    id: string;
    order: number;
    narration: string;
    claimIds: string[];
    sourceSpanIds: string[];
    narrationUnits: number;
    estimatedDurationSeconds: number;
  }>;
};

type ShotSpec = {
  scriptArtifactId: string;
  audioTimingArtifactId: string;
  timingSource: 'ffprobe_cumulative_tts_duration';
  shots: Array<{
    id: string;
    sourceSegmentId: string;
    semanticAnchor: string;
    visualDescription: string;
    compositionAndAction: string;
    keyObjects: string[];
    continuityReason: string;
    motion: string;
    motionReason: string;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
  }>;
};

type ScriptDraftState = {
  artifactId: string;
  baseline: string;
  value: ScriptManifest;
};

type AudioTiming = {
  scriptArtifactId: string;
  timingSource: 'ffprobe_cumulative_tts_duration';
  segments: Array<{
    segmentId: string;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    audioArtifactId: string;
    audioSha256: string;
  }>;
  totalDurationSeconds: number;
};

type DeliveryManifest = {
  packageStatus: 'technical-draft' | 'publishable';
  blockingChecks?: string[];
  files?: Array<{
    name: string;
    relativePath: string;
    bytes: number;
    mime: string;
    sourceArtifactId: string;
  }>;
};

type TtsConfigurationStatus = 'loading' | 'configured' | 'missing' | 'unavailable';
type ImageConfigurationStatus = TtsConfigurationStatus | 'unsupported';
type VisualAssetCatalogStatus = 'loading' | 'ready' | 'error' | 'unavailable';

const defaultCharacterAsset: CreatorVisualAssetRef = {
  assetId: 'stickman.character.default',
  revision: 1
};
const defaultStyleAsset: CreatorVisualAssetRef = {
  assetId: 'stickman.style.paper-pencil',
  revision: 1
};

const targetDurationPresets = [30, 60, 300, 600] as const;

const deliveryKinds = [
  'clean_video',
  'narration_subtitle'
] as const;

export default function StickmanVideoWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  creatorServicesService?: CreatorServicesSettingsService | null;
  creatorService?: CreatorWebService | null;
}) {
  const l = useLocalizedCopy();
  const session = useCreatorSession();
  const { job, state } = session;
  const [activeStep, setActiveStep] = useState(0);
  const [notice, setNotice] = useState('');
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [controlPending, setControlPending] = useState<'canceling' | 'resuming'>();
  const [ttsConfigurationStatus, setTtsConfigurationStatus] = useState<TtsConfigurationStatus>('loading');
  const [imageConfigurationStatus, setImageConfigurationStatus] = useState<ImageConfigurationStatus>('loading');
  const [scriptDraftState, setScriptDraftState] = useState<ScriptDraftState>();
  const [scriptSubmitting, setScriptSubmitting] = useState(false);
  const [transitionPending, setTransitionPending] = useState<'audio' | 'visuals'>();
  const [savingShotId, setSavingShotId] = useState<string>();
  const [regenerationRequests, setRegenerationRequests] = useState<Record<string, string | null>>({});
  const [batchGenerationPending, setBatchGenerationPending] = useState(false);
  const batchGenerationStageCount = useRef(0);
  const [visualAssets, setVisualAssets] = useState<CreatorVisualAssetSummary[]>([]);
  const [visualAssetPreviewUrls, setVisualAssetPreviewUrls] = useState<Record<string, string>>({});
  const [visualAssetCatalogStatus, setVisualAssetCatalogStatus] = useState<VisualAssetCatalogStatus>('loading');

  const scriptArtifact = latestCompleted(job.artifacts, 'script_manifest');
  const scriptStage = latestStage(job.stages, 'script');
  const audioTimingArtifact = latestCompleted(job.artifacts, 'audio_timing');
  const shotSpecArtifact = latestCompleted(job.artifacts, 'shot_spec');
  const visualValidationArtifact = latestCompleted(job.artifacts, 'visual_validation');
  const rawScript = useArtifactJson<unknown>(scriptArtifact?.id);
  const script = readScriptManifest(rawScript);
  const scriptRequiresRegeneration = rawScript !== undefined && script === undefined;
  const audioTiming = useArtifactJson<AudioTiming>(audioTimingArtifact?.id);
  const shotSpec = useArtifactJson<ShotSpec>(shotSpecArtifact?.id);
  const snapshots = readCreatorResultSnapshots(job.state.resultSnapshots);
  const latestSnapshot = snapshots.at(-1);
  const observedSnapshotVersion = useRef(latestSnapshot?.version);
  const currentSnapshot = snapshots.find(snapshot => snapshot.version === selectedVersion)
    ?? latestSnapshot;
  const derivedStep = snapshots.length > 0
    ? 5
    : visualValidationArtifact !== undefined
      ? 3
      : audioTimingArtifact !== undefined
        ? 2
      : scriptArtifact !== undefined
        ? 1
        : 0;
  const workflowStep = stickmanWorkflowStep(state.currentStage);
  const workbenchStep = Math.max(derivedStep, workflowStep);
  const activeStages = job.stages.filter(stage => stage.status === 'queued' || stage.status === 'running');
  const isBusy = activeStages.length > 0;
  const review = readNeedsInput(state.needsInput);
  const characterAsset = readVisualAssetRef(state.characterAsset, defaultCharacterAsset);
  const sourceType = state.sourceType === 'text' ? 'text' : 'url';
  const sourceUrl = typeof state.sourceUrl === 'string' ? state.sourceUrl : '';
  const sourceText = typeof state.sourceText === 'string' ? state.sourceText : '';
  const styleAsset = readVisualAssetRef(state.styleAsset, defaultStyleAsset);
  const targetDurationSeconds = typeof state.targetDurationSeconds === 'number'
    ? state.targetDurationSeconds
    : 30;
  const ttsProvider = isTtsProvider(state.ttsProvider) ? state.ttsProvider : 'openai';
  const ttsModel = typeof state.ttsModel === 'string' ? state.ttsModel : '';
  const voiceCode = typeof state.voiceCode === 'string' ? state.voiceCode : '';
  const voiceName = typeof state.voiceName === 'string' ? state.voiceName : voiceCode;
  const targetLanguage = typeof state.targetLanguage === 'string' ? state.targetLanguage : 'zh-CN';
  const scriptDraft = scriptArtifact !== undefined && scriptDraftState?.artifactId === scriptArtifact.id
    ? scriptDraftState.value
    : script;
  const scriptDirty = scriptDraftState !== undefined
    && scriptDraftState.artifactId === scriptArtifact?.id
    && JSON.stringify(scriptDraftState.value) !== scriptDraftState.baseline;
  const characterAssets = useMemo(
    () => visualAssets.filter(asset => asset.kind === 'character' && asset.status === 'ready'),
    [visualAssets]
  );
  const styleAssets = useMemo(
    () => visualAssets.filter(asset => asset.kind === 'style' && asset.status === 'ready'),
    [visualAssets]
  );

  useEffect(() => {
    let active = true;
    const objectUrls: string[] = [];
    const service = props.creatorService;
    if (service === null || service === undefined) {
      setVisualAssetCatalogStatus('unavailable');
      return () => {
        active = false;
      };
    }
    setVisualAssetCatalogStatus('loading');
    void service.listVisualAssets('stickman-video')
      .then(async response => {
        if (!active) return;
        setVisualAssets(response.assets);
        const previews = await Promise.all(response.assets.flatMap(asset => (
          asset.previewUrl === null
            ? []
            : [service.openVisualAssetPreview(asset.id, asset.revision)
                .then(async preview => {
                  const url = URL.createObjectURL(await preview.blob());
                  objectUrls.push(url);
                  return [assetRefKey(asset), url] as const;
                })]
        )));
        if (!active) return;
        setVisualAssetPreviewUrls(Object.fromEntries(previews));
        setVisualAssetCatalogStatus('ready');
      })
      .catch(() => {
        if (active) setVisualAssetCatalogStatus('error');
      });
    return () => {
      active = false;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [job.id, props.creatorService]);

  useEffect(() => {
    let active = true;
    const service = props.creatorServicesService;
    if (service === null || service === undefined) {
      setTtsConfigurationStatus('unavailable');
      setImageConfigurationStatus('unavailable');
      return () => {
        active = false;
      };
    }
    setTtsConfigurationStatus('loading');
    void service.getConfig()
      .then(response => {
        if (!active) return;
        const provider = response.config.tts.provider;
        const providerConfig = provider === 'edge-tts'
          ? null
          : response.config.tts[provider];
        const configured = provider === 'edge-tts'
          || (providerConfig !== null && (
            providerConfig.apiKey.trim().length > 0
            || response.configuredCredentials.some(credential => credential === `tts.${provider}.apiKey`)
          ));
        setTtsConfigurationStatus(configured ? 'configured' : 'missing');
        const imageProvider = response.config.image.provider;
        if (imageProvider !== 'openai' && imageProvider !== 'gemini') {
          setImageConfigurationStatus('unsupported');
        } else {
          const credential = imageProvider === 'openai'
            ? 'image.openai.apiKey' as const
            : 'image.gemini.apiKey' as const;
          const imageConfigured = response.config.image[imageProvider].apiKey.trim().length > 0
            || response.configuredCredentials.includes(credential);
          setImageConfigurationStatus(imageConfigured ? 'configured' : 'missing');
        }
        if (scriptArtifact !== undefined) return;
        session.updateDraft({
          ttsProvider: provider,
          ttsModel: providerConfig?.model ?? '',
          voiceCode: configured ? providerConfig?.defaultVoiceId ?? '' : '',
          voiceName: configured ? providerConfig?.defaultVoiceId ?? '' : ''
        });
      })
      .catch(() => {
        if (active) {
          setTtsConfigurationStatus('unavailable');
          setImageConfigurationStatus('unavailable');
        }
      });
    return () => {
      active = false;
    };
  }, [job.id, props.creatorServicesService, scriptArtifact?.id]);

  useEffect(() => {
    setActiveStep(current => (
      current === 0 || current > workbenchStep ? workbenchStep : current
    ));
  }, [workbenchStep]);

  useEffect(() => {
    if (
      review?.kind === 'approve-script'
      && review.artifactId === scriptArtifact?.id
    ) {
      setActiveStep(1);
    }
  }, [review?.artifactId, review?.kind, scriptArtifact?.id]);

  useEffect(() => {
    const previousVersion = observedSnapshotVersion.current;
    observedSnapshotVersion.current = latestSnapshot?.version;
    if (latestSnapshot === undefined) return;
    setSelectedVersion(latestSnapshot.version);
    if (previousVersion !== latestSnapshot.version) {
      setActiveStep(current => current === 4 ? 5 : current);
    }
  }, [latestSnapshot?.version]);

  useEffect(() => {
    if (scriptArtifact === undefined || script === undefined) return;
    setScriptDraftState(current => {
      if (current?.artifactId === scriptArtifact.id) return current;
      const value = cloneScriptManifest(script);
      return {
        artifactId: scriptArtifact.id,
        baseline: JSON.stringify(value),
        value
      };
    });
  }, [script, scriptArtifact?.id]);

  useEffect(() => {
    setRegenerationRequests(current => {
      let changed = false;
      const next = { ...current };
      for (const [shotId, previousStageId] of Object.entries(current)) {
        const latest = latestShotStage(job.stages, shotId);
        if (latest !== undefined && latest.id !== previousStageId) {
          delete next[shotId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [job.stages]);

  useEffect(() => {
    if (!batchGenerationPending) return;
    const continuationStarted = job.stages.length > batchGenerationStageCount.current
      || job.stages.some(stage => (
        (stage.status === 'queued' || stage.status === 'running')
        && (stage.stageId === 'images' || stage.stageId === 'visual-validation')
      ));
    if (continuationStarted || visualValidationArtifact !== undefined) {
      setBatchGenerationPending(false);
    }
  }, [batchGenerationPending, job.stages, visualValidationArtifact]);

  useEffect(() => {
    if (session.error?.code === 'creator_revision_conflict') {
      setNotice(l('任务已被其他入口更新，已刷新到最新版本，请重新操作', 'The task changed elsewhere. The latest revision has been loaded; retry your action.'));
    }
  }, [l, session.error?.code]);

  const currentVideo = artifactFromSnapshot(job.artifacts, currentSnapshot?.artifactRefs.clean_video);
  const currentDeliveryManifest = artifactFromSnapshot(
    job.artifacts,
    currentSnapshot?.artifactRefs.delivery_manifest
  );
  const deliveryManifest = useArtifactJson<DeliveryManifest>(currentDeliveryManifest?.id);
  const videoUrl = useArtifactUrl(currentVideo?.id);

  async function apply(action: string, input: Record<string, unknown>) {
    session.clearError();
    setNotice('');
    try {
      await session.applyAction({ actor: 'user', action, input: input as never });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function startWorkflow() {
    if (visualAssetCatalogStatus === 'error' || visualAssetCatalogStatus === 'unavailable') {
      setNotice(l(
        '暂时无法读取人物与视觉风格目录，请检查 Runtime 后重试',
        'Could not load the character and visual style catalog. Check the Runtime and retry.'
      ));
      return;
    }
    if (ttsConfigurationStatus !== 'configured') {
      setNotice(ttsConfigurationStatus === 'unavailable'
        ? l('暂时无法读取配音服务配置，请检查 Runtime 后重试', 'Could not read TTS settings. Check the Runtime and retry.')
        : l('请先前往 AI 服务配置配音服务', 'Configure a TTS service in AI Services first.'));
      return;
    }
    if (imageConfigurationStatus !== 'configured') {
      setNotice(imageConfigurationStatus === 'unsupported'
        ? l('当前生图服务不支持角色参考图，请在 AI 服务中切换到 OpenAI 或 Gemini', 'The current image provider does not support character references. Switch to OpenAI or Gemini in AI Services.')
        : imageConfigurationStatus === 'unavailable'
          ? l('暂时无法读取生图服务配置，请检查 Runtime 后重试', 'Could not read image settings. Check the Runtime and retry.')
          : l('请先前往 AI 服务配置生图服务', 'Configure an image provider in AI Services first.'));
      return;
    }
    if (sourceType === 'text') {
      if (sourceText.trim().length === 0) {
        setNotice(l('请输入要生成火柴人视频的文本内容', 'Enter the text to turn into a stickman video.'));
        return;
      }
      void apply('run-stage', { stageId: 'ingest-text' });
      return;
    }
    if (!isPublicYoutubeUrl(sourceUrl)) {
      setNotice(l('请输入有效的公开 YouTube 链接', 'Enter a valid public YouTube URL.'));
      return;
    }
    void apply('run-stage', { stageId: 'source-transcript' });
  }

  function updateScriptDraft(value: ScriptManifest) {
    if (scriptArtifact === undefined || script === undefined) return;
    setScriptDraftState(current => {
      if (current?.artifactId === scriptArtifact.id) return { ...current, value };
      const baseline = cloneScriptManifest(script);
      return {
        artifactId: scriptArtifact.id,
        baseline: JSON.stringify(baseline),
        value
      };
    });
  }

  async function continueFromScript() {
    if (scriptArtifact === undefined || scriptDraft === undefined || scriptSubmitting) return;
    const normalized = normalizeScriptManifest(scriptDraft);
    const validationError = validateScriptManifest(normalized, l);
    if (validationError !== '') {
      setNotice(validationError);
      return;
    }
    session.clearError();
    setNotice('');
    setScriptSubmitting(true);
    try {
      let nextJob = job;
      let nextArtifact = scriptArtifact;
      if (scriptDirty) {
        nextJob = await session.applyAction({
          actor: 'user',
          action: 'edit-script',
          input: {
            artifactId: scriptArtifact.id,
            content: JSON.stringify(normalized)
          }
        });
        const editedArtifact = latestCompleted(nextJob.artifacts, 'script_manifest');
        if (editedArtifact === undefined) {
          throw new Error(l('脚本已保存，但未找到新的脚本版本', 'The script was saved, but the new version could not be found.'));
        }
        nextArtifact = editedArtifact;
        setScriptDraftState({
          artifactId: editedArtifact.id,
          baseline: JSON.stringify(normalized),
          value: normalized
        });
        setNotice(l(
          '脚本修改已保存，请检查修改后的最终脚本并再次点击下一步确认。',
          'Script changes were saved. Review the final script and click Next again to approve it.'
        ));
        return;
      }
      await session.applyAction({
        actor: 'user',
        action: 'approve-script',
        input: { artifactId: nextArtifact.id, revision: nextJob.revision }
      });
      setActiveStep(2);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setScriptSubmitting(false);
    }
  }

  async function continueFromAudio() {
    if (audioTimingArtifact === undefined || transitionPending !== undefined || isBusy) return;
    session.clearError();
    setNotice('');
    setTransitionPending('audio');
    try {
      await session.applyAction({
        actor: 'user',
        action: 'continue-after-audio',
        input: { artifactId: audioTimingArtifact.id, revision: job.revision }
      });
      setActiveStep(3);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setTransitionPending(undefined);
    }
  }

  async function continueFromVisuals() {
    if (visualValidationArtifact === undefined || transitionPending !== undefined || isBusy) return;
    session.clearError();
    setNotice('');
    setTransitionPending('visuals');
    try {
      const nextJob = await session.applyAction({
        actor: 'user',
        action: 'continue-after-visuals',
        input: { artifactId: visualValidationArtifact.id, revision: job.revision }
      });
      setActiveStep(readCreatorResultSnapshots(nextJob.state.resultSnapshots).length > 0 ? 5 : 4);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setTransitionPending(undefined);
    }
  }

  function retryAudioStage(stage: CreatorStageRun) {
    void apply('retry-stage', {
      stageId: stage.stageId,
      ...(stage.scopeKey === null ? {} : { scopeKey: stage.scopeKey })
    });
  }

  function retryRenderStage() {
    const failed = [...job.stages].reverse().find(stage => (
      stickmanWorkflowStep(stage.stageId) === 4 && stage.status === 'failed'
    ));
    if (failed === undefined) return;
    void apply('retry-stage', {
      stageId: failed.stageId,
      ...(failed.scopeKey === null ? {} : { scopeKey: failed.scopeKey })
    });
  }

  async function saveShot(shotId: string, visualDescription: string, motion: string) {
    if (shotSpecArtifact === undefined || savingShotId !== undefined) return;
    const description = visualDescription.trim();
    if (description === '') {
      setNotice(l('画面描述不能为空', 'Visual description cannot be empty.'));
      return;
    }
    const previousStageId = latestShotStage(job.stages, shotId)?.id ?? null;
    session.clearError();
    setNotice('');
    setSavingShotId(shotId);
    setRegenerationRequests(current => ({ ...current, [shotId]: previousStageId }));
    try {
      await session.applyAction({
        actor: 'user',
        action: 'edit-shot',
        input: {
          artifactId: shotSpecArtifact.id,
          scopeKey: shotId,
          patch: {
            visualDescription: description,
            motion
          },
          revision: job.revision
        }
      });
    } catch (error) {
      setRegenerationRequests(current => {
        const next = { ...current };
        delete next[shotId];
        return next;
      });
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingShotId(undefined);
    }
  }

  async function regenerateShot(shotId: string) {
    if (Object.hasOwn(regenerationRequests, shotId)) return;
    const stage = latestShotStage(job.stages, shotId);
    if (stage?.inputFingerprint === null || stage?.inputFingerprint === undefined) {
      setNotice(l('当前镜头尚未建立生成指纹，请先审核分镜', 'This shot has no generation fingerprint yet. Approve the storyboard first.'));
      return;
    }
    session.clearError();
    setNotice('');
    setRegenerationRequests(current => ({ ...current, [shotId]: stage.id }));
    try {
      await session.applyAction({
        actor: 'user',
        action: 'regenerate-shot',
        input: {
          scopeKey: shotId,
          inputFingerprint: stage.inputFingerprint,
          revision: job.revision
        }
      });
    } catch (error) {
      setRegenerationRequests(current => {
        const next = { ...current };
        delete next[shotId];
        return next;
      });
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateMissingShots() {
    if (batchGenerationPending || isBusy) return;
    session.clearError();
    setNotice('');
    batchGenerationStageCount.current = job.stages.length;
    setBatchGenerationPending(true);
    try {
      await session.applyAction({
        actor: 'user',
        action: 'generate-missing-shots',
        input: { revision: job.revision }
      });
    } catch (error) {
      setBatchGenerationPending(false);
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function control(kind: 'canceling' | 'resuming') {
    setControlPending(kind);
    try {
      if (kind === 'canceling') await session.cancelJob();
      else await session.resumeJob();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setControlPending(undefined);
    }
  }

  const steps = [
    l('来源与角色', 'Source and character'),
    l('脚本审核', 'Script review'),
    l('配音与节奏', 'Voice and timing'),
    l('分镜与画面', 'Storyboard and visuals'),
    l('动画合成', 'Video composition'),
    l('成片交付', 'Video delivery')
  ];
  const completedSteps = [
    scriptArtifact !== undefined,
    scriptArtifact !== undefined && job.state.approvedScriptArtifactId === scriptArtifact.id,
    audioTimingArtifact !== undefined,
    visualValidationArtifact !== undefined,
    latestSnapshot !== undefined,
    latestSnapshot !== undefined
  ];

  return (
    <CreatorToolShell
      title={l('火柴人动画', 'Stickman video')}
      titleIcon={<PersonStanding size={20} strokeWidth={1.8} />}
      subtitle={l('从文本或 YouTube 内容生成旁白、配音、分镜画面、字幕与动画', 'Turn text or YouTube content into narration, voice, storyboard visuals, subtitles, and animation.')}
      context={currentIssue(job, steps[workbenchStep]!, l)}
      stepLabel={steps[workbenchStep]}
      currentIssue={review?.message ?? undefined}
      placeholder={props.promptHint ?? l('告诉 Agent 需要调整的脚本、镜头或画面要求', 'Tell the Agent what to change in the script, shots, or visuals')}
      suggestions={[
        l('检查当前任务状态', 'Check the current task status'),
        l('优化脚本节奏', 'Improve the script pacing'),
        l('检查镜头一致性', 'Check shot consistency')
      ]}
      pageClassName="stickman-workspace-page"
      contentClassName="stickman-workspace-content"
      onCancelTask={isBusy ? () => void control('canceling') : undefined}
      onResumeTask={job.status === 'canceled' ? () => void control('resuming') : undefined}
      taskControlPending={controlPending}
      onBack={props.onBack}
    >
      <div className="creator-tool-stack stickman-tool-stack">
        <div className="stickman-tool-top">
          <nav className="video-translation-steps creator-tool-steps stickman-steps" aria-label={l('火柴人视频制作步骤', 'Stickman video steps')}>
            <ol>
              {steps.map((step, index) => {
                const active = index === activeStep;
                const completed = completedSteps[index] ?? false;
                return (
                  <li
                    key={step}
                    data-active={active}
                    data-completed={completed}
                    data-visited={index <= workbenchStep}
                    data-running={index === workbenchStep && isBusy}
                  >
                    <button
                      type="button"
                      disabled={index > workbenchStep}
                      aria-current={active ? 'step' : undefined}
                      onClick={() => setActiveStep(index)}
                    >
                      <span>{completed
                        ? <Check size={13} strokeWidth={2.2} aria-hidden="true" />
                        : index === workbenchStep && isBusy
                          ? <LoaderCircle className="creator-collaboration-spin" size={13} aria-hidden="true" />
                          : index + 1}</span>
                      <strong>{step}</strong>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {notice || session.error ? (
            <div className="creator-tool-notice" role="alert">
              <span>{notice || session.error?.message}</span>
              <button type="button" onClick={() => { setNotice(''); session.clearError(); }} aria-label={l('关闭提示', 'Dismiss')}><X size={15} /></button>
            </div>
          ) : null}
        </div>

        <div
          className="creator-task-layout stickman-step-scroll"
          data-step={activeStep}
          key={`stickman-step-${activeStep}`}
        >
          <section className="creator-task-workspace">
            {activeStep === 0 ? (
              <SourceAndCharacterStep
                sourceType={sourceType}
                sourceUrl={sourceUrl}
                sourceText={sourceText}
                characterAsset={characterAsset}
                styleAsset={styleAsset}
                characterAssets={characterAssets}
                styleAssets={styleAssets}
                previewUrls={visualAssetPreviewUrls}
                visualAssetCatalogStatus={visualAssetCatalogStatus}
                targetDurationSeconds={targetDurationSeconds}
                ttsProvider={ttsProvider}
                ttsModel={ttsModel}
                voiceCode={voiceCode}
                creatorServicesService={props.creatorServicesService ?? null}
                ttsConfigurationStatus={ttsConfigurationStatus}
                imageConfigurationStatus={imageConfigurationStatus}
                busy={isBusy}
                canContinue={workbenchStep > 0}
                l={l}
                onPatch={patch => session.updateDraft({ ratio: '16:9', ...patch }, { semantic: true })}
                onStart={startWorkflow}
                onContinue={() => setActiveStep(1)}
              />
            ) : null}

            {activeStep === 1 ? (
              <ScriptStep
                artifact={scriptArtifact}
                script={scriptDraft}
                stage={scriptStage}
                requiresRegeneration={scriptRequiresRegeneration}
                dirty={scriptDirty}
                busy={isBusy}
                submitting={scriptSubmitting}
                l={l}
                onChange={updateScriptDraft}
                onBack={() => setActiveStep(0)}
                onNext={() => void continueFromScript()}
                onRetry={() => void apply('retry-stage', { stageId: 'script' })}
              />
            ) : null}

            {activeStep === 2 ? (
              <AudioStep
                script={script}
                timing={audioTiming}
                timingStage={latestStage(job.stages, 'audio-timing')}
                artifacts={job.artifacts}
                stages={job.stages}
                voiceName={voiceName}
                targetLanguage={targetLanguage}
                busy={isBusy || transitionPending === 'audio'}
                l={l}
                onBack={() => setActiveStep(1)}
                onNext={() => void continueFromAudio()}
                onRetry={retryAudioStage}
              />
            ) : null}

            {activeStep === 3 ? (
              <StoryboardStep
                jobStages={job.stages}
                shotSpec={shotSpec}
                script={script}
                timing={audioTiming}
                artifacts={job.artifacts}
                busy={isBusy || transitionPending === 'visuals'}
                batchGenerationPending={batchGenerationPending}
                savingShotId={savingShotId}
                regenerationRequests={regenerationRequests}
                l={l}
                onSave={saveShot}
                onRegenerate={shotId => void regenerateShot(shotId)}
                onGenerateMissing={() => void generateMissingShots()}
                onBack={() => setActiveStep(2)}
                onNext={() => void continueFromVisuals()}
              />
            ) : null}

            {activeStep === 4 ? (
              <CompositionStep
                stages={job.stages}
                deliveryReady={latestSnapshot !== undefined}
                l={l}
                onBack={() => setActiveStep(3)}
                onRetry={retryRenderStage}
              />
            ) : null}

            {activeStep === 5 ? (
              <ResultStep
                artifacts={job.artifacts}
                snapshot={currentSnapshot}
                videoUrl={videoUrl}
                version={selectedVersion || latestSnapshot?.version || 0}
                versions={snapshots.map(snapshot => ({ value: snapshot.version, description: snapshot.description }))}
                manifest={deliveryManifest}
                l={l}
                onVersionChange={setSelectedVersion}
                onOpen={artifact => void openArtifact(session.openArtifact, artifact)}
                onDownload={artifact => void downloadArtifact(session.openArtifact, artifact)}
                onBack={() => setActiveStep(4)}
              />
            ) : null}
          </section>
        </div>
      </div>

    </CreatorToolShell>
  );
}

function SourceAndCharacterStep(props: {
  sourceType: 'url' | 'text';
  sourceUrl: string;
  sourceText: string;
  characterAsset: CreatorVisualAssetRef;
  styleAsset: CreatorVisualAssetRef;
  characterAssets: CreatorVisualAssetSummary[];
  styleAssets: CreatorVisualAssetSummary[];
  previewUrls: Record<string, string>;
  visualAssetCatalogStatus: VisualAssetCatalogStatus;
  targetDurationSeconds: number;
  ttsProvider: CreatorTtsProvider;
  ttsModel: string;
  voiceCode: string;
  creatorServicesService: CreatorServicesSettingsService | null;
  ttsConfigurationStatus: TtsConfigurationStatus;
  imageConfigurationStatus: ImageConfigurationStatus;
  busy: boolean;
  canContinue: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onPatch(patch: Record<string, CreatorJson>): void;
  onStart(): void;
  onContinue(): void;
}) {
  return (
    <div className="creator-tool-panel stickman-story-panel">
      <header className="creator-tool-panel-heading"><span><Sparkles size={18} /></span><div><h2>{props.l('来源与角色', 'Source and character')}</h2><p>{props.l('选择创作来源与固定角色。', 'Choose a source and a fixed character.')}</p></div></header>
      <div className="creator-tool-segmented" role="tablist" aria-label={props.l('内容来源', 'Content source')}>
        <button type="button" role="tab" aria-selected={props.sourceType === 'text'} onClick={() => props.onPatch({ sourceType: 'text' })}><FileText size={15} />{props.l('输入文本', 'Text')}</button>
        <button type="button" role="tab" aria-selected={props.sourceType === 'url'} onClick={() => props.onPatch({ sourceType: 'url' })}><Link2 size={15} />YouTube</button>
      </div>
      {props.sourceType === 'text' ? (
        <label className="creator-tool-field stickman-source-text"><span>{props.l('文本内容', 'Source text')}</span><textarea value={props.sourceText} placeholder={props.l('输入文章、脚本草稿或要讲解的内容', 'Enter an article, script draft, or topic content')} maxLength={50_000} onChange={event => props.onPatch({ sourceText: event.target.value })} /></label>
      ) : (
        <label className="creator-tool-field"><span>{props.l('YouTube 链接', 'YouTube URL')}</span><input type="url" value={props.sourceUrl} placeholder="https://www.youtube.com/watch?v=..." onChange={event => props.onPatch({ sourceUrl: event.target.value })} /></label>
      )}
      <div className="stickman-character-picker">
        <div className="stickman-character-presets" role="radiogroup" aria-label={props.l('角色预设', 'Character presets')}>
          {props.characterAssets.map(asset => {
            const selected = sameAssetRef(props.characterAsset, asset);
            const previewUrl = props.previewUrls[assetRefKey(asset)];
            return (
            <button type="button" role="radio" aria-checked={selected} key={assetRefKey(asset)} onClick={() => props.onPatch({ characterAsset: { assetId: asset.id, revision: asset.revision } })}>
              <span className="stickman-character-preset-visual">{previewUrl === undefined ? <LoaderCircle className="creator-collaboration-spin" size={18} aria-hidden="true" /> : <img src={previewUrl} alt="" />}</span>
              <strong title={props.l(asset.name.zhCN, asset.name.en)}>{props.l(asset.name.zhCN, asset.name.en)}</strong>
              {selected ? <Check className="stickman-character-preset-check" size={15} /> : null}
            </button>
          );})}
        </div>
        {props.visualAssetCatalogStatus === 'loading' ? <div className="stickman-asset-catalog-state" role="status"><LoaderCircle className="creator-collaboration-spin" size={17} />{props.l('正在读取视觉资产', 'Loading visual assets')}</div> : null}
        {props.visualAssetCatalogStatus === 'error' || props.visualAssetCatalogStatus === 'unavailable' ? <div className="stickman-asset-catalog-state is-error" role="alert"><ImageIcon size={17} />{props.l('人物与视觉风格目录不可用', 'The character and visual style catalog is unavailable')}</div> : null}
      </div>
      <div className="creator-tool-form-row">
        <VisualStylePicker
          assets={props.styleAssets}
          selected={props.styleAsset}
          l={props.l}
          onChange={styleAsset => props.onPatch({ styleAsset })}
        />
        <div className="creator-tool-field">
          <span id="stickman-target-duration-label">{props.l('目标时长', 'Target duration')}</span>
          <div className="stickman-duration-control">
            <select
              aria-labelledby="stickman-target-duration-label"
              value={targetDurationPreset(props.targetDurationSeconds)}
              onChange={event => props.onPatch({
                targetDurationSeconds: event.target.value === 'custom'
                  ? 90
                  : Number(event.target.value)
              })}
            >
              <option value="30">{props.l('30 秒', '30 seconds')}</option>
              <option value="60">{props.l('1 分钟', '1 minute')}</option>
              <option value="300">{props.l('5 分钟', '5 minutes')}</option>
              <option value="600">{props.l('10 分钟', '10 minutes')}</option>
              <option value="custom">{props.l('自定义', 'Custom')}</option>
            </select>
            {targetDurationPreset(props.targetDurationSeconds) === 'custom' ? (
              <span className="stickman-custom-duration">
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={props.targetDurationSeconds}
                  aria-label={props.l('自定义时长（秒）', 'Custom duration in seconds')}
                  onChange={event => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value >= 10 && value <= 600) {
                      props.onPatch({ targetDurationSeconds: value });
                    }
                  }}
                />
                <small>{props.l('秒', 'sec')}</small>
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="stickman-voice-settings">
        {props.ttsConfigurationStatus === 'configured' && props.ttsProvider !== 'edge-tts' ? (
          <TtsVoicePicker
            id="stickman-video-voice"
            provider={props.ttsProvider}
            model={props.ttsModel}
            value={props.voiceCode}
            service={props.creatorServicesService}
            label={props.l('配音音色', 'Narration voice')}
            disabled={props.busy}
            onChange={(voiceId, voice) => props.onPatch({
              voiceCode: voiceId,
              voiceName: voice?.name ?? voiceId
            })}
            onVoiceResolved={voice => props.onPatch({ voiceName: voice.name })}
          />
        ) : props.ttsConfigurationStatus === 'configured' ? (
          <div className="stickman-tts-configuration is-configured" role="status">
            <Volume2 size={18} aria-hidden="true" />
            <div>
              <strong>{props.l('使用 Edge TTS 配音', 'Using Edge TTS')}</strong>
              <small>{props.l('无需选择音色，将使用服务默认音色。', 'No voice selection is required; the service default will be used.')}</small>
            </div>
          </div>
        ) : (
          <div className="stickman-tts-configuration" role="status">
            {props.ttsConfigurationStatus === 'loading'
              ? <LoaderCircle className="creator-collaboration-spin" size={18} aria-hidden="true" />
              : <Settings2 size={18} aria-hidden="true" />}
            <div>
              <strong>{props.ttsConfigurationStatus === 'loading'
                ? props.l('正在读取配音服务配置', 'Loading TTS settings')
                : props.l('尚未配置配音服务', 'TTS service is not configured')}</strong>
              <small>{props.ttsConfigurationStatus === 'unavailable'
                ? props.l('暂时无法读取配置，请检查 Runtime 或前往设置。', 'Settings are temporarily unavailable. Check the Runtime or open Settings.')
                : props.l('配置服务商和 API Key 后，才能选择配音音色。', 'Configure a provider and API key before selecting a voice.')}</small>
            </div>
            {props.ttsConfigurationStatus !== 'loading' ? (
              <a href="#/settings?tab=ai-services&section=tts">
                {props.l('前往配音服务配置', 'Configure TTS service')}
              </a>
            ) : null}
          </div>
        )}
      </div>
      {props.imageConfigurationStatus !== 'configured' ? (
        <div className="stickman-tts-configuration" role="status">
          {props.imageConfigurationStatus === 'loading'
            ? <LoaderCircle className="creator-collaboration-spin" size={18} aria-hidden="true" />
            : <ImageIcon size={18} aria-hidden="true" />}
          <div>
            <strong>{props.imageConfigurationStatus === 'loading'
              ? props.l('正在读取生图服务配置', 'Loading image settings')
              : props.imageConfigurationStatus === 'unsupported'
                ? props.l('当前生图服务不支持角色参考图', 'The image provider does not support character references')
                : props.l('尚未配置生图服务', 'Image service is not configured')}</strong>
            <small>{props.imageConfigurationStatus === 'unsupported'
              ? props.l('火柴人必须把所选角色图片随每个镜头提交，请切换到 OpenAI 或 Gemini。', 'Stickman generation must attach the selected character to every shot. Switch to OpenAI or Gemini.')
              : props.l('配置支持参考图的服务后，才能保证镜头使用所选角色。', 'Configure a reference-capable provider so every shot uses the selected character.')}</small>
          </div>
          {props.imageConfigurationStatus !== 'loading' ? (
            <a href="#/settings?tab=ai-services&section=image">
              {props.l('前往生图服务配置', 'Configure image service')}
            </a>
          ) : null}
        </div>
      ) : null}
      <div className={`stickman-wizard-actions stickman-source-actions${props.canContinue ? ' has-next' : ''}`}>
        {props.canContinue ? (
          <button
            className="video-translation-secondary-action"
            type="button"
            disabled={props.busy || props.ttsConfigurationStatus !== 'configured' || props.imageConfigurationStatus !== 'configured'}
            onClick={props.onStart}
          >
            {props.busy
              ? <LoaderCircle className="creator-collaboration-spin" size={16} aria-hidden="true" />
              : <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />}
            {props.busy
              ? props.l('重新生成中...', 'Regenerating...')
              : props.l('重新生成', 'Regenerate')}
          </button>
        ) : null}
        <button
          className="video-translation-primary-action"
          type="button"
          disabled={props.busy || (!props.canContinue && (
            props.ttsConfigurationStatus !== 'configured'
            || props.imageConfigurationStatus !== 'configured'
            || props.visualAssetCatalogStatus === 'error'
            || props.visualAssetCatalogStatus === 'unavailable'
          ))}
          onClick={props.canContinue ? props.onContinue : props.onStart}
        >
          {props.canContinue
            ? props.l('下一步', 'Next')
            : props.busy
              ? props.l('生成中...', 'Generating...')
              : props.l('开始生成', 'Start generation')}
          {props.canContinue
            ? <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
            : props.busy
              ? <LoaderCircle className="creator-collaboration-spin" size={16} aria-hidden="true" />
              : <Sparkles size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

function VisualStylePicker(props: {
  assets: CreatorVisualAssetSummary[];
  selected: CreatorVisualAssetRef;
  l: ReturnType<typeof useLocalizedCopy>;
  onChange(reference: CreatorVisualAssetRef): void;
}) {
  const selectedAsset = props.assets.find(asset => sameAssetRef(props.selected, asset));
  return (
    <div className="creator-tool-field stickman-style-field">
      <label htmlFor="stickman-visual-style">{props.l('视觉风格', 'Visual style')}</label>
      <select
        id="stickman-visual-style"
        value={selectedAsset === undefined ? '' : assetRefKey(selectedAsset)}
        disabled={props.assets.length === 0}
        onChange={event => {
          const asset = props.assets.find(candidate => assetRefKey(candidate) === event.target.value);
          if (asset !== undefined) props.onChange({ assetId: asset.id, revision: asset.revision });
        }}
      >
        {props.assets.length === 0 ? <option value="">{props.l('正在读取视觉风格', 'Loading visual styles')}</option> : null}
        {props.assets.map(asset => (
          <option key={assetRefKey(asset)} value={assetRefKey(asset)}>
            {props.l(asset.name.zhCN, asset.name.en)}
          </option>
        ))}
      </select>
      {selectedAsset?.styleAttributes !== undefined ? (
        <div className="stickman-style-summary">
          <span
            className="stickman-style-swatch"
            data-texture={selectedAsset.styleAttributes.swatch.texture}
            aria-hidden="true"
            style={{
              '--stickman-style-bg': selectedAsset.styleAttributes.swatch.background,
              '--stickman-style-fg': selectedAsset.styleAttributes.swatch.foreground,
              '--stickman-style-accent': selectedAsset.styleAttributes.swatch.accent
            } as CSSProperties}
          ><i /><i /><i /></span>
          <span className="stickman-style-copy">
            <strong>{props.l(selectedAsset.name.zhCN, selectedAsset.name.en)}</strong>
            <small>{props.l(selectedAsset.description.zhCN, selectedAsset.description.en)}</small>
            <span>
              <em>{props.l(selectedAsset.styleAttributes.medium.zhCN, selectedAsset.styleAttributes.medium.en)}</em>
              <em>{props.l(selectedAsset.styleAttributes.palette.zhCN, selectedAsset.styleAttributes.palette.en)}</em>
              <em>{props.l(selectedAsset.styleAttributes.sceneDensity.zhCN, selectedAsset.styleAttributes.sceneDensity.en)}</em>
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function readVisualAssetRef(
  value: CreatorJson | undefined,
  fallback: CreatorVisualAssetRef
): CreatorVisualAssetRef {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    return fallback;
  }
  return typeof value.assetId === 'string'
    && typeof value.revision === 'number'
    && Number.isSafeInteger(value.revision)
    && value.revision > 0
    ? { assetId: value.assetId, revision: value.revision }
    : fallback;
}

function sameAssetRef(
  reference: CreatorVisualAssetRef,
  asset: Pick<CreatorVisualAssetSummary, 'id' | 'revision'>
): boolean {
  return reference.assetId === asset.id && reference.revision === asset.revision;
}

function assetRefKey(asset: Pick<CreatorVisualAssetSummary, 'id' | 'revision'>): string {
  return `${asset.id}@${asset.revision}`;
}

function targetDurationPreset(value: number): string {
  return targetDurationPresets.includes(value as (typeof targetDurationPresets)[number])
    ? String(value)
    : 'custom';
}

function stickmanWorkflowStep(value: unknown): number {
  if (typeof value !== 'string') return 0;
  if (
    value === 'source-brief'
    || value === 'content-plan'
    || value === 'script'
  ) return 1;
  if (
    value === 'narration'
    || value === 'audio-timing'
  ) return 2;
  if (
    value === 'storyboard'
    || value === 'style-assets'
    || value === 'prompt-pack'
    || value === 'images'
    || value === 'visual-validation'
  ) return 3;
  if (
    value === 'timeline'
    || value === 'render-clean'
    || value === 'media-validation'
    || value === 'package-validation'
  ) return 4;
  return 0;
}

function isTtsProvider(value: unknown): value is CreatorTtsProvider {
  return value === 'openai'
    || value === 'aliyun'
    || value === 'minimax'
    || value === 'edge-tts';
}

function cloneScriptManifest(value: ScriptManifest): ScriptManifest {
  return {
    ...value,
    narrationBudget: { ...value.narrationBudget },
    segments: value.segments.map(segment => ({
      ...segment,
      claimIds: [...segment.claimIds],
      sourceSpanIds: [...segment.sourceSpanIds]
    }))
  };
}

function normalizeScriptManifest(value: ScriptManifest): ScriptManifest {
  return {
    ...value,
    title: value.title.trim(),
    language: value.language.trim(),
    segments: value.segments.map(segment => ({
      ...segment,
      narration: segment.narration.trim()
    }))
  };
}

function validateScriptManifest(
  value: ScriptManifest,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (value.title.length === 0) return l('请填写脚本标题', 'Enter a script title.');
  const invalidSegment = value.segments.findIndex(segment => (
    segment.narration.length === 0
  ));
  if (invalidSegment >= 0) {
    return l(
      `请完善第 ${invalidSegment + 1} 段旁白`,
      `Complete the narration for segment ${invalidSegment + 1}.`
    );
  }
  return '';
}

function ScriptStep(props: {
  artifact?: CreatorArtifact;
  script?: ScriptManifest;
  stage?: CreatorStageRun;
  requiresRegeneration: boolean;
  dirty: boolean;
  busy: boolean;
  submitting: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onChange(value: ScriptManifest): void;
  onBack(): void;
  onNext(): void;
  onRetry(): void;
}) {
  if (props.requiresRegeneration) {
    return (
      <div className="stickman-script-step">
        <div className="creator-tool-panel creator-workspace-loading" role="alert">
          <FileText size={20} />
          <p>{props.l(
            '当前脚本结构已更新，请返回来源与角色重新生成',
            'The script structure has changed. Return to Source and character to regenerate it.'
          )}</p>
        </div>
        <footer className="stickman-wizard-actions stickman-script-actions">
          <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            {props.l('上一步', 'Back')}
          </button>
          <button className="video-translation-primary-action" type="button" disabled>
            {props.l('下一步', 'Next')}
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </footer>
      </div>
    );
  }
  if (props.artifact === undefined || props.script === undefined) {
    return (
      <div className="stickman-script-step">
        <ScriptPlaceholderPanel
          stage={props.stage}
          busy={props.busy}
          l={props.l}
          onRetry={props.onRetry}
        />
        <footer className="stickman-wizard-actions stickman-script-actions">
          <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            {props.l('上一步', 'Back')}
          </button>
          <button className="video-translation-primary-action" type="button" disabled>
            {props.l('下一步', 'Next')}
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </footer>
      </div>
    );
  }
  const script = props.script;
  const totalDuration = Math.round(script.estimatedTotalDurationSeconds * 10) / 10;
  function updateSegment(index: number, patch: Partial<ScriptManifest['segments'][number]>) {
    props.onChange({
      ...script,
      segments: script.segments.map((segment, segmentIndex) => (
        segmentIndex === index ? { ...segment, ...patch } : segment
      ))
    });
  }
  return (
    <div className="stickman-script-step">
      <div className="creator-tool-panel stickman-script-panel">
        <header className="creator-tool-panel-heading">
          <span><FileText size={18} /></span>
          <div className="stickman-script-heading-copy">
            <input
              aria-label={props.l('脚本标题', 'Script title')}
              value={script.title}
              onChange={event => props.onChange({ ...script, title: event.target.value })}
            />
            <p>
              {script.language} · {script.segments.length} {props.l('段', 'segments')}
              {' · '}{props.l('预计', 'est.')} {totalDuration}s / {props.l('目标', 'target')} {formatSeconds(script.targetDurationSeconds)}
            </p>
          </div>
          {props.dirty ? <small className="stickman-script-unsaved">{props.l('有未保存修改', 'Unsaved changes')}</small> : null}
        </header>
        <div className="stickman-script-editor">
          {script.segments.map((segment, index) => (
            <article className="stickman-script-row" key={segment.id}>
              <div className="stickman-script-meta">
                <strong>{String(index + 1).padStart(2, '0')}</strong>
                <small>{props.l('预计', 'est.')} {Math.round(segment.estimatedDurationSeconds * 10) / 10}s</small>
              </div>
              <div className="stickman-script-fields">
                <label>
                  <span>{props.l('旁白', 'Narration')}</span>
                  <textarea
                    rows={3}
                    value={segment.narration}
                    aria-label={props.l(`第 ${index + 1} 段旁白`, `Segment ${index + 1} narration`)}
                    onChange={event => updateSegment(index, { narration: event.target.value })}
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      </div>
      <footer className="stickman-wizard-actions stickman-script-actions">
        <button className="video-translation-secondary-action" type="button" disabled={props.submitting} onClick={props.onBack}>
          <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          {props.l('上一步', 'Back')}
        </button>
        <button className="video-translation-primary-action" type="button" disabled={props.busy || props.submitting} onClick={props.onNext}>
          {props.submitting ? props.l('正在保存...', 'Saving...') : props.l('下一步', 'Next')}
          {props.submitting
            ? <LoaderCircle className="creator-collaboration-spin" size={16} aria-hidden="true" />
            : <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />}
        </button>
      </footer>
    </div>
  );
}

function ScriptPlaceholderPanel(props: {
  stage?: CreatorStageRun;
  busy: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onRetry(): void;
}) {
  const failed = props.stage?.status === 'failed';
  return (
    <div
      className="creator-tool-panel stickman-script-panel stickman-script-placeholder"
      data-state={failed ? 'failed' : 'loading'}
      aria-busy={!failed}
    >
      <header className="creator-tool-panel-heading">
        <span><FileText size={18} /></span>
        <div className="stickman-script-placeholder-heading">
          <h2>{props.l('脚本内容', 'Script')}</h2>
          <p role="status">{failed ? props.l('生成失败', 'Generation failed') : props.l('正在生成', 'Generating')}</p>
        </div>
        {!failed ? <LoaderCircle className="creator-collaboration-spin" size={17} aria-hidden="true" /> : null}
      </header>
      {failed ? (
        <div className="stickman-script-placeholder-error" role="alert">
          <span><FileText size={20} /></span>
          <strong>{props.l('脚本生成失败', 'Script generation failed')}</strong>
          <p>{props.stage?.errorMessage ?? props.l('生成脚本时出现问题，请重新生成', 'Something went wrong while generating the script.')}</p>
          <button
            className="video-translation-secondary-action"
            type="button"
            disabled={props.busy}
            onClick={props.onRetry}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {props.l('重新生成', 'Regenerate')}
          </button>
        </div>
      ) : (
        <div className="stickman-script-editor stickman-script-skeleton-editor" aria-hidden="true">
          {[0, 1, 2].map(index => (
            <article className="stickman-script-row stickman-script-skeleton-row" key={index}>
              <div className="stickman-script-meta">
                <strong>{String(index + 1).padStart(2, '0')}</strong>
                <i className="stickman-script-skeleton-duration" />
              </div>
              <div className="stickman-script-skeleton-fields">
                <div>
                  <span>{props.l('旁白', 'Narration')}</span>
                  <div className="stickman-script-skeleton-box is-narration">
                    <i />
                    <i className="is-medium" />
                    <i className="is-short" />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AudioStep(props: {
  script?: ScriptManifest;
  timing?: AudioTiming;
  timingStage?: CreatorStageRun;
  artifacts: CreatorArtifact[];
  stages: CreatorStageRun[];
  voiceName: string;
  targetLanguage: string;
  busy: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onBack(): void;
  onNext(): void;
  onRetry(stage: CreatorStageRun): void;
}) {
  const timingBySegment = new Map(
    props.timing?.segments.map(segment => [segment.segmentId, segment]) ?? []
  );
  const segments = props.script?.segments ?? [];
  const readyCount = segments.filter(segment => props.artifacts.some(artifact => (
    artifact.kind === 'narration_audio'
    && artifact.scopeKey === segment.id
    && artifact.status === 'completed'
  ))).length;
  return (
    <div className="stickman-audio-step">
      <div className="creator-tool-panel stickman-audio-review">
        <header className="creator-tool-panel-heading">
          <span><Volume2 size={18} /></span>
          <div>
            <h2>{props.l('配音与节奏', 'Voice and timing')}</h2>
            <p>
              {props.timing
                ? props.l(
                    `${segments.length} 段旁白 · 实际 ${formatSeconds(props.timing.totalDurationSeconds)} · 目标 ${formatSeconds(props.script?.targetDurationSeconds ?? props.timing.totalDurationSeconds)}`,
                    `${segments.length} narration segments · ${formatSeconds(props.timing.totalDurationSeconds)} actual · ${formatSeconds(props.script?.targetDurationSeconds ?? props.timing.totalDurationSeconds)} target`
                  )
                : props.l(
                    `正在生成旁白 ${readyCount}/${segments.length}`,
                    `Generating narration ${readyCount}/${segments.length}`
                  )}
            </p>
          </div>
          <div className="stickman-audio-meta">
            <strong>{props.voiceName || props.l('服务默认音色', 'Service default voice')}</strong>
            <small>{props.targetLanguage}</small>
          </div>
        </header>
        <div className="stickman-audio-segments">
          {segments.length === 0 ? (
            <div className="stickman-inline-empty">
              <FileAudio size={20} />
              <span>{props.l('正在准备配音内容', 'Preparing narration content.')}</span>
            </div>
          ) : segments.map((segment, index) => {
            const timing = timingBySegment.get(segment.id);
            const artifact = timing === undefined
              ? [...props.artifacts].reverse().find(candidate => (
                  candidate.kind === 'narration_audio'
                  && candidate.scopeKey === segment.id
                  && candidate.status === 'completed'
                ))
              : props.artifacts.find(candidate => candidate.id === timing.audioArtifactId);
            const stage = latestScopedStage(props.stages, 'narration', segment.id);
            return (
              <NarrationRow
                key={segment.id}
                index={index}
                narration={segment.narration}
                durationSeconds={timing?.durationSeconds ?? readArtifactDuration(artifact)}
                artifact={artifact}
                stage={stage}
                l={props.l}
                onRetry={() => stage && props.onRetry(stage)}
              />
            );
          })}
        </div>
      </div>
      {props.timingStage?.status === 'failed' && props.timing === undefined ? (
        <footer className="stickman-wizard-actions stickman-script-actions">
          <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
            <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            {props.l('上一步', 'Back')}
          </button>
          <button className="video-translation-primary-action" type="button" onClick={() => props.onRetry(props.timingStage!)}>
            <RefreshCw size={16} aria-hidden="true" />
            {props.l('重新测量时长', 'Measure timing again')}
          </button>
        </footer>
      ) : (
        <WizardActions
          busy={props.busy}
          canContinue={props.timing !== undefined}
          pendingLabel={props.l('配音生成中...', 'Generating narration...')}
          l={props.l}
          onBack={props.onBack}
          onNext={props.onNext}
        />
      )}
    </div>
  );
}

function NarrationRow(props: {
  index: number;
  narration: string;
  durationSeconds?: number;
  artifact?: CreatorArtifact;
  stage?: CreatorStageRun;
  l: ReturnType<typeof useLocalizedCopy>;
  onRetry(): void;
}) {
  const url = useArtifactUrl(props.artifact?.id);
  const failed = props.stage?.status === 'failed';
  const running = props.stage?.status === 'running' || props.stage?.status === 'queued';
  return (
    <article className="stickman-audio-row" data-status={failed ? 'failed' : url ? 'ready' : running ? 'running' : 'waiting'}>
      <div className="stickman-audio-index">
        <strong>{String(props.index + 1).padStart(2, '0')}</strong>
        <small>{props.durationSeconds === undefined ? '--' : formatSeconds(props.durationSeconds)}</small>
      </div>
      <p>{props.narration}</p>
      <div className="stickman-audio-control">
        {url ? <audio controls preload="metadata" src={url} /> : null}
        {!url && running ? <span><LoaderCircle className="creator-collaboration-spin" size={16} />{props.l('生成中', 'Generating')}</span> : null}
        {!url && !running && !failed ? <span><Clock3 size={16} />{props.l('等待生成', 'Waiting')}</span> : null}
        {failed ? (
          <button type="button" onClick={props.onRetry}>
            <RefreshCw size={15} />{props.l('重试', 'Retry')}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StoryboardStep(props: {
  jobStages: CreatorStageRun[];
  shotSpec?: ShotSpec;
  script?: ScriptManifest;
  timing?: AudioTiming;
  artifacts: CreatorArtifact[];
  busy: boolean;
  batchGenerationPending: boolean;
  savingShotId?: string;
  regenerationRequests: Record<string, string | null>;
  l: ReturnType<typeof useLocalizedCopy>;
  onSave(shotId: string, visualDescription: string, motion: string): Promise<void>;
  onRegenerate(shotId: string): void;
  onGenerateMissing(): void;
  onBack(): void;
  onNext(): void;
}) {
  if (props.shotSpec === undefined) {
    return (
      <div className="stickman-storyboard-step">
        <StoryboardPlaceholderPanel
          script={props.script}
          timing={props.timing}
          l={props.l}
        />
        <WizardActions
          canContinue={false}
          busy={props.busy}
          pendingLabel={props.l('正在准备画面...', 'Preparing visuals...')}
          l={props.l}
          onBack={props.onBack}
          onNext={props.onNext}
        />
      </div>
    );
  }
  const readyCount = props.shotSpec.shots.filter(shot => {
    const stage = latestShotStage(props.jobStages, shot.id);
    return latestShotImage(props.artifacts, shot.id, stage?.inputFingerprint ?? null) !== undefined;
  }).length;
  const visualValidation = latestCompleted(props.artifacts, 'visual_validation');
  const visualValidationStage = latestStage(props.jobStages, 'visual-validation');
  const failedCount = props.shotSpec.shots.filter(shot => {
    const stage = latestShotStage(props.jobStages, shot.id);
    const image = latestShotImage(props.artifacts, shot.id, stage?.inputFingerprint ?? null);
    return image === undefined && stage?.status === 'failed';
  }).length;
  const imageGenerationActive = props.jobStages.some(stage => (
    stage.stageId === 'images' && (stage.status === 'queued' || stage.status === 'running')
  ));
  const visualValidationActive = visualValidationStage?.status === 'queued'
    || visualValidationStage?.status === 'running';
  const visualValidationFailed = visualValidationStage?.status === 'failed';
  const canContinue = readyCount === props.shotSpec.shots.length
    && props.shotSpec.shots.length > 0
    && visualValidation !== undefined;
  return (
    <div className="stickman-storyboard-step">
      <div className="creator-tool-panel stickman-storyboard-review">
        <header className="creator-tool-panel-heading"><span><ImageIcon size={18} /></span><div><h2>{props.l('分镜与画面', 'Storyboard and visuals')}</h2><p>{props.l(`${props.shotSpec.shots.length} 个镜头 · 画面已生成 ${readyCount}/${props.shotSpec.shots.length}`, `${props.shotSpec.shots.length} shots · ${readyCount}/${props.shotSpec.shots.length} visuals generated`)}</p></div></header>
        <div className="stickman-storyboard-editor">
          {props.shotSpec.shots.map((shot, index) => {
            const stage = latestShotStage(props.jobStages, shot.id);
            const image = latestShotImage(props.artifacts, shot.id, stage?.inputFingerprint ?? null);
            const narration = props.script?.segments.find(segment => segment.id === shot.sourceSegmentId)?.narration;
            return (
              <StoryboardShotRow
                key={shot.id}
                index={index}
                shot={shot}
                stage={stage}
                image={image}
                narration={narration}
                saving={props.savingShotId === shot.id}
                regenerationRequested={Object.hasOwn(props.regenerationRequests, shot.id)}
                l={props.l}
                onSave={props.onSave}
                onRegenerate={props.onRegenerate}
              />
            );
          })}
        </div>
      </div>
      <StoryboardStepActions
        canContinue={canContinue}
        busy={props.busy}
        batchGenerationPending={props.batchGenerationPending}
        totalCount={props.shotSpec.shots.length}
        readyCount={readyCount}
        failedCount={failedCount}
        imageGenerationActive={imageGenerationActive}
        visualValidationActive={visualValidationActive}
        visualValidationFailed={visualValidationFailed}
        l={props.l}
        onBack={props.onBack}
        onGenerateMissing={props.onGenerateMissing}
        onNext={props.onNext}
      />
    </div>
  );
}

function StoryboardShotRow(props: {
  index: number;
  shot: ShotSpec['shots'][number];
  stage?: CreatorStageRun;
  image?: CreatorArtifact;
  narration?: string;
  saving: boolean;
  regenerationRequested: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onSave(shotId: string, visualDescription: string, motion: string): Promise<void>;
  onRegenerate(shotId: string): void;
}) {
  const [visualDescription, setVisualDescription] = useState(props.shot.visualDescription);
  const [motion, setMotion] = useState(props.shot.motion);
  useEffect(() => {
    setVisualDescription(props.shot.visualDescription);
    setMotion(props.shot.motion);
  }, [props.shot.id, props.shot.motion, props.shot.visualDescription]);

  const stageActive = props.stage?.status === 'queued' || props.stage?.status === 'running';
  const generating = props.regenerationRequested || stageActive;
  const dirty = visualDescription !== props.shot.visualDescription || motion !== props.shot.motion;
  const percent = typeof props.stage?.progress.percent === 'number'
    ? Math.max(0, Math.min(100, Math.round(props.stage.progress.percent)))
    : undefined;
  const generationStatus = props.regenerationRequested && !stageActive
    ? props.l('请求已提交，等待生成', 'Request submitted. Waiting to generate.')
    : props.stage?.status === 'queued'
      ? props.l('已进入生成队列', 'Queued for generation.')
      : props.stage?.status === 'running'
        ? props.l(
            `正在生成画面${percent === undefined ? '' : ` · ${percent}%`}`,
            `Generating visual${percent === undefined ? '' : ` · ${percent}%`}`
          )
        : props.stage?.status === 'failed'
          ? props.stage.errorMessage ?? props.l('画面生成失败', 'Visual generation failed.')
          : '';

  return (
    <article className="stickman-storyboard-row" data-status={generating ? 'generating' : props.stage?.status}>
      <div className="stickman-storyboard-meta">
        <strong>{String(props.index + 1).padStart(2, '0')}</strong>
        <small>{formatSeconds(props.shot.durationSeconds)}</small>
      </div>
      <ShotPreview artifact={props.image} status={props.stage?.status} pending={props.regenerationRequested} l={props.l} />
      <div className="stickman-storyboard-copy">
        <label className="stickman-storyboard-description">
          <strong>{props.l('画面描述', 'Visual description')}</strong>
          <textarea
            aria-label={props.l(`第 ${props.index + 1} 个镜头画面描述`, `Visual description for shot ${props.index + 1}`)}
            value={visualDescription}
            disabled={props.saving || generating}
            onChange={event => setVisualDescription(event.target.value)}
          />
        </label>
        {props.narration ? (
          <div className="stickman-storyboard-narration">
            <span>{props.l('旁白（来自脚本）', 'Narration (from script)')}</span>
            <p>{props.narration}</p>
          </div>
        ) : null}
        <label className="stickman-storyboard-motion">
          <span>{props.l('镜头运动', 'Motion')}</span>
          <select
            aria-label={props.l(`第 ${props.index + 1} 个镜头运动`, `Motion for shot ${props.index + 1}`)}
            value={motion}
            disabled={props.saving || generating}
            onChange={event => setMotion(event.target.value)}
          >
            <option value="static">{props.l('静止', 'Static')}</option>
            <option value="push-in">{props.l('推进', 'Push in')}</option>
            <option value="zoom-out">{props.l('拉远', 'Zoom out')}</option>
            <option value="pan-left">{props.l('向左平移', 'Pan left')}</option>
            <option value="pan-right">{props.l('向右平移', 'Pan right')}</option>
          </select>
        </label>
        <div className="stickman-storyboard-actions">
          {dirty ? (
            <button
              className="stickman-storyboard-prompt"
              type="button"
              disabled={props.saving || generating || visualDescription.trim() === ''}
              onClick={() => void props.onSave(props.shot.id, visualDescription, motion)}
            >
              {props.saving
                ? <LoaderCircle className="creator-collaboration-spin" size={15} aria-hidden="true" />
                : <Check size={15} aria-hidden="true" />}
              {props.saving ? props.l('保存中...', 'Saving...') : props.l('保存修改', 'Save changes')}
            </button>
          ) : null}
          {!generating && props.stage?.status === 'failed' && props.image === undefined ? (
            <button
              className="stickman-storyboard-regenerate"
              type="button"
              disabled={props.saving || dirty}
              onClick={() => props.onRegenerate(props.shot.id)}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {props.l('单独重试', 'Retry this shot')}
            </button>
          ) : null}
          {!generating && props.image !== undefined ? (
            <button
              className="stickman-storyboard-regenerate"
              type="button"
              disabled={props.saving || dirty}
              onClick={() => props.onRegenerate(props.shot.id)}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {props.l('重新生成', 'Regenerate')}
            </button>
          ) : null}
          {!generating && props.image === undefined && props.stage?.status !== 'failed' ? (
            <span className="stickman-storyboard-waiting"><Clock3 size={15} />{props.l('等待生成', 'Waiting')}</span>
          ) : null}
          {generationStatus !== '' ? (
            <span
              className="stickman-storyboard-generation-status"
              data-status={props.stage?.status ?? 'submitting'}
              role="status"
            >
              {generationStatus}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StoryboardPlaceholderPanel(props: {
  script?: ScriptManifest;
  timing?: AudioTiming;
  l: ReturnType<typeof useLocalizedCopy>;
}) {
  const timingBySegment = new Map(
    props.timing?.segments.map(segment => [segment.segmentId, segment]) ?? []
  );
  const segments = props.script?.segments ?? [];
  const rows = segments.length > 0
    ? segments.map(segment => ({
        id: segment.id,
        narration: segment.narration,
        durationSeconds: timingBySegment.get(segment.id)?.durationSeconds
          ?? segment.estimatedDurationSeconds
      }))
    : [0, 1, 2].map(index => ({
        id: `pending-${index}`,
        narration: '',
        durationSeconds: undefined
      }));

  return (
    <div
      className="creator-tool-panel stickman-storyboard-review stickman-storyboard-placeholder"
      aria-busy="true"
    >
      <header className="creator-tool-panel-heading">
        <span><ImageIcon size={18} /></span>
        <div>
          <h2>{props.l('分镜与画面', 'Storyboard and visuals')}</h2>
          <p role="status">
            {segments.length > 0
              ? props.l(
                  `正在规划 ${segments.length} 个镜头的画面描述`,
                  `Planning visual descriptions for ${segments.length} shots`
                )
              : props.l('正在读取旁白并规划分镜', 'Reading narration and planning the storyboard')}
          </p>
        </div>
        <LoaderCircle className="creator-collaboration-spin" size={17} aria-hidden="true" />
      </header>
      <div className="stickman-storyboard-editor">
        {rows.map((row, index) => (
          <article
            className="stickman-storyboard-row stickman-storyboard-loading-row"
            data-status="planning"
            key={row.id}
          >
            <div className="stickman-storyboard-meta">
              <strong>{String(index + 1).padStart(2, '0')}</strong>
              <small>
                {row.durationSeconds === undefined ? '--' : formatSeconds(row.durationSeconds)}
              </small>
            </div>
            <div className="stickman-storyboard-media">
              <div className="stickman-storyboard-image stickman-storyboard-placeholder-image">
                <div className="stickman-storyboard-placeholder-image-status">
                  <LoaderCircle className="creator-collaboration-spin" size={17} aria-hidden="true" />
                  <small>{props.l('准备画面', 'Preparing visual')}</small>
                </div>
              </div>
            </div>
            <div className="stickman-storyboard-copy">
              <strong>{props.l('画面描述', 'Visual description')}</strong>
              <div
                className="stickman-storyboard-description-skeleton"
                aria-label={props.l('正在生成画面描述', 'Generating visual description')}
              >
                <i />
                <i className="is-medium" />
              </div>
              {row.narration !== '' ? (
                <div className="stickman-storyboard-narration">
                  <span>{props.l('旁白', 'Narration')}</span>
                  <p>{row.narration}</p>
                </div>
              ) : (
                <div className="stickman-storyboard-narration-skeleton" aria-hidden="true">
                  <i />
                  <i className="is-short" />
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StoryboardStepActions(props: {
  canContinue: boolean;
  busy: boolean;
  batchGenerationPending: boolean;
  totalCount: number;
  readyCount: number;
  failedCount: number;
  imageGenerationActive: boolean;
  visualValidationActive: boolean;
  visualValidationFailed: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onBack(): void;
  onGenerateMissing(): void;
  onNext(): void;
}) {
  const batchBusy = props.batchGenerationPending
    || props.imageGenerationActive
    || props.visualValidationActive
    || props.busy;
  const remainingCount = Math.max(0, props.totalCount - props.readyCount);
  const label = props.canContinue
    ? props.l('下一步', 'Next')
    : props.batchGenerationPending
      ? props.l('正在准备续跑...', 'Preparing to continue...')
      : props.imageGenerationActive
        ? props.l(
            `正在生成 ${props.readyCount}/${props.totalCount}`,
            `Generating ${props.readyCount}/${props.totalCount}`
          )
        : props.visualValidationActive
          ? props.l('正在检查画面...', 'Validating visuals...')
          : props.busy
            ? props.l('正在准备画面...', 'Preparing visuals...')
            : props.failedCount > 0
              ? props.l(
                  `重试失败并继续（${props.failedCount} 个失败）`,
                  `Retry failures and continue (${props.failedCount} failed)`
                )
              : props.readyCount === 0
                ? props.l(
                    `生成全部画面（${props.totalCount}）`,
                    `Generate all visuals (${props.totalCount})`
                  )
                : remainingCount > 0
                  ? props.l(
                      `继续生成剩余 ${remainingCount} 个`,
                      `Generate the remaining ${remainingCount}`
                    )
                  : props.visualValidationFailed
                    ? props.l('重新检查画面', 'Retry visual validation')
                    : props.l('继续完成画面检查', 'Continue visual validation');
  return (
    <footer className="stickman-wizard-actions stickman-script-actions stickman-storyboard-step-actions">
      <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
        <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        {props.l('上一步', 'Back')}
      </button>
      <button
        className="video-translation-primary-action stickman-storyboard-batch-action"
        type="button"
        disabled={props.canContinue ? props.busy : batchBusy || props.totalCount === 0}
        onClick={props.canContinue ? props.onNext : props.onGenerateMissing}
      >
        {batchBusy && !props.canContinue
          ? <LoaderCircle className="creator-collaboration-spin" size={16} aria-hidden="true" />
          : null}
        {label}
        {!batchBusy || props.canContinue
          ? props.visualValidationFailed && !props.canContinue
            ? <RefreshCw size={16} strokeWidth={1.8} aria-hidden="true" />
            : <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
          : null}
      </button>
    </footer>
  );
}

function WizardActions(props: {
  canContinue: boolean;
  busy: boolean;
  pendingLabel: string;
  l: ReturnType<typeof useLocalizedCopy>;
  onBack(): void;
  onNext(): void;
}) {
  return (
    <footer className="stickman-wizard-actions stickman-script-actions stickman-storyboard-step-actions">
      <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
        <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
        {props.l('上一步', 'Back')}
      </button>
      <button
        className="video-translation-primary-action"
        type="button"
        disabled={props.busy || !props.canContinue}
        onClick={props.onNext}
      >
        {props.busy ? props.pendingLabel : props.l('下一步', 'Next')}
        {props.busy
          ? <LoaderCircle className="creator-collaboration-spin" size={16} aria-hidden="true" />
          : <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />}
      </button>
    </footer>
  );
}

function ShotPreview(props: { artifact?: CreatorArtifact; status?: CreatorStageRun['status']; pending?: boolean; l: ReturnType<typeof useLocalizedCopy> }) {
  const url = useArtifactUrl(props.artifact?.id);
  const generating = props.pending || props.status === 'running' || props.status === 'queued';
  return (
    <div className="stickman-storyboard-media">
      <div className="stickman-storyboard-image">
        {url ? <img src={url} alt={props.l('镜头画面', 'Shot visual')} /> : null}
        {generating ? (
          <span aria-label={props.l('正在重新生成画面', 'Regenerating visual')}>
            <LoaderCircle className="creator-collaboration-spin" size={18} />
          </span>
        ) : !url ? <span><ImageIcon size={18} /></span> : null}
      </div>
    </div>
  );
}

const compositionPhases = [
  { id: 'timeline', stageIds: ['timeline'], icon: Captions },
  { id: 'clean-render', stageIds: ['render-clean', 'media-validation'], icon: Film },
  { id: 'delivery', stageIds: ['package-validation'], icon: Download }
] as const;

function CompositionStep(props: {
  stages: CreatorStageRun[];
  deliveryReady: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onBack(): void;
  onRetry(): void;
}) {
  const failed = [...props.stages].reverse().find(stage => (
    stickmanWorkflowStep(stage.stageId) === 4 && stage.status === 'failed'
  ));
  return (
    <div className="stickman-composition-step">
      <div className="stickman-composition-content">
        <div className="creator-tool-panel stickman-composition-panel">
          <header className="creator-tool-panel-heading">
            <span><Film size={18} /></span>
            <div>
              <h2>{props.l('动画合成', 'Video composition')}</h2>
              <p>{props.deliveryReady
                ? props.l('合成流程已完成，可在成片交付中预览和下载文件', 'Composition is complete. Preview and download files from Video delivery.')
                : props.l('正在按真实时间线生成字幕并合成视频', 'Generating subtitles and composing the video from the real timeline.')}</p>
            </div>
          </header>
          <div className="stickman-composition-phases" aria-label={props.l('合成进度', 'Composition progress')}>
            {compositionPhases.map(phase => {
              const status = compositionPhaseStatus(props.stages, [...phase.stageIds]);
              const Icon = phase.icon;
              return (
                <div key={phase.id} data-status={status}>
                  <span><Icon size={16} /></span>
                  <div>
                    <strong>{compositionPhaseLabel(phase.id, props.l)}</strong>
                    <small>{compositionStatusLabel(status, props.l)}</small>
                  </div>
                  {status === 'completed' ? <Check size={16} /> : null}
                  {status === 'running' ? <LoaderCircle className="creator-collaboration-spin" size={16} /> : null}
                  {status === 'failed' ? <X size={16} /> : null}
                  {status === 'waiting' ? <Circle size={14} /> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <footer className="stickman-wizard-actions stickman-script-actions">
        <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
          <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          {props.l('上一步', 'Back')}
        </button>
        {failed !== undefined ? (
          <button className="video-translation-primary-action" type="button" onClick={props.onRetry}>
            <RefreshCw size={16} />{props.l('重试失败步骤', 'Retry failed step')}
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function ResultStep(props: {
  artifacts: CreatorArtifact[];
  snapshot?: ReturnType<typeof readCreatorResultSnapshots>[number];
  videoUrl: string;
  version: number;
  versions: Array<{ value: number; description: string }>;
  manifest?: DeliveryManifest;
  l: ReturnType<typeof useLocalizedCopy>;
  onVersionChange(version: number): void;
  onOpen(artifact: CreatorArtifact): void;
  onDownload(artifact: CreatorArtifact): void;
  onBack(): void;
}) {
  if (props.snapshot === undefined) return <PendingPanel icon={FileVideo} label={props.l('最终交付尚未完成', 'Final delivery is not complete yet.')} />;
  const publishable = props.manifest?.packageStatus === 'publishable';
  return (
    <div className="stickman-delivery-step">
      <header className="stickman-result-toolbar">
        <div>
          <h2>{props.l('成片交付', 'Video delivery')}</h2>
          <small className="stickman-delivery-status" data-status={props.manifest?.packageStatus}>
            {publishable
              ? props.l('成片和交付文件已就绪', 'The video and delivery files are ready.')
              : props.l('成片已生成，部分发布检查尚未通过', 'The video is ready, but some publishing checks still need attention.')}
          </small>
        </div>
        <CreatorResultVersionMenu version={props.version} versions={props.versions} onVersionChange={props.onVersionChange} />
      </header>
      <div className="stickman-delivery-content">
        <section className="stickman-delivery-preview" aria-label={props.l('成片预览', 'Video preview')}>
          {props.videoUrl
            ? <video controls preload="metadata" src={props.videoUrl} />
            : <div><FileVideo size={28} /><span>{props.l('成片暂时无法预览', 'The video preview is unavailable.')}</span></div>}
        </section>
        <section className="stickman-delivery-files">
          <header>
            <h3>{props.l('交付文件', 'Delivery files')}</h3>
            <span>{props.l(`${deliveryKinds.length} 项`, `${deliveryKinds.length} items`)}</span>
          </header>
          <div className="creator-result-files">
            {deliveryKinds.map(kind => {
              const artifact = artifactFromSnapshot(props.artifacts, props.snapshot!.artifactRefs[kind]);
              const file = props.manifest?.files?.find(candidate => candidate.sourceArtifactId === artifact?.id);
              return (
                <article key={kind} data-ready={artifact !== undefined}>
                  <span>{deliveryIcon(kind)}</span>
                  <div>
                    <strong>{deliveryLabel(kind, props.l)}</strong>
                    <small>{file === undefined
                      ? artifact === undefined
                        ? props.l('文件不可用', 'File unavailable')
                        : artifactFileDetail(artifact, props.l)
                      : `${formatFileSize(file.bytes)} · ${file.mime}`}</small>
                  </div>
                  <button type="button" disabled={artifact === undefined} title={props.l('预览', 'Preview')} aria-label={`${props.l('预览', 'Preview')} ${deliveryLabel(kind, props.l)}`} onClick={() => artifact && props.onOpen(artifact)}><Eye size={15} /></button>
                  <button type="button" disabled={artifact === undefined} title={props.l('下载', 'Download')} aria-label={`${props.l('下载', 'Download')} ${deliveryLabel(kind, props.l)}`} onClick={() => artifact && props.onDownload(artifact)}><Download size={15} /></button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
      <footer className="stickman-wizard-actions stickman-script-actions">
        <button className="video-translation-secondary-action" type="button" onClick={props.onBack}>
          <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
          {props.l('上一步', 'Back')}
        </button>
      </footer>
    </div>
  );
}

function PendingPanel(props: { icon: typeof FileText; label: string }) {
  const Icon = props.icon;
  return <div className="creator-tool-panel creator-workspace-loading" aria-live="polite"><Icon size={20} /><p>{props.label}</p></div>;
}

function useArtifactJson<T>(artifactId?: string): T | undefined {
  const session = useCreatorSession();
  const [loaded, setLoaded] = useState<{ artifactId: string; value: T }>();
  useEffect(() => {
    let canceled = false;
    if (artifactId === undefined) return () => { canceled = true; };
    void session.openArtifactJson<T>(artifactId).then(next => {
      if (!canceled) setLoaded({ artifactId, value: next });
    }).catch(() => undefined);
    return () => { canceled = true; };
  }, [artifactId, session.openArtifactJson]);
  return loaded !== undefined && loaded.artifactId === artifactId
    ? loaded.value
    : undefined;
}

function readScriptManifest(value: unknown): ScriptManifest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.contract !== 'stickman-narration-script-v2'
    || (record.reviewStatus !== 'needs_review' && record.reviewStatus !== 'approved')
    || typeof record.contentLocked !== 'boolean'
    || typeof record.title !== 'string'
    || typeof record.language !== 'string'
    || typeof record.targetDurationSeconds !== 'number'
    || record.narrationBudget === null
    || typeof record.narrationBudget !== 'object'
    || Array.isArray(record.narrationBudget)
    || typeof record.segmentCount !== 'number'
    || typeof record.totalNarrationUnits !== 'number'
    || typeof record.estimatedTotalDurationSeconds !== 'number'
    || !Array.isArray(record.segments)
  ) return undefined;
  const validSegments = record.segments.every(segment => {
    if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) return false;
    const item = segment as Record<string, unknown>;
    return typeof item.id === 'string'
      && typeof item.order === 'number'
      && typeof item.narration === 'string'
      && typeof item.narrationUnits === 'number'
      && typeof item.estimatedDurationSeconds === 'number'
      && Array.isArray(item.claimIds)
      && item.claimIds.length > 0
      && item.claimIds.every(claimId => typeof claimId === 'string')
      && Array.isArray(item.sourceSpanIds)
      && item.sourceSpanIds.length > 0
      && item.sourceSpanIds.every(sourceSpanId => typeof sourceSpanId === 'string');
  });
  return validSegments ? value as ScriptManifest : undefined;
}

function useArtifactUrl(artifactId?: string): string {
  const session = useCreatorSession();
  const [url, setUrl] = useState('');
  useEffect(() => {
    let objectUrl = '';
    let canceled = false;
    setUrl('');
    if (artifactId === undefined) return () => { canceled = true; };
    void session.openArtifact(artifactId).then(async response => {
      if (!response.ok) return;
      objectUrl = URL.createObjectURL(await response.blob());
      if (!canceled) setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { canceled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [artifactId, session.openArtifact]);
  return url;
}

function latestCompleted(artifacts: CreatorArtifact[], kind: string): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => artifact.kind === kind && artifact.status === 'completed');
}

function latestStage(stages: CreatorStageRun[], stageId: string): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => stage.stageId === stageId);
}

function latestScopedStage(
  stages: CreatorStageRun[],
  stageId: string,
  scopeKey: string
): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => (
    stage.stageId === stageId && stage.scopeKey === scopeKey
  ));
}

function latestShotStage(stages: CreatorStageRun[], scopeKey: string): CreatorStageRun | undefined {
  return [...stages].reverse().find(stage => stage.stageId === 'images' && stage.scopeKey === scopeKey);
}

function latestShotImage(artifacts: CreatorArtifact[], scopeKey: string, fingerprint: string | null): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => artifact.kind === 'shot_image' && artifact.status === 'completed' && artifact.scopeKey === scopeKey && (fingerprint === null || artifact.inputFingerprint === fingerprint));
}

function artifactFromSnapshot(artifacts: CreatorArtifact[], ids?: string[]): CreatorArtifact | undefined {
  return [...(ids ?? [])].reverse().flatMap(id => artifacts.find(artifact => artifact.id === id) ?? []).at(0);
}

function readNeedsInput(value: unknown): { code: string; kind?: string; message?: string; artifactId?: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string') return null;
  return {
    code: record.code,
    ...(typeof record.kind === 'string' ? { kind: record.kind } : {}),
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
    ...(typeof record.artifactId === 'string' ? { artifactId: record.artifactId } : {})
  };
}

function currentIssue(job: { status: string; stages: CreatorStageRun[] }, step: string, l: ReturnType<typeof useLocalizedCopy>): string {
  const active = [...job.stages].reverse().find(stage => stage.status === 'running' || stage.status === 'queued');
  if (active) return l(`正在执行：${step}`, `Running: ${step}`);
  return job.status === 'needs_input' ? l(`等待操作：${step}`, `Action required: ${step}`) : step;
}

function deliveryLabel(kind: typeof deliveryKinds[number], l: ReturnType<typeof useLocalizedCopy>): string {
  const labels = { clean_video: ['火柴人动画', 'Stickman video'], narration_subtitle: ['旁白字幕', 'Narration subtitles'] } as const;
  const [zh, en] = labels[kind];
  return l(zh, en);
}

function deliveryIcon(kind: typeof deliveryKinds[number]) {
  return kind === 'narration_subtitle' ? <Captions size={17} /> : <FileVideo size={17} />;
}

type CompositionStatus = 'waiting' | 'running' | 'completed' | 'failed';

function compositionPhaseStatus(
  stages: CreatorStageRun[],
  stageIds: string[]
): CompositionStatus {
  const current = stageIds.flatMap(stageId => latestStage(stages, stageId) ?? []);
  if (current.some(stage => stage.status === 'failed')) return 'failed';
  if (current.some(stage => stage.status === 'running' || stage.status === 'queued')) return 'running';
  if (current.length === stageIds.length && current.every(stage => stage.status === 'succeeded')) {
    return 'completed';
  }
  if (current.some(stage => stage.status === 'succeeded')) return 'running';
  return 'waiting';
}

function compositionPhaseLabel(
  id: typeof compositionPhases[number]['id'],
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const labels = {
    timeline: ['生成时间线与旁白字幕', 'Build timeline and narration subtitles'],
    'clean-render': ['渲染并检查火柴人动画', 'Render and validate the stickman video'],
    delivery: ['整理交付文件', 'Prepare delivery files']
  } as const;
  const [zh, en] = labels[id];
  return l(zh, en);
}

function compositionStatusLabel(
  status: CompositionStatus,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const labels = {
    waiting: ['等待执行', 'Waiting'],
    running: ['正在处理', 'In progress'],
    completed: ['已完成', 'Completed'],
    failed: ['执行失败', 'Failed']
  } as const;
  const [zh, en] = labels[status];
  return l(zh, en);
}

function formatSeconds(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}s`;
}

function readArtifactDuration(artifact?: CreatorArtifact): number | undefined {
  return typeof artifact?.metadata.duration === 'number' ? artifact.metadata.duration : undefined;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function artifactFileDetail(
  artifact: CreatorArtifact,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  const duration = typeof artifact.metadata.duration === 'number'
    ? formatSeconds(artifact.metadata.duration)
    : '';
  const width = typeof artifact.metadata.width === 'number' ? artifact.metadata.width : undefined;
  const height = typeof artifact.metadata.height === 'number' ? artifact.metadata.height : undefined;
  const dimensions = width !== undefined && height !== undefined ? `${width}×${height}` : '';
  return [duration, dimensions].filter(Boolean).join(' · ') || l('文件已就绪', 'File ready');
}

async function openArtifact(open: (id: string) => Promise<Response>, artifact: CreatorArtifact) {
  const response = await open(artifact.id);
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadArtifact(open: (id: string) => Promise<Response>, artifact: CreatorArtifact) {
  const response = await open(artifact.id);
  if (!response.ok) return;
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = typeof artifact.metadata.fileName === 'string' ? artifact.metadata.fileName : artifact.kind;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isPublicYoutubeUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com');
  } catch {
    return false;
  }
}
