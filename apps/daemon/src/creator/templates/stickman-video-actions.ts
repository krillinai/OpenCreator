import type {
  CreatorArtifact,
  CreatorJob,
  CreatorProviderRequest,
  CreatorStageRun
} from '@opencreator/protocol';
import { readFile } from 'node:fs/promises';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorCommandDispatcher } from '../command-dispatcher.js';
import {
  type CreatorProviderCapabilities,
  type CreatorProviderRequestLedger
} from '../provider-requests.js';
import type { CreatorRepository } from '../repository.js';
import { CreatorServiceError, type CreatorService } from '../service.js';
import {
  stickmanScriptManifestSchema,
  stickmanShotSpecSchema
} from '../stickman/contracts.js';
import {
  currentNarrationAudio,
  currentShotImage,
  previousStickmanShotImage,
  stickmanNarrationFingerprint,
  stickmanShotFingerprint,
  type StickmanImageSettings,
  type StickmanTtsSettings
} from '../stickman/lineage.js';
import { STICKMAN_IMAGE_PROMPT_CONTRACT } from '../stickman/image-prompt.js';
import {
  DEFAULT_STICKMAN_CHARACTER_ASSET,
  DEFAULT_STICKMAN_STYLE_ASSET,
  readVisualAssetRef
} from '../stickman/visual-assets.js';

export type StickmanVideoWorkflow = ReturnType<typeof createStickmanVideoWorkflow>;

const noProviderLookup: CreatorProviderCapabilities = {
  lookupByRequestKey: false,
  async lookup() {
    return { status: 'not_found' };
  }
};

