import {
  smartDubbingStyles,
  smartDubbingVoices,
  type CreateSmartDubbingRequest,
  type RuntimeErrorCode,
  type SmartDubbingResult,
  type SmartDubbingStyle
} from '@opencreator/protocol';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';

const MAX_TEXT_LENGTH = 5_000;
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;
const SAFE_RESULT_ID = /^[A-Za-z0-9_-]{12,64}$/;

const styleInstructions: Record<SmartDubbingStyle, string> = {
  natural: 'Speak naturally with clear articulation and balanced pacing.',
  professional: 'Use a polished, confident, professional presentation style.',
  warm: 'Use a warm, friendly, approachable tone with gentle pacing.',
  energetic: 'Use an energetic, upbeat delivery while keeping every word clear.',
  calm: 'Use a calm, steady, reassuring tone with measured pauses.',
  storytelling: 'Use an expressive storytelling cadence with natural emphasis and pauses.'
};

export type SmartDubbingService = {
  generate(request: CreateSmartDubbingRequest): Promise<SmartDubbingResult>;
  preview(request: CreateSmartDubbingRequest): Promise<{
    mime: 'audio/mpeg' | 'audio/wav';
    content: Buffer;
  }>;
  get(id: string): Promise<SmartDubbingResult>;
  read(id: string): Promise<{ result: SmartDubbingResult; content: Buffer }>;
};

export class SmartDubbingError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode,
      | 'VALIDATION_FAILED'
      | 'SMART_DUBBING_CONFIG_REQUIRED'
      | 'SMART_DUBBING_PROVIDER_UNSUPPORTED'
      | 'SMART_DUBBING_UPSTREAM_ERROR'
      | 'SMART_DUBBING_RESULT_NOT_FOUND'
      | 'SMART_DUBBING_STORAGE_FAILED'>,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'SmartDubbingError';
  }
}

export function createSmartDubbingService(input: {
  dataDir: string;
  configStore: CreatorServicesConfigStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
}): SmartDubbingService {
  const rootDir = resolve(input.dataDir, 'smart-dubbing');
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? (() => randomBytes(12).toString('base64url'));

  async function get(id: string): Promise<SmartDubbingResult> {
    validateResultId(id);
    try {
      const parsed = JSON.parse(await readFile(metadataPath(id), 'utf8')) as unknown;
      if (!isSmartDubbingResult(parsed) || parsed.id !== id) throw new Error('invalid metadata');
      return parsed;
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new SmartDubbingError('SMART_DUBBING_RESULT_NOT_FOUND', 'Dubbing result was not found', 404);
      }
      if (error instanceof SmartDubbingError) throw error;
      throw new SmartDubbingError('SMART_DUBBING_STORAGE_FAILED', 'Dubbing result metadata is unavailable', 500);
    }
  }

  async function synthesize(request: CreateSmartDubbingRequest) {
    validateRequest(request);
    const config = await input.configStore.read();
    if (config.tts.provider !== 'openai') {
      throw new SmartDubbingError(
        'SMART_DUBBING_PROVIDER_UNSUPPORTED',
        `Smart dubbing does not support the configured ${config.tts.provider} provider yet`,
        409
      );
    }
    const provider = config.tts.openai;
    if (!provider.apiKey.trim()) {
      throw new SmartDubbingError(
        'SMART_DUBBING_CONFIG_REQUIRED',
        'Configure an OpenAI TTS API key before generating dubbing',
        409
      );
    }

    const model = provider.model.trim() || 'gpt-4o-mini-tts';
    const endpoint = openAiSpeechEndpoint(provider.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref();
    let response: Response;
    try {
      const body: Record<string, unknown> = {
        model,
        input: request.text.trim(),
        voice: request.voice,
        response_format: request.format,
        speed: request.speed
      };
      if (model.toLowerCase().includes('gpt-4o')) {
        body.instructions = styleInstructions[request.style];
      }
      response = await fetchAudio({
        endpoint,
        apiKey: provider.apiKey,
        body: JSON.stringify(body),
        proxy: config.proxy.trim(),
        signal: controller.signal,
        fetchImpl: input.fetchImpl
      });
    } catch {
      throw new SmartDubbingError(
        'SMART_DUBBING_UPSTREAM_ERROR',
        'The dubbing provider could not be reached',
        502
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new SmartDubbingError(
        'SMART_DUBBING_UPSTREAM_ERROR',
        await upstreamErrorMessage(response),
        502
      );
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length === 0 || content.length > MAX_AUDIO_BYTES) {
      throw new SmartDubbingError(
        'SMART_DUBBING_UPSTREAM_ERROR',
        'The dubbing provider returned an invalid audio file',
        502
      );
    }
    return {
      content,
      model,
      mime: request.format === 'wav' ? 'audio/wav' as const : 'audio/mpeg' as const
    };
  }

  return {
    async generate(request) {
      const { content, mime, model } = await synthesize(request);

      const id = createId();
      validateResultId(id);
      const result: SmartDubbingResult = {
        id,
        fileName: `OpenCreator-dubbing-${id}.${request.format}`,
        mime,
        size: content.length,
        provider: 'openai',
        model,
        voice: request.voice,
        style: request.style,
        speed: request.speed,
        format: request.format,
        characterCount: [...request.text.trim()].length,
        createdAt: now().toISOString()
      };
      try {
        await mkdir(rootDir, { recursive: true, mode: 0o700 });
        await writeFile(audioPath(result), content, { mode: 0o600, flag: 'wx' });
        await writeFile(metadataPath(id), `${JSON.stringify(result)}\n`, { mode: 0o600, flag: 'wx' });
      } catch {
        await Promise.all([
          rm(audioPath(result), { force: true }),
          rm(metadataPath(id), { force: true })
        ]).catch(() => undefined);
        throw new SmartDubbingError(
          'SMART_DUBBING_STORAGE_FAILED',
          'The generated dubbing could not be stored',
          500
        );
      }
      return result;
    },
    async preview(request) {
      const { content, mime } = await synthesize(request);
      return { content, mime };
    },
    get,
    async read(id) {
      const result = await get(id);
      try {
        return { result, content: await readFile(audioPath(result)) };
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new SmartDubbingError('SMART_DUBBING_RESULT_NOT_FOUND', 'Dubbing audio was not found', 404);
        }
        throw new SmartDubbingError('SMART_DUBBING_STORAGE_FAILED', 'Dubbing audio is unavailable', 500);
      }
    }
  };

  function metadataPath(id: string) {
    return resolve(rootDir, `${id}.json`);
  }

  function audioPath(result: Pick<SmartDubbingResult, 'id' | 'format'>) {
    return resolve(rootDir, `${result.id}.${result.format}`);
  }
}

