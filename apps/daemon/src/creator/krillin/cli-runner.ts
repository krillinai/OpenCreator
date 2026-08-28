import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CreatorJson,
  CreatorServicesConfig,
  KrillinResultArtifact
} from '@opencreator/protocol';
import type { CreatorExecutorInput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { createKrillinConfigToml } from './config-bridge.js';
import {
  resolveInside,
  type KrillinRuntimeManifest
} from './manifest.js';

export type MaterializedKrillinArtifact = {
  id: string;
  kind: string;
  path: string;
};

type KrillinCliResponse = {
  ok?: boolean;
  stage?: string;
  task_id?: string;
  outputs?: Record<string, string>;
  warnings?: string[];
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
};

export class KrillinCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind?: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = 'KrillinCliError';
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
  options: Record<string, unknown>;
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
    useOnDemandTranscription: input.config.transcription.provider === 'whisperkit'
  });
  const cliConfig = stageConfig(input.config, input.stage.stageRun.stageId, input.options);
  await writeFile(
    join(configDir, 'config.toml'),
    createKrillinConfigToml(cliConfig),
    { mode: 0o600 }
  );
  await writeFile(join(dependencyBin, '.yt-dlp-last-check'), new Date().toISOString(), { mode: 0o600 });

  const style = input.options.subtitleStyle;
  const stylePath = style === undefined ? undefined : join(configDir, 'subtitle-style.json');
  if (stylePath !== undefined) {
    await writeFile(stylePath, `${JSON.stringify(style, null, 2)}\n`, { mode: 0o600 });
  }
  if (input.stage.stageRun.stageId !== 'subtitle') {
    await writeInitialManifest(input.stage, input.options);
  }

  const args = commandArguments(input.stage, input.artifacts, input.options, stylePath);
  input.stage.reportProgress({
    krillinMode: 'cli',
    providerStatus: 'running',
    percent: 5
  });
  try {
    const response = await executeCli({
      executable: resolveInside(input.resourceRoot, cli.path),
      args,
      cwd: launcherRoot,
      runtimeBin,
      resourceRoot: cliResourceRoot,
      dependencyBin,
      reportProgress: progress => input.stage.reportProgress(progress),
      signal: input.stage.signal
    });
    const artifacts = await collectArtifacts(input, response);
    input.stage.reportProgress({
      krillinMode: 'cli',
      providerStatus: 'succeeded',
      percent: 100,
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
    await rm(launcherRoot, { recursive: true, force: true });
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
  ) return source;
  const config = structuredClone(source);
  config.tts.provider = provider;
  if (provider !== 'edge-tts') {
    const model = stringOption(options, 'ttsModel');
    if (model) config.tts[provider].model = model;
  }
  return config;
}

function commandArguments(
  stage: CreatorExecutorInput,
  artifacts: MaterializedKrillinArtifact[],
  options: Record<string, unknown>,
  stylePath: string | undefined
): string[] {
  const command = stage.stageRun.stageId;
  const common = ['--workdir', stage.workdir, '--task-id', stage.stageRun.id];
  if (command === 'subtitle') {
    const source = resolveKrillinCliSource(artifacts, options);
    if (!source) throw new CreatorExecutorError('creator_stage_input_missing', 'Subtitle input video or URL is required');
    return [
      'subtitle',
      source,
      '--origin-lang', requiredOption(options, 'originLanguage'),
      '--target-lang', requiredOption(options, 'targetLanguage'),
      '--caption-source', stringOption(options, 'captionSource') ?? 'any',
      `--bilingual-top=${booleanOption(options, 'bilingualTop', true)}`,
      ...common,
      ...styleArgument(stylePath)
    ];
  }
  if (command === 'tts') {
    const target = artifactPath(artifacts, 'target_subtitle');
    const bilingual = artifactPath(artifacts, 'bilingual_subtitle');
    const subtitle = target ?? bilingual;
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
      ...(video ? ['--video', video] : []),
      ...(voice ? ['--voice', voice] : [])
    ];
  }
  if (command === 'render-horizontal' || command === 'render-vertical') {
    const sourceVideo = artifactPath(artifacts, 'source_video');
    const dubbedVideo = artifactPath(artifacts, 'dubbed_video');
    const dubbed = booleanOption(options, 'dubbed', false);
    if (dubbed && !dubbedVideo) {
      throw new CreatorExecutorError(
        'krillin_dubbed_video_missing',
        'Generate the dubbed video before rendering a dubbed output'
      );
    }
    const video = dubbed ? dubbedVideo : sourceVideo;
    const target = artifactPath(artifacts, 'target_subtitle');
    const bilingual = artifactPath(artifacts, 'bilingual_subtitle');
    const subtitle = booleanOption(options, 'bilingual', false) && bilingual
      ? bilingual
      : target ?? bilingual;
    if (!video || !subtitle) {
      throw new CreatorExecutorError('creator_stage_input_missing', 'Render video and subtitle inputs are required');
    }
    return [
      command,
      ...common,
      '--video', video,
      '--subtitle', subtitle,
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
  reportProgress(progress: Record<string, CreatorJson>): void;
  signal: AbortSignal;
}): Promise<KrillinCliResponse> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnCreatorProcess(input.executable, input.args, {
      cwd: input.cwd,
      env: createKrillinCliEnvironment(
        process.env,
        input.runtimeBin,
        input.resourceRoot,
        input.dependencyBin
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
        input.reportProgress
      );
    });
    child.stderr?.on('data', chunk => { stderr = boundedAppend(stderr, String(chunk)); });
    child.once('error', reject);
    child.once('exit', code => {
      if (input.signal.aborted) {
        reject(new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled'));
        return;
      }
      reportProgressLine(pendingStdoutLine, input.reportProgress);
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

async function collectArtifacts(
  input: RunKrillinCliInput,
  response: KrillinCliResponse
): Promise<KrillinResultArtifact[]> {
  const mappings = outputMappings(input.stage.stageRun.stageId);
  const result: KrillinResultArtifact[] = [];
  const jobRoot = await realpath(resolve(input.jobsRoot, input.stage.job.id));
  for (const [field, kind] of mappings) {
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
    result.push({
      id: `${input.stage.stageRun.id}:${kind}`,
      kind,
      relativePath: relative(input.jobsRoot, path).replaceAll('\\', '/'),
      mimeType: mimeType(path),
      size: info.size,
      sha256: createHash('sha256').update(await readFile(path)).digest('hex')
    });
  }
  return result;
}

export function outputMappings(stageId: string): Array<[string, string]> {
  if (stageId === 'subtitle') {
    return [
      ['origin_video', 'source_video'],
      ['origin_srt', 'source_subtitle'],
      ['target_srt', 'target_subtitle'],
      ['bilingual_srt', 'bilingual_subtitle'],
      ['short_origin_mixed_srt', 'vertical_subtitle']
    ];
  }
  if (stageId === 'tts') return [['tts_audio', 'dubbed_audio'], ['video_with_tts', 'dubbed_video']];
  if (stageId === 'render-horizontal') return [['horizontal_video', 'horizontal_video']];
  if (stageId === 'render-vertical') return [['vertical_video', 'vertical_video']];
  return [];
}

export function createKrillinCliEnvironment(
  env: NodeJS.ProcessEnv,
  runtimeBin: string,
  resourceRoot: string,
  dependencyBin: string
): NodeJS.ProcessEnv {
  const names = process.platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']
    : ['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'];
  const executablePath = process.platform === 'win32'
    ? [dependencyBin, runtimeBin].join(delimiter)
    : [dependencyBin, runtimeBin, '/usr/bin', '/bin'].join(delimiter);
  return {
    ...Object.fromEntries(names.flatMap(name => env[name] === undefined ? [] : [[name, env[name]]])),
    PATH: executablePath,
    Path: executablePath,
    KRILLINAI_RESOURCE_ROOT: resourceRoot,
    KRILLINAI_OFFLINE_DEPENDENCIES: '1',
    OPENCREATOR_KRILLINAI_CLI: '1'
  };
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
  reportProgress({
    krillinMode: 'cli',
    providerStatus: 'running',
    percent: frame.percent,
    ...(frame.phase === undefined ? {} : { phase: frame.phase }),
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
    return {
      type: 'progress',
      percent: Math.max(0, Math.min(99, Math.round(parsed.percent))),
      ...(phase === undefined ? {} : { phase }),
      ...(message === undefined ? {} : { message })
    };
  } catch {
    return undefined;
  }
}

async function prepareCliResourceRoot(input: {
  resourceRoot: string;
  dependencyRoot: string;
  launcherRoot: string;
  useOnDemandTranscription: boolean;
}): Promise<string> {
  const dependencyBin = join(input.dependencyRoot, 'bin');
  const dependencyModels = join(input.dependencyRoot, 'models');
  await mkdir(dependencyBin, { recursive: true });
  await mkdir(dependencyModels, { recursive: true });
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(dependencyModels, join(input.launcherRoot, 'models'), type);
  if (!input.useOnDemandTranscription) {
    await symlink(dependencyBin, join(input.launcherRoot, 'bin'), type);
    return input.resourceRoot;
  }

  const overlayBin = join(input.launcherRoot, 'bin');
  await mkdir(overlayBin, { recursive: true });
  await linkDirectoryEntries(join(input.resourceRoot, 'bin'), overlayBin);
  const whisperKitName = process.platform === 'win32' ? 'whisperkit-cli.exe' : 'whisperkit-cli';
  await linkFile(
    join(dependencyBin, whisperKitName),
    join(overlayBin, whisperKitName)
  );
  return input.launcherRoot;
}

async function linkDirectoryEntries(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    await linkFile(join(source, entry.name), join(destination, entry.name));
  }
}

async function linkFile(source: string, target: string): Promise<void> {
  await rm(target, { force: true });
  await symlink(source, target, process.platform === 'win32' ? 'file' : undefined);
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
  const localSource = artifactPath(artifacts, 'source_video');
  return localSource === undefined ? stringOption(options, 'sourceUrl') : `local:${localSource}`;
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
