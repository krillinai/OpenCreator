import { copyFile, link, mkdir, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CreatorJson,
  CreatorServicesConfig
} from '@opencreator/protocol';
import { gatewayModelIdMatches, gatewayTranslationFlashModel, normalizeSubtitleRenderCues, type SubtitleRenderCueInput } from '@opencreator/protocol';
import type { CreatorExecutorInput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { sha256CreatorFile } from '../file-hash.js';
import { publicErrorKindForCode, sanitizePublicErrorFacts, type PublicErrorFacts } from '@opencreator/protocol';
import { spawnCreatorProcess } from '../process-tree.js';
import { createKrillinConfigToml } from './config-bridge.js';
import { gatewayCreatorBinding } from '../../gateway/creator-service-source.js';
import { isYouTubeSource } from './execution-plan.js';
import {
  resolveInside,
  type KrillinRuntimeManifest
} from './manifest.js';
import { normalizeSimplifiedChineseSubtitleOutputs } from './subtitle-script.js';
import type { YtDlpRuntime } from '../yt-dlp/runtime.js';

export type MaterializedKrillinArtifact = {
  id: string;
  kind: string;
  path: string;
};

export type KrillinResultArtifact = {
  id: string;
  kind: string;
  relativePath: string;
  mimeType?: string;
  size?: number;
  sha256?: string;
  metadata?: Record<string, CreatorJson>;
};

type KrillinCliResponse = {
  ok?: boolean;
  stage?: string;
  task_id?: string;
  outputs?: Record<string, string>;
  warnings?: string[];
  subtitle_quality?: {
    status: 'qualified' | 'degraded' | 'failed';
    approximate_layouts: number;
    degraded_segmentation_units: number;
    semantic_pending: number;
    unresolved_errors?: number;
    overflow_cues?: number;
    timing_fallback?: boolean;
    issues?: Array<{ sentence_id: string; cue?: number; output_cue?: number; timestamp?: string;
      type: string; severity: string; source_evidence?: string; target_evidence?: string; reason: string }>;
  };
  translation_failures?: Array<{ sentence_id: string; source_text: string; reason: string }>;
  error?: {
    kind?: string;
    code?: string;
    message?: string;
    retryable?: boolean;
  };
};

export type KrillinCliProgressFrame = {
  type: 'progress';
  phase?: string;
  percent: number;
  message?: string;
  completed?: number;
  total?: number;
};

type RunProcess = (input: {
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
}) => Promise<void>;

export class KrillinCliError extends Error {
  readonly publicFacts: PublicErrorFacts;
  constructor(
    readonly code: string,
    message: string,
    readonly kind?: string,
    readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'KrillinCliError';
    const douyinFailure = /^prepare_(?:media|audio_fallback)_failed$/.test(code) && /\[Douyin(?:\+[^\]]+)?\]/i.test(message);
    const signatureRequired = douyinFailure && /Douyin request signature is required/i.test(message);
    const sessionRequired = douyinFailure && /fresh cookies|Douyin browser identity was rejected/i.test(message);
    const status = sessionRequired || signatureRequired ? /http error\s+(\d{3})\b/i.exec(message) : null;
    const outputRejected = /\bstatus code:\s*400\b/i.test(message)
      && /Requested output exceeds the gateway limit of \d+ tokens/.test(message);
    this.publicFacts = sanitizePublicErrorFacts({
      kind: outputRejected ? 'http-rejected' : signatureRequired ? 'unsupported' : sessionRequired ? 'unauthorized' : /^prepare_(?:media|audio_fallback)_failed$/.test(code)
        && /bilibili risk control (?:rejected the media request|blocked media extraction)/i.test(message)
        ? 'http-rejected' : publicErrorKindForCode(code) ?? 'unknown', provider: 'krillinai',
      upstreamCode: outputRejected ? 'output_too_large' : code, upstreamMessage: message,
      ...(outputRejected ? { httpStatus: 400 } : status === null ? {} : { httpStatus: Number(status[1]) })
    });
  }
}

type RunKrillinCliInput = {
  resourceRoot: string;
  jobsRoot: string;
  dependencyRoot: string;
  manifest: KrillinRuntimeManifest;
  stage: CreatorExecutorInput;
  config: CreatorServicesConfig;
  artifacts: MaterializedKrillinArtifact[];
  source?: string;
  options: Record<string, unknown>;
  ytDlpRuntime?: YtDlpRuntime;
  llmOverride?: { baseUrl: string; apiKey: string; model: string };
};

