import { copyFile, link, lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CreatorArtifact,
  CreatorJson,
  CreatorServicesConfig
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type {
  CreatorExecutor,
  CreatorExecutorInput,
  CreatorExecutorOutput,
  CreatorExecutorResult
} from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { creatorSubtitleStyleSchema } from '../presets/module-schemas.js';
import { validateMediaFile } from '../validators/media.js';
import { validateSrtFile } from '../validators/srt.js';
import {
  KrillinCliError,
  resolveKrillinCliSource,
  runKrillinCli,
  type KrillinResultArtifact
} from './cli-runner.js';
import type { KrillinDependencyLoader } from './dependency-loader.js';
import { preflightKrillinDependencies } from './dependency-preflight.js';
import { createKrillinCliExecutionPlan } from './execution-plan.js';
import { readKrillinRuntimeManifest, resolveInside } from './manifest.js';
import type { YtDlpRuntime } from '../yt-dlp/runtime.js';

export function createKrillinExecutor(input: {
  resourceRoot: string;
  jobsRoot: string;
  dependencyLoader: KrillinDependencyLoader;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  getYtDlpRuntime?(): YtDlpRuntime | undefined;
}): CreatorExecutor {
  return {
    id: 'krillinai',
    async run(stage): Promise<CreatorExecutorResult> {
      const configured = await input.configStore.read();
      const preflight = preflightKrillinDependencies(input.resourceRoot, configured);
      await ensureKrillinTranscriptionDependency(
        input.dependencyLoader,
        preflight.config,
        stage
      );
      const ffprobe = executablePath(input.resourceRoot, /(?:^|\/)ffprobe(?:\.exe)?$/i);
      const materializedArtifacts = await writeArtifactIndex(input.jobsRoot, stage);
      const options = stageOptions(stage);
      let artifacts: KrillinResultArtifact[];
      try {
        const attempts = createKrillinCliExecutionPlan(
          stage.stageRun.stageId,
          resolveKrillinCliSource(materializedArtifacts, options),
          options
        );
        let completed: KrillinResultArtifact[] | undefined;
        for (const attempt of attempts) {
          try {
            completed = await runKrillinCli({
              resourceRoot: input.resourceRoot,
              jobsRoot: input.jobsRoot,
              dependencyRoot: input.dependencyLoader.root,
              manifest: preflight.manifest,
              stage,
              config: preflight.config,
              artifacts: materializedArtifacts,
              options: attempt.options,
              ytDlpRuntime: input.getYtDlpRuntime?.()
            });
            break;
          } catch (error) {
            if (
              error instanceof KrillinCliError
              && error.code === attempt.continueOnErrorCode
            ) {
              continue;
            }
            throw error;
          }
        }
        if (completed === undefined) {
          throw new CreatorExecutorError(
            'krillin_stage_failed',
            'KrillinAI exhausted the subtitle execution plan'
          );
        }
        artifacts = completed;
      } catch (error) {
        if (!(error instanceof KrillinCliError)) throw error;
        const normalized = normalizeKrillinFailure({
          code: error.kind === 'usage' ? 'usage' : error.code,
          message: error.message
        });
        throw new CreatorExecutorError(normalized.code, normalized.message);
      }
      const outputs = await validateResultArtifacts({
        stage,
        jobsRoot: input.jobsRoot,
        artifacts,
        ffprobe
      });
      return {
        outputs,
        progress: {
          ...stage.stageRun.progress,
          krillinMode: 'cli',
          providerStatus: 'succeeded',
          percent: 100,
          completedOutputKinds: outputs.map(output => output.kind)
        }
      };
    }
  };
}

async function ensureKrillinTranscriptionDependency(
  loader: KrillinDependencyLoader,
  config: CreatorServicesConfig,
  stage: CreatorExecutorInput
): Promise<void> {
  await loader.ensure({
    config,
    signal: stage.signal,
    reportProgress(progress) {
      stage.reportProgress({ ...stage.stageRun.progress, ...progress });
    }
  });
}

export function normalizeKrillinFailure(error: { code?: string; message?: string } | undefined): {
  code: string;
  message: string;
} {
  const message = error?.message ?? 'KrillinAI stage failed';
  if (
    error?.code === 'subtitle_style_load_failed'
    || error?.code === 'default_subtitle_style_load_failed'
    || /(?:fontconfig|fontconfig error|could not load font|failed to find.*font|subtitle style)/i.test(message)
  ) {
    return { code: 'creator_subtitle_style_unsupported', message };
  }
  if (/OpenAI.*(?:杞綍|转录|transcri)|(?:杞綍|转录|transcri).*OpenAI/i.test(message)) {
    return { code: 'creator_transcription_config_missing', message };
  }
  if (error?.code === 'usage') {
    if (/(?:TTS|閰嶉煶|配音|语音合成)/i.test(message)) {
      return { code: 'creator_tts_config_missing', message };
    }
    if (/(?:LLM|澶фā鍨媩鏂囨湰缈昏瘧|大模型|文本翻译)/i.test(message)) {
      return { code: 'creator_llm_config_missing', message };
    }
  }
  return { code: error?.code ?? 'krillin_stage_failed', message };
}

function stageOptions(input: CreatorExecutorInput): Record<string, unknown> {
  const state = input.job.state;
  return compactObject({
    sourceUrl: typeof state.sourceUrl === 'string' ? state.sourceUrl : undefined,
    originLanguage: typeof state.sourceLanguage === 'string' ? state.sourceLanguage : undefined,
    targetLanguage: typeof state.targetLanguage === 'string' ? state.targetLanguage : undefined,
    captionSource: state.preferPlatformCaptions === false ? 'whisper' : 'any',
    bilingual: state.bilingual === true,
    bilingualTop: state.subtitlePosition === 'top',
    ttsProvider: typeof state.ttsProvider === 'string' ? state.ttsProvider : undefined,
    ttsModel: typeof state.ttsModel === 'string' ? state.ttsModel : undefined,
    voiceCode: typeof state.voiceCode === 'string' ? state.voiceCode : undefined,
    verticalTitle: typeof state.verticalTitle === 'string' ? state.verticalTitle : undefined,
    verticalSubtitle: typeof state.verticalSubtitle === 'string' ? state.verticalSubtitle : undefined,
    dubbed: state.dubbing === true || state.dubbed === true,
    subtitleStyle: buildKrillinSubtitleStyle(state.subtitleStyle)
  });
}

export function buildKrillinSubtitleStyle(value: CreatorJson | undefined): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (Object.keys(value).length === 0) return undefined;
  const parsed = creatorSubtitleStyleSchema.safeParse(value);
  if (!parsed.success) {
    throw new CreatorExecutorError(
      'creator_subtitle_style_unsupported',
      `Unsupported subtitle style: ${parsed.error.issues.map(issue => issue.message).join('; ')}`
    );
  }
  const style = parsed.data;
  const fontName = `${subtitleFontFamily(style.fontPreset)} ${subtitleWeightName(style.fontWeight)}`;
  const bold = style.fontWeight === 'bold';
  const backColor = assBackColor(style.shadow.color, style.shadow.opacity);
  const shadow = style.shadow.enabled
    ? Math.max(Math.abs(style.shadow.offsetX), Math.abs(style.shadow.offsetY))
    : 0;
  const overrideTags = style.shadow.enabled
    ? `\\xshad${formatAssNumber(style.shadow.offsetX)}\\yshad${formatAssNumber(style.shadow.offsetY)}\\blur${formatAssNumber(style.shadow.blur)}`
    : '';
  const sizes = subtitleFontSizes(style.fontSize);
  const createStyle = (
    name: 'Major' | 'Minor',
    fontSize: number,
    primaryColor: string,
    marginV: number
  ) => ({
    name,
    font_name: fontName,
    font_size: fontSize,
    primary_color: primaryColor,
    secondary_color: primaryColor,
    outline_color: style.outlineColor,
    back_color: backColor,
    bold,
    italic: false,
    underline: false,
    strike_out: false,
    scale_x: 100,
    scale_y: 100,
    spacing: 0,
    angle: 0,
    border_style: 1,
    outline: style.outlineWidth,
    shadow,
    alignment: 2,
    margin_l: 10,
    margin_r: 10,
    margin_v: marginV,
    encoding: 1,
    override_tags: overrideTags
  });
  return {
    version: 1,
    horizontal: {
      major: createStyle('Major', sizes.horizontalMajor, style.primaryColor, 20),
      minor: createStyle('Minor', sizes.horizontalMinor, style.secondaryColor, 30)
    },
    vertical: {
      major: createStyle('Major', sizes.verticalMajor, style.primaryColor, 101),
      minor: createStyle('Minor', sizes.verticalMinor, style.secondaryColor, 92)
    }
  };
}