export function createStickmanVideoWorkflow(input: {
  creator: CreatorService;
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatchWorkflow'>;
  configStore?: Pick<CreatorServicesConfigStore, 'read'>;
  repository?: CreatorRepository;
  providerLedger?: CreatorProviderRequestLedger;
  providerCapabilities?: CreatorProviderCapabilities;
}) {
  async function handleStageChanged(stage: CreatorStageRun): Promise<void> {
    const job = input.creator.getJob(stage.jobId);
    if (!isStickman(job) || stage.status !== 'succeeded') return;
    await reconcile(job);
  }

  async function handleAction(job: CreatorJob, action: string): Promise<void> {
    if (!isStickman(job)) return;
    if (
      action === 'approve-script'
      || action === 'continue-after-audio'
      || action === 'continue-after-visuals'
      || action === 'edit-script'
      || action === 'edit-shot'
      || action === 'regenerate-shot'
      || action === 'generate-missing-shots'
      || action === 'retry-stage'
      || action === 'resolve-provider-request'
    ) {
      await reconcile(input.creator.getJob(job.id) ?? job);
    }
  }

  async function validateStage(
    job: CreatorJob,
    stageId: string,
    scopeKey: string | null = null
  ): Promise<void> {
    if (!isStickman(job)) return;
    const unresolved = input.providerLedger?.unresolvedForStage({
      jobId: job.id,
      stageId,
      scopeKey
    }) ?? [];
    if (unresolved.length > 0) {
      throw new CreatorServiceError(
        'creator_provider_resolution_required',
        '必须先处置状态未知的 Provider 请求，才能重新执行该阶段'
      );
    }
    const interrupted = [...job.stages].reverse().find(stage => (
      stage.stageId === stageId
      && stage.scopeKey === scopeKey
      && stage.status === 'interrupted'
    ));
    if (interrupted !== undefined && hasRemoteSideEffect(interrupted, job.providerRequests)) {
      throw new CreatorServiceError(
        'creator_provider_resolution_required',
        '该阶段存在尚未确认的远端任务，不能自动重试'
      );
    }
    requireApprovedInputs(job, stageId);
    requireWorkflowTarget(job, stageId);
  }

  async function validateResume(job: CreatorJob, stage: CreatorStageRun): Promise<void> {
    await validateStage(job, stage.stageId, stage.scopeKey);
    if (stage.scopeKey !== null && stage.inputFingerprint !== null) {
      const current = completedScopedOutput(job, stage);
      if (current !== undefined) {
        throw new CreatorServiceError(
          'creator_job_not_resumable',
          '该阶段的精确输出已经完成，无需再次执行'
        );
      }
    }
  }

  async function reconcile(job: CreatorJob): Promise<void> {
    if (
      !isStickman(job)
      || job.status === 'draft'
      || job.status === 'canceled'
      || job.status === 'completed'
      || job.status === 'failed'
    ) return;
    if (job.providerRequests.some(request => (
      request.status === 'unknown_remote_acceptance' || request.status === 'waiting_remote'
    ))) return;
    const needsInput = job.state.needsInput;
    if (
      needsInput !== null
      && typeof needsInput === 'object'
      && !Array.isArray(needsInput)
      && needsInput.code === 'creator_provider_resolution_required'
    ) return;
    if (
      needsInput !== null
      && typeof needsInput === 'object'
      && !Array.isArray(needsInput)
      && typeof needsInput.code === 'string'
      && needsInput.code !== 'creator_review_required'
    ) return;

    const sourceType = job.state.sourceType === 'text' ? 'text' : 'url';
    let sourceInput: CreatorArtifact;
    if (sourceType === 'text') {
      const sourceText = latestCompleted(job, 'source_text');
      if (sourceText === undefined) {
        queueStage(job, 'ingest-text', 'workflow:start');
        return;
      }
      sourceInput = sourceText;
    } else {
      const sourceSubtitle = latestCompleted(job, 'source_subtitle');
      if (sourceSubtitle === undefined) {
        queueStage(job, 'source-transcript', 'workflow:start');
        return;
      }
      sourceInput = sourceSubtitle;
    }
    const sourceBrief = latestCompleted(job, 'source_brief');
    if (sourceBrief === undefined) {
      queueStage(job, 'source-brief', sourceInput.id);
      return;
    }
    const contentPlan = latestCompleted(job, 'content_plan');
    if (contentPlan === undefined) {
      queueStage(job, 'content-plan', sourceBrief.id);
      return;
    }
    const script = latestCompleted(job, 'script_manifest');
    if (script === undefined) {
      queueStage(job, 'script', contentPlan.id);
      return;
    }
    if (job.state.approvedScriptArtifactId !== script.id) {
      setReviewGate(input.creator, job, 'approve-script', script.id);
      return;
    }

    const narrationReady = await reconcileNarration(job, script);
    if (!narrationReady) return;
    const audioTiming = latestCompleted(job, 'audio_timing');
    if (audioTiming === undefined) {
      queueStage(job, 'audio-timing', `narration:${script.id}`);
      return;
    }
    if (!workflowTargetAtLeast(job, 'visuals_ready')) return;
    const storyboard = latestCompleted(job, 'shot_spec');
    if (storyboard === undefined) {
      queueStage(job, 'storyboard', audioTiming.id);
      return;
    }
    const characterReference = latestCompleted(job, 'character_reference');
    const styleReference = latestCompleted(job, 'style_reference');
    const styleContract = latestCompleted(job, 'style_contract');
    if (
      characterReference === undefined
      || styleContract === undefined
      || !matchesCurrentVisualProfile(job, characterReference, styleReference, styleContract)
    ) {
      queueStage(job, 'style-assets', storyboard.id);
      return;
    }
    const promptPack = latestCompleted(job, 'image_prompt_pack');
    if (
      promptPack === undefined
      || promptPack.metadata.contract !== STICKMAN_IMAGE_PROMPT_CONTRACT
      || !promptPack.sourceArtifactIds.includes(styleContract.id)
      || !promptPack.sourceArtifactIds.includes(characterReference.id)
      || (styleReference !== undefined && !promptPack.sourceArtifactIds.includes(styleReference.id))
    ) {
      queueStage(job, 'prompt-pack', `${storyboard.id}:${characterReference.id}`);
      return;
    }
    const mediaReady = await reconcileApprovedMedia(job, storyboard);
    if (!mediaReady) return;

    const visualValidation = latestCompleted(job, 'visual_validation');
    if (visualValidation === undefined) {
      queueStage(job, 'visual-validation', `${storyboard.id}:${promptPack.id}`);
      return;
    }
    if (!workflowTargetAtLeast(job, 'delivery_ready')) return;

    const timeline = latestCompleted(job, 'timeline_manifest');
    if (timeline === undefined) {
      queueStage(job, 'timeline', visualValidation.id);
      return;
    }
    const cleanVideo = latestCompleted(job, 'clean_video');
    if (cleanVideo === undefined) {
      queueStage(job, 'render-clean', timeline.id);
      return;
    }
    const mediaValidation = latestCompleted(job, 'media_validation');
    if (
      mediaValidation === undefined
      || !mediaValidation.sourceArtifactIds.includes(cleanVideo.id)
    ) {
      queueStage(job, 'media-validation', `${timeline.id}:${cleanVideo.id}`);
      return;
    }

    if (latestCompleted(job, 'delivery_manifest') === undefined) {
      queueStage(
        job,
        'package-validation',
        `${cleanVideo.id}:${mediaValidation.id}:${timeline.id}`
      );
    }
  }

  async function reconcileApprovedMedia(
    job: CreatorJob,
    shotSpecArtifact: CreatorArtifact
  ): Promise<boolean> {
    if (shotSpecArtifact.path === null) return false;
    const shotSpec = stickmanShotSpecSchema.parse(JSON.parse(
      await readFile(shotSpecArtifact.path, 'utf8')
    ));
    const characterReference = latestCompleted(job, 'character_reference');
    const styleReference = latestCompleted(job, 'style_reference');
    const styleContract = latestCompleted(job, 'style_contract');
    const promptPack = latestCompleted(job, 'image_prompt_pack');
    if (characterReference === undefined || styleContract === undefined || promptPack === undefined) {
      return false;
    }
    const settings = await imageSettings(job);
    for (const [shotIndex, shot] of shotSpec.shots.entries()) {
      const previousShotImage = previousStickmanShotImage({
        artifacts: job.artifacts,
        shotSpec,
        shotIndex
      });
      const fingerprint = stickmanShotFingerprint({
        shot,
        job,
        shotSpec: shotSpecArtifact,
        characterReference,
        styleReference,
        styleContract,
        promptPack,
        previousShotImage,
        settings
      });
      if (currentShotImage(job, shot.id, fingerprint) !== undefined) continue;
      if (hasUnresolvedProvider(job, 'images', shot.id)) return false;
      queueStage(job, 'images', `approval:${shotSpecArtifact.id}:${shot.id}`, {
        scopeKey: shot.id,
        inputFingerprint: fingerprint
      });
      return false;
    }
    return true;
  }

  async function reconcileNarration(
    job: CreatorJob,
    scriptArtifact: CreatorArtifact
  ): Promise<boolean> {
    if (scriptArtifact.path === null) return false;
    const script = stickmanScriptManifestSchema.parse(JSON.parse(
      await readFile(scriptArtifact.path, 'utf8')
    ));
    const settings = await ttsSettings(job);
    for (const segment of script.segments) {
      const fingerprint = stickmanNarrationFingerprint({
        segment,
        script: scriptArtifact,
        settings
      });
      if (currentNarrationAudio(job, segment.id, fingerprint) !== undefined) continue;
      if (hasUnresolvedProvider(job, 'narration', segment.id)) return false;
      queueStage(job, 'narration', `approval:${scriptArtifact.id}:${segment.id}`, {
        scopeKey: segment.id,
        inputFingerprint: fingerprint
      });
      return false;
    }
    return true;
  }

  function queueStage(
    job: CreatorJob,
    stageId: string,
    parentIdentity: string,
    identity: { scopeKey?: string; inputFingerprint?: string } = {}
  ): void {
    const current = input.creator.getJob(job.id) ?? job;
    const scopedRuns = current.stages.filter(stage => (
      stage.stageId === stageId
      && stage.scopeKey === (identity.scopeKey ?? null)
    ));
    const matchingRuns = scopedRuns.filter(stage => (
      stage.inputFingerprint === (identity.inputFingerprint ?? null)
    ));
    if (matchingRuns.some(stage => stage.status === 'queued' || stage.status === 'running')) return;
    const generation = scopedRuns.length + 1;
    input.dispatcher.dispatchWorkflow(current.id, {
      action: 'run-stage',
      expectedRevision: current.revision,
      idempotencyKey: `stickman:${current.id}:${parentIdentity}:${stageId}:${identity.scopeKey ?? 'global'}:${generation}`,
      input: { stageId }
    }, { parentStageRunId: parentIdentity, ...identity });
  }

  async function recover(): Promise<void> {
    for (const job of input.creator.listJobs()) {
      if (!isStickman(job)) continue;
      await recoverProviderRequests(job);
      await recoverInterruptedScopes(input.creator.getJob(job.id) ?? job);
      await reconcile(input.creator.getJob(job.id) ?? job);
    }
  }

  async function recoverProviderRequests(job: CreatorJob): Promise<void> {
    if (input.providerLedger === undefined) return;
    for (const request of job.providerRequests) {
      if (isProviderTerminal(request)) continue;
      await input.providerLedger.recover(
        request.id,
        input.providerCapabilities ?? noProviderLookup
      );
    }
  }

  async function recoverInterruptedScopes(job: CreatorJob): Promise<void> {
    if (input.repository === undefined) return;
    for (const stage of job.stages.filter(candidate => candidate.status === 'interrupted')) {
      const latest = input.creator.getJob(job.id) ?? job;
      const artifact = completedScopedOutput(latest, stage);
      if (artifact !== undefined) {
        input.repository.updateStageRun({
          id: stage.id,
          status: 'succeeded',
          progress: { ...stage.progress, recoveredArtifactId: artifact.id },
          errorCode: null,
          errorMessage: null
        });
        continue;
      }
      const requests = latest.providerRequests.filter(request => request.stageRunId === stage.id);
      const unresolved = requests.find(request => (
        request.status === 'unknown_remote_acceptance'
        || request.status === 'waiting_remote'
      ));
      if (unresolved !== undefined || hasRemoteSideEffect(stage, requests)) {
        setProviderRecoveryGate(input.creator, latest, stage, unresolved);
        continue;
      }
      if (requests.some(request => request.status === 'succeeded')) {
        setProviderRecoveryGate(input.creator, latest, stage, requests.at(-1));
        continue;
      }
      queueStage(latest, stage.stageId, `recovery:${stage.id}`, {
        ...(stage.scopeKey === null ? {} : { scopeKey: stage.scopeKey }),
        ...(stage.inputFingerprint === null
          ? {}
          : { inputFingerprint: stage.inputFingerprint })
      });
      const resumed = (input.creator.getJob(job.id) ?? latest).stages.find(candidate => (
        candidate.progress.workflowParentStageRunId === `recovery:${stage.id}`
      ));
      if (resumed !== undefined) {
        input.repository.updateStageRun({
          id: resumed.id,
          status: resumed.status,
          progress: { ...resumed.progress, resumedFromStageRunId: stage.id }
        });
      }
    }
  }

  async function imageSettings(job: CreatorJob): Promise<StickmanImageSettings> {
    if (input.configStore === undefined) {
      return {
        provider: 'configured-image-provider',
        model: 'configured-image-model',
        quality: typeof job.state.quality === 'string' ? job.state.quality : 'medium'
      };
    }
    const config = await input.configStore.read();
    const provider = config.image.provider;
    return {
      provider,
      model: config.image[provider].model,
      quality: typeof job.state.quality === 'string' ? job.state.quality : 'medium'
    };
  }

  async function ttsSettings(job: CreatorJob): Promise<StickmanTtsSettings> {
    if (input.configStore === undefined) {
      return {
        provider: typeof job.state.ttsProvider === 'string' ? job.state.ttsProvider : 'openai',
        model: typeof job.state.ttsModel === 'string' ? job.state.ttsModel : 'default',
        voiceId: typeof job.state.voiceCode === 'string' ? job.state.voiceCode : 'default'
      };
    }
    const config = await input.configStore.read();
    const provider = job.state.ttsProvider === 'openai'
      || job.state.ttsProvider === 'aliyun'
      || job.state.ttsProvider === 'minimax'
      ? job.state.ttsProvider
      : config.tts.provider;
    if (provider === 'edge-tts') {
      return { provider, model: '', voiceId: '' };
    }
    const providerConfig = config.tts[provider];
    return {
      provider,
      model: typeof job.state.ttsModel === 'string' && job.state.ttsModel.trim()
        ? job.state.ttsModel.trim()
        : providerConfig.model,
      voiceId: typeof job.state.voiceCode === 'string' && job.state.voiceCode.trim()
        ? job.state.voiceCode.trim()
        : providerConfig.defaultVoiceId
    };
  }

  return {
    handleStageChanged,
    handleAction,
    validateStage,
    validateResume,
    reconcile,
    recover,
    async resumeConfiguredJobs(): Promise<void> {
      for (const job of input.creator.listJobs()) await reconcile(job);
    }
  };
}