export async function runKrillinCli(input: RunKrillinCliInput): Promise<KrillinResultArtifact[]> {
  const cli = input.manifest.resources.find(resource => (
    resource.kind === 'executable'
    && /(?:^|\/)krillinai-cli(?:\.exe)?$/i.test(resource.path)
  ));
  if (cli === undefined) throw new CreatorExecutorError('dependency_not_packaged', 'Missing KrillinAI CLI');

  const runtimeBin = resolve(input.resourceRoot, 'bin');
  const launcherRoot = join(input.stage.workdir, '.krillin-cli');
  const configDir = join(launcherRoot, 'config');
  const dependencyBin = join(input.dependencyRoot, 'bin');
  await rm(launcherRoot, { recursive: true, force: true });
  await mkdir(configDir, { recursive: true });
  const cliResourceRoot = await prepareCliResourceRoot({
    resourceRoot: input.resourceRoot,
    dependencyRoot: input.dependencyRoot,
    launcherRoot,
    onDemandTranscriptionProvider: isOnDemandTranscriptionProvider(
      input.config.transcription.provider
    ) ? input.config.transcription.provider : undefined,
    onDemandTranscriptionModel: input.config.transcription.provider === 'whisper.cpp'
      ? input.config.transcription.whisperCpp.model
      : undefined,
    ytDlpRuntime: input.ytDlpRuntime
  });
  const cliConfig = stageConfig(input.config, krillinCliStageId(input.stage.stageRun.stageId), input.options);
  const officialBinding = gatewayCreatorBinding(input.config);
  const officialTextModel = officialBinding?.catalog?.find(model => (
    model.modality === 'text' && gatewayModelIdMatches(model.id, cliConfig.llm.model)
  ));
  const flash = input.stage.job.templateId === 'video-translation'
    && krillinCliStageId(input.stage.stageRun.stageId) === 'subtitle'
    ? gatewayTranslationFlashModel(officialBinding?.catalog ?? []) : undefined;
  const llmFallback = officialBinding && flash && !gatewayModelIdMatches(flash.id, cliConfig.llm.model) ? {
    baseUrl: officialBinding.baseUrl, apiKey: officialBinding.apiKey,
    model: flash.id, modelName: flash.name ?? flash.id
  } : undefined;
  await writeFile(
    join(configDir, 'config.toml'),
    createKrillinConfigToml(cliConfig, input.llmOverride, officialBinding?.models.transcription,
      officialTextModel?.name === undefined ? undefined : { id: cliConfig.llm.model, name: officialTextModel.name }, llmFallback),
    { mode: 0o600 }
  );
  await writeFile(join(dependencyBin, '.yt-dlp-last-check'), new Date().toISOString(), { mode: 0o600 });

  const style = input.options.subtitleStyle;
  const stylePath = style === undefined ? undefined : join(configDir, 'subtitle-style.json');
  if (stylePath !== undefined) {
    await writeFile(stylePath, `${JSON.stringify(style, null, 2)}\n`, { mode: 0o600 });
  }
  if (krillinCliStageId(input.stage.stageRun.stageId) !== 'subtitle') {
    await writeInitialManifest(input.stage, input.options);
  }
  if (input.stage.stageRun.stageId === 'tts') {
    const targetSubtitle = input.artifacts.find(artifact => artifact.kind === 'target_subtitle');
    if (targetSubtitle !== undefined) {
      await copyFile(targetSubtitle.path, join(input.stage.workdir, 'target_language_srt.srt'));
    }
    const sourceSubtitle = input.artifacts.find(artifact => artifact.kind === 'source_subtitle');
    if (sourceSubtitle !== undefined) {
      await copyFile(sourceSubtitle.path, join(input.stage.workdir, 'origin_language_srt.srt'));
    }
  }

  const args = buildKrillinCliCommandArguments(
    input.stage,
    input.artifacts,
    input.options,
    stylePath,
    input.source
  );
  if (args[0] === 'render-horizontal' || args[0] === 'render-vertical') {
    const kind = args[0] === 'render-vertical' && !booleanOption(input.options, 'dubbed', false)
      ? 'vertical_subtitle' : 'target_subtitle';
    const source = input.stage.inputArtifacts.find(artifact => artifact.kind === kind)
      ?? input.stage.inputArtifacts.find(artifact => artifact.kind === 'target_subtitle');
    const readCues = (artifact: typeof source): SubtitleRenderCueInput[] => {
      const value = artifact?.metadata.renderCues ?? artifact?.metadata.cues;
      if (!Array.isArray(value)) return [];
      return value.flatMap(cue => cue && typeof cue === 'object' && !Array.isArray(cue)
        && typeof cue.start === 'string' && typeof cue.end === 'string' && typeof cue.text === 'string'
        ? [{ start: cue.start, end: cue.end, text: cue.text, ...(typeof cue.sourceText === 'string' ? { sourceText: cue.sourceText } : {}) }] : []);
    };
    let cues = readCues(source);
    const target = input.stage.inputArtifacts.find(artifact => artifact.kind === 'target_subtitle');
    if (source?.kind === 'target_subtitle') {
      const originals = readCues(input.stage.inputArtifacts.find(artifact => artifact.kind === 'source_subtitle'));
      cues = cues.map((cue, index) => ({ ...cue, sourceText: cue.sourceText ?? originals[index]?.text }));
    }
    if (cues.length > 0) {
      const snapshot = source?.metadata.settingsSnapshot;
      const position = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && snapshot.subtitlePosition === 'bottom' ? 'bottom' : 'top';
      const sourceVideo = input.stage.inputArtifacts.find(artifact => artifact.kind === 'source_video');
      const horizontal = args[0] === 'render-horizontal';
      const width = typeof sourceVideo?.metadata.width === 'number' && Number.isInteger(sourceVideo.metadata.width) && sourceVideo.metadata.width >= 32
        ? sourceVideo.metadata.width : horizontal ? 1920 : 1080;
      const height = typeof sourceVideo?.metadata.height === 'number' && Number.isInteger(sourceVideo.metadata.height) && sourceVideo.metadata.height >= 32
        ? sourceVideo.metadata.height : horizontal ? 1080 : 1920;
      const documentPath = join(configDir, 'subtitle-document.json');
      await writeFile(documentPath, JSON.stringify({
        width, height, horizontal,
        bilingual: booleanOption(input.options, 'bilingual', false), subtitlePosition: booleanOption(input.options, 'bilingualTop', true) ? 'top' : 'bottom',
        majorTitle: args[0] === 'render-vertical' ? stringOption(input.options, 'verticalTitle') : undefined,
        minorTitle: args[0] === 'render-vertical' ? stringOption(input.options, 'verticalSubtitle') : undefined,
        cues: normalizeSubtitleRenderCues({ cues, legacyMixed: source?.kind === 'vertical_subtitle' && !Array.isArray(source.metadata.renderCues),
          targetPosition: position, targetCues: readCues(target) })
      }), { mode: 0o600 });
      args.push('--subtitle-document', documentPath);
    }
  }
  input.stage.reportProgress({
    krillinMode: 'cli',
    providerStatus: 'running',
    percent: args[0] === 'subtitle' ? 1 : 5
  });
  try {
    let response: KrillinCliResponse;
    try {
      response = await executeCli({
        executable: resolveInside(input.resourceRoot, cli.path),
        args,
        cwd: launcherRoot,
        runtimeBin,
        resourceRoot: cliResourceRoot,
        dependencyBin,
        ytDlpRuntime: input.ytDlpRuntime,
        nlpPython: resolveKrillinNlpPython(input.resourceRoot, input.manifest),
        reportProgress: progress => input.stage.reportProgress(progress),
        signal: input.stage.signal
      });
    } catch (error) {
      const recovered = await recoverWindowsHorizontalAssRender({
        platform: process.platform,
        resourceRoot: input.resourceRoot,
        manifest: input.manifest,
        stageId: input.stage.stageRun.stageId,
        workdir: input.stage.workdir,
        artifacts: input.artifacts,
        signal: input.stage.signal,
        error,
        reportProgress: progress => input.stage.reportProgress(progress)
      });
      if (recovered === undefined) throw error;
      response = recovered;
    }
    const artifacts = await collectArtifacts(input, response);
    const translationReport = args[0] === 'subtitle' ? krillinTranslationReport(response) : {};
    input.stage.reportProgress({
      krillinMode: 'cli',
      providerStatus: 'succeeded',
      percent: 100,
      phase: 'completed',
      ...translationReport,
      ...(translationReport.translationStatus === 'partial'
        ? { message: `Translation finished with ${translationReport.translationFailedCount} untranslated items` }
        : translationReport.translationStatus === 'degraded'
        ? { message: 'Translation finished with automatic quality checks pending review' }
        : translationReport.translationStatus === 'layout_pending'
        ? { message: 'Translation finished; some subtitle layouts need adjustment' }
        : {}),
      completedOutputKinds: artifacts.map(artifact => artifact.kind)
    });
    return artifacts;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'KrillinAI CLI failed';
    input.stage.reportProgress({
      krillinMode: 'cli',
      providerStatus: 'failed',
      phase: 'failed',
      krillinEventPayload: {
        phase: 'failed',
        message
      }
    });
    throw error;
  } finally {
    await removeLauncherRootBestEffort(launcherRoot);
  }
}