function subtitleFontFamily(preset: 'system' | 'sans' | 'serif' | 'rounded'): string {
  if (preset === 'serif') return 'OpenCreator Serif';
  if (preset === 'rounded') return 'OpenCreator Rounded';
  return 'OpenCreator Sans';
}

function subtitleWeightName(weight: 'regular' | 'medium' | 'bold'): string {
  if (weight === 'medium') return 'Medium';
  if (weight === 'bold') return 'Bold';
  return 'Regular';
}

function subtitleFontSizes(size: 'small' | 'medium' | 'large'): {
  horizontalMajor: number;
  horizontalMinor: number;
  verticalMajor: number;
  verticalMinor: number;
} {
  if (size === 'small') {
    return { horizontalMajor: 12, horizontalMinor: 9, verticalMajor: 10, verticalMinor: 6 };
  }
  if (size === 'large') {
    return { horizontalMajor: 18, horizontalMinor: 12, verticalMajor: 15, verticalMinor: 9 };
  }
  return { horizontalMajor: 14, horizontalMinor: 10, verticalMajor: 12, verticalMinor: 7 };
}

function assBackColor(color: string, opacity: number): string {
  const hex = color.slice(1).toUpperCase();
  const alpha = Math.round(255 * (1 - opacity)).toString(16).padStart(2, '0').toUpperCase();
  return `&H${alpha}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function formatAssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

async function writeArtifactIndex(
  jobsRoot: string,
  input: CreatorExecutorInput
): Promise<Array<{ id: string; kind: string; path: string }>> {
  const jobRoot = resolve(jobsRoot, input.job.id);
  await mkdir(jobRoot, { recursive: true });
  const entries: Array<{ id: string; kind: string; relativePath: string; path: string }> = [];
  for (const artifact of input.inputArtifacts) {
    if (artifact.path === null) continue;
    const path = await materializeArtifact(jobRoot, artifact);
    entries.push({
      id: artifact.id,
      kind: artifact.kind,
      relativePath: relative(jobRoot, path).replaceAll('\\', '/'),
      path
    });
  }
  const target = join(jobRoot, 'artifact-index.json');
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    artifacts: entries.map(({ path: _path, ...entry }) => entry)
  }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return entries.map(({ id, kind, path }) => ({ id, kind, path }));
}

async function materializeArtifact(jobRoot: string, artifact: CreatorArtifact): Promise<string> {
  const source = await realpath(artifact.path!);
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new CreatorExecutorError('creator_artifact_invalid', `Artifact ${artifact.id} is not a regular file`);
  }
  if (isInside(jobRoot, source)) return source;
  const destination = join(jobRoot, 'imports', artifact.id, basename(source));
  await mkdir(dirname(destination), { recursive: true });
  try {
    await link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await copyFile(source, destination);
  }
  const actual = await realpath(destination);
  if (!isInside(jobRoot, actual)) {
    throw new CreatorExecutorError('creator_artifact_path_escape', `Artifact ${artifact.id} escaped the Job root`);
  }
  return actual;
}

async function validateResultArtifacts(input: {
  stage: CreatorExecutorInput;
  jobsRoot: string;
  artifacts: KrillinResultArtifact[];
  ffprobe: string;
}): Promise<CreatorExecutorOutput[]> {
  const expected = expectedOutputKinds(input.stage.stageRun.stageId);
  const outputs: CreatorExecutorOutput[] = [];
  const jobRoot = await realpath(resolve(input.jobsRoot, input.stage.job.id));
  for (const artifact of input.artifacts) {
    if (!expected.has(artifact.kind)) {
      throw new CreatorExecutorError('krillin_output_mismatch', `KrillinAI returned undeclared output ${artifact.kind}`);
    }
    const path = await realpath(resolve(input.jobsRoot, artifact.relativePath));
    if (!isInside(jobRoot, path)) {
      throw new CreatorExecutorError('krillin_output_escape', 'KrillinAI output escapes the current Job root');
    }
    let metadata: Record<string, CreatorJson> = {
      fileName: basename(path),
      settingsSnapshot: input.stage.job.state,
      sha256: artifact.sha256 ?? null,
      bytes: artifact.size ?? null
    };
    if (artifact.kind.includes('subtitle')) {
      const cues = await validateSrtFile(path, {
        allowOverlaps: artifact.kind === 'vertical_subtitle'
      });
      metadata = {
        ...metadata,
        cueCount: cues.length,
        cues: cues.map(cue => ({
          id: cue.index,
          start: formatSrtTimestamp(cue.startMs),
          end: formatSrtTimestamp(cue.endMs),
          text: cue.text
        }))
      };
    } else {
      metadata = { ...metadata, ...(await validateMediaFile(path, input.ffprobe)) };
    }
    outputs.push({ kind: artifact.kind, status: 'completed', path, metadata });
  }
  for (const required of requiredOutputKinds(input.stage.stageRun.stageId)) {
    if (!outputs.some(output => output.kind === required)) {
      throw new CreatorExecutorError('krillin_output_missing', `KrillinAI did not produce ${required}`);
    }
  }
  return outputs;
}

function executablePath(resourceRoot: string, pattern: RegExp): string {
  const manifest = readKrillinRuntimeManifest(resourceRoot);
  const resource = manifest.resources.find(candidate => candidate.kind === 'executable' && pattern.test(candidate.path));
  if (resource === undefined) throw new CreatorExecutorError('dependency_not_packaged', `Missing runtime executable: ${pattern}`);
  return resolveInside(resourceRoot, resource.path);
}

function expectedOutputKinds(stageId: string): Set<string> {
  if (stageId === 'subtitle') return new Set([
    'source_video',
    'source_subtitle',
    'target_subtitle',
    'bilingual_subtitle',
    'vertical_subtitle'
  ]);
  if (stageId === 'tts') return new Set(['dubbed_audio', 'dubbed_video']);
  if (stageId === 'render-horizontal') return new Set(['horizontal_video']);
  if (stageId === 'render-vertical') return new Set(['vertical_video']);
  return new Set();
}

function requiredOutputKinds(stageId: string): string[] {
  if (stageId === 'subtitle') {
    return ['source_video', 'source_subtitle', 'target_subtitle', 'vertical_subtitle'];
  }
  if (stageId === 'tts') return ['dubbed_audio'];
  if (stageId === 'render-horizontal') return ['horizontal_video'];
  if (stageId === 'render-vertical') return ['vertical_video'];
  return [];
}

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function nonEmptyString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function finiteNumber(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatSrtTimestamp(value: number): string {
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const milliseconds = value % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}
