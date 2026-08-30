import type {
  CreatorServicesConfig,
  CreatorTtsPreviewRequest,
  CreatorTtsProvider,
  CreatorTtsVoice,
  CreatorTtsVoicesResponse,
  RuntimeErrorCode
} from '@opencreator/protocol';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import { createKrillinConfigToml } from './config-bridge.js';
import {
  readKrillinRuntimeManifest,
  resolveInside,
  verifyKrillinRuntimeManifest
} from './manifest.js';
import { listBundledTtsVoices } from './tts-voice-catalog.js';

const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

type KrillinVoice = {
  code?: string;
  name?: string;
  language?: string;
  gender?: string;
  provider?: string;
  scenario?: string;
  kind?: string;
  supported_models?: string[];
  recommended?: boolean;
};

type KrillinUtilityResponse = {
  ok?: boolean;
  voices?: KrillinVoice[];
  outputs?: { tts_audio?: string };
  error?: {
    code?: string;
    message?: string;
  };
};

type ExecuteUtilityInput = {
  config: CreatorServicesConfig;
  args: string[];
  launcherRoot: string;
};

export type KrillinTtsSynthesisRequest = {
  text: string;
  provider?: CreatorTtsProvider;
  model?: string;
  voiceId?: string;
  format?: 'mp3' | 'wav';
  speed?: number;
  instructions?: string;
};

export type KrillinTtsSynthesisResult = {
  content: Buffer;
  mime: 'audio/mpeg' | 'audio/wav';
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>;
  model: string;
  voiceId: string;
  format: 'mp3' | 'wav';
};

export type KrillinTtsService = ReturnType<typeof createKrillinTtsService>;

export class KrillinTtsServiceError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode,
      | 'VALIDATION_FAILED'
      | 'creator_tts_config_missing'
      | 'creator_tts_runtime_unavailable'
      | 'creator_tts_upstream_error'
      | 'unsupported_capability'>,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'KrillinTtsServiceError';
  }
}