function stageConfig(
  source: CreatorServicesConfig,
  stageId: string,
  options: Record<string, unknown>
): CreatorServicesConfig {
  if (stageId !== 'tts') return source;
  const provider = stringOption(options, 'ttsProvider');
  if (
    provider !== 'openai'
    && provider !== 'aliyun'
    && provider !== 'minimax'
    && provider !== 'edge-tts'
    && provider !== 'volcengine'
  ) return source;
  const config = structuredClone(source);
  config.tts.provider = provider;
  if (provider !== 'edge-tts') {
    const model = stringOption(options, 'ttsModel');
    if (model) config.tts[provider].model = model;
  }
  return config;
}

export function buildKrillinCliCommandArguments(
  stage: CreatorExecutorInput,
  artifacts: MaterializedKrillinArtifact[],
  options: Record<string, unknown>,
  stylePath: string | undefined,
  sourceOverride?: string
): string[] {
  const command = krillinCliStageId(stage.stageRun.stageId);
  const common = ['--workdir', stage.workdir, '--task-id', stage.stageRun.id];
  const sourceUrl = stringOption(options, 'sourceUrl');
  const mediaCache = sourceUrl ? ['--media-workdir', join(dirname(stage.workdir), 'source-media', createHash('sha256').update(sourceUrl).digest('hex').slice(0, 16))] : [];
  if (command === 'subtitle') {
    const subtitleOnly = options.sourceType === 'subtitle';
    const source = subtitleOnly ? undefined : sourceOverride ?? resolveKrillinCliSource(artifacts, options);
    const sourceOnly = booleanOption(options, 'sourceOnly', false);
    const importedTarget = subtitleOnly ? undefined : artifactPath(artifacts, 'target_subtitle');
    const importedSource = artifactPath(artifacts, 'source_subtitle');
    const imported = importedTarget ?? importedSource;
    if (subtitleOnly ? !importedSource : !source && !imported) {
      throw new CreatorExecutorError('creator_stage_input_missing', 'A video, URL or imported source SRT is required');
    }
    return [
      'subtitle',
      ...(source ? [source] : []),
      ...(!subtitleOnly && source && !sourceOnly && booleanOption(options, 'prepareVideo', true) ? ['--prepare-video'] : []),
      '--origin-lang', requiredOption(options, 'originLanguage'),
      '--target-lang', requiredOption(options, 'targetLanguage'),
      '--caption-source', stringOption(options, 'captionSource') ?? 'any',
      ...(sourceOnly ? ['--source-only'] : []),
      ...(imported ? ['--input-srt', imported, `--srt-translated=${importedTarget !== undefined}`] : []),
      `--bilingual-top=${booleanOption(options, 'bilingualTop', true)}`,
      ...common,
      ...styleArgument(stylePath)
    ];
  }
  if (command === 'tts') {
    const target = artifactPath(artifacts, 'target_subtitle');
    const bilingual = artifactPath(artifacts, 'bilingual_subtitle');
    const subtitle = stage.stageRun.stageId === 'tts' && target
      ? join(stage.workdir, 'target_language_srt.srt')
      : target ?? bilingual;
    if (!subtitle) throw new CreatorExecutorError('creator_stage_input_missing', 'TTS subtitle input is required');
    const lineMode = target
      ? 'target-only'
      : booleanOption(options, 'bilingualTop', true)
        ? 'bilingual-target-top'
        : 'bilingual-target-bottom';
    const video = artifactPath(artifacts, 'source_video');
    const voice = stringOption(options, 'voiceCode');
    return [
      'tts',
      ...common,
      '--input-srt', subtitle,
      '--line-mode', lineMode,
      ...mediaCache,
      ...(booleanOption(options, 'audioOnly', false) ? ['--audio-only'] : []),
      ...(!video && !booleanOption(options, 'audioOnly', false) ? optionalArgument('--source-url', stringOption(options, 'sourceUrl')) : []),
      ...(video ? ['--video', video] : []),
      ...(voice ? ['--voice', voice] : [])
    ];
  }
  if (command === 'render-horizontal' || command === 'render-vertical') {
    const sourceVideo = artifactPath(artifacts, 'source_video');
    const dubbedVideo = artifactPath(artifacts, 'dubbed_video');
    const dubbedAudio = artifactPath(artifacts, 'dubbed_audio');
    const dubbed = booleanOption(options, 'dubbed', false);
    if (dubbed && !dubbedVideo && !dubbedAudio) {
      throw new CreatorExecutorError(
        'krillin_dubbed_video_missing',
        'Generate the dubbed video before rendering a dubbed output'
      );
    }
    const video = dubbed ? dubbedVideo ?? sourceVideo : sourceVideo;
    const vertical = artifactPath(artifacts, 'vertical_subtitle');
    const target = artifactPath(artifacts, 'target_subtitle');
    const bilingual = artifactPath(artifacts, 'bilingual_subtitle');
    const subtitle = command === 'render-vertical' && !dubbed
      ? vertical ?? (booleanOption(options, 'bilingual', false) ? bilingual ?? target : target ?? bilingual)
      : booleanOption(options, 'bilingual', false) && bilingual
        ? bilingual
        : target ?? bilingual;
    if ((!video && !sourceUrl) || !subtitle) {
      throw new CreatorExecutorError('creator_stage_input_missing', 'Render video and subtitle inputs are required');
    }
    return [
      command,
      ...common,
      ...mediaCache,
      ...(video ? ['--video', video] : ['--source-url', sourceUrl!]),
      '--subtitle', subtitle,
      '--line-mode', subtitle === bilingual || subtitle === vertical
        ? booleanOption(options, 'bilingualTop', true) ? 'bilingual-target-top' : 'bilingual-target-bottom'
        : 'target-only',
      ...(subtitle === vertical && target ? ['--mixed-target-subtitle', target] : []),
      ...(!booleanOption(options, 'bilingual', false) && subtitle !== target ? ['--target-only'] : []),
      ...(dubbed && !dubbedVideo && dubbedAudio ? ['--audio', dubbedAudio] : []),
      ...(dubbed ? ['--dubbed'] : []),
      ...(command === 'render-vertical'
        ? [
            ...optionalArgument('--major-title', stringOption(options, 'verticalTitle')),
            ...optionalArgument('--minor-title', stringOption(options, 'verticalSubtitle'))
          ]
        : []),
      ...styleArgument(stylePath)
    ];
  }
  throw new CreatorExecutorError('creator_stage_not_supported', `Unsupported KrillinAI stage ${command}`);
}