function matchesCurrentVisualProfile(
  job: CreatorJob,
  characterReference: CreatorArtifact,
  styleReference: CreatorArtifact | undefined,
  styleContract: CreatorArtifact
): boolean {
  const character = readVisualAssetRef(
    job.state.characterAsset,
    DEFAULT_STICKMAN_CHARACTER_ASSET
  );
  const style = readVisualAssetRef(job.state.styleAsset, DEFAULT_STICKMAN_STYLE_ASSET);
  return characterReference.metadata.assetId === character.assetId
    && characterReference.metadata.revision === character.revision
    && styleContract.metadata.contract === 'stickman-visual-profile-v2'
    && styleContract.metadata.characterAssetId === character.assetId
    && styleContract.metadata.characterRevision === character.revision
    && styleContract.metadata.styleAssetId === style.assetId
    && styleContract.metadata.styleRevision === style.revision
    && (
      styleContract.metadata.styleReferenceCount === 0
        ? styleReference === undefined
        : styleReference !== undefined
          && styleReference.metadata.assetId === style.assetId
          && styleReference.metadata.revision === style.revision
    );
}

function requireApprovedInputs(job: CreatorJob, stageId: string): void {
  const script = latestCompleted(job, 'script_manifest');
  if (
    stageAtOrAfter(stageId, 'narration')
    && (script === undefined || job.state.approvedScriptArtifactId !== script.id)
  ) {
    throw new CreatorServiceError('creator_review_required', '必须先审核当前脚本');
  }
  const storyboard = latestCompleted(job, 'shot_spec');
  if (
    stageAtOrAfter(stageId, 'style-assets')
    && storyboard === undefined
  ) {
    throw new CreatorServiceError('creator_stage_input_missing', '必须先生成当前分镜');
  }
}