function validateRequest(request: CreateSmartDubbingRequest) {
  if (!isRecord(request)) {
    throw new SmartDubbingError('VALIDATION_FAILED', 'request body must be an object', 400);
  }
  const text = request.text?.trim();
  if (!text || [...text].length > MAX_TEXT_LENGTH) {
    throw new SmartDubbingError(
      'VALIDATION_FAILED',
      `text must contain between 1 and ${MAX_TEXT_LENGTH} characters`,
      400
    );
  }
  if (!(smartDubbingVoices as readonly string[]).includes(request.voice)) {
    throw new SmartDubbingError('VALIDATION_FAILED', 'voice is invalid', 400);
  }
  if (!(smartDubbingStyles as readonly string[]).includes(request.style)) {
    throw new SmartDubbingError('VALIDATION_FAILED', 'style is invalid', 400);
  }
  if (!Number.isFinite(request.speed) || request.speed < 0.75 || request.speed > 1.25) {
    throw new SmartDubbingError('VALIDATION_FAILED', 'speed must be between 0.75 and 1.25', 400);
  }
  if (request.format !== 'mp3' && request.format !== 'wav') {
    throw new SmartDubbingError('VALIDATION_FAILED', 'format must be mp3 or wav', 400);
  }
}

function validateResultId(id: string) {
  if (!SAFE_RESULT_ID.test(id)) {
    throw new SmartDubbingError('VALIDATION_FAILED', 'result id is invalid', 400);
  }
}

function openAiSpeechEndpoint(baseUrl: string): URL {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return new URL('https://api.openai.com/v1/audio/speech');
  const base = new URL(trimmed);
  if (/\/audio\/speech$/i.test(base.pathname)) return base;
  if (base.pathname === '' || base.pathname === '/') {
    base.pathname = '/v1/audio/speech';
  } else {
    base.pathname = `${base.pathname.replace(/\/$/, '')}/audio/speech`;
  }
  return base;
}

async function fetchAudio(input: {
  endpoint: URL;
  apiKey: string;
  body: string;
  proxy: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const headers = {
    Accept: 'audio/mpeg, audio/wav, application/octet-stream',
    Authorization: `Bearer ${input.apiKey}`,
    'Content-Type': 'application/json'
  };
  if (input.fetchImpl !== undefined || !input.proxy || input.endpoint.protocol !== 'https:') {
    return await (input.fetchImpl ?? fetch)(input.endpoint, {
      method: 'POST',
      headers,
      body: input.body,
      signal: input.signal
    });
  }
  return await new Promise<Response>((resolveResponse, reject) => {
    const request = httpsRequest(input.endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(input.body) },
      agent: new HttpsProxyAgent(input.proxy),
      signal: input.signal
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_AUDIO_BYTES) {
          response.destroy(new Error('Audio response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolveResponse(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 502,
          headers: response.headers as HeadersInit
        }));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(input.body);
  });
}

async function upstreamErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as unknown;
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      return `Dubbing provider rejected the request: ${payload.error.message.slice(0, 300)}`;
    }
  } catch {
    // The upstream may return an HTML or empty error response.
  }
  return `Dubbing provider rejected the request with status ${response.status}`;
}

function isSmartDubbingResult(value: unknown): value is SmartDubbingResult {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.fileName === 'string'
    && (value.mime === 'audio/mpeg' || value.mime === 'audio/wav')
    && typeof value.size === 'number'
    && value.provider === 'openai'
    && typeof value.model === 'string'
    && (smartDubbingVoices as readonly unknown[]).includes(value.voice)
    && (smartDubbingStyles as readonly unknown[]).includes(value.style)
    && typeof value.speed === 'number'
    && (value.format === 'mp3' || value.format === 'wav')
    && typeof value.characterCount === 'number'
    && typeof value.createdAt === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

export function smartDubbingRequestFingerprint(request: CreateSmartDubbingRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}