async function writeInitialManifest(
  stage: CreatorExecutorInput,
  options: Record<string, unknown>
): Promise<void> {
  await writeFile(join(stage.workdir, 'krillinai_manifest.json'), `${JSON.stringify({
    task_id: stage.stageRun.id,
    workdir: stage.workdir,
    origin_language: stringOption(options, 'originLanguage') ?? '',
    target_language: stringOption(options, 'targetLanguage') ?? '',
    provider: {},
    outputs: {},
    stages: {}
  }, null, 2)}\n`, { mode: 0o600 });
}

function executeCli(input: {
  executable: string;
  args: string[];
  cwd: string;
  runtimeBin: string;
  resourceRoot: string;
  dependencyBin: string;
  ytDlpRuntime?: YtDlpRuntime;
  nlpPython?: string;
  reportProgress(progress: Record<string, CreatorJson>): void;
  signal: AbortSignal;
}): Promise<KrillinCliResponse> {
  return new Promise((resolvePromise, reject) => {
    const reportProgress = createMonotonicProgressReporter(input.reportProgress);
    const child = spawnCreatorProcess(input.executable, input.args, {
      cwd: input.cwd,
      env: createKrillinCliEnvironment(
        process.env,
        input.runtimeBin,
        input.resourceRoot,
        input.dependencyBin,
        input.ytDlpRuntime,
        input.nlpPython
      ),
      stdio: ['ignore', 'pipe', 'pipe']
    }, input.signal);
    let stdout = '';
    let stderr = '';
    let pendingStdoutLine = '';
    child.stdout?.on('data', chunk => {
      const value = String(chunk);
      stdout = boundedAppend(stdout, value);
      pendingStdoutLine = consumeProgressLines(
        pendingStdoutLine + value,
        reportProgress
      );
    });
    child.stderr?.on('data', chunk => { stderr = boundedAppend(stderr, String(chunk)); });
    child.once('error', reject);
    child.once('exit', code => {
      if (input.signal.aborted) {
        reject(new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled'));
        return;
      }
      reportProgressLine(pendingStdoutLine, reportProgress);
      const response = parseResponse(stdout);
      if (response === undefined) {
        reject(new KrillinCliError(
          'krillin_cli_failed',
          redact(stderr || `KrillinAI CLI exited with code ${code ?? 'unknown'}`)
        ));
        return;
      }
      if (response.ok !== true || code !== 0) {
        reject(new KrillinCliError(
          response.error?.code ?? 'krillin_cli_failed',
          redact(response.error?.message ?? (stderr || 'KrillinAI CLI failed')),
          response.error?.kind,
          response.error?.retryable === true
        ));
        return;
      }
      resolvePromise(response);
    });
  });
}

function createMonotonicProgressReporter(
  reportProgress: (progress: Record<string, CreatorJson>) => void
): (progress: Record<string, CreatorJson>) => void {
  let lastPercent = 0;
  return progress => {
    const incomingPercent = progress.percent;
    if (typeof incomingPercent !== 'number' || !Number.isFinite(incomingPercent)) {
      reportProgress(progress);
      return;
    }
    const percent = Math.max(lastPercent, Math.max(0, Math.min(99, Math.round(incomingPercent))));
    lastPercent = percent;
    const legacyPayload = progress.krillinEventPayload;
    const nextLegacyPayload = legacyPayload && typeof legacyPayload === 'object' && !Array.isArray(legacyPayload)
      ? { ...legacyPayload, percent }
      : undefined;
    reportProgress({
      ...progress,
      percent,
      ...(nextLegacyPayload === undefined ? {} : { krillinEventPayload: nextLegacyPayload })
    });
  };
}

async function collectArtifacts(
  input: RunKrillinCliInput,
  response: KrillinCliResponse
): Promise<KrillinResultArtifact[]> {
  const mappings = outputMappings(input.stage.stageRun.stageId);
  const candidates: Array<{ field: string; kind: string; path: string }> = [];
  const jobRoot = await realpath(resolve(input.jobsRoot, input.stage.job.id));
  for (const [field, kind] of mappings) {
    if (kind === 'source_video' && input.stage.stageRun.stageId !== 'subtitle' && input.artifacts.some(artifact => artifact.kind === 'source_video')) continue;
    const reported = response.outputs?.[field];
    if (!reported) continue;
    const candidate = isAbsolute(reported) ? reported : resolve(input.stage.workdir, reported);
    let path;
    try {
      path = await realpath(candidate);
    } catch {
      continue;
    }
    if (!isInside(jobRoot, path)) {
      throw new CreatorExecutorError('krillin_output_escape', `KrillinAI output escapes the current Job root: ${field}`);
    }
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) continue;
    candidates.push({ field, kind, path });
  }
  await normalizeSimplifiedChineseSubtitleOutputs(candidates, {
    originLanguage: input.options.originLanguage,
    targetLanguage: input.options.targetLanguage,
    bilingualTop: booleanOption(input.options, 'bilingualTop', true)
  });
  const result: KrillinResultArtifact[] = [];
  for (const { field, kind, path } of candidates) {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) continue;
    result.push({
      id: `${input.stage.stageRun.id}:${kind}`,
      kind,
      relativePath: relative(input.jobsRoot, path).replaceAll('\\', '/'),
      mimeType: mimeType(path),
      size: info.size,
      sha256: await sha256CreatorFile(path, input.stage.signal),
      ...(kind === 'target_subtitle' || kind === 'bilingual_subtitle' || kind === 'vertical_subtitle'
        ? { metadata: krillinTranslationReport(response) } : {})
    });
  }
  return result;
}

