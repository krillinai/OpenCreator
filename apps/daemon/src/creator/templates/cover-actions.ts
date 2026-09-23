import type {
  CreatorJob,
  CreatorStageRun,
  ImageGenerationProvider
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorCommandDispatcher } from '../command-dispatcher.js';
import type { CreatorService } from '../service.js';
import {
  imageProviderConfigured,
  readImageProvider
} from '../image-settings.js';
import { imageGenerationCapabilities } from '../../image-generation/provider.js';

export type CoverWorkflow = ReturnType<typeof createCoverWorkflow>;

export function createCoverWorkflow(input: {
  creator: CreatorService;
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatch'>;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
}) {
  async function validateStage(job: CreatorJob, stageId: string): Promise<void> {
    if (job.templateId !== 'cover' || job.templateVersion < 2) return;
    validateCoverSettings(job);
    if (stageId === 'analyze-source') {
      validateYoutubeSource(job);
      const config = await input.configStore.read();
      if (!config.llm.apiKey.trim()) {
        setConfigurationNeeded(input.creator, job.id, {
          code: 'creator_llm_config_missing',
          message: '请先完成文本模型配置，以分析视频内容',
          section: 'text',
          resumeStageId: stageId
        });
        throw new CoverWorkflowError(
          'creator_llm_config_missing',
          'LLM configuration is incomplete'
        );
      }
      return;
    }
    if (stageId !== 'generate') return;
    let referenceImageAvailable = false;
    try {
      referenceImageAvailable = validateGenerationInput(job);
    } catch (error) {
      if (
        error instanceof CoverWorkflowError
        && error.code === 'creator_cover_reference_missing'
      ) {
        setReferenceNeeded(input.creator, job.id);
      }
      throw error;
    }
    const config = await input.configStore.read();
    const provider = readImageProvider(job.state.provider, config.image.provider);
    if (!hasImageCredentials(config, provider)) {
      setConfigurationNeeded(input.creator, job.id, {
        code: 'creator_image_config_missing',
        message: '请先完成当前图像生成服务配置',
        section: 'image',
        resumeStageId: stageId
      });
      throw new CoverWorkflowError(
        'creator_image_config_missing',
        'Image generation configuration is incomplete'
      );
    }
    if (
      referenceImageAvailable
      && !supportsReferenceImage(provider)
    ) {
      setConfigurationNeeded(input.creator, job.id, {
        code: 'unsupported_capability',
        message: '当前图像服务不支持参考图，请切换到 OpenAI 或 Gemini',
        section: 'image',
        resumeStageId: stageId
      });
      throw new CoverWorkflowError(
        'unsupported_capability',
        `The ${provider} image provider does not support reference images`
      );
    }
  }

  async function continueFrom(stage: CreatorStageRun): Promise<void> {
    if (
      stage.stageId !== 'analyze-source'
      || stage.status !== 'succeeded'
      || stage.progress.workflow !== true
    ) {
      return;
    }
    let job = input.creator.getJob(stage.jobId);
    if (job === undefined || job.templateId !== 'cover' || job.templateVersion < 2) return;
    try {
      await validateStage(job, 'generate');
    } catch (error) {
      if (error instanceof CoverWorkflowError) return;
      throw error;
    }
    job = input.creator.getJob(stage.jobId);
    if (job !== undefined) queueStage(job, 'generate', input.dispatcher, stage.id);
  }

  return {
    validateStage,
    async handleStageChanged(stage: CreatorStageRun): Promise<void> {
      await continueFrom(stage);
    },
    async recover(): Promise<void> {
      for (const job of input.creator.listJobs()) {
        if (job.templateId !== 'cover' || job.templateVersion < 2) continue;
        const completed = [...job.stages].reverse().find(stage => (
          stage.stageId === 'analyze-source'
          && stage.status === 'succeeded'
          && stage.progress.workflow === true
        ));
        if (completed !== undefined) await continueFrom(completed);
      }
    },
    async resumeConfiguredJobs(): Promise<void> {
      for (const listed of input.creator.listJobs()) {
        if (
          listed.templateId !== 'cover'
          || listed.templateVersion < 2
          || listed.status !== 'needs_input'
        ) {
          continue;
        }
        const requested = readResumeRequest(listed);
        if (requested === undefined) continue;
        try {
          await validateStage(listed, requested.stageId);
        } catch (error) {
          if (error instanceof CoverWorkflowError) continue;
          throw error;
        }
        const latest = input.creator.getJob(listed.id);
        if (latest === undefined || latest.status !== 'needs_input') continue;
        queueStage(
          latest,
          requested.stageId,
          input.dispatcher,
          requested.parentStageRunId,
          `cover-configured:${latest.id}:${requested.stageId}:${latest.revision}`
        );
      }
    }
  };
}

function validateCoverSettings(job: CreatorJob): void {
  if (
    job.state.coverStyle === 'custom'
    && (
      typeof job.state.customStylePrompt !== 'string'
      || !job.state.customStylePrompt.trim()
    )
  ) {
    throw new CoverWorkflowError(
      'creator_stage_input_missing',
      'Custom cover style instructions are required'
    );
  }
}

export class CoverWorkflowError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CoverWorkflowError';
  }
}

export function supportsReferenceImage(provider: ImageGenerationProvider): boolean {
  return imageGenerationCapabilities(provider).supportsReferenceImage;
}

