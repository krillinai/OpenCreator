import {
  videoSourceIdentity,
  parseBilibiliVideoSource,
  supportedVideoSourcePlatform,
  volcengineTtsCredentialsReady,
  type CreatorJob,
  type CreatorServicesConfig,
  type CreatorStageRun,
  type CreatorTtsProvider
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorCommandDispatcher } from '../command-dispatcher.js';
import type { CreatorService } from '../service.js';
import { VideoMetadataError, type VideoMetadataService } from '../../video-metadata/service.js';

export type VideoTranslationWorkflow = ReturnType<typeof createVideoTranslationWorkflow>;

export function createVideoTranslationWorkflow(input: {
  creator: CreatorService;
  dispatcher: Pick<CreatorCommandDispatcher, 'dispatch'>;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  readConfigForJob?(jobId: string): Promise<CreatorServicesConfig>;
  videoMetadataService?: VideoMetadataService;
}) {
  async function validateStage(job: CreatorJob, stageId: string): Promise<void> {
    if (job.templateId !== 'video-translation') return;
    if (job.state.sourceType === 'subtitle' && stageId !== 'subtitle') {
      throw new VideoTranslationWorkflowError('creator_action_not_allowed', 'Subtitle-only tasks only support subtitle translation');
    }
    if (stageId === 'subtitle') {
      validateSource(job);
      await validateBilibiliSource(job, input.videoMetadataService);
      if (job.state.sourceType !== 'subtitle' && job.artifacts.some(artifact => artifact.id === job.state.importedTargetSubtitleId && artifact.kind === 'target_subtitle' && artifact.status === 'completed')) return;
      const config = await (input.readConfigForJob?.(job.id) ?? input.configStore.read());
      if (
        config.llm.source === 'custom'
        && (
          !config.llm.baseUrl.trim()
          || !config.llm.model.trim()
          || !config.llm.apiKey.trim()
        )
      ) {
        setConfigurationNeeded(input.creator, job.id, {
          code: 'creator_llm_config_missing',
          message: 'Configure the text translation model first',
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
    const config = await (input.readConfigForJob?.(job.id) ?? input.configStore.read());
    if (!hasTtsCredentials(config, job)) {
      setConfigurationNeeded(input.creator, job.id, {
        code: 'creator_tts_config_missing',
        message: 'Configure the target-language TTS service first',
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
    if (job.status === 'canceled') return;
    const sourceDownload = [...job.stages].reverse().find(run => run.progress.backgroundSourceDownload === true
      && run.progress.workflowParentStageRunId === stage.id);
    if (sourceDownload && ['canceled', 'interrupted'].includes(sourceDownload.status)) return;
    if (job.stages.some(run => run.progress.backgroundSourceDownload === true && ['queued', 'running'].includes(run.status))) return;
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

  function startSourceDownload(stage: CreatorStageRun): void {
    if (stage.stageId !== 'subtitle' || stage.status !== 'running' || stage.progress.workflow !== true) return;
    const job = input.creator.getJob(stage.jobId);
    if (!job || job.templateId !== 'video-translation' || job.state.sourceType !== 'url'
      || job.state.skipVideoDownload === true || typeof job.state.sourceUrl !== 'string'
      || videoSourceIdentity(job.state.sourceUrl) === null) return;
    if (job.stages.some(run => run.stageId === 'preview-source-video'
      && (run.progress.workflowParentStageRunId === stage.id || ['queued', 'running'].includes(run.status)))) return;
    input.dispatcher.dispatch(job.id, {
      action: 'run-stage', expectedRevision: job.revision,
      idempotencyKey: `video-translation:${stage.id}:source-download`,
      input: { stageId: 'preview-source-video', backgroundSourceDownload: true, workflowParentStageRunId: stage.id }
    }, 'system');
  }

  return {
    validateStage,
    async handleStageChanged(stage: CreatorStageRun): Promise<void> {
      startSourceDownload(stage);
      if (stage.progress.backgroundSourceDownload === true && ['succeeded', 'failed'].includes(stage.status)) {
        const job = input.creator.getJob(stage.jobId);
        const parent = job?.stages.find(run => run.id === stage.progress.workflowParentStageRunId);
        if (parent) await continueFrom(parent);
      }
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
        for (const stage of job.stages) startSourceDownload(stage);
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

export async function validateBilibiliSource(job: CreatorJob, service?: VideoMetadataService): Promise<void> {
  if (job.state.sourceType === 'file' || job.state.sourceType === 'subtitle' || typeof job.state.sourceUrl !== 'string') return;
  let host: string;
  try {
    host = new URL(job.state.sourceUrl).hostname.toLowerCase();
  } catch {
    return;
  }
  if (host !== 'bilibili.com' && !host.endsWith('.bilibili.com')) return;
  const source = parseBilibiliVideoSource(job.state.sourceUrl);
  if (source === null) {
    throw new VideoTranslationWorkflowError('creator_source_invalid_part', 'Invalid Bilibili URL. Check the video address and part parameter (p must be a positive integer).');
  }
  try {
    if (service === undefined) throw new Error('Video metadata service unavailable');
    const metadata = await service.get(source.url);
    if ((metadata.parts?.length ?? 0) > 1 && source.partIndex === undefined) {
      throw new VideoTranslationWorkflowError('creator_source_part_required', `This video has ${metadata.parts!.length} parts. Select the part to translate in the video source settings.`);
    }
    if (source.partIndex !== undefined && metadata.parts !== undefined
      && !metadata.parts.some(part => part.index === source.partIndex)) {
      throw new VideoTranslationWorkflowError('creator_source_invalid_part', 'The requested video part does not exist. Select another part.');
    }
  } catch (error) {
    if (error instanceof VideoTranslationWorkflowError) throw error;
    if (error instanceof VideoMetadataError && error.code === 'INVALID_PART') {
      throw new VideoTranslationWorkflowError('creator_source_invalid_part', error.message);
    }
    throw new VideoTranslationWorkflowError('creator_source_metadata_unavailable', 'Could not read Bilibili video parts. Try again. Download and translation have not started.');
  }
}

function validateSource(job: CreatorJob): void {
  if (typeof job.state.importedSourceSubtitleId === 'string' && job.state.sourceLanguage === 'auto') {
    throw new VideoTranslationWorkflowError('creator_action_invalid', 'Select the source subtitle language before translating');
  }
  if (job.state.sourceType === 'subtitle') {
    if (!job.artifacts.some(artifact => artifact.id === job.state.importedSourceSubtitleId
      && artifact.kind === 'source_subtitle' && artifact.status === 'completed')) {
      throw new VideoTranslationWorkflowError('creator_source_missing', 'An imported source SRT file is required');
    }
    return;
  }
  if (job.state.sourceType === 'file') {
    if (!job.artifacts.some(artifact => artifact.kind === 'source_video' && artifact.status === 'completed')) {
      throw new VideoTranslationWorkflowError('creator_source_missing', 'Registered local source video is required');
    }
    return;
  }
  const value = job.state.sourceUrl;
  if (typeof value !== 'string' || !isSupportedVideoUrl(value)) {
    throw new VideoTranslationWorkflowError('unsupported_source', 'Only public YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, and Reddit video URLs are supported');
  }
}

function isSupportedVideoUrl(value: string): boolean {
  try {
    const source = new URL(value.trim());
    // Existing translation jobs may use HTTP YouTube or Bilibili links.
    if (source.protocol === 'http:') {
      source.protocol = 'https:';
      const platform = supportedVideoSourcePlatform(source.toString());
      return platform === 'youtube' || platform === 'bilibili';
    }
    return supportedVideoSourcePlatform(value) !== null;
  } catch {
    return supportedVideoSourcePlatform(value) !== null;
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
  if (provider === 'volcengine') {
    return volcengineTtsCredentialsReady(config.tts.volcengine);
  }
  return config.tts.aliyun.apiKey.length > 0;
}

function isTtsProvider(value: unknown): value is CreatorTtsProvider {
  return value === 'openai'
    || value === 'aliyun'
    || value === 'edge-tts'
    || value === 'minimax'
    || value === 'volcengine';
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
  if (job.state.sourceType === 'subtitle') return undefined;
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