export function krillinTranslationReport(response: Pick<KrillinCliResponse, 'warnings' | 'translation_failures' | 'subtitle_quality'>): Record<string, CreatorJson> {
  const warnings = (response.warnings ?? []).filter(value => typeof value === 'string' && value.trim());
  const failures = (response.translation_failures ?? []).filter(value => value && typeof value.sentence_id === 'string'
    && typeof value.source_text === 'string' && typeof value.reason === 'string');
  return {
    translationStatus: failures.length > 0 ? 'partial'
      : response.subtitle_quality?.status === 'degraded' || response.subtitle_quality?.status === 'failed' ? 'degraded'
      : warnings.some(value => value.startsWith('字幕排版待调整：')) ? 'layout_pending' : 'complete',
    translationFailedCount: failures.length,
    translationLayoutPending: warnings.some(value => value.startsWith('字幕排版待调整：')),
    translationFailures: failures.map(value => ({ sentenceId: value.sentence_id, sourceText: value.source_text, reason: value.reason })),
    translationWarnings: warnings,
    ...(response.subtitle_quality === undefined ? {} : { subtitleQuality: { ...response.subtitle_quality } })
  };
}

export function outputMappings(stageId: string): Array<[string, string]> {
  if (stageId === 'source-transcript') return [['origin_srt', 'source_subtitle']];
  if (stageId === 'narration') return [['tts_audio', 'narration_audio']];
  if (stageId === 'subtitles') return [['bilingual_srt', 'bilingual_subtitle']];
  if (stageId === 'bilingual-render') return [['horizontal_video', 'bilingual_video']];
  if (stageId === 'subtitle') {
    return [
      ['origin_video', 'source_video'],
      ['origin_srt', 'source_subtitle'],
      ['target_srt', 'target_subtitle'],
      ['bilingual_srt', 'bilingual_subtitle'],
      ['short_origin_mixed_srt', 'vertical_subtitle']
    ];
  }
  if (stageId === 'tts') return [
    ['origin_video', 'source_video'],
    ['origin_srt', 'source_subtitle'],
    ['target_srt', 'target_subtitle'],
    ['bilingual_srt', 'bilingual_subtitle'],
    ['tts_audio', 'dubbed_audio'],
    ['video_with_tts', 'dubbed_video']
  ];
  if (stageId === 'render-horizontal') return [['origin_video', 'source_video'], ['horizontal_video', 'horizontal_video']];
  if (stageId === 'render-vertical') return [['origin_video', 'source_video'], ['vertical_video', 'vertical_video']];
  return [];
}

