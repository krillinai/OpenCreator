import type {
  CreatorJob,
  CreatorPreflightCheck,
  CreatorPreflightExecutionMode,
  CreatorPreflightResponse,
  CreatorServicesCapabilitiesResponse,
  CreatorServicesConfig
} from '@opencreator/protocol';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { CreatorTemplateStage } from './templates/types.js';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { preflightKrillinDependencies } from './krillin/dependency-preflight.js';
import type { YtDlpRuntime } from './yt-dlp/runtime.js';
import { supportsReferenceImage } from './templates/cover-actions.js';
import { creatorResultSnapshotForVersion } from './result-snapshots.js';
import { resolveCreatorStageInputs } from './stage-runner.js';
import { readStickmanRemotionRuntime } from './stickman/remotion-runtime.js';

export type CreatorPreflight = ReturnType<typeof createCreatorPreflight>;

export type CreatorPreflightOptions = {
  inputResultVersion?: number;
};

export class CreatorPreflightError extends Error {
  constructor(readonly result: CreatorPreflightResponse) {
    super('Creator preflight blocked this stage');
    this.name = 'CreatorPreflightError';
  }

  get code(): string {
    const ids = new Set(this.result.blocked.map(item => item.id));
    const id = ids.has('llm') ? 'llm'
      : ids.has('tts') ? 'tts'
        : ids.has('image-provider') ? 'image-provider'
          : ids.has('video-provider') ? 'video-provider'
            : ids.has('reference-image-capability') ? 'reference-image-capability'
              : this.result.blocked[0]?.id;
    if (id === 'llm') return 'creator_llm_config_missing';
    if (id === 'tts') return 'creator_tts_config_missing';
    if (id === 'image-provider') return 'creator_image_config_missing';
    if (id === 'video-provider') return 'VIDEO_GENERATION_CONFIG_REQUIRED';
    if (id === 'reference-image-capability') return 'unsupported_capability';
    return 'creator_preflight_blocked';
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
  getYtDlpRuntime?(): YtDlpRuntime | undefined;
  executorIds?: Iterable<string>;
  validateRuntimeAssets?: boolean;
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

    const config = await input.configStore.read();
    checkProviderConfig(job, stage, config, input.readCapabilities(), add);
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
          if (input.stickmanRuntimeRoot === undefined) throw new Error('stickman_runtime_unavailable');
          readStickmanRemotionRuntime(input.stickmanRuntimeRoot);
          add('ready', { id: 'stickman-runtime', title: 'Stickman 渲染运行时', message: 'Remotion 运行资源校验通过。', executionMode: 'local' });
        } catch (error) {
          add('blocked', {
            id: 'stickman-runtime',
            title: 'Stickman 渲染运行时不可用',
            message: error instanceof Error ? error.message : 'Remotion 运行资源校验失败。',
            executionMode: 'local'
          }, { label: '打开运行组件设置', deepLink: '#/settings?tab=local-components' });
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
        preflightKrillinDependencies(input.resourceRoot, config);
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

function checkProviderConfig(
  job: CreatorJob,
  stage: CreatorTemplateStage,
  config: CreatorServicesConfig,
  capabilities: CreatorServicesCapabilitiesResponse,
  add: (status: 'ready' | 'warning' | 'blocked', item: Omit<CreatorPreflightCheck, 'executionMode'> & { executionMode?: CreatorPreflightExecutionMode }, repair?: CreatorPreflightCheck['repair']) => void
): void {
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

  if (needs.has('llm')) checkOpenAi(config.llm, 'llm', '文本模型', '#/settings?tab=ai-services&section=text', add);
  if (needs.has('tts')) {
    const provider = readTtsProvider(job, config);
    if (provider === 'edge-tts') add('ready', { id: 'tts', title: '配音服务', message: 'Edge TTS 不需要 API Key。', executionMode: 'remote' });
    else checkTts(config, provider, add);
  }
  if (needs.has('image')) {
    const provider = readImageProvider(job, config);
    const settings = config.image[provider];
    const hasKey = providerCredentials(settings, provider);
    if (!hasKey || !settings.model.trim() || !settings.baseUrl.trim()) add('blocked', {
      id: 'image-provider', title: '图像服务配置不完整', message: `请配置 ${provider} 的 Base URL、模型和凭据。`, executionMode: 'remote'
    }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=image' });
    else add('ready', { id: 'image-provider', title: '图像服务', message: `${provider} / ${settings.model} 已配置。`, executionMode: 'remote' });
    const hasReference = stage.executor === 'stickman-image'
      || (stage.inputArtifacts.some(item => item.kind === 'reference_image')
        && typeof job.state.referenceImageArtifactId === 'string');
    if (hasReference && !supportsReferenceImage(provider)) add('blocked', {
      id: 'reference-image-capability', title: '参考图能力不匹配', message: `${provider} 不支持当前阶段的参考图编辑。`, executionMode: 'remote'
    }, { label: '选择支持参考图的服务', deepLink: '#/settings?tab=ai-services&section=image' });
  }
  if (needs.has('video')) {
    const provider = readVideoProvider(job, config);
    const settings = config.video[provider];
    const hasKey = providerCredentials(settings, provider);
    if (!hasKey || !settings.model.trim() || !settings.baseUrl.trim()) add('blocked', {
      id: 'video-provider', title: '视频服务配置不完整', message: `请配置 ${provider} 的 Base URL、模型和凭据。`, executionMode: 'remote'
    }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=video' });
    else add('ready', { id: 'video-provider', title: '视频服务', message: `${provider} / ${settings.model} 已配置。`, executionMode: 'remote' });
  }
  if (stage.executor === 'krillinai' && stage.id === 'subtitle' && (job.state.sourceType === 'file' || job.state.preferPlatformCaptions === false)) {
    const provider = capabilities.transcription.providers.find(candidate => candidate.provider === config.transcription.provider);
    if (provider?.available !== true) return;
    if (config.transcription.provider === 'openai' && !config.transcription.openai.apiKey.trim()) {
      checkOpenAi(config.transcription.openai, 'transcription', '语音识别', '#/settings?tab=ai-services&section=transcription', add);
    } else if (config.transcription.provider === 'aliyun' && (!config.transcription.aliyun.speech.accessKeyId.trim() || !config.transcription.aliyun.speech.accessKeySecret.trim() || !config.transcription.aliyun.speech.appKey.trim())) {
      add('blocked', { id: 'transcription-config', title: '语音识别凭据缺失', message: '请补全阿里云语音识别凭据。', executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=transcription' });
    } else add('ready', { id: 'transcription-config', title: '语音识别', message: `${config.transcription.provider} 已配置。`, executionMode: provider.kind === 'local' ? 'local' : 'remote' });
  }
}

function checkOpenAi(
  value: { baseUrl: string; apiKey: string; model: string },
  id: string,
  title: string,
  deepLink: string,
  add: Parameters<typeof checkProviderConfig>[4]
) {
  if (!value.baseUrl.trim() || !value.model.trim() || !value.apiKey.trim()) add('blocked', { id, title: `${title}配置不完整`, message: `请补全 ${title} 的 Base URL、模型和 API Key。`, executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink });
  else add('ready', { id, title, message: `${value.model} 已配置。`, executionMode: 'remote' });
}

function checkTts(config: CreatorServicesConfig, provider: Exclude<CreatorServicesConfig['tts']['provider'], 'edge-tts'>, add: Parameters<typeof checkProviderConfig>[4]) {
  const value = config.tts[provider];
  if (!value.baseUrl.trim() || !value.model.trim() || !value.apiKey.trim()) add('blocked', { id: 'tts', title: '配音服务配置不完整', message: `请补全 ${provider} 的 Base URL、模型和 API Key。`, executionMode: 'remote' }, { label: '打开 AI 服务设置', deepLink: '#/settings?tab=ai-services&section=tts' });
  else add('ready', { id: 'tts', title: '配音服务', message: `${provider} / ${value.model} 已配置。`, executionMode: 'remote' });
}

async function checkInputs(
  stage: CreatorTemplateStage,
  artifacts: Array<CreatorJob['artifacts'][number]>,
  missing: string[],
  add: Parameters<typeof checkProviderConfig>[4]
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
  const value = job.state.ttsProvider;
  return value === 'openai' || value === 'aliyun' || value === 'edge-tts' || value === 'minimax' ? value : config.tts.provider;
}
function readImageProvider(job: CreatorJob, config: CreatorServicesConfig): CreatorServicesConfig['image']['provider'] {
  const value = job.state.provider;
  return value === 'openai' || value === 'jimeng' || value === 'kling' || value === 'gemini' ? value : config.image.provider;
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
