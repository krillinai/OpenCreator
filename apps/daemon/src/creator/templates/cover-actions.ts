import type {
  CreatorJob,
  CreatorStageRun,
  ImageGenerationProvider
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorCommandDispatcher } from '../command-dispatcher.js';
import type { CreatorService } from '../service.js';

export type CoverWorkflow = ReturnType<typeof createCoverWorkflow>;

export function createCoverWorkflow(input: {
  creator: CreatorService;
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatch'>;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
}) {
  async function validateStage(job: CreatorJob, stageId: string): Promise<void> {
    if (job.templateId !== 'cover' || job.templateVersion < 2) return;
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
    validateGenerationInput(job);
    const config = await input.configStore.read();
    const provider = readProvider(job.state.provider, config.image.provider);
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
      typeof job.state.referenceImageArtifactId === 'string'
      && !supportsReferenceImage(provider)
    ) {
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

export class CoverWorkflowError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CoverWorkflowError';
  }
}

export function supportsReferenceImage(provider: ImageGenerationProvider): boolean {
  return provider === 'openai' || provider === 'gemini';
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

function validateGenerationInput(job: CreatorJob): void {
  const prompt = typeof job.state.prompt === 'string' ? job.state.prompt.trim() : '';
  const brief = [...job.artifacts].reverse().find(artifact => (
    artifact.kind === 'cover_brief'
    && artifact.status === 'completed'
    && typeof artifact.metadata.imagePrompt === 'string'
    && artifact.metadata.imagePrompt.trim().length > 0
  ));
  if (!prompt && brief === undefined) {
    throw new CoverWorkflowError(
      'creator_stage_input_missing',
      'A cover prompt or analyzed video source is required'
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
}

function hasImageCredentials(
  config: Awaited<ReturnType<CreatorServicesConfigStore['read']>>,
  provider: ImageGenerationProvider
): boolean {
  if (provider === 'kling') {
    return config.image.kling.accessKey.trim().length > 0
      && config.image.kling.secretKey.trim().length > 0;
  }
  return config.image[provider].apiKey.trim().length > 0;
}

function readProvider(
  value: unknown,
  fallback: ImageGenerationProvider
): ImageGenerationProvider {
  return value === 'openai' || value === 'jimeng' || value === 'kling' || value === 'gemini'
    ? value
    : fallback;
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