function requireWorkflowTarget(job: CreatorJob, stageId: string): void {
  if (stageAtOrAfter(stageId, 'timeline') && !workflowTargetAtLeast(job, 'delivery_ready')) {
    throw new CreatorServiceError(
      'creator_workflow_gate_required',
      '必须先确认当前分镜画面，才能开始动画合成'
    );
  }
  if (stageAtOrAfter(stageId, 'storyboard') && !workflowTargetAtLeast(job, 'visuals_ready')) {
    throw new CreatorServiceError(
      'creator_workflow_gate_required',
      '必须先完成配音与节奏阶段，才能开始生成分镜画面'
    );
  }
}

type StickmanWorkflowTarget = 'script_ready' | 'audio_ready' | 'visuals_ready' | 'delivery_ready';

function workflowTargetAtLeast(job: CreatorJob, expected: StickmanWorkflowTarget): boolean {
  const order: StickmanWorkflowTarget[] = [
    'script_ready',
    'audio_ready',
    'visuals_ready',
    'delivery_ready'
  ];
  return order.indexOf(readWorkflowTarget(job)) >= order.indexOf(expected);
}

function readWorkflowTarget(job: CreatorJob): StickmanWorkflowTarget {
  const value = job.state.workflowTarget;
  if (
    value === 'script_ready'
    || value === 'audio_ready'
    || value === 'visuals_ready'
    || value === 'delivery_ready'
  ) return value;

  const currentStage = typeof job.state.currentStage === 'string' ? job.state.currentStage : '';
  if (stageAtOrAfter(currentStage, 'timeline')) return 'delivery_ready';
  if (stageAtOrAfter(currentStage, 'storyboard')) return 'visuals_ready';
  if (stageAtOrAfter(currentStage, 'narration')) return 'audio_ready';
  return 'script_ready';
}

