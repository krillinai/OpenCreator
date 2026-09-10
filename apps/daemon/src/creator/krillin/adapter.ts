import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {
  CreateKrillinTaskRequest,
  CreatorArtifact,
  CreatorJson,
  CreatorServicesConfig,
  KrillinResultArtifact,
  KrillinTask,
  KrillinTaskEvent
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type {
  CreatorExecutor,
  CreatorExecutorInput,
  CreatorExecutorOutput,
  CreatorExecutorResult
} from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateMediaFile } from '../validators/media.js';
import { validateSrtFile } from '../validators/srt.js';
import {
  KrillinCliError,
  resolveKrillinCliSource,
  runKrillinCli
} from './cli-runner.js';
import type { KrillinDependencyLoader } from './dependency-loader.js';
import { preflightKrillinDependencies } from './dependency-preflight.js';
import { createKrillinCliExecutionPlan } from './execution-plan.js';
import { readKrillinRuntimeManifest, resolveInside } from './manifest.js';
import type { KrillinRuntimeHost } from './runtime-host.js';
import { KrillinServiceError, type KrillinServiceClient } from './service-client.js';
import type { YtDlpRuntime } from '../yt-dlp/runtime.js';

export function createKrillinExecutor(input: {
  resourceRoot: string;
  jobsRoot: string;
  dependencyLoader: KrillinDependencyLoader;
  runtimeHost: KrillinRuntimeHost;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  getYtDlpRuntime?(): YtDlpRuntime | undefined;
  now?: () => number;
  inactivityTimeoutMs?: number;
  stageTimeoutMs?: number;
  pollIntervalMs?: number;
}): CreatorExecutor {
  const now = input.now ?? Date.now;
  const inactivityTimeoutMs = input.inactivityTimeoutMs ?? 3 * 60_000;
  const stageTimeoutMs = input.stageTimeoutMs ?? 60 * 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 250;
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
      const inputArtifactIds = materializedArtifacts.map(artifact => artifact.id);
      const options = buildKrillinStageOptions(stage);
      if (hasPackagedCli(preflight.manifest)) {
        let artifacts: KrillinResultArtifact[];
        try {
          const attempts = createKrillinCliExecutionPlan(
            resolveKrillinStageContract(stage).stageType,
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
      const request = createTaskRequest(stage, inputArtifactIds, preflight.config);
      let client = await input.runtimeHost.client();
      let restarted = false;
      const call = async <T>(operation: (active: KrillinServiceClient) => Promise<T>): Promise<T> => {
        try {
          return await operation(client);
        } catch (error) {
          if (restarted || !isTransportFailure(error)) throw error;
          restarted = true;
          client = await input.runtimeHost.restart();
          return operation(client);
        }
      };
      let task = await call(active => active.createTask(request));
      let cursor = readCursor(stage.stageRun.progress);
      const startedAt = now();
      let lastActivityAt = startedAt;
      let accumulatedProgress: Record<string, CreatorJson> = { ...stage.stageRun.progress };
      const reportProgress = (progress: Record<string, CreatorJson>) => {
        accumulatedProgress = mergeKrillinProgress(accumulatedProgress, progress);
        stage.reportProgress(accumulatedProgress);
      };
      reportProgress({
        krillinTaskId: task.id,
        krillinEventCursor: cursor,
        krillinStatus: task.status,
        providerStatus: task.status
      });
      const abort = () => { void client.cancelTask(task.id).catch(() => undefined); };
      if (stage.signal.aborted) abort();
      else stage.signal.addEventListener('abort', abort, { once: true });
      try {
        while (!isTerminal(task.status)) {
          if (stage.signal.aborted) {
            await client.cancelTask(task.id).catch(() => undefined);
            throw new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
          }
          const events = await call(active => active.events(task.id, cursor));
          const previousCursor = cursor;
          for (const event of events.events) {
            cursor = Math.max(cursor, event.seq);
            reportProgress(krillinEventProgress(task, event, cursor));
          }
          if (cursor > previousCursor) lastActivityAt = now();
          task = await call(active => active.getTask(task.id));
          reportProgress({
            krillinTaskId: task.id,
            krillinEventCursor: cursor,
            krillinStatus: task.status,
            providerStatus: task.status
          });
          if (!isTerminal(task.status)) {
            await enforceKrillinDeadlines({
              client,
              taskId: task.id,
              startedAt,
              lastActivityAt,
              now,
              inactivityTimeoutMs,
              stageTimeoutMs
            });
            await waitForPoll(stage.signal, pollIntervalMs);
          }
        }
      } finally {
        stage.signal.removeEventListener('abort', abort);
      }
      if (task.status !== 'succeeded') throw taskFailure(task);
      const manifest = await call(active => active.result(task.id));
      const outputs = await validateResultArtifacts({
        stage,
        jobsRoot: input.jobsRoot,
        artifacts: manifest.artifacts,
        ffprobe
      });
      return {
        outputs,
        progress: mergeKrillinProgress(accumulatedProgress, {
          krillinTaskId: task.id,
          krillinEventCursor: cursor,
          krillinStatus: task.status,
          providerStatus: task.status,
          percent: 100,
          completedOutputKinds: outputs.map(output => output.kind)
        })
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

export async function enforceKrillinDeadlines(input: {
  client: Pick<KrillinServiceClient, 'health' | 'cancelTask'>;
  taskId: string;
  startedAt: number;
  lastActivityAt: number;
  now: () => number;
  inactivityTimeoutMs: number;
  stageTimeoutMs: number;
}): Promise<void> {
  const currentTime = input.now();
  if (currentTime - input.startedAt >= input.stageTimeoutMs) {
    await input.client.cancelTask(input.taskId).catch(() => undefined);
    throw new CreatorExecutorError(
      'creator_stage_timeout',
      `Creator stage exceeded ${Math.round(input.stageTimeoutMs / 60_000)} minutes`
    );
  }
  if (currentTime - input.lastActivityAt < input.inactivityTimeoutMs) return;

  let healthDetail = '';
  try {
    const health = await input.client.health();
    if (!health.ok) healthDetail = '; KrillinAI health check reported unavailable';
  } catch (error) {
    healthDetail = `; KrillinAI health check failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  await input.client.cancelTask(input.taskId).catch(() => undefined);
  throw new CreatorExecutorError(
    'creator_stage_inactivity_timeout',
    `Creator stage produced no new events for ${Math.round(input.inactivityTimeoutMs / 60_000)} minutes${healthDetail}`
  );
}

export function normalizeKrillinFailure(error: { code?: string; message?: string } | undefined): {
  code: string;
  message: string;
} {
  const message = error?.message ?? 'KrillinAI stage failed';
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

function createTaskRequest(
  input: CreatorExecutorInput,
  inputArtifactIds: string[],
  providerConfig: CreatorServicesConfig
): CreateKrillinTaskRequest {
  const stageType = resolveKrillinStageContract(input).stageType;
  const requestIdentity = {
    protocolVersion: 1 as const,
    jobId: input.job.id,
    stageRunId: input.stageRun.id,
    stageType,
    idempotencyKey: input.stageRun.id,
    inputArtifactIds,
    options: buildKrillinStageOptions(input)
  };
  return {
    ...requestIdentity,
    requestHash: createHash('sha256').update(canonicalJson(requestIdentity)).digest('hex'),
    providerConfig: providerConfig as unknown as Record<string, unknown>
  };
}

export function buildKrillinStageOptions(input: CreatorExecutorInput): Record<string, unknown> {
  const state = input.job.state;
  return compactObject({
    sourceUrl: typeof state.sourceUrl === 'string' ? state.sourceUrl : undefined,
    originLanguage: typeof state.sourceLanguage === 'string' ? state.sourceLanguage : undefined,
    targetLanguage: typeof state.targetLanguage === 'string' ? state.targetLanguage : undefined,
    captionSource: state.preferPlatformCaptions === false ? 'whisper' : 'any',
    sourceOnly: input.job.templateId === 'stickman-video'
      && input.stageRun.stageId === 'source-transcript',
    bilingual: input.stageRun.stageId === 'subtitles' || state.bilingual === true,
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
  const style = value as Record<string, CreatorJson>;
  const primaryColor = nonEmptyString(style.primaryColor);
  const secondaryColor = nonEmptyString(style.secondaryColor);
  const outlineColor = nonEmptyString(style.outlineColor);
  const outlineWidth = finiteNumber(style.outlineWidth);
  const major = compactObject({
    primary_color: primaryColor,
    outline_color: outlineColor,
    outline: outlineWidth
  });
  const minor = compactObject({
    primary_color: secondaryColor,
    outline_color: outlineColor,
    outline: outlineWidth
  });
  if (Object.keys(major).length === 0 && Object.keys(minor).length === 0) return undefined;
  return {
    version: 1,
    horizontal: { major: { ...major }, minor: { ...minor } },
    vertical: { major: { ...major }, minor: { ...minor } }
  };
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
      kind: krillinInputKind(input, artifact.kind),
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

export async function validateResultArtifacts(input: {
  stage: CreatorExecutorInput;
  jobsRoot: string;
  artifacts: KrillinResultArtifact[];
  ffprobe: string;
}): Promise<CreatorExecutorOutput[]> {
  const contract = resolveKrillinStageContract(input.stage);
  const outputs: CreatorExecutorOutput[] = [];
  const jobRoot = await realpath(resolve(input.jobsRoot, input.stage.job.id));
  for (const artifact of input.artifacts) {
    if (!contract.allowedOutputKinds.has(artifact.kind)) {
      throw new CreatorExecutorError('krillin_output_mismatch', `KrillinAI returned undeclared output ${artifact.kind}`);
    }
    const outputKind = contract.outputAliases[artifact.kind];
    if (outputKind === undefined) continue;
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
    if (outputKind.includes('subtitle')) {
      const cues = await validateSrtFile(path, {
        allowOverlaps: outputKind === 'vertical_subtitle'
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
    outputs.push({ kind: outputKind, status: 'completed', path, metadata });
  }
  for (const required of contract.requiredOutputKinds) {
    if (!outputs.some(output => output.kind === required)) {
      throw new CreatorExecutorError('krillin_output_missing', `KrillinAI did not produce ${required}`);
    }
  }
  return outputs;
}

export function krillinEventProgress(
  task: KrillinTask,
  event: KrillinTaskEvent,
  cursor: number
): Record<string, CreatorJson> {
  const payload = event.payload as Record<string, CreatorJson>;
  const progress: Record<string, CreatorJson> = {
    krillinTaskId: task.id,
    krillinEventCursor: cursor,
    krillinStatus: task.status,
    providerStatus: task.status,
    krillinEventType: event.type,
    krillinEventPayload: payload
  };
  if (typeof payload.percent === 'number' && Number.isFinite(payload.percent)) {
    progress.percent = Math.max(0, Math.min(100, payload.percent));
  }
  if (typeof payload.phase === 'string' && payload.phase.trim().length > 0) {
    progress.phase = payload.phase;
  }
  return progress;
}

export function mergeKrillinProgress(
  current: Record<string, CreatorJson>,
  update: Record<string, CreatorJson>
): Record<string, CreatorJson> {
  return { ...current, ...update };
}

function taskFailure(task: KrillinTask): CreatorExecutorError {
  if (task.status === 'canceled') return new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled');
  if (task.status === 'interrupted') {
    return new CreatorExecutorError('krillin_task_interrupted', task.error?.message ?? 'KrillinAI task was interrupted');
  }
  const normalized = normalizeKrillinFailure(task.error);
  return new CreatorExecutorError(normalized.code, normalized.message);
}

function executablePath(resourceRoot: string, pattern: RegExp): string {
  const manifest = readKrillinRuntimeManifest(resourceRoot);
  const resource = manifest.resources.find(candidate => candidate.kind === 'executable' && pattern.test(candidate.path));
  if (resource === undefined) throw new CreatorExecutorError('dependency_not_packaged', `Missing runtime executable: ${pattern}`);
  return resolveInside(resourceRoot, resource.path);
}

export type KrillinStageContract = {
  stageType: CreateKrillinTaskRequest['stageType'];
  allowedOutputKinds: Set<string>;
  outputAliases: Record<string, string | undefined>;
  requiredOutputKinds: string[];
};

export function resolveKrillinStageContract(
  input: Pick<CreatorExecutorInput, 'job' | 'stageRun'>
): KrillinStageContract {
  const stageId = input.stageRun.stageId;
  if (input.job.templateId === 'stickman-video') {
    if (stageId === 'source-transcript') return {
      stageType: 'subtitle',
      allowedOutputKinds: new Set(['source_video', 'source_subtitle', 'target_subtitle', 'bilingual_subtitle', 'vertical_subtitle']),
      outputAliases: { source_subtitle: 'source_subtitle' },
      requiredOutputKinds: ['source_subtitle']
    };
    if (stageId === 'narration') return {
      stageType: 'tts',
      allowedOutputKinds: new Set(['dubbed_audio', 'dubbed_video', 'narration_audio']),
      outputAliases: { dubbed_audio: 'narration_audio', narration_audio: 'narration_audio' },
      requiredOutputKinds: ['narration_audio']
    };
    if (stageId === 'subtitles') return {
      stageType: 'subtitle',
      allowedOutputKinds: new Set(['source_video', 'source_subtitle', 'target_subtitle', 'bilingual_subtitle', 'vertical_subtitle']),
      outputAliases: { bilingual_subtitle: 'bilingual_subtitle' },
      requiredOutputKinds: ['bilingual_subtitle']
    };
    if (stageId === 'bilingual-render') return {
      stageType: 'render-horizontal',
      allowedOutputKinds: new Set(['horizontal_video', 'bilingual_video']),
      outputAliases: { horizontal_video: 'bilingual_video', bilingual_video: 'bilingual_video' },
      requiredOutputKinds: ['bilingual_video']
    };
  }
  if (stageId === 'subtitle' || stageId === 'tts' || stageId === 'render-horizontal' || stageId === 'render-vertical') {
    const expected = expectedOutputKinds(stageId);
    return {
      stageType: stageId,
      allowedOutputKinds: expected,
      outputAliases: Object.fromEntries([...expected].map(kind => [kind, kind])),
      requiredOutputKinds: requiredOutputKinds(stageId)
    };
  }
  throw new CreatorExecutorError('creator_stage_not_supported', `Unsupported KrillinAI stage ${stageId}`);
}

function krillinInputKind(input: CreatorExecutorInput, kind: string): string {
  if (input.job.templateId !== 'stickman-video') return kind;
  if (input.stageRun.stageId === 'narration' && kind === 'narration_subtitle') {
    return 'target_subtitle';
  }
  if (
    (input.stageRun.stageId === 'subtitles' || input.stageRun.stageId === 'bilingual-render')
    && kind === 'clean_video'
  ) {
    return 'source_video';
  }
  return kind;
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

function isTerminal(status: KrillinTask['status']): boolean {
  return ['succeeded', 'failed', 'canceled', 'interrupted'].includes(status);
}

function readCursor(progress: Record<string, CreatorJson>): number {
  const value = progress.krillinEventCursor;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isTransportFailure(error: unknown): boolean {
  return error instanceof KrillinServiceError && error.code === 'krillin_service_unavailable';
}

function hasPackagedCli(manifest: ReturnType<typeof readKrillinRuntimeManifest>): boolean {
  return manifest.resources.some(resource => (
    resource.kind === 'executable'
    && /(?:^|\/)krillinai-cli(?:\.exe)?$/i.test(resource.path)
  ));
}

function waitForPoll(signal: AbortSignal, intervalMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolvePromise();
    }, intervalMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new CreatorExecutorError('creator_stage_canceled', 'Creator stage was canceled'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
