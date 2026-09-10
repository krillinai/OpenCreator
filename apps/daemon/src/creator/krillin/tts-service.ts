import type {
  CreatorServicesConfig,
  CreatorTtsPreviewRequest,
  CreatorTtsProvider,
  CreatorTtsVoice,
  CreatorTtsVoicesResponse,
  RuntimeErrorCode
} from '@opencreator/protocol';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

type ExecuteSynthesisInput = {
  config: CreatorServicesConfig;
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>;
  model: string;
  voiceId: string;
  text: string;
  format: 'mp3' | 'wav';
  speed: number;
  instructions?: string;
  signal?: AbortSignal;
};

type ExecuteSynthesisResult = {
  content: Buffer;
  format: 'mp3' | 'wav';
};

export type KrillinTtsSynthesisRequest = {
  text: string;
  provider?: CreatorTtsProvider;
  model?: string;
  voiceId?: string;
  format?: 'mp3' | 'wav';
  speed?: number;
  instructions?: string;
  signal?: AbortSignal;
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
  executeSynthesis?: (input: ExecuteSynthesisInput) => Promise<ExecuteSynthesisResult>;
}) {
  const executeUtility = input.executeUtility ?? (utility => executePackagedKrillinUtility({
    ...utility,
    resourceRoot: input.resourceRoot,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }));
  const executeSynthesis = input.executeSynthesis ?? (request => executeProviderSynthesis({
    ...request,
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

    try {
      const synthesis = await executeSynthesis({
        config: prepared.config,
        provider,
        model: prepared.model,
        voiceId,
        text,
        format,
        speed,
        ...(request.instructions?.trim()
          ? { instructions: request.instructions.trim() }
          : {}),
        ...(request.signal === undefined ? {} : { signal: request.signal })
      });
      const content = synthesis.content;
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
        format: synthesis.format,
        mime: synthesis.format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      };
    } catch (error) {
      if (error instanceof KrillinTtsServiceError) throw error;
      throw new KrillinTtsServiceError(
        'creator_tts_upstream_error',
        error instanceof Error ? error.message : 'KrillinAI speech synthesis failed',
        502
      );
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

async function executeProviderSynthesis(
  input: ExecuteSynthesisInput & { timeoutMs: number }
): Promise<ExecuteSynthesisResult> {
  if (input.provider === 'aliyun') return synthesizeAliyun(input);
  if (input.provider === 'minimax') return synthesizeMinimax(input);
  return synthesizeOpenAi(input);
}

async function synthesizeOpenAi(
  input: ExecuteSynthesisInput & { timeoutMs: number }
): Promise<ExecuteSynthesisResult> {
  const provider = input.config.tts.openai;
  const response = await providerFetch(
    appendPath(provider.baseUrl || 'https://api.openai.com/v1', '/audio/speech'),
    provider.apiKey,
    {
      model: input.model,
      input: input.text,
      voice: input.voiceId,
      response_format: input.format,
      speed: input.speed,
      ...(input.instructions === undefined ? {} : { instructions: input.instructions })
    },
    input
  );
  return {
    content: await readAudioResponse(response),
    format: audioFormat(response.headers.get('content-type'), undefined, input.format)
  };
}

async function synthesizeAliyun(
  input: ExecuteSynthesisInput & { timeoutMs: number }
): Promise<ExecuteSynthesisResult> {
  const provider = input.config.tts.aliyun;
  const endpoint = aliyunTtsEndpoint(provider.baseUrl);
  const response = await providerFetch(endpoint, provider.apiKey, {
    model: input.model,
    input: {
      text: input.text,
      voice: input.voiceId,
      language_type: containsCjk(input.text) ? 'Chinese' : 'English'
    }
  }, input);
  const payload = await readJsonResponse(response) as {
    output?: { audio?: { data?: string; url?: string } };
    request_id?: string;
  };
  const audio = payload.output?.audio;
  const encoded = audio?.data?.trim();
  if (encoded) {
    const content = decodeBase64Audio(encoded);
    return { content, format: detectAudioFormat(content, input.format) };
  }
  if (!audio?.url) throw new Error('Aliyun TTS response did not contain audio');
  const audioUrl = new URL(audio.url);
  if (audioUrl.protocol === 'http:') audioUrl.protocol = 'https:';
  if (audioUrl.protocol !== 'https:') throw new Error('Aliyun TTS returned an invalid audio URL');
  const audioResponse = await timedFetch(audioUrl, { method: 'GET' }, input);
  if (!audioResponse.ok) await throwProviderHttpError(audioResponse);
  const content = await readAudioResponse(audioResponse);
  return {
    content,
    format: audioFormat(
      audioResponse.headers.get('content-type'),
      audioUrl.pathname,
      detectAudioFormat(content, input.format)
    )
  };
}

async function synthesizeMinimax(
  input: ExecuteSynthesisInput & { timeoutMs: number }
): Promise<ExecuteSynthesisResult> {
  const provider = input.config.tts.minimax;
  const response = await providerFetch(
    minimaxTtsEndpoint(provider.baseUrl || 'https://api.minimax.io'),
    provider.apiKey,
    {
      model: input.model,
      text: input.text,
      stream: false,
      voice_setting: {
        voice_id: input.voiceId,
        speed: input.speed,
        vol: 1,
        pitch: 0
      },
      audio_setting: {
        sample_rate: 44_100,
        format: input.format,
        channel: 1
      }
    },
    input
  );
  const payload = await readJsonResponse(response) as {
    data?: { audio?: string; status?: number };
    base_resp?: { status_code?: number; status_msg?: string };
  };
  if (payload.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax TTS failed: ${payload.base_resp.status_msg || payload.base_resp.status_code}`
    );
  }
  const encoded = payload.data?.audio;
  if (!encoded) throw new Error('MiniMax TTS response did not contain audio');
  const content = Buffer.from(encoded, 'hex');
  if (content.length === 0) throw new Error('MiniMax TTS returned invalid audio');
  return { content, format: detectAudioFormat(content, input.format) };
}

async function providerFetch(
  url: string,
  apiKey: string,
  body: unknown,
  input: ExecuteSynthesisInput & { timeoutMs: number }
): Promise<Response> {
  const response = await timedFetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  }, input);
  if (!response.ok) await throwProviderHttpError(response);
  return response;
}

async function timedFetch(
  url: string | URL,
  init: RequestInit,
  input: Pick<ExecuteSynthesisInput, 'signal'> & { timeoutMs: number }
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, input.timeoutMs);
  timeout.unref();
  if (input.signal?.aborted) abort();
  else input.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abort);
  }
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error('TTS provider returned invalid JSON');
  }
}

async function readAudioResponse(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OUTPUT_BYTES) {
    throw new Error('TTS provider audio exceeds the size limit');
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length === 0 || content.length > MAX_OUTPUT_BYTES) {
    throw new Error('TTS provider returned invalid audio bytes');
  }
  return content;
}

async function throwProviderHttpError(response: Response): Promise<never> {
  const detail = redactProviderDetail((await response.text()).slice(-1_000));
  throw new Error(
    `TTS provider request failed: HTTP ${response.status}${detail ? `: ${detail}` : ''}`
  );
}

function appendPath(baseUrl: string, suffix: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return base.toLowerCase().endsWith(suffix.toLowerCase()) ? base : `${base}${suffix}`;
}

function aliyunTtsEndpoint(baseUrl: string): string {
  const base = (baseUrl || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/$/, '');
  const suffix = '/services/aigc/multimodal-generation/generation';
  if (base.toLowerCase().endsWith(suffix)) return base;
  return /\/api\/v1$/i.test(base)
    ? `${base}${suffix}`
    : `${base}/api/v1${suffix}`;
}

function minimaxTtsEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (/\/v1\/t2a_v2$/i.test(base)) return base;
  return /\/v1$/i.test(base) ? `${base}/t2a_v2` : `${base}/v1/t2a_v2`;
}

function decodeBase64Audio(value: string): Buffer {
  const encoded = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const content = Buffer.from(encoded, 'base64');
  if (content.length === 0) throw new Error('TTS provider returned invalid base64 audio');
  return content;
}

function audioFormat(
  contentType: string | null,
  path: string | undefined,
  fallback: 'mp3' | 'wav'
): 'mp3' | 'wav' {
  if (contentType?.toLowerCase().includes('mpeg')) return 'mp3';
  if (contentType?.toLowerCase().includes('wav')) return 'wav';
  if (/\.mp3$/i.test(path ?? '')) return 'mp3';
  if (/\.wav$/i.test(path ?? '')) return 'wav';
  return fallback;
}

function detectAudioFormat(content: Buffer, fallback: 'mp3' | 'wav'): 'mp3' | 'wav' {
  if (content.subarray(0, 4).toString('ascii') === 'RIFF') return 'wav';
  if (content.subarray(0, 3).toString('ascii') === 'ID3') return 'mp3';
  if (content.length >= 2 && content[0] === 0xff && (content[1]! & 0xe0) === 0xe0) return 'mp3';
  return fallback;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function redactProviderDetail(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, '[url]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .trim();
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