function stageAtOrAfter(stageId: string, boundary: string): boolean {
  const order = [
    'ingest-text', 'source-transcript', 'source-brief', 'content-plan', 'script',
    'narration', 'audio-timing', 'storyboard', 'style-assets', 'prompt-pack',
    'images', 'visual-validation', 'timeline', 'render-clean', 'media-validation',
    'package-validation'
  ];
  return order.indexOf(stageId) >= order.indexOf(boundary);
}

function completedScopedOutput(job: CreatorJob, stage: CreatorStageRun): CreatorArtifact | undefined {
  if (stage.scopeKey === null || stage.inputFingerprint === null) return undefined;
  return job.artifacts.find(artifact => (
    artifact.status === 'completed'
    && artifact.scopeKey === stage.scopeKey
    && artifact.inputFingerprint === stage.inputFingerprint
  ));
}

function hasUnresolvedProvider(job: CreatorJob, stageId: string, scopeKey: string | null): boolean {
  const stageIds = new Set(job.stages.filter(stage => (
    stage.stageId === stageId && stage.scopeKey === scopeKey
  )).map(stage => stage.id));
  return job.providerRequests.some(request => (
    stageIds.has(request.stageRunId)
    && (request.status === 'unknown_remote_acceptance' || request.status === 'waiting_remote')
  ));
}