function validateYoutubeSource(job: CreatorJob): void {
  const value = job.state.sourceUrl;
  if (job.state.sourceType !== 'youtube' || typeof value !== 'string') {
    throw new CoverWorkflowError(
      'creator_cover_source_missing',
      'A YouTube source URL is required'
    );
  }
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return;
  } catch {
    // Report the same stable validation error below.
  }
  throw new CoverWorkflowError(
    'unsupported_source',
    'Only public YouTube URLs are supported for cover analysis'
  );
}

function validateGenerationInput(job: CreatorJob): boolean {
  const prompt = typeof job.state.prompt === 'string' ? job.state.prompt.trim() : '';
  const brief = [...job.artifacts].reverse().find(artifact => (
    artifact.kind === 'cover_brief'
    && artifact.status === 'completed'
    && typeof artifact.metadata.headline === 'string'
    && artifact.metadata.headline.trim().length > 0
  ));
  const headline = typeof job.state.coverHeadline === 'string'
    ? job.state.coverHeadline.trim()
    : '';
  if (!prompt && !headline && brief === undefined) {
    throw new CoverWorkflowError(
      'creator_stage_input_missing',
      'A cover prompt, headline, or analyzed video source is required'
    );
  }
  const referenceId = job.state.referenceImageArtifactId;
  if (
    typeof referenceId === 'string'
    && !job.artifacts.some(artifact => (
      artifact.id === referenceId
      && artifact.kind === 'reference_image'
      && artifact.status === 'completed'
      && artifact.path !== null
    ))
  ) {
    throw new CoverWorkflowError(
      'creator_stage_input_missing',
      'The selected reference image is unavailable'
    );
  }
  const hasSelectedReference = typeof referenceId === 'string';
  const hasYoutubeReference = job.state.sourceType === 'youtube'
    && [...job.artifacts].reverse().some(artifact => (
      artifact.kind === 'source_keyframe'
      && artifact.status === 'completed'
      && artifact.path !== null
    ));
  if (
    job.state.sourceType === 'youtube'
    && !hasSelectedReference
    && !hasYoutubeReference
  ) {
    throw new CoverWorkflowError(
      'creator_cover_reference_missing',
      'The YouTube thumbnail reference is unavailable'
    );
  }
  return hasSelectedReference || hasYoutubeReference;
}

function hasImageCredentials(
  config: Awaited<ReturnType<CreatorServicesConfigStore['read']>>,
  provider: ImageGenerationProvider
): boolean {
  return imageProviderConfigured(config, provider);
}

function setConfigurationNeeded(
  creator: CreatorService,
  jobId: string,
  request: {
    code: string;
    message: string;
    section: string;
    resumeStageId: string;
  }
): void {
  const existing = creator.getJob(jobId)?.state.needsInput;
  if (
    existing !== null
    && typeof existing === 'object'
    && !Array.isArray(existing)
    && existing.code === request.code
    && existing.resumeStageId === request.resumeStageId
  ) {
    return;
  }
  creator.setNeedsInput(jobId, {
    code: request.code,
    message: request.message,
    deepLink: `#/settings?tab=ai-services&section=${request.section}`,
    resumeStageId: request.resumeStageId,
    workflow: true
  });
}

function setReferenceNeeded(
  creator: CreatorService,
  jobId: string
): void {
  const existing = creator.getJob(jobId)?.state.needsInput;
  if (
    existing !== null
    && typeof existing === 'object'
    && !Array.isArray(existing)
    && existing.code === 'creator_cover_reference_missing'
  ) {
    return;
  }
  creator.setNeedsInput(jobId, {
    code: 'creator_cover_reference_missing',
    message: '无法获取 YouTube 原封面，请重新分析视频来源',
    resumeStageId: 'analyze-source',
    workflow: true
  });
}

function readResumeRequest(job: CreatorJob): {
  stageId: 'analyze-source' | 'generate';
  parentStageRunId?: string;
} | undefined {
  const needsInput = job.state.needsInput;
  if (
    needsInput === null
    || typeof needsInput !== 'object'
    || Array.isArray(needsInput)
    || (needsInput.resumeStageId !== 'analyze-source' && needsInput.resumeStageId !== 'generate')
  ) {
    return undefined;
  }
  if (needsInput.resumeStageId === 'generate') {
    const parent = [...job.stages].reverse().find(stage => (
      stage.stageId === 'analyze-source'
      && stage.status === 'succeeded'
      && stage.progress.workflow === true
    ));
    return {
      stageId: 'generate',
      ...(parent === undefined ? {} : { parentStageRunId: parent.id })
    };
  }
  return { stageId: 'analyze-source' };
}

function queueStage(
  job: CreatorJob,
  stageId: 'analyze-source' | 'generate',
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatch'>,
  parentStageRunId?: string,
  idempotencyKey = parentStageRunId === undefined
    ? `cover:${job.id}:${stageId}:${job.revision}`
    : `cover:${parentStageRunId}:${stageId}`
): void {
  const alreadyQueued = job.stages.some(stage => (
    stage.stageId === stageId
    && (
      parentStageRunId === undefined
        ? stage.status === 'queued' || stage.status === 'running'
        : stage.progress.workflowParentStageRunId === parentStageRunId
    )
  ));
  if (alreadyQueued) return;
  dispatcher.dispatch(job.id, {
    action: 'run-stage',
    expectedRevision: job.revision,
    idempotencyKey,
    input: {
      stageId,
      workflow: true,
      ...(parentStageRunId === undefined
        ? {}
        : { workflowParentStageRunId: parentStageRunId })
    }
  }, 'system');
}
