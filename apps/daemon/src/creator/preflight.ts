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
import { creatorPreflightFailure, imagePromptRequiresReference } from '@opencreator/protocol';
import { access, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { CreatorTemplateStage } from './templates/types.js';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { preflightKrillinDependencies } from './krillin/dependency-preflight.js';
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
      else blocked.push({ ...value, repair: repair ?? { label: '打开设置', deepLink: '#/settings?tab=diagnostics' } });
    };

    if (executorIds.size > 0 && !executorIds.has(stage.executor)) {
      add('blocked', {
        id: 'executor',
        title: '执行器不可用',
        message: `当前 Runtime 未加载 ${stage.executor} 执行器。`,
        executionMode: mode
      }, { label: '打开诊断', deepLink: '#/settings?tab=diagnostics' });
    } else {
      add('ready', { id: 'executor', title: '执行器', message: `${stage.executor} 已加载`, executionMode: mode });
    }

    try { input.assertServiceSource?.(job.id); } catch {
      add('blocked', { id: 'service-source', title: '任务服务来源不匹配', message: '请恢复原任务账户和服务来源后继续。', executionMode: 'remote' }, { label: '打开账户设置', deepLink: '#/settings?tab=ai-services' });
      return { templateId: job.templateId, templateVersion: job.templateVersion, stageId: stage.id, executionMode: mode, canStart: false, ready, warning, blocked, checkedAt: new Date().toISOString() };
    }
    const config = await input.configStore.read();
    const inputSnapshot = options.inputResultVersion === undefined
      ? undefined
      : creatorResultSnapshotForVersion(job, options.inputResultVersion);
    if (options.inputResultVersion !== undefined && inputSnapshot === undefined) {
      add('blocked', {
        id: 'input-result-version',
        title: '结果版本不存在',
        message: `找不到结果版本 ${options.inputResultVersion}，无法安全复用历史输入。`,
        executionMode: 'local'
      }, { label: '打开诊断', deepLink: '#/settings?tab=diagnostics' });
    }
    const inputState = inputSnapshot?.state ?? job.state;
    if (stage.resultVersionPolicy === 'attach' && inputSnapshot === undefined) {
      add('blocked', { id: 'input-result-version', title: '请先选择项目版本', message: '准备预览视频需要明确的已保存项目版本。', executionMode: 'local' });
    }
    if (job.templateId === 'video-translation' && (stage.id === 'subtitle' || stage.id === 'prepare-source-video' || stage.id === 'preview-source-video')) {
      try {
        await validateBilibiliSource({ ...job, state: inputState }, input.videoMetadataService);
      } catch (error) {
        add('blocked', {
          id: 'bilibili-part', title: '请确认 B 站分集',
          message: error instanceof Error ? error.message : '无法确认 B 站分集，请重新选择视频来源。',
          executionMode: 'remote'
        }, { label: '选择视频分集', deepLink: `#/workbench?tool=video-translation&jobId=${encodeURIComponent(job.id)}` });
      }
    }
    if (inputState.sourceType === 'file' && stage.executor === 'krillinai' && typeof inputState.sourceArtifactId !== 'string') {
      add('blocked', {
        id: 'input-file',
        title: '输入文件缺失',
        message: '请选择要处理的本地视频文件。',
        executionMode: 'local'
      }, { label: '选择输入文件', deepLink: '#/settings?tab=diagnostics' });
    }
    const resolvedInputs = resolveCreatorStageInputs(
      job,
      stage.inputArtifacts,
      inputSnapshot?.artifactRefs,
      inputSnapshot?.state
    );
    await checkProviderConfig(job, stage, config, resolvedInputs.artifacts, input.readCapabilities(), add, input.readCodexImageStatus);
    if (job.templateId === 'image-generation' && stage.id === 'generate'
      && typeof inputState.prompt === 'string' && imagePromptRequiresReference(inputState.prompt)
      && !resolvedInputs.artifacts.some(artifact => artifact.kind === 'reference_image'
        && artifact.status === 'completed' && artifact.path !== null)) {
      add('blocked', {
        id: 'reference-image-required', title: '缺少参考图',
        message: '当前提示词需要基于已有图片生成，请先上传参考图；如需纯文字生图，请移除对上传图片或原图的要求。',
        executionMode: 'local'
      }, { label: '上传参考图', deepLink: `#/workbench?tool=image-generation&jobId=${encodeURIComponent(job.id)}` });
    }
    await checkInputs(stage, resolvedInputs.artifacts, resolvedInputs.missing, add);
    await checkRuntimeDependencies(job, stage, config, add);
    await checkManagedDirectory(add);

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
      add('ready', { id: 'managed-directory', title: '受管目录', message: '任务目录可写。', executionMode: 'local' });
    } catch {
      add('blocked', {
        id: 'managed-directory',
        title: '受管目录不可写',
        message: 'OpenCreator 无法写入任务目录，无法安全保存 Artifact。',
        executionMode: 'local'
      }, { label: '打开诊断', deepLink: '#/settings?tab=diagnostics' });
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
          title: 'KrillinAI Runtime 不可用',
          message: error instanceof Error ? error.message : 'KrillinAI Runtime 校验失败。',
          executionMode: 'local'
        }, { label: '打开运行组件设置', deepLink: '#/settings?tab=local-components' });
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
          title: `${label} 不可用`,
          message: `当前 Runtime 未找到 ${label}，该阶段无法执行。`,
          executionMode: 'local'
        }, { label: '打开运行组件设置', deepLink: '#/settings?tab=local-components' });
        else add('ready', { id, title: label, message: `${label} 已就绪。`, executionMode: 'local' });
      }
      if (stage.executor === 'stickman-delivery' && input.ffmpegPath === undefined) {
        add('warning', { id: 'ffmpeg', title: 'FFmpeg 不可用', message: '交付校验将跳过视频帧采样。', executionMode: 'local' });
      }
      if (stage.executor === 'stickman-remotion') {
        try {
          if (input.remotionComponent) {
            const component = await input.remotionComponent.status();
            if (!component.available) throw new Error(component.error ?? 'remotion_component_unavailable');
            add(component.state === 'ready' ? 'ready' : 'warning', {
              id: 'stickman-runtime', title: 'Remotion 渲染组件',
              message: component.state === 'ready' ? 'Remotion 渲染组件已就绪。' : '执行渲染时将按需准备 Remotion 组件，完成后自动继续。', executionMode: 'local'
            });
          } else {
            if (input.stickmanRuntimeRoot === undefined) throw new Error('stickman_runtime_unavailable');
            readStickmanRemotionRuntime(input.stickmanRuntimeRoot);
            add('ready', { id: 'stickman-runtime', title: 'Stickman 渲染运行时', message: 'Remotion 运行资源校验通过。', executionMode: 'local' });
          }
        } catch (error) {
          add('blocked', {
            id: 'stickman-runtime',
            title: 'Stickman 渲染运行时不可用',
            message: error instanceof Error ? error.message : 'Remotion 运行资源校验失败。',
            executionMode: 'local'
          }, { label: '打开运行组件设置', deepLink: '#/settings?tab=local-components&component=remotion' });
        }
      }
    }
    if (input.validateRuntimeAssets !== false && (stage.executor === 'download' || stage.executor === 'cover-analysis' || (stage.executor === 'krillinai' && job.state.sourceType !== 'file'))) {
      let runtime: YtDlpRuntime | undefined;
      try { runtime = input.getYtDlpRuntime?.(); } catch { runtime = undefined; }
      if (runtime === undefined) add('blocked', {
        id: 'yt-dlp',
        title: 'yt-dlp 不可用',
        message: '当前 Runtime 未找到 yt-dlp，无法处理远程媒体。',
        executionMode: 'local'
      }, { label: '打开运行组件设置', deepLink: '#/settings?tab=local-components' });
      else add('ready', { id: 'yt-dlp', title: 'yt-dlp', message: `已就绪（${runtime.version}）。`, executionMode: 'local' });
    }
    if (input.validateRuntimeAssets !== false && stage.executor === 'krillinai') {
      try {
        preflightKrillinDependencies(input.resourceRoot, config, {
          cachePath: input.runtimeVerificationCachePath
        });
        add('ready', { id: 'krillin-runtime', title: 'KrillinAI Runtime', message: '运行资源校验通过。', executionMode: 'local' });
      } catch (error) {
        add('blocked', {
          id: 'krillin-runtime',
          title: 'KrillinAI Runtime 不完整',
          message: error instanceof Error ? error.message : 'KrillinAI 运行资源校验失败。',
          executionMode: 'local'
        }, { label: '打开运行组件设置', deepLink: '#/settings?tab=local-components' });
      }
    }
    if (stage.executor === 'krillinai' && (job.state.sourceType === 'file' || job.state.preferPlatformCaptions === false) && ['whisper.cpp', 'whisperkit', 'faster-whisper'].includes(config.transcription.provider)) {
      const provider = input.readCapabilities().transcription.providers.find(candidate => candidate.provider === config.transcription.provider);
      if (provider?.available !== true) add('blocked', {
        id: 'transcription-capability',
        title: '语音识别能力不可用',
        message: `${config.transcription.provider} 在当前 Runtime 不可用。`,
        executionMode: 'local'
      }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=transcription' });
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
        title: '文本模型',
        message: `本机 Codex / ${config.llm.model || 'Runtime'} 已启用。`,
        executionMode: 'local'
      });
    } else {
      checkOpenAi(config.llm, 'llm', '文本模型', '#/settings?tab=ai-services&section=text', add);
    }
  }
  if (needs.has('tts')) {
    const gateway = gatewayCreatorBinding(config);
    if (gateway && (stage.executor === 'smart-dubbing' || (typeof job.state.speed === 'number' && job.state.speed !== 1))) {
      add('blocked', { id: 'tts-style-capability', title: '配音参数不受支持', message: '当前官方语音模型未提供已验证的样式或语速控制，请选择其他配音服务。', executionMode: 'remote' }, { label: '打开配音设置', deepLink: '#/settings?tab=ai-services&section=tts' });
    }
    const provider = readTtsProvider(job, config);
    if (provider === 'edge-tts') add('ready', { id: 'tts', title: '配音服务', message: 'Edge TTS 不需要 API Key。', executionMode: 'remote' });
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
        id: 'image-provider', title: '本机 Codex 生图',
        message: status?.message ?? '无法检查 Codex 生图认证和 Runtime 能力，请检查本机 Codex 登录和配置。',
        executionMode: status?.executionMode === 'api' ? 'remote' : 'local'
      }, { label: '检查生图设置', deepLink: '#/settings?tab=ai-services&section=image' });
    } else if (imageProviderConfigured(config, provider)) {
      add('ready', {
        id: 'image-provider',
        title: '图像服务',
        message: `${provider} / ${settings.model} 已配置。`,
        executionMode: settings.executionMode
      });
    } else {
      add('blocked', {
        id: 'image-provider', title: '图像服务配置不完整', message: `请配置 ${provider} 的 Base URL、模型和凭据。`, executionMode: settings.executionMode
      }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=image' });
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
          add('blocked', { id: 'shot-spec-invalid', title: '分镜数据不可用', message: '无法检查分镜的参考图要求，请重新生成分镜。', executionMode: 'local' });
        }
      }
      if (multiple) add('blocked', { id: 'reference-image-count', title: '参考图数量不支持', message: '当前官方图像服务仅验证了 1 张参考图，此任务需要多张参考图。', executionMode: 'remote' });
    }
    if (hasReference && !supportsReference) add('blocked', {
      id: 'reference-image-capability', title: '参考图能力不匹配', message: `${provider} 不支持当前阶段的参考图编辑。`, executionMode: 'remote'
    }, { label: '选择支持参考图的服务', deepLink: '#/settings?tab=ai-services&section=image' });
  }
  if (needs.has('video')) {
    const gateway = gatewayCreatorBinding(config);
    if (gateway) {
      add(gateway.models.video ? 'ready' : 'blocked', { id: 'video-provider', title: '官方视频服务', message: gateway.models.video ? `${gateway.models.video} 已配置。` : '当前官方服务没有可用的视频模型', executionMode: 'remote' });
      if (job.artifacts.some(artifact => artifact.kind === 'reference_image' && artifact.status === 'completed') && !gateway.capabilities?.video?.includes('image_to_video')) add('blocked', { id:'reference-image-capability',title:'参考图能力不匹配',message:'当前官方视频模型不支持参考图。',executionMode:'remote' });
    } else {
      const provider = readVideoProvider(job, config);
      const settings = config.video[provider];
      const hasKey = providerCredentials(settings, provider);
      if (!hasKey || !settings.model.trim() || !settings.baseUrl.trim()) add('blocked', {
        id: 'video-provider', title: '视频服务配置不完整', message: `请配置 ${provider} 的 Base URL、模型和凭据。`, executionMode: 'remote'
      }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=video' });
      else add('ready', { id: 'video-provider', title: '视频服务', message: `${provider} / ${settings.model} 已配置。`, executionMode: 'remote' });
    }
  }
  if (stage.executor === 'krillinai' && stage.id === 'subtitle' && (job.state.sourceType === 'file' || job.state.preferPlatformCaptions === false)) {
    const provider = capabilities.transcription.providers.find(candidate => candidate.provider === config.transcription.provider);
    if (provider?.available !== true) return;
    if (config.transcription.provider === 'openai' && !config.transcription.openai.apiKey.trim()) {
      checkOpenAi(config.transcription.openai, 'transcription', '语音识别', '#/settings?tab=ai-services&section=transcription', add);
    } else if (config.transcription.provider === 'aliyun' && (!config.transcription.aliyun.speech.accessKeyId.trim() || !config.transcription.aliyun.speech.accessKeySecret.trim() || !config.transcription.aliyun.speech.appKey.trim())) {
      add('blocked', { id: 'transcription-config', title: '语音识别凭据缺失', message: '请补全阿里云语音识别凭据。', executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else if (config.transcription.provider === 'funasr' && (!config.transcription.funasr.baseUrl.trim() || !config.transcription.funasr.model.trim())) {
      add('blocked', { id: 'transcription-config', title: '语音识别配置缺失', message: '请补全 FunASR Base URL 和模型。', executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else if (config.transcription.provider === 'volcengine' && (!config.transcription.volcengine.appId.trim() || !config.transcription.volcengine.accessToken.trim())) {
      add('blocked', { id: 'transcription-config', title: '语音识别凭据缺失', message: '请补全火山引擎 App ID 和 Access Token。', executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else add('ready', { id: 'transcription-config', title: '语音识别', message: `${config.transcription.provider} 已配置。`, executionMode: provider.kind === 'local' ? 'local' : 'remote' });
  }
}

function checkOpenAi(
  value: { baseUrl: string; apiKey: string; model: string },
  id: string,
  title: string,
  deepLink: string,
  add: Parameters<typeof checkProviderConfig>[5]
) {
  if (!value.baseUrl.trim() || !value.model.trim() || !value.apiKey.trim()) add('blocked', { id, title: `${title}配置不完整`, message: `请补全 ${title} 的 Base URL、模型和 API Key。`, executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink });
  else add('ready', { id, title, message: `${value.model} 已配置。`, executionMode: 'remote' });
}

function checkTts(config: CreatorServicesConfig, provider: Exclude<CreatorServicesConfig['tts']['provider'], 'edge-tts'>, add: Parameters<typeof checkProviderConfig>[5]) {
  const credentialsReady = provider === 'volcengine'
    ? Boolean(config.tts.volcengine.appId.trim() && config.tts.volcengine.accessToken.trim())
    : Boolean(config.tts[provider].apiKey.trim());
  const value = config.tts[provider];
  if (!value.baseUrl.trim() || !value.model.trim() || !credentialsReady) add('blocked', { id: 'tts', title: '配音服务配置不完整', message: `请补全 ${provider} 的 Base URL、模型和凭据。`, executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=tts' });
  else add('ready', { id: 'tts', title: '配音服务', message: `${provider} / ${value.model} 已配置。`, executionMode: 'remote' });
}

async function checkInputs(
  stage: CreatorTemplateStage,
  artifacts: Array<CreatorJob['artifacts'][number]>,
  missing: string[],
  add: Parameters<typeof checkProviderConfig>[5]
): Promise<void> {
  for (const kind of missing) {
    add('blocked', { id: `input-artifact:${kind}`, title: '前置产物缺失', message: `请先生成 ${kind}，再启动 ${stage.id}。`, executionMode: 'local' }, { label: '返回上一步', deepLink: '#/settings?tab=diagnostics' });
  }
  for (const artifact of artifacts) {
    if (artifact.path === null) {
      add('blocked', { id: 'input-file', title: '输入文件不可用', message: '所选输入文件不存在或不可读。', executionMode: 'local' }, { label: '重新选择输入文件', deepLink: '#/settings?tab=diagnostics' });
      continue;
    }
    try {
      await access(artifact.path, constants.R_OK);
      add('ready', { id: `input-file:${artifact.id}`, title: '输入文件', message: '输入文件存在且可读。', executionMode: 'local' });
    } catch {
      add('blocked', { id: 'input-file', title: '输入文件不可读', message: '所选输入文件不存在或不可读。', executionMode: 'local' }, { label: '重新选择输入文件', deepLink: '#/settings?tab=diagnostics' });
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
