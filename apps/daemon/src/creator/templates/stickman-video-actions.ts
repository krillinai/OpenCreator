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
import { stickmanShotSpecSchema } from '../stickman/contracts.js';
import {
  currentShotImage,
  stickmanShotFingerprint,
  type StickmanImageSettings
} from '../stickman/lineage.js';

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
    if (!isStickman(job) || !isTerminal(stage)) return;
    await reconcile(job);
  }

  async function handleAction(job: CreatorJob, action: string): Promise<void> {
    if (!isStickman(job)) return;
    if (
      action === 'approve-script'
      || action === 'approve-storyboard'
      || action === 'approve-visuals'
      || action === 'regenerate-shot'
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

    const sourceVideo = latestCompleted(job, 'source_video');
    if (sourceVideo === undefined) {
      queueStage(job, 'acquire-source', 'workflow:start');
      return;
    }
    const sourceSubtitle = latestCompleted(job, 'source_subtitle');
    if (sourceSubtitle === undefined) {
      queueStage(job, 'source-transcript', sourceVideo.id);
      return;
    }
    const sourceBrief = latestCompleted(job, 'source_brief');
    if (sourceBrief === undefined) {
      queueStage(job, 'source-brief', sourceSubtitle.id);
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

    const storyboard = latestCompleted(job, 'shot_spec');
    if (storyboard === undefined) {
      queueStage(job, 'storyboard', `approval:${script.id}`);
      return;
    }
    if (job.state.approvedShotSpecArtifactId !== storyboard.id) {
      setReviewGate(input.creator, job, 'approve-storyboard', storyboard.id);
      return;
    }

    const mediaReady = await reconcileApprovedMedia(job, storyboard);
    if (!mediaReady) return;

    const visualValidation = latestCompleted(job, 'visual_validation');
    if (visualValidation === undefined) {
      const narration = latestCompleted(job, 'narration_audio')!;
      queueStage(job, 'visual-validation', `${storyboard.id}:${narration.id}`);
      return;
    }
    if (job.state.approvedVisualValidationArtifactId !== visualValidation.id) {
      setReviewGate(input.creator, job, 'approve-visuals', visualValidation.id);
      return;
    }

    const timeline = latestCompleted(job, 'timeline_manifest');
    if (timeline === undefined) {
      queueStage(job, 'timeline', `approval:${visualValidation.id}`);
      return;
    }
    const cleanVideo = latestCompleted(job, 'clean_video');
    if (cleanVideo === undefined) {
      queueStage(job, 'render-clean', timeline.id);
      return;
    }

    const cover = latestCompleted(job, 'cover_image');
    if (cover === undefined) queueStage(job, 'cover', cleanVideo.id);
    const subtitles = latestCompleted(job, 'bilingual_subtitle');
    if (subtitles === undefined) queueStage(job, 'subtitles', cleanVideo.id);
    const publishCopy = latestCompleted(job, 'publish_copy');
    if (publishCopy === undefined) queueStage(job, 'publish-copy', cleanVideo.id);
    if (cover === undefined || subtitles === undefined || publishCopy === undefined) return;

    const bilingualVideo = latestCompleted(job, 'bilingual_video');
    if (bilingualVideo === undefined) {
      queueStage(job, 'bilingual-render', `${cleanVideo.id}:${subtitles.id}`);
      return;
    }
    if (latestCompleted(job, 'delivery_manifest') === undefined) {
      queueStage(
        job,
        'package-validation',
        `${cleanVideo.id}:${cover.id}:${publishCopy.id}:${bilingualVideo.id}:${subtitles.id}`
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
    const settings = await imageSettings(job);
    let allImagesReady = true;
    for (const shot of shotSpec.shots) {
      const fingerprint = stickmanShotFingerprint({
        shot,
        job,
        shotSpec: shotSpecArtifact,
        characterReference,
        settings
      });
      if (currentShotImage(job, shot.id, fingerprint) !== undefined) continue;
      allImagesReady = false;
      if (hasUnresolvedProvider(job, 'images', shot.id)) continue;
      queueStage(job, 'images', `approval:${shotSpecArtifact.id}:${shot.id}`, {
        scopeKey: shot.id,
        inputFingerprint: fingerprint
      });
    }
    const narration = latestCompleted(job, 'narration_audio');
    if (narration === undefined) {
      queueStage(job, 'narration', `approval:${shotSpecArtifact.id}`);
    }
    return allImagesReady && narration !== undefined;
  }

  function queueStage(
    job: CreatorJob,
    stageId: string,
    parentIdentity: string,
    identity: { scopeKey?: string; inputFingerprint?: string } = {}
  ): void {
    const current = input.creator.getJob(job.id) ?? job;
    const matchingRuns = current.stages.filter(stage => (
      stage.stageId === stageId
      && stage.scopeKey === (identity.scopeKey ?? null)
      && stage.inputFingerprint === (identity.inputFingerprint ?? null)
    ));
    if (matchingRuns.some(stage => stage.status === 'queued' || stage.status === 'running')) return;
    const generation = matchingRuns.length + 1;
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
        provider: typeof job.state.provider === 'string' ? job.state.provider : 'openai',
        model: typeof job.state.imageModel === 'string' ? job.state.imageModel : 'default',
        quality: typeof job.state.quality === 'string' ? job.state.quality : 'medium'
      };
    }
    const config = await input.configStore.read();
    const provider = job.state.provider === 'openai'
      || job.state.provider === 'jimeng'
      || job.state.provider === 'kling'
      || job.state.provider === 'gemini'
      ? job.state.provider
      : config.image.provider;
    return {
      provider,
      model: config.image[provider].model,
      quality: typeof job.state.quality === 'string' ? job.state.quality : 'medium'
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

function requireApprovedInputs(job: CreatorJob, stageId: string): void {
  const script = latestCompleted(job, 'script_manifest');
  if (
    stageAtOrAfter(stageId, 'storyboard')
    && (script === undefined || job.state.approvedScriptArtifactId !== script.id)
  ) {
    throw new CreatorServiceError('creator_review_required', '必须先审核当前脚本');
  }
  const storyboard = latestCompleted(job, 'shot_spec');
  if (
    stageAtOrAfter(stageId, 'images')
    && (storyboard === undefined || job.state.approvedShotSpecArtifactId !== storyboard.id)
  ) {
    throw new CreatorServiceError('creator_review_required', '必须先审核当前分镜');
  }
  const validation = latestCompleted(job, 'visual_validation');
  if (
    stageAtOrAfter(stageId, 'timeline')
    && (validation === undefined || job.state.approvedVisualValidationArtifactId !== validation.id)
  ) {
    throw new CreatorServiceError('creator_review_required', '必须先审核当前画面');
  }
}

function stageAtOrAfter(stageId: string, boundary: string): boolean {
  const order = [
    'acquire-source', 'source-transcript', 'source-brief', 'content-plan', 'script',
    'storyboard', 'images', 'narration', 'visual-validation', 'timeline', 'render-clean',
    'cover', 'subtitles', 'publish-copy', 'bilingual-render', 'package-validation'
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

function isTerminal(stage: CreatorStageRun): boolean {
  return ['succeeded', 'failed', 'canceled', 'interrupted'].includes(stage.status);
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
  kind: 'approve-script' | 'approve-storyboard' | 'approve-visuals',
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
    'approve-script': '请审核脚本后继续',
    'approve-storyboard': '请审核分镜后继续',
    'approve-visuals': '请审核画面后继续'
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
