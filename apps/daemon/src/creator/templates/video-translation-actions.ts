import type {
  CreatorJob,
  CreatorStageRun,
  CreatorTtsProvider
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorCommandDispatcher } from '../command-dispatcher.js';
import type { CreatorService } from '../service.js';

export type VideoTranslationWorkflow = ReturnType<typeof createVideoTranslationWorkflow>;

export function createVideoTranslationWorkflow(input: {
  creator: CreatorService;
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatch'>;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
}) {
  async function validateStage(job: CreatorJob, stageId: string): Promise<void> {
    if (job.templateId !== 'video-translation') return;
    if (stageId === 'subtitle') {
      validateSource(job);
      const config = await input.configStore.read();
      if (!config.llm.apiKey) {
        setConfigurationNeeded(input.creator, job.id, {
          code: 'creator_llm_config_missing',
          message: '请先完成文本翻译模型配置',
          section: 'text'
        });
        throw new VideoTranslationWorkflowError(
          'creator_llm_config_missing',
          'LLM configuration is incomplete'
        );
      }
      return;
    }
    if (stageId !== 'tts' || job.state.dubbing !== true) return;
    const config = await input.configStore.read();
    if (!hasTtsCredentials(config, job)) {
      setConfigurationNeeded(input.creator, job.id, {
        code: 'creator_tts_config_missing',
        message: '请先完成目标语言配音服务配置',
        section: 'tts'
      });
      throw new VideoTranslationWorkflowError(
        'creator_tts_config_missing',
        'TTS configuration is incomplete'
      );
    }
  }

  async function continueFrom(stage: CreatorStageRun): Promise<void> {
    if (stage.status !== 'succeeded' || stage.progress.workflow !== true) return;
    let job = input.creator.getJob(stage.jobId);
    if (job === undefined || job.templateId !== 'video-translation') return;
    const nextStageId = nextWorkflowStage(job, stage.stageId);
    if (nextStageId === undefined) return;
    try {
      await validateStage(job, nextStageId);
    } catch (error) {
      if (error instanceof VideoTranslationWorkflowError) return;
      throw error;
    }
    job = input.creator.getJob(stage.jobId);
    if (job !== undefined) queueNextStage(job, stage, nextStageId, input.dispatcher);
  }

  return {
    validateStage,
    async handleStageChanged(stage: CreatorStageRun): Promise<void> {
      await continueFrom(stage);
    },
    async reconcile(job: CreatorJob): Promise<void> {
      if (job.templateId !== 'video-translation') return;
      const completed = [...job.stages].reverse().find(stage => (
        stage.status === 'succeeded' && stage.progress.workflow === true
      ));
      if (completed !== undefined) await continueFrom(completed);
    },
    async resumeConfiguredJobs(): Promise<void> {
      for (const job of input.creator.listJobs()) {
        if (
          job.templateId !== 'video-translation'
          || job.status !== 'needs_input'
          || job.state.dubbing !== true
          || needsInputCode(job) !== 'creator_tts_config_missing'
        ) {
          continue;
        }
        const completed = [...job.stages].reverse().find(stage => (
          stage.stageId === 'subtitle'
          && stage.status === 'succeeded'
          && stage.progress.workflow === true
        ));
        if (completed !== undefined) await continueFrom(completed);
      }
    },
    async recover(): Promise<void> {
      for (const job of input.creator.listJobs()) {
        if (job.templateId !== 'video-translation') continue;
        const completed = [...job.stages].reverse().find(stage => (
          stage.status === 'succeeded' && stage.progress.workflow === true
        ));
        if (completed !== undefined) await continueFrom(completed);
      }
    }
  };
}

export class VideoTranslationWorkflowError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'VideoTranslationWorkflowError';
  }
}

function validateSource(job: CreatorJob): void {
  if (job.state.sourceType === 'file') {
    if (!job.artifacts.some(artifact => artifact.kind === 'source_video' && artifact.status === 'completed')) {
      throw new VideoTranslationWorkflowError('creator_source_missing', 'Registered local source video is required');
    }
    return;
  }
  const value = job.state.sourceUrl;
  if (typeof value !== 'string' || !isSupportedVideoUrl(value)) {
    throw new VideoTranslationWorkflowError('unsupported_source', 'Only YouTube and Bilibili public URLs are supported');
  }
}

function isSupportedVideoUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com') || host === 'b23.tv' || host.endsWith('bilibili.com');
  } catch {
    return false;
  }
}

function hasTtsCredentials(
  config: Awaited<ReturnType<CreatorServicesConfigStore['read']>>,
  job: CreatorJob
): boolean {
  const provider = isTtsProvider(job.state.ttsProvider)
    ? job.state.ttsProvider
    : config.tts.provider;
  if (provider === 'edge-tts') return true;
  if (provider === 'openai') return config.tts.openai.apiKey.length > 0;
  if (provider === 'minimax') return config.tts.minimax.apiKey.length > 0;
  return config.tts.aliyun.apiKey.length > 0;
}

function isTtsProvider(value: unknown): value is CreatorTtsProvider {
  return value === 'openai'
    || value === 'aliyun'
    || value === 'edge-tts'
    || value === 'minimax';
}

function queueNextStage(
  job: CreatorJob,
  completed: CreatorStageRun,
  nextStageId: string,
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatch'>
): void {
  const alreadyQueued = job.stages.some(stage => (
    stage.stageId === nextStageId
    && stage.progress.workflowParentStageRunId === completed.id
  ));
  if (alreadyQueued) return;
  const resultVersion = typeof completed.progress.resultVersion === 'number'
    && Number.isInteger(completed.progress.resultVersion)
    && completed.progress.resultVersion > 0
    ? completed.progress.resultVersion
    : undefined;
  dispatcher.dispatch(job.id, {
    action: 'run-stage',
    expectedRevision: job.revision,
    idempotencyKey: `video-translation:${completed.id}:${nextStageId}`,
    input: {
      stageId: nextStageId,
      workflow: true,
      workflowParentStageRunId: completed.id,
      ...(resultVersion === undefined
        ? {}
        : {
            baseResultVersion: resultVersion,
            inputResultVersion: resultVersion,
            targetResultVersion: resultVersion
          })
    }
  }, 'system');
}

function nextWorkflowStage(job: CreatorJob, completedStageId: string): string | undefined {
  if (completedStageId === 'subtitle') {
    if (job.state.dubbing === true) return 'tts';
    return firstRenderStage(job);
  }
  if (completedStageId === 'tts') return firstRenderStage(job);
  if (completedStageId === 'render-horizontal' && job.state.videoFormat === 'all') {
    return 'render-vertical';
  }
  return undefined;
}

function firstRenderStage(job: CreatorJob): string | undefined {
  if (job.state.composeVideo !== true) return undefined;
  return job.state.videoFormat === 'vertical' ? 'render-vertical' : 'render-horizontal';
}

function setConfigurationNeeded(
  creator: CreatorService,
  jobId: string,
  input: { code: string; message: string; section: string }
): void {
  const existing = creator.getJob(jobId)?.state.needsInput;
  if (
    existing !== null
    && typeof existing === 'object'
    && !Array.isArray(existing)
    && existing.code === input.code
  ) {
    return;
  }
  creator.setNeedsInput(jobId, {
    code: input.code,
    message: input.message,
    deepLink: `#/settings?tab=ai-services&section=${input.section}`
  });
}

function needsInputCode(job: CreatorJob): string | undefined {
  const value = job.state.needsInput;
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.code === 'string'
  )
    ? value.code
    : undefined;
}
