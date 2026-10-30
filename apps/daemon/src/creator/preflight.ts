import type {
  CodexImageStatus,
  CreatorArtifact,
  CreatorJob,
  CreatorPreflightCheck,
  CreatorPreflightExecutionMode,
  CreatorPreflightResponse,
  CreatorServicesCapabilitiesResponse,
  CreatorServicesConfig,
  PublicErrorFacts
} from '@opencreator/protocol';
import {
  creatorPreflightFailure,
  imagePromptRequiresReference,
  volcengineTtsCredentialsReady,
  volcengineAsrCredentialsReady
} from '@opencreator/protocol';
import { access, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { CreatorTemplateStage } from './templates/types.js';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { preflightKrillinDependencies } from './krillin/dependency-preflight.js';
import { assessKrillinTranscription } from './krillin/transcription-language.js';
import { isYouTubeSource } from './krillin/execution-plan.js';
import type { YtDlpRuntime } from './yt-dlp/runtime.js';
import {
  imageProviderConfigured,
  resolveCreatorImageSettings
} from './image-settings.js';
import { creatorResultSnapshotForVersion } from './result-snapshots.js';
import { resolveCreatorStageInputs } from './stage-runner.js';
import { readStickmanRemotionRuntime } from './stickman/remotion-runtime.js';
import type { RemotionComponentManager } from './stickman/remotion-component.js';
import { validateBilibiliSource } from './templates/video-translation-actions.js';
import type { VideoMetadataService } from '../video-metadata/service.js';
import { gatewayCreatorBinding } from '../gateway/creator-service-source.js';
import { stickmanShotSpecSchema } from './stickman/contracts.js';
import { shouldUsePreviousShotReference } from './stickman/image-prompt.js';

export type CreatorPreflight = ReturnType<typeof createCreatorPreflight>;

export type CreatorPreflightOptions = {
  inputResultVersion?: number;
};

export class CreatorPreflightError extends Error {
  readonly code: string;
  readonly publicFacts: PublicErrorFacts;
  constructor(readonly result: CreatorPreflightResponse) {
    const failure = creatorPreflightFailure(result);
    super(failure.message);
    this.name = 'CreatorPreflightError';
    this.code = failure.code;
    this.publicFacts = failure.publicFacts;
  }
}

export function createCreatorPreflight(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  readConfigForJob?(jobId: string): Promise<CreatorServicesConfig>;
  readCapabilities(): CreatorServicesCapabilitiesResponse;
  resourceRoot: string;
  jobsRoot: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  stickmanRuntimeRoot?: string;
  remotionComponent?: Pick<RemotionComponentManager, 'status'>;
  getYtDlpRuntime?(): YtDlpRuntime | undefined;
  runtimeVerificationCachePath?: string;
  ensureRuntimeReady?(): Promise<void>;
  executorIds?: Iterable<string>;
  validateRuntimeAssets?: boolean;
  readCodexImageStatus?(): Promise<CodexImageStatus>;
  videoMetadataService?: VideoMetadataService;
  assertServiceSource?(jobId: string): void;
  validateOfficialModel?(modality: import('@opencreator/protocol').GatewayModel['modality'], model: string): Promise<unknown>;
}) {
  const executorIds = new Set(input.executorIds ?? []);

  async function check(job: CreatorJob, stage: CreatorTemplateStage, options: CreatorPreflightOptions = {}): Promise<CreatorPreflightResponse> {
    const ready: CreatorPreflightCheck[] = [];
    const warning: CreatorPreflightCheck[] = [];
    const blocked: Array<CreatorPreflightCheck & { repair: NonNullable<CreatorPreflightCheck['repair']> }> = [];
    const mode = executionMode(stage, job);
    const add = (
      status: 'ready' | 'warning' | 'blocked',
      item: Omit<CreatorPreflightCheck, 'executionMode'> & { executionMode?: CreatorPreflightExecutionMode },
      repair?: CreatorPreflightCheck['repair']
    ) => {
      const value = { ...item, executionMode: item.executionMode ?? mode };
      if (status === 'ready') ready.push(value);
      else if (status === 'warning') warning.push(value);
      else blocked.push({ ...value, repair: repair ?? { label: 'Open settings', deepLink: '#/settings?tab=diagnostics' } });
    };

    if (executorIds.size > 0 && !executorIds.has(stage.executor)) {
      add('blocked', {
        id: 'executor',
        title: 'Executor unavailable',
        message: `The Runtime has not loaded the ${stage.executor} executor.`,
        executionMode: mode
      }, { label: 'Open diagnostics', deepLink: '#/settings?tab=diagnostics' });
    } else {
      add('ready', { id: 'executor', title: 'Executor', message: `${stage.executor} loaded`, executionMode: mode });
    }

    try { input.assertServiceSource?.(job.id); } catch {
      add('blocked', { id: 'service-source', title: 'Task service source mismatch', message: 'Restore the original task account and service source before continuing.', executionMode: 'remote' }, { label: 'Open account settings', deepLink: '#/settings?tab=ai-services' });
      return { templateId: job.templateId, templateVersion: job.templateVersion, stageId: stage.id, executionMode: mode, canStart: false, ready, warning, blocked, checkedAt: new Date().toISOString() };
    }
    const config = await (input.readConfigForJob?.(job.id) ?? input.configStore.read());
    const inputSnapshot = options.inputResultVersion === undefined
      ? undefined
      : creatorResultSnapshotForVersion(job, options.inputResultVersion);
    if (options.inputResultVersion !== undefined && inputSnapshot === undefined) {
      add('blocked', {
        id: 'input-result-version',
        title: 'Result version not found',
        message: `Result version ${options.inputResultVersion} was not found. Saved inputs cannot be reused safely.`,
        executionMode: 'local'
      }, { label: 'Open diagnostics', deepLink: '#/settings?tab=diagnostics' });
    }
    const inputState = inputSnapshot?.state ?? job.state;
    if (inputState.sourceType === 'subtitle' && stage.id === 'subtitle'
      && !job.artifacts.some(artifact => artifact.id === inputState.importedSourceSubtitleId
        && artifact.kind === 'source_subtitle' && artifact.status === 'completed')) {
      add('blocked', { id: 'input-subtitle', title: 'Subtitle file missing', message: 'Import a source SRT file to translate.', executionMode: 'local' });
    }
    if (stage.resultVersionPolicy === 'attach' && inputSnapshot === undefined) {
      add('blocked', { id: 'input-result-version', title: 'Select a project version', message: 'Select a saved project version before preparing the preview video.', executionMode: 'local' });
    }
    if (job.templateId === 'video-translation' && (stage.id === 'subtitle' || stage.id === 'prepare-source-video' || stage.id === 'preview-source-video')) {
      try {
        await validateBilibiliSource({ ...job, state: inputState }, input.videoMetadataService);
      } catch (error) {
        add('blocked', {
          id: 'bilibili-part', title: 'Confirm the Bilibili video part',
          message: error instanceof Error ? error.message : 'Could not confirm the Bilibili video part. Select the video source again.',
          executionMode: 'remote'
        }, { label: 'Select a video part', deepLink: `#/workbench?tool=video-translation&jobId=${encodeURIComponent(job.id)}` });
      }
    }
    if (inputState.sourceType === 'file' && stage.executor === 'krillinai' && typeof inputState.sourceArtifactId !== 'string') {
      add('blocked', {
        id: 'input-file',
        title: 'Input file missing',
        message: 'Select a local video file to process.',
        executionMode: 'local'
      }, { label: 'Select an input file', deepLink: '#/settings?tab=diagnostics' });
    }
    const resolvedInputs = resolveCreatorStageInputs(
      job,
      stage.inputArtifacts,
      inputSnapshot?.artifactRefs,
      inputSnapshot?.state
    );
    await checkProviderConfig({ ...job, state: inputState }, stage, config, resolvedInputs.artifacts, input.readCapabilities(), add, input.readCodexImageStatus);
    if (job.templateId === 'image-generation' && stage.id === 'generate'
      && typeof inputState.prompt === 'string' && imagePromptRequiresReference(inputState.prompt)
      && !resolvedInputs.artifacts.some(artifact => artifact.kind === 'reference_image'
        && artifact.status === 'completed' && artifact.path !== null)) {
      add('blocked', {
        id: 'reference-image-required', title: 'Reference image missing',
        message: 'This prompt requires an existing image. Upload a reference image, or remove the image requirements for text-only generation.',
        executionMode: 'local'
      }, { label: 'Upload a reference image', deepLink: `#/workbench?tool=image-generation&jobId=${encodeURIComponent(job.id)}` });
    }
    await checkInputs(stage, resolvedInputs.artifacts, resolvedInputs.missing, add);
    await checkRuntimeDependencies({ ...job, state: inputState }, stage, config, add);
    await checkManagedDirectory(add);

    const gateway = gatewayCreatorBinding(config);
    if (gateway && blocked.length === 0 && input.validateOfficialModel) {
      const modalities = new Set<import('@opencreator/protocol').GatewayModel['modality']>();
      for (const check of ready) {
        if (check.id === 'llm') modalities.add('text');
        if (check.id === 'tts') modalities.add('speech');
        if (check.id === 'transcription-config') modalities.add('transcription');
        if (check.id === 'image-provider') modalities.add('image');
        if (check.id === 'video-provider') modalities.add('video');
      }
      // Translation starts a workflow; validate its downstream models before processing the video.
      if (job.templateId === 'video-translation' && ['download', 'subtitle'].includes(stage.id)) {
        modalities.add('text');
        if (inputState.sourceType !== 'subtitle' && !hasImportedSubtitle({ ...job, state: inputState }) && !canTryPlatformCaptions({ ...job, state: inputState })) modalities.add('transcription');
        if (inputState.dubbing === true) modalities.add('speech');
      }
      for (const modality of modalities) {
        const choices = inputState.officialModels;
        const selected = choices && typeof choices === 'object' && !Array.isArray(choices) ? choices[modality] : undefined;
        const model = typeof selected === 'string' ? selected : gateway.models[modality];
        try {
          if (!model) throw new Error('No official model is selected. Choose another model.');
          await input.validateOfficialModel(modality, model);
          add('ready', { id: `official-model-catalog:${modality}`, title: 'Model configuration', message: `${model} is in the compatible model catalog.`, executionMode: 'remote' });
        } catch (error) {
          const code = (error as { code?: string })?.code;
          const message = code === 'invalid_model' || !model
            ? `${model ?? modality} is currently unavailable. Choose another model.`
            : 'Model configuration could not be checked. Reconnect official services and try again.';
          add('blocked', { id: `official-model-catalog:${modality}`, title: 'Model configuration check failed', message, executionMode: 'remote' },
            { label: 'Choose another model', deepLink: `#/workbench?tool=${encodeURIComponent(job.templateId)}&jobId=${encodeURIComponent(job.id)}` });
        }
      }
    }

    return {
      templateId: job.templateId,
      templateVersion: job.templateVersion,
      stageId: stage.id,
      executionMode: mode,
      canStart: blocked.length === 0,
      ready,
      warning,
      blocked,
      checkedAt: new Date().toISOString()
    };
  }

  return { check };

  async function checkManagedDirectory(
    add: (status: 'ready' | 'warning' | 'blocked', item: Omit<CreatorPreflightCheck, 'executionMode'> & { executionMode?: CreatorPreflightExecutionMode }, repair?: CreatorPreflightCheck['repair']) => void
  ) {
    try {
      await mkdir(input.jobsRoot, { recursive: true });
      await access(input.jobsRoot, constants.W_OK);
      add('ready', { id: 'managed-directory', title: 'Managed directory', message: 'The task directory is writable.', executionMode: 'local' });
    } catch {
      add('blocked', {
        id: 'managed-directory',
        title: 'Managed directory is not writable',
        message: 'OpenCreator cannot write to the task directory or save artifacts safely.',
        executionMode: 'local'
      }, { label: 'Open diagnostics', deepLink: '#/settings?tab=diagnostics' });
    }
  }

  async function checkRuntimeDependencies(
    job: CreatorJob,
    stage: CreatorTemplateStage,
    config: CreatorServicesConfig,
    add: (status: 'ready' | 'warning' | 'blocked', item: Omit<CreatorPreflightCheck, 'executionMode'> & { executionMode?: CreatorPreflightExecutionMode }, repair?: CreatorPreflightCheck['repair']) => void
  ) {
    if (
      input.validateRuntimeAssets !== false
      && runtimeBackedExecutor(stage.executor)
      && input.ensureRuntimeReady !== undefined
    ) {
      try {
        await input.ensureRuntimeReady();
      } catch (error) {
        add('blocked', {
          id: 'krillin-runtime',
          title: 'KrillinAI Runtime unavailable',
          message: error instanceof Error ? error.message : 'KrillinAI Runtime verification failed.',
          executionMode: 'local'
        }, { label: 'Open local component settings', deepLink: '#/settings?tab=local-components' });
        return;
      }
    }
    if (input.validateRuntimeAssets !== false) {
      const requiredTools = new Map<string, string | undefined>();
      if (['download', 'clip', 'krillinai', 'stickman-media-validation'].includes(stage.executor)) requiredTools.set('ffmpeg', input.ffmpegPath);
      if (['download', 'clip', 'krillinai', 'stickman-audio', 'stickman-remotion', 'stickman-media-validation', 'stickman-delivery'].includes(stage.executor)) requiredTools.set('ffprobe', input.ffprobePath);
      for (const [id, path] of requiredTools) {
        const label = id === 'ffmpeg' ? 'FFmpeg' : 'ffprobe';
        if (path === undefined) add('blocked', {
          id,
          title: `${label} unavailable`,
          message: `The Runtime could not find ${label}. This stage cannot run.`,
          executionMode: 'local'
        }, { label: 'Open local component settings', deepLink: '#/settings?tab=local-components' });
        else add('ready', { id, title: label, message: `${label} is ready.`, executionMode: 'local' });
      }
      if (stage.executor === 'stickman-delivery' && input.ffmpegPath === undefined) {
        add('warning', { id: 'ffmpeg', title: 'FFmpeg unavailable', message: 'Delivery checks will skip video frame sampling.', executionMode: 'local' });
      }
      if (stage.executor === 'stickman-remotion') {
        try {
          if (input.remotionComponent) {
            const component = await input.remotionComponent.status();
            if (!component.available) throw new Error(component.error ?? 'remotion_component_unavailable');
            add(component.state === 'ready' ? 'ready' : 'warning', {
              id: 'stickman-runtime', title: 'Remotion rendering component',
              message: component.state === 'ready' ? 'The Remotion rendering component is ready.' : 'Remotion will be prepared on demand. Rendering will continue automatically when ready.', executionMode: 'local'
            });
          } else {
            if (input.stickmanRuntimeRoot === undefined) throw new Error('stickman_runtime_unavailable');
            readStickmanRemotionRuntime(input.stickmanRuntimeRoot);
            add('ready', { id: 'stickman-runtime', title: 'Stickman rendering Runtime', message: 'Remotion Runtime assets passed verification.', executionMode: 'local' });
          }
        } catch (error) {
          add('blocked', {
            id: 'stickman-runtime',
            title: 'Stickman rendering Runtime unavailable',
            message: error instanceof Error ? error.message : 'Remotion Runtime asset verification failed.',
            executionMode: 'local'
          }, { label: 'Open local component settings', deepLink: '#/settings?tab=local-components&component=remotion' });
        }
      }
    }
    if (input.validateRuntimeAssets !== false && (stage.executor === 'download' || stage.executor === 'cover-analysis' || (stage.executor === 'krillinai' && job.state.sourceType !== 'file' && job.state.sourceType !== 'subtitle'))) {
      let runtime: YtDlpRuntime | undefined;
      try { runtime = input.getYtDlpRuntime?.(); } catch { runtime = undefined; }
      if (runtime === undefined) add('blocked', {
        id: 'yt-dlp',
        title: 'yt-dlp unavailable',
        message: 'yt-dlp was not found. Remote media cannot be processed.',
        executionMode: 'local'
      }, { label: 'Open local component settings', deepLink: '#/settings?tab=local-components' });
      else add('ready', { id: 'yt-dlp', title: 'yt-dlp', message: `Ready (${runtime.version}).`, executionMode: 'local' });
    }
    if (input.validateRuntimeAssets !== false && stage.executor === 'krillinai') {
      try {
        preflightKrillinDependencies(input.resourceRoot, config, {
          cachePath: input.runtimeVerificationCachePath
        });
        add('ready', { id: 'krillin-runtime', title: 'KrillinAI Runtime', message: 'Runtime assets passed verification.', executionMode: 'local' });
      } catch (error) {
        add('blocked', {
          id: 'krillin-runtime',
          title: 'KrillinAI Runtime incomplete',
          message: error instanceof Error ? error.message : 'KrillinAI Runtime asset verification failed.',
          executionMode: 'local'
        }, { label: 'Open local component settings', deepLink: '#/settings?tab=local-components' });
      }
    }
    if (stage.executor === 'krillinai' && stage.id === 'subtitle' && job.state.sourceType !== 'subtitle' && !hasImportedSubtitle(job) && !canTryPlatformCaptions(job) && ['whisper.cpp', 'whisperkit', 'faster-whisper'].includes(config.transcription.provider)) {
      const provider = input.readCapabilities().transcription.providers.find(candidate => candidate.provider === config.transcription.provider);
      if (provider?.available !== true) add('blocked', {
        id: 'transcription-capability',
        title: 'Speech recognition unavailable',
        message: `${config.transcription.provider} is unavailable in this Runtime.`,
        executionMode: 'local'
      }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=transcription' });
    }
  }
}

function runtimeBackedExecutor(executorId: string): boolean {
  return [
    'krillinai',
    'download',
    'cover-analysis',
    'clip',
    'stickman-audio',
    'stickman-remotion',
    'stickman-media-validation',
    'stickman-delivery'
  ].includes(executorId);
}

async function checkProviderConfig(
  job: CreatorJob,
  stage: CreatorTemplateStage,
  config: CreatorServicesConfig,
  inputArtifacts: CreatorArtifact[],
  capabilities: CreatorServicesCapabilitiesResponse,
  add: (status: 'ready' | 'warning' | 'blocked', item: Omit<CreatorPreflightCheck, 'executionMode'> & { executionMode?: CreatorPreflightExecutionMode }, repair?: CreatorPreflightCheck['repair']) => void,
  readCodexImageStatus?: () => Promise<CodexImageStatus>
): Promise<void> {
  const needs = new Set<string>();
  if (stage.executor === 'krillinai') {
    if (
      stage.id === 'subtitle'
      && !job.artifacts.some(artifact => (
        artifact.id === job.state.importedTargetSubtitleId
        && artifact.kind === 'target_subtitle'
        && artifact.status === 'completed'
      ))
    ) needs.add('llm');
    if (stage.id === 'tts' && job.state.dubbing === true) needs.add('tts');
  }
  if (stage.executor === 'clip') needs.add('llm');
  if (stage.executor === 'stickman-content' && ['source-brief', 'content-plan', 'script', 'storyboard'].includes(stage.id)) needs.add('llm');
  if (stage.executor === 'cover-analysis') needs.add('llm');
  if (stage.executor === 'image') {
    needs.add('image');
    if (stage.id === 'analyze-source') needs.add('llm');
  }
  if (stage.executor === 'video') needs.add('video');
  if (stage.executor === 'smart-dubbing') needs.add('tts');
  if (stage.executor === 'stickman-audio' && stage.id === 'narration') needs.add('tts');
  if (stage.executor === 'stickman-image') needs.add('image');
  if (stage.executor === 'wechat-article' && stage.id === 'images') needs.add('image');

  if (needs.has('llm')) {
    if (config.llm.source === 'codex' && stage.executor === 'krillinai' && config.llm.apiKey.trim()) {
      add('ready', {
        id: 'llm',
        title: 'Text model',
        message: `Local Codex / ${config.llm.model || 'Runtime'} is enabled.`,
        executionMode: 'local'
      });
    } else {
      checkOpenAi(config.llm, 'llm', 'Text model', '#/settings?tab=ai-services&section=text', add);
    }
  }
  if (needs.has('tts')) {
    const gateway = gatewayCreatorBinding(config);
    if (gateway && (stage.executor === 'smart-dubbing' && typeof job.state.style === 'string' && job.state.style !== 'natural' && !gateway.capabilities?.speech?.includes('speech_instructions')
      || typeof job.state.speed === 'number' && job.state.speed !== 1 && !gateway.capabilities?.speech?.includes('speech_speed'))) {
      add('blocked', { id: 'tts-style-capability', title: 'Unsupported speech settings', message: 'Style and speed controls are not verified for this official speech model. Select another TTS service.', executionMode: 'remote' }, { label: 'Open speech settings', deepLink: '#/settings?tab=ai-services&section=tts' });
    }
    const provider = readTtsProvider(job, config);
    if (provider === 'edge-tts') add('ready', { id: 'tts', title: 'Speech service', message: 'Edge TTS does not require an API key.', executionMode: 'remote' });
    else checkTts(config, provider, add);
  }
  if (needs.has('image')) {
    const settings = resolveCreatorImageSettings({
      config,
      provider: gatewayCreatorBinding(config) ? 'openai' : job.state.provider,
      candidateCount: job.state.candidateCount,
      fallbackCandidateCount: job.templateId === 'image-generation' ? 2 : 1,
      maxCandidateCount: job.templateId === 'image-generation' ? 4 : 8
    });
    const { provider } = settings;
    if (provider === 'codex-native') {
      let status: CodexImageStatus | undefined;
      try { status = await readCodexImageStatus?.(); } catch { status = undefined; }
      add(status?.ready ? 'ready' : 'blocked', {
        id: 'image-provider', title: 'Local Codex image generation',
        message: status?.message ?? 'Could not check Codex image authentication and Runtime capabilities. Check local Codex sign-in and configuration.',
        executionMode: status?.executionMode === 'api' ? 'remote' : 'local'
      }, { label: 'Check image settings', deepLink: '#/settings?tab=ai-services&section=image' });
    } else if (imageProviderConfigured(config, provider)) {
      add('ready', {
        id: 'image-provider',
        title: 'Image service',
        message: `${provider} / ${settings.model} is configured.`,
        executionMode: settings.executionMode
      });
    } else {
      add('blocked', {
        id: 'image-provider', title: 'Image service configuration incomplete', message: `Configure the Base URL, model, and credentials for ${provider}.`, executionMode: settings.executionMode
      }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=image' });
    }
    const hasReference = stage.executor === 'stickman-image'
      || (stage.inputArtifacts.some(item => item.kind === 'reference_image')
        && typeof job.state.referenceImageArtifactId === 'string');
    const gateway = gatewayCreatorBinding(config);
    const supportsReference = gateway ? gateway.capabilities?.image?.includes('edit') === true : settings.supportsReferenceImage;
    if (gateway && stage.executor === 'stickman-image') {
      let multiple = inputArtifacts.some(artifact => artifact.kind === 'style_reference');
      const shotSpec = inputArtifacts.find(artifact => artifact.kind === 'shot_spec');
      if (shotSpec?.path) {
        try {
          const spec = stickmanShotSpecSchema.parse(JSON.parse(await readFile(shotSpec.path, 'utf8')));
          multiple ||= spec.shots.some(shouldUsePreviousShotReference);
        } catch {
          add('blocked', { id: 'shot-spec-invalid', title: 'Storyboard data unavailable', message: 'Could not check storyboard reference requirements. Generate the storyboard again.', executionMode: 'local' });
        }
      }
      if (multiple && settings.maxReferenceImages < 2) add('blocked', { id: 'reference-image-count', title: 'Unsupported number of reference images', message: 'This image model does not support the multiple references required by this task.', executionMode: 'remote' });
    }
    if (gateway?.capabilities?.image?.includes('reference_required') && !hasReference) add('blocked', {
      id: 'reference-image-required', title: 'Reference image missing', message: 'The selected image model requires a reference image.', executionMode: 'remote'
    }, { label: 'Upload a reference image', deepLink: `#/workbench?tool=${encodeURIComponent(job.templateId)}&jobId=${encodeURIComponent(job.id)}` });
    if (hasReference && !supportsReference) add('blocked', {
      id: 'reference-image-capability', title: 'Reference image capability mismatch', message: `${provider} does not support reference image editing for this stage.`, executionMode: 'remote'
    }, { label: 'Select a service that supports reference images', deepLink: '#/settings?tab=ai-services&section=image' });
  }
  if (needs.has('video')) {
    const gateway = gatewayCreatorBinding(config);
    if (gateway) {
      add(gateway.models.video ? 'ready' : 'blocked', { id: 'video-provider', title: 'Official video service', message: gateway.models.video ? `${gateway.models.video} is configured.` : 'The official service has no available video model', executionMode: 'remote' });
      if (job.artifacts.some(artifact => artifact.kind === 'reference_image' && artifact.status === 'completed') && !gateway.capabilities?.video?.includes('image_to_video')) add('blocked', { id:'reference-image-capability',title:'Reference image capability mismatch',message:'The official video model does not support reference images.',executionMode:'remote' });
    } else {
      const provider = readVideoProvider(job, config);
      const settings = config.video[provider];
      const hasKey = providerCredentials(settings, provider);
      if (!hasKey || !settings.model.trim() || !settings.baseUrl.trim()) add('blocked', {
        id: 'video-provider', title: 'Video service configuration incomplete', message: `Configure the Base URL, model, and credentials for ${provider}.`, executionMode: 'remote'
      }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=video' });
      else add('ready', { id: 'video-provider', title: 'Video service', message: `${provider} / ${settings.model} is configured.`, executionMode: 'remote' });
    }
  }
  if (stage.executor === 'krillinai' && stage.id === 'subtitle' && job.state.sourceType !== 'subtitle' && !hasImportedSubtitle(job)) {
    const choices = job.state.officialModels;
    const selectedModel = choices && typeof choices === 'object' && !Array.isArray(choices) && typeof choices.transcription === 'string' ? choices.transcription : undefined;
    const assessment = assessKrillinTranscription(config, typeof job.state.sourceLanguage === 'string' ? job.state.sourceLanguage : 'en', selectedModel);
    const languageExecutionMode = capabilities.transcription.providers.find(candidate => candidate.provider === assessment.provider)?.kind === 'local' ? 'local' : 'remote';
    const fallbackOnly = canTryPlatformCaptions(job);
    const repair = { label: 'Change speech recognition service or import source subtitles', deepLink: '#/settings?tab=ai-services&section=transcription' };
    if (assessment.support === 'unsupported') add(fallbackOnly ? 'warning' : 'blocked', {
      id: 'transcription-language', title: 'Speech recognition language unsupported',
      message: `${assessment.provider} / ${assessment.model} does not support ${assessment.productLanguage}.${fallbackOnly ? ' Platform subtitles can still be used; audio fallback is unavailable.' : ' Change the speech recognition service or import source subtitles.'}`, executionMode: languageExecutionMode
    }, repair);
    else if (assessment.support === 'unknown') add('warning', {
      id: 'transcription-language-unknown', title: 'Speech recognition language unverified',
      message: `Language coverage for ${assessment.provider} / ${assessment.model} is unverified. Confirm that the service supports ${assessment.productLanguage}.`, executionMode: languageExecutionMode
    }, repair);
    if (fallbackOnly) return;
    const gateway = gatewayCreatorBinding(config);
    if (gateway && assessment.capability.timestamps === 'none') add('blocked', {
      id: 'transcription-timestamps', title: 'Subtitle timestamps unavailable', message: 'This speech recognition model returns text without timestamps. Select a transcription service with subtitle timestamps.', executionMode: 'remote'
    }, { label: 'Open speech recognition settings', deepLink: '#/settings?tab=ai-services&section=transcription' });
    const provider = capabilities.transcription.providers.find(candidate => candidate.provider === config.transcription.provider);
    if (provider?.available !== true) return;
    if (config.transcription.provider === 'openai' && !config.transcription.openai.apiKey.trim()) {
      checkOpenAi(config.transcription.openai, 'transcription', 'Speech recognition', '#/settings?tab=ai-services&section=transcription', add);
    } else if (config.transcription.provider === 'aliyun' && (!config.transcription.aliyun.speech.accessKeyId.trim() || !config.transcription.aliyun.speech.accessKeySecret.trim() || !config.transcription.aliyun.speech.appKey.trim())) {
      add('blocked', { id: 'transcription-config', title: 'Speech recognition credentials missing', message: 'Complete the Aliyun speech recognition credentials.', executionMode: 'remote' }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else if (config.transcription.provider === 'funasr' && (!config.transcription.funasr.baseUrl.trim() || !config.transcription.funasr.model.trim())) {
      add('blocked', { id: 'transcription-config', title: 'Speech recognition configuration missing', message: 'Complete the FunASR Base URL and model.', executionMode: 'remote' }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else if (config.transcription.provider === 'volcengine' && !volcengineAsrCredentialsReady(config.transcription.volcengine)) {
      add('blocked', { id: 'transcription-config', title: 'Speech recognition credentials missing', message: 'Complete the Volcengine App ID and access token.', executionMode: 'remote' }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else add('ready', { id: 'transcription-config', title: 'Speech recognition', message: `${config.transcription.provider} is configured.`, executionMode: provider.kind === 'local' ? 'local' : 'remote' });
  }
}

function hasImportedSubtitle(job: CreatorJob): boolean {
  return job.artifacts.some(artifact => artifact.status === 'completed' && (
    artifact.kind === 'source_subtitle' && artifact.id === job.state.importedSourceSubtitleId
    || artifact.kind === 'target_subtitle' && artifact.id === job.state.importedTargetSubtitleId
  ));
}

function canTryPlatformCaptions(job: CreatorJob): boolean {
  return job.state.sourceType !== 'file' && job.state.preferPlatformCaptions !== false && isYouTubeSource(typeof job.state.sourceUrl === 'string' ? job.state.sourceUrl : undefined);
}

function checkOpenAi(
  value: { baseUrl: string; apiKey: string; model: string },
  id: string,
  title: string,
  deepLink: string,
  add: Parameters<typeof checkProviderConfig>[5]
) {
  if (!value.baseUrl.trim() || !value.model.trim() || !value.apiKey.trim()) add('blocked', { id, title: `${title} configuration incomplete`, message: `Complete the Base URL, model, and API key for ${title}.`, executionMode: 'remote' }, { label: 'Open AI service settings', deepLink });
  else add('ready', { id, title, message: `${value.model} is configured.`, executionMode: 'remote' });
}

function checkTts(config: CreatorServicesConfig, provider: Exclude<CreatorServicesConfig['tts']['provider'], 'edge-tts'>, add: Parameters<typeof checkProviderConfig>[5]) {
  const credentialsReady = provider === 'volcengine'
    ? volcengineTtsCredentialsReady(config.tts.volcengine)
    : Boolean(config.tts[provider].apiKey.trim());
  const value = config.tts[provider];
  if (!value.baseUrl.trim() || !value.model.trim() || !credentialsReady) add('blocked', { id: 'tts', title: 'Speech service configuration incomplete', message: `Complete the Base URL, model, and credentials for ${provider}.`, executionMode: 'remote' }, { label: 'Open AI service settings', deepLink: '#/settings?tab=ai-services&section=tts' });
  else add('ready', { id: 'tts', title: 'Speech service', message: `${provider} / ${value.model} is configured.`, executionMode: 'remote' });
}

async function checkInputs(
  stage: CreatorTemplateStage,
  artifacts: Array<CreatorJob['artifacts'][number]>,
  missing: string[],
  add: Parameters<typeof checkProviderConfig>[5]
): Promise<void> {
  for (const kind of missing) {
    add('blocked', { id: `input-artifact:${kind}`, title: 'Required input missing', message: `Generate ${kind} before starting ${stage.id}.`, executionMode: 'local' }, { label: 'Return to the previous step', deepLink: '#/settings?tab=diagnostics' });
  }
  for (const artifact of artifacts) {
    if (artifact.path === null) {
      add('blocked', { id: 'input-file', title: 'Input file unavailable', message: 'The selected input file is missing or unreadable.', executionMode: 'local' }, { label: 'Select the input file again', deepLink: '#/settings?tab=diagnostics' });
      continue;
    }
    try {
      await access(artifact.path, constants.R_OK);
      add('ready', { id: `input-file:${artifact.id}`, title: 'Input file', message: 'The input file exists and is readable.', executionMode: 'local' });
    } catch {
      add('blocked', { id: 'input-file', title: 'Input file unreadable', message: 'The selected input file is missing or unreadable.', executionMode: 'local' }, { label: 'Select the input file again', deepLink: '#/settings?tab=diagnostics' });
    }
  }
}

function readTtsProvider(job: CreatorJob, config: CreatorServicesConfig): CreatorServicesConfig['tts']['provider'] {
  if (gatewayCreatorBinding(config)) return 'openai';
  const value = job.state.ttsProvider;
  return value === 'openai' || value === 'aliyun' || value === 'edge-tts' || value === 'minimax' || value === 'volcengine' ? value : config.tts.provider;
}
function readVideoProvider(job: CreatorJob, config: CreatorServicesConfig): CreatorServicesConfig['video']['provider'] {
  const value = job.state.provider;
  return value === 'seedance' || value === 'kling' || value === 'veo' ? value : config.video.provider;
}
function executionMode(stage: CreatorTemplateStage, job: CreatorJob): CreatorPreflightExecutionMode {
  if (stage.executor === 'image' || stage.executor === 'video' || stage.executor === 'smart-dubbing' || stage.executor === 'stickman-image') return 'remote';
  if (
    stage.executor === 'cover-analysis'
    || (stage.executor === 'clip')
    || (stage.executor === 'stickman-content' && ['source-brief', 'content-plan', 'script', 'storyboard'].includes(stage.id))
    || (stage.executor === 'stickman-audio' && stage.id === 'narration')
  ) return 'mixed';
  if (stage.executor === 'krillinai' && job.state.sourceType !== 'file') return 'mixed';
  return 'local';
}

function providerCredentials(
  settings: { model: string; apiKey?: string; accessKey?: string; secretKey?: string },
  provider: 'openai' | 'jimeng' | 'kling' | 'gemini' | 'seedance' | 'veo'
): boolean {
  if (provider === 'kling') {
    return (settings.accessKey?.trim().length ?? 0) > 0
      && (settings.secretKey?.trim().length ?? 0) > 0;
  }
  return (settings.apiKey?.trim().length ?? 0) > 0;
}