function krillinCliStageId(stageId: string): string {
  if (stageId === 'source-transcript' || stageId === 'subtitles') return 'subtitle';
  if (stageId === 'narration') return 'tts';
  if (stageId === 'bilingual-render') return 'render-horizontal';
  return stageId;
}

export function createKrillinCliEnvironment(
  env: NodeJS.ProcessEnv,
  runtimeBin: string,
  resourceRoot: string,
  dependencyBin: string,
  ytDlpRuntime?: YtDlpRuntime,
  nlpPython?: string
): NodeJS.ProcessEnv {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
    : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  const runtimePaths = ytDlpRuntime === undefined
    ? []
    : [dirname(ytDlpRuntime.executable)];
  const executablePath = process.platform === 'win32'
    ? [dependencyBin, ...runtimePaths, runtimeBin].join(delimiter)
    : [dependencyBin, ...runtimePaths, runtimeBin, '/usr/bin', '/bin'].join(delimiter);
  return {
    ...Object.fromEntries(names.flatMap(name => env[name] === undefined ? [] : [[name, env[name]]])),
    ...ytDlpRuntime?.env,
    ...(process.platform === 'win32' && ytDlpRuntime !== undefined && ytDlpRuntime.prefixArgs.length > 0
      ? { OPENCREATOR_YT_DLP_COMMAND: JSON.stringify([ytDlpRuntime.executable, ...ytDlpRuntime.prefixArgs]) }
      : {}),
    PATH: executablePath,
    Path: executablePath,
    KRILLINAI_RESOURCE_ROOT: resourceRoot,
    KRILLINAI_OFFLINE_DEPENDENCIES: '1',
    OPENCREATOR_KRILLINAI_CLI: '1',
    ...(nlpPython === undefined ? {} : { KRILLINAI_NLP_PYTHON: nlpPython }),
    ...(ytDlpRuntime === undefined
      ? {}
      : {
          KRILLINAI_YT_DLP_EXECUTABLE: ytDlpRuntime.executable,
          KRILLINAI_YT_DLP_PREFIX_ARGS: JSON.stringify(ytDlpRuntime.prefixArgs)
        })
  };
}

export function resolveKrillinNlpPython(resourceRoot: string, manifest: KrillinRuntimeManifest): string | undefined {
  if (manifest.nlp === undefined) return undefined;
  const executable = manifest.nlp.executable;
  if (!manifest.resources.some(resource => resource.path === executable && resource.kind === 'executable')) {
    throw new CreatorExecutorError('dependency_not_packaged', 'Missing manifest-pinned NLP Python');
  }
  return resolveInside(resourceRoot, executable);
}

function consumeProgressLines(
  value: string,
  reportProgress: (progress: Record<string, CreatorJson>) => void
): string {
  const lines = value.split(/\r?\n/);
  const pending = lines.pop() ?? '';
  for (const line of lines) reportProgressLine(line, reportProgress);
  return pending.length <= 1024 * 1024 ? pending : pending.slice(-1024 * 1024);
}

function reportProgressLine(
  line: string,
  reportProgress: (progress: Record<string, CreatorJson>) => void
): void {
  const frame = parseKrillinCliProgressFrame(line);
  if (frame === undefined) return;
  const payload: Record<string, CreatorJson> = { percent: frame.percent };
  if (frame.phase !== undefined) payload.phase = frame.phase;
  if (frame.message !== undefined) payload.message = frame.message;
  if (frame.completed !== undefined) payload.completed = frame.completed;
  if (frame.total !== undefined) payload.total = frame.total;
  reportProgress({
    krillinMode: 'cli',
    providerStatus: 'running',
    ...payload,
    krillinEventPayload: payload
  });
}

export function parseKrillinCliProgressFrame(line: string): KrillinCliProgressFrame | undefined {
  const value = line.trim();
  if (!value.startsWith('{') || !value.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.type !== 'progress' || typeof parsed.percent !== 'number' || !Number.isFinite(parsed.percent)) {
      return undefined;
    }
    const phase = typeof parsed.phase === 'string' && parsed.phase.trim()
      ? parsed.phase.trim()
      : undefined;
    const message = typeof parsed.message === 'string' && parsed.message.trim()
      ? parsed.message.trim()
      : undefined;
    const counts = typeof parsed.completed === 'number' && Number.isSafeInteger(parsed.completed)
      && typeof parsed.total === 'number' && Number.isSafeInteger(parsed.total)
      && parsed.total > 0 && parsed.completed >= 0 && parsed.completed <= parsed.total
      ? { completed: parsed.completed, total: parsed.total }
      : {};
    return {
      type: 'progress',
      percent: Math.max(0, Math.min(99, Math.round(parsed.percent))),
      ...(phase === undefined ? {} : { phase }),
      ...(message === undefined ? {} : { message }),
      ...counts
    };
  } catch {
    return undefined;
  }
}