export function createKrillinTtsService(input: {
  resourceRoot: string;
  workRoot: string;
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  timeoutMs?: number;
  executeUtility?: (input: ExecuteUtilityInput) => Promise<KrillinUtilityResponse>;
}) {
  const executeUtility = input.executeUtility ?? (utility => executePackagedKrillinUtility({
    ...utility,
    resourceRoot: input.resourceRoot,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }));

  async function listVoices(
    provider: CreatorTtsProvider,
    model?: string
  ): Promise<CreatorTtsVoicesResponse> {
    if (provider === 'edge-tts') {
      return { provider, model: '', voices: [] };
    }
    const prepared = prepareConfig(await input.configStore.read(), provider, model);
    const bundledVoices = listBundledTtsVoices(provider, prepared.model);
    if (bundledVoices !== undefined) {
      return {
        provider,
        model: prepared.model,
        voices: bundledVoices
      };
    }
    const launcherRoot = await createLauncherRoot(input.workRoot);
    try {
      const response = await executeUtility({
        config: prepared.config,
        args: ['voices', '--provider', provider],
        launcherRoot
      });
      ensureSuccessfulResponse(response);
      return {
        provider,
        model: prepared.model,
        voices: (response.voices ?? [])
          .filter(voice => supportsModel(voice, prepared.model))
          .flatMap(voice => mapVoice(voice, provider))
      };
    } finally {
      await rm(launcherRoot, { recursive: true, force: true });
    }
  }

  async function synthesize(
    request: KrillinTtsSynthesisRequest
  ): Promise<KrillinTtsSynthesisResult> {
    const text = request.text?.trim();
    if (!text) {
      throw new KrillinTtsServiceError('VALIDATION_FAILED', 'Speech text is required', 400);
    }
    const configured = await input.configStore.read();
    const provider = request.provider ?? configured.tts.provider;
    if (provider === 'edge-tts') {
      throw new KrillinTtsServiceError(
        'unsupported_capability',
        'KrillinAI speech utility does not support edge-tts',
        409
      );
    }
    const prepared = prepareConfig(configured, provider, request.model);
    ensureCredentials(prepared.config, provider);
    const voiceId = request.voiceId?.trim() || prepared.providerConfig.defaultVoiceId;
    if (!voiceId) {
      throw new KrillinTtsServiceError('VALIDATION_FAILED', 'A voice must be selected', 400);
    }
    const format = request.format ?? 'wav';
    const speed = request.speed ?? 1;
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      throw new KrillinTtsServiceError(
        'VALIDATION_FAILED',
        'Speech speed must be between 0.5 and 2',
        400
      );
    }

    const launcherRoot = await createLauncherRoot(input.workRoot);
    const textPath = join(launcherRoot, 'speech.txt');
    const outputPath = join(launcherRoot, `speech.${format}`);
    await writeFile(textPath, text, { mode: 0o600 });
    try {
      const args = [
        'speech',
        '--text-file', textPath,
        '--output', outputPath,
        '--provider', provider,
        '--voice', voiceId,
        '--format', format,
        '--speed', String(speed)
      ];
      if (request.instructions?.trim()) {
        args.push('--instructions', request.instructions.trim());
      }
      const response = await executeUtility({
        config: prepared.config,
        args,
        launcherRoot
      });
      ensureSuccessfulResponse(response);
      const content = await readFile(outputPath);
      if (content.length === 0 || content.length > MAX_OUTPUT_BYTES) {
        throw new KrillinTtsServiceError(
          'creator_tts_upstream_error',
          'KrillinAI returned an invalid audio file',
          502
        );
      }
      return {
        content,
        provider,
        model: prepared.model,
        voiceId,
        format,
        mime: format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      };
    } catch (error) {
      if (error instanceof KrillinTtsServiceError) throw error;
      throw new KrillinTtsServiceError(
        'creator_tts_upstream_error',
        error instanceof Error ? error.message : 'KrillinAI speech synthesis failed',
        502
      );
    } finally {
      await rm(launcherRoot, { recursive: true, force: true });
    }
  }

  return {
    listVoices,
    preview(request: CreatorTtsPreviewRequest) {
      return synthesize({
        text: request.text?.trim() || '你好，这是当前音色的试听效果。',
        provider: request.provider,
        model: request.model,
        voiceId: request.voiceId,
        format: 'mp3'
      });
    },
    synthesize
  };
}

function prepareConfig(
  source: CreatorServicesConfig,
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>,
  model?: string
) {
  const config = structuredClone(source);
  config.tts.provider = provider;
  const providerConfig = config.tts[provider];
  if (model?.trim()) providerConfig.model = model.trim();
  return { config, providerConfig, model: providerConfig.model };
}

function ensureCredentials(
  config: CreatorServicesConfig,
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>
): void {
  if (config.tts[provider].apiKey.trim()) return;
  throw new KrillinTtsServiceError(
    'creator_tts_config_missing',
    `Configure the ${provider} TTS API key before generating speech`,
    409
  );
}

function supportsModel(voice: KrillinVoice, model: string): boolean {
  if (!Array.isArray(voice.supported_models) || voice.supported_models.length === 0) {
    return true;
  }
  const normalizedModel = model.trim().toLowerCase();
  return voice.supported_models.some(candidate => (
    typeof candidate === 'string'
    && candidate.trim().toLowerCase() === normalizedModel
  ));
}

function mapVoice(
  voice: KrillinVoice,
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>
): CreatorTtsVoice[] {
  const id = voice.code?.trim();
  if (!id) return [];
  const kind = voice.kind === 'custom' || voice.kind === 'designed'
    ? voice.kind
    : 'builtin';
  return [{
    id,
    name: voice.name?.trim() || id,
    provider,
    ...(voice.language ? { language: voice.language } : {}),
    ...(voice.gender ? { gender: voice.gender } : {}),
    ...(voice.scenario ? { scenario: voice.scenario } : {}),
    kind,
    ...(Array.isArray(voice.supported_models)
      ? { supportedModels: voice.supported_models.filter(value => typeof value === 'string') }
      : {}),
    ...(voice.recommended === true ? { recommended: true } : {})
  }];
}