function hasRemoteSideEffect(
  stage: CreatorStageRun,
  requests: CreatorProviderRequest[]
): boolean {
  return typeof stage.progress.krillinTaskId === 'string'
    || requests.some(request => (
      request.status === 'submitting'
      || request.status === 'waiting_remote'
      || request.status === 'unknown_remote_acceptance'
    ));
}

function isProviderTerminal(request: CreatorProviderRequest): boolean {
  return ['succeeded', 'failed', 'abandoned_unknown', 'canceled'].includes(request.status);
}

function latestCompleted(job: CreatorJob, kind: string): CreatorArtifact | undefined {
  return [...job.artifacts].reverse().find(artifact => (
    artifact.kind === kind && artifact.status === 'completed'
  ));
}

function isStickman(job: CreatorJob | undefined): job is CreatorJob {
  return job?.templateId === 'stickman-video' && job.templateVersion === 2;
}

function setReviewGate(
  creator: CreatorService,
  job: CreatorJob,
  kind: 'approve-script',
  artifactId: string
): void {
  const currentGate = job.state.needsInput;
  if (
    currentGate !== null
    && typeof currentGate === 'object'
    && !Array.isArray(currentGate)
    && currentGate.kind === kind
    && currentGate.artifactId === artifactId
  ) return;
  const messages = {
    'approve-script': '请审核脚本后继续'
  } as const;
  creator.setNeedsInput(job.id, {
    code: 'creator_review_required',
    message: messages[kind],
    reviewKind: kind,
    artifactId
  });
}

function setProviderRecoveryGate(
  creator: CreatorService,
  job: CreatorJob,
  stage: CreatorStageRun,
  request?: CreatorProviderRequest
): void {
  const currentGate = job.state.needsInput;
  if (
    currentGate !== null
    && typeof currentGate === 'object'
    && !Array.isArray(currentGate)
    && currentGate.code === 'creator_provider_resolution_required'
    && currentGate.resumeStageId === stage.stageId
  ) return;
  creator.setNeedsInput(job.id, {
    code: 'creator_provider_resolution_required',
    message: request === undefined
      ? '检测到未完成的远端任务，请确认状态后继续'
      : `Provider 请求 ${request.id} 的远端接受状态需要用户处置`,
    resumeStageId: stage.stageId,
    workflow: true
  });
}