export async function prepareCliResourceRoot(input: {
  resourceRoot: string;
  dependencyRoot: string;
  launcherRoot: string;
  onDemandTranscriptionProvider?: 'whisperkit' | 'whisper.cpp';
  onDemandTranscriptionModel?: 'tiny' | 'medium' | 'large-v2' | 'large-v3-turbo';
  useOnDemandTranscription?: boolean;
  useWhisperCpp?: boolean;
  ytDlpRuntime?: YtDlpRuntime;
}): Promise<string> {
  const dependencyBin = join(input.dependencyRoot, 'bin');
  const dependencyModels = join(input.dependencyRoot, 'models');
  await mkdir(dependencyBin, { recursive: true });
  await mkdir(dependencyModels, { recursive: true });
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  if (input.onDemandTranscriptionProvider === 'whisper.cpp') {
    const model = input.onDemandTranscriptionModel;
    if (model === undefined) {
      throw new CreatorExecutorError(
        'creator_transcription_config_missing',
        'Whisper.cpp model selection is required'
      );
    }
    const sourceModels = join(dependencyModels, 'whispercpp');
    const mountedModels = join(input.launcherRoot, 'models', 'whispercpp');
    await mkdir(mountedModels, { recursive: true });
    await linkDirectoryEntries(sourceModels, mountedModels);
    if (model !== 'large-v2' && model !== 'large-v3-turbo') {
      await linkFile(
        join(sourceModels, `ggml-${model}.bin`),
        join(mountedModels, 'ggml-large-v2.bin'),
        true
      );
    }
  } else {
    await symlink(dependencyModels, join(input.launcherRoot, 'models'), type);
  }
  const overlayBin = join(input.launcherRoot, 'bin');
  await mkdir(overlayBin, { recursive: true });
  await linkDirectoryEntries(join(input.resourceRoot, 'bin'), overlayBin);
  const sourceFonts = join(input.resourceRoot, 'fonts');
  try {
    if ((await stat(sourceFonts)).isDirectory()) {
      const overlayFonts = join(input.launcherRoot, 'fonts');
      await mkdir(overlayFonts, { recursive: true });
      await linkDirectoryEntries(sourceFonts, overlayFonts);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (input.useWhisperCpp === true && input.onDemandTranscriptionProvider === undefined) {
    await linkDirectoryEntries(join(dependencyBin, 'whispercpp'), overlayBin);
  }
  if (input.ytDlpRuntime !== undefined) {
    const ytDlpName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
    await installYtDlpCommand(
      input.ytDlpRuntime,
      join(overlayBin, ytDlpName)
    );
  }
  if (
    input.onDemandTranscriptionProvider === 'whisperkit'
    || input.useOnDemandTranscription === true
  ) {
    const whisperKitName = process.platform === 'win32' ? 'whisperkit-cli.exe' : 'whisperkit-cli';
    await linkFile(
      join(dependencyBin, whisperKitName),
      join(overlayBin, whisperKitName)
    );
  } else if (input.onDemandTranscriptionProvider === 'whisper.cpp') {
    await linkDirectory(
      join(dependencyBin, 'whispercpp'),
      join(overlayBin, 'whispercpp')
    );
  }
  return input.launcherRoot;
}

export async function recoverWindowsHorizontalAssRender(input: {
  platform: NodeJS.Platform;
  resourceRoot: string;
  manifest: KrillinRuntimeManifest;
  stageId: string;
  workdir: string;
  artifacts: MaterializedKrillinArtifact[];
  signal: AbortSignal;
  error: unknown;
  reportProgress(progress: Record<string, CreatorJson>): void;
  runProcess?: RunProcess;
}): Promise<KrillinCliResponse | undefined> {
  if (!isWindowsHorizontalAssPathFailure(input)) return undefined;
  const sourceVideo = artifactPath(input.artifacts, 'source_video');
  const assName = 'formatted_horizontal_bilingual.ass';
  const assPath = join(input.workdir, assName);
  if (!sourceVideo || !await isNonEmptyFile(sourceVideo) || !await isNonEmptyFile(assPath)) {
    return undefined;
  }
  const ffmpeg = input.manifest.resources.find(resource => (
    resource.kind === 'executable'
    && /(?:^|\/)ffmpeg(?:\.exe)?$/i.test(resource.path)
  ));
  if (ffmpeg === undefined) return undefined;

  const outputPath = join(input.workdir, 'horizontal_bilingual.mp4');
  const temporaryPath = join(input.workdir, '.horizontal_bilingual.opencreator-recovery.mp4');
  const args = [
    '-y',
    '-i', sourceVideo,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-vf', `ass=${assName}`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    temporaryPath
  ];
  await rm(outputPath, { force: true });
  await rm(temporaryPath, { force: true });
  input.reportProgress({
    krillinMode: 'cli',
    providerStatus: 'running',
    phase: 'rendering_subtitles',
    percent: 95,
    message: 'Rendering bilingual subtitles'
  });
  try {
    await (input.runProcess ?? runProcess)({
      executable: resolveInside(input.resourceRoot, ffmpeg.path),
      args,
      cwd: input.workdir,
      signal: input.signal
    });
    if (!await isNonEmptyFile(temporaryPath)) {
      throw new KrillinCliError(
        'render_video_failed',
        'Windows ASS compatibility render did not produce a video'
      );
    }
    await rename(temporaryPath, outputPath);
    await writeFile(join(input.workdir, 'opencreator-windows-ass-recovery.json'), `${JSON.stringify({
      schemaVersion: 1,
      reason: 'krillinai-2.1.0-windows-absolute-ass-path',
      cwd: input.workdir,
      inputVideo: sourceVideo,
      assFile: assName,
      outputVideo: outputPath,
      ffmpegArgs: args
    }, null, 2)}\n`);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (error instanceof CreatorExecutorError || error instanceof KrillinCliError) throw error;
    throw new KrillinCliError(
      'render_video_failed',
      `Windows ASS compatibility render failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return {
    ok: true,
    stage: 'render-horizontal',
    outputs: { horizontal_video: outputPath },
    warnings: ['Recovered KrillinAI 2.1.0 Windows ASS path handling with a relative ASS filter path']
  };
}

function isWindowsHorizontalAssPathFailure(input: {
  platform: NodeJS.Platform;
  stageId: string;
  error: unknown;
}): boolean {
  if (
    input.platform !== 'win32'
    || input.stageId !== 'bilingual-render'
    || !(input.error instanceof KrillinCliError)
    || input.error.code !== 'render_video_failed'
  ) return false;
  return /Unable to parse option value[\s\S]*formatted_horizontal_bilingual\.ass[\s\S]*as image size/i
    .test(input.error.message)
    && /Error applying option ['"]?original_size['"]? to filter ['"]?ass['"]?/i
      .test(input.error.message);
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function runProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCreatorProcess(input.executable, input.args, {
      cwd: input.cwd,
      stdio: ['ignore', 'ignore', 'pipe']
    }, input.signal);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr = boundedAppend(stderr, String(chunk)); });
    child.once('error', reject);
    child.once('exit', code => {
      if (input.signal.aborted) {
        reject(new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled'));
        return;
      }
      if (code === 0) resolvePromise();
      else reject(new Error(redact(stderr || `FFmpeg exited with code ${code ?? 'unknown'}`)));
    });
  });
}

async function linkDirectoryEntries(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    await linkFile(join(source, entry.name), join(destination, entry.name));
  }
}

async function linkFile(
  source: string,
  target: string,
  preferWindowsHardlink = false
): Promise<void> {
  await rm(target, { force: true });
  if (process.platform !== 'win32') {
    await symlink(source, target);
    return;
  }
  if (!preferWindowsHardlink) {
    await copyFile(source, target);
    return;
  }
  try {
    await link(source, target);
  } catch (error) {
    if (!isWindowsLinkFallbackError(error)) throw error;
    await copyFile(source, target);
  }
}

async function installYtDlpCommand(
  runtime: YtDlpRuntime,
  target: string
): Promise<void> {
  if (runtime.prefixArgs.length === 0) {
    await linkFile(runtime.executable, target);
    return;
  }
  if (process.platform === 'win32') {
    // Krillin executes the structured Python command supplied in its environment.
    await rm(target, { force: true });
    return;
  }

  await rm(target, { force: true });
  const command = [runtime.executable, ...runtime.prefixArgs]
    .map(quoteShellArgument)
    .join(' ');
  await writeFile(target, `#!/bin/sh\nexec ${command} "$@"\n`, {
    mode: 0o700
  });
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function removeLauncherRootBestEffort(launcherRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(launcherRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isBusyCleanupError(error) || attempt === 7) return;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

function isBusyCleanupError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  return ['EBUSY', 'EPERM', 'EACCES'].includes(String(error.code));
}

function isWindowsLinkFallbackError(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('code' in error)) return false;
  return ['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP'].includes(String(error.code));
}

async function linkDirectory(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}

function isOnDemandTranscriptionProvider(
  provider: CreatorServicesConfig['transcription']['provider']
): provider is 'whisperkit' | 'whisper.cpp' {
  return provider === 'whisperkit' || provider === 'whisper.cpp';
}

function parseResponse(stdout: string): KrillinCliResponse | undefined {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    const value = line.trim();
    if (!value.startsWith('{') || !value.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(value) as KrillinCliResponse;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      continue;
    }
  }
  return undefined;
}

function artifactPath(artifacts: MaterializedKrillinArtifact[], kind: string): string | undefined {
  return artifacts.find(artifact => artifact.kind === kind)?.path;
}

export function resolveKrillinCliSource(
  artifacts: MaterializedKrillinArtifact[],
  options: Record<string, unknown>
): string | undefined {
  const sourceUrl = stringOption(options, 'sourceUrl');
  const captionSource = stringOption(options, 'captionSource') ?? 'any';
  const hasImportedSubtitle = artifacts.some(artifact => artifact.kind === 'source_subtitle' || artifact.kind === 'target_subtitle');
  if (!hasImportedSubtitle && isYouTubeSource(sourceUrl) && captionSource !== 'whisper') {
    return sourceUrl;
  }
  const localSource = artifactPath(artifacts, 'source_video');
  return localSource === undefined ? sourceUrl : `local:${localSource}`;
}

function requiredOption(options: Record<string, unknown>, name: string): string {
  const value = stringOption(options, name);
  if (!value) throw new CreatorExecutorError('creator_stage_config_missing', `KrillinAI option ${name} is required`);
  return value;
}

function stringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanOption(options: Record<string, unknown>, name: string, fallback: boolean): boolean {
  return typeof options[name] === 'boolean' ? options[name] as boolean : fallback;
}

function optionalArgument(flag: string, value: string | undefined): string[] {
  return value ? [flag, value] : [];
}

function styleArgument(path: string | undefined): string[] {
  return path ? ['--subtitle-style-file', path] : [];
}

function mimeType(path: string): string | undefined {
  const extension = basename(path).split('.').at(-1)?.toLowerCase();
  if (extension === 'srt') return 'application/x-subrip';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'mp4') return 'video/mp4';
  return undefined;
}

function isInside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function boundedAppend(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= 4 * 1024 * 1024 ? combined : combined.slice(-4 * 1024 * 1024);
}

function redact(value: string): string {
  return value
    .replace(/(?:api[_-]?key|token|secret)\s*[=:]\s*\S+/gi, '$1=[redacted]')
    .trim()
    .slice(-4_000);
}