function ensureSuccessfulResponse(response: KrillinUtilityResponse): void {
  if (response.ok === true) return;
  throw new KrillinTtsServiceError(
    'creator_tts_upstream_error',
    response.error?.message || 'KrillinAI TTS command failed',
    502
  );
}

async function createLauncherRoot(workRoot: string): Promise<string> {
  await mkdir(workRoot, { recursive: true, mode: 0o700 });
  return mkdtemp(join(resolve(workRoot), 'tts-'));
}

async function executePackagedKrillinUtility(input: ExecuteUtilityInput & {
  resourceRoot: string;
  timeoutMs: number;
}): Promise<KrillinUtilityResponse> {
  let manifest;
  try {
    manifest = readKrillinRuntimeManifest(input.resourceRoot);
    verifyKrillinRuntimeManifest(input.resourceRoot, manifest);
  } catch (error) {
    throw new KrillinTtsServiceError(
      'creator_tts_runtime_unavailable',
      error instanceof Error ? error.message : 'KrillinAI runtime is unavailable',
      503
    );
  }
  const cli = manifest.resources.find(resource => (
    resource.kind === 'executable'
    && /(?:^|\/)krillinai-cli(?:\.exe)?$/i.test(resource.path)
  ));
  if (cli === undefined) {
    throw new KrillinTtsServiceError(
      'creator_tts_runtime_unavailable',
      'KrillinAI CLI is not packaged',
      503
    );
  }
  const configDir = join(input.launcherRoot, 'config');
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(configDir, 'config.toml'),
    createKrillinConfigToml(input.config),
    { mode: 0o600 }
  );

  return await new Promise<KrillinUtilityResponse>((resolvePromise, reject) => {
    const child = spawn(
      resolveInside(input.resourceRoot, cli.path),
      input.args,
      {
        cwd: input.launcherRoot,
        env: {
          ...process.env,
          OPENCREATOR_KRILLINAI_CLI: '1',
          KRILLINAI_RESOURCE_ROOT: resolve(input.resourceRoot)
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      fail(new KrillinTtsServiceError(
        'creator_tts_upstream_error',
        'KrillinAI TTS command timed out',
        504
      ));
    }, input.timeoutMs);
    timeout.unref();
    child.stdout.on('data', chunk => {
      stdout = appendBounded(stdout, String(chunk));
    });
    child.stderr.on('data', chunk => {
      stderr = appendBounded(stderr, String(chunk));
    });
    child.once('error', error => fail(new KrillinTtsServiceError(
      'creator_tts_runtime_unavailable',
      error.message,
      503
    )));
    child.once('exit', code => {
      if (settled) return;
      const response = parseLastJsonLine(stdout);
      if (response !== undefined) {
        succeed(response);
        return;
      }
      fail(new KrillinTtsServiceError(
        'creator_tts_upstream_error',
        `KrillinAI TTS command exited with ${code ?? 'unknown'}: ${stderr.trim().slice(-500)}`,
        502
      ));
    });

    function succeed(response: KrillinUtilityResponse) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(response);
    }

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    }
  });
}

function appendBounded(previous: string, chunk: string): string {
  const next = previous + chunk;
  if (Buffer.byteLength(next) <= MAX_PROCESS_OUTPUT_BYTES) return next;
  return next.slice(-MAX_PROCESS_OUTPUT_BYTES);
}

function parseLastJsonLine(stdout: string): KrillinUtilityResponse | undefined {
  const lines = stdout.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as KrillinUtilityResponse;
      }
    } catch {
      // Progress and log lines are ignored until the final JSON response.
    }
  }
  return undefined;
}
