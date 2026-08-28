import {
  smartDubbingStyles,
  type CreateSmartDubbingRequest,
  type RuntimeErrorCode,
  type SmartDubbingResult,
  type SmartDubbingStyle
} from '@opencreator/protocol';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  KrillinTtsServiceError,
  type KrillinTtsService
} from '../creator/krillin/tts-service.js';

const MAX_TEXT_LENGTH = 5_000;
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
  ttsService: Pick<KrillinTtsService, 'synthesize'>;
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
    try {
      return await input.ttsService.synthesize({
        text: request.text.trim(),
        voiceId: request.voice.trim(),
        format: request.format,
        speed: request.speed,
        instructions: styleInstructions[request.style]
      });
    } catch (error) {
      throw mapTtsError(error);
    }
  }

  return {
    async generate(request) {
      const synthesis = await synthesize(request);
      const id = createId();
      validateResultId(id);
      const result: SmartDubbingResult = {
        id,
        fileName: `OpenCreator-dubbing-${id}.${synthesis.format}`,
        mime: synthesis.mime,
        size: synthesis.content.length,
        provider: synthesis.provider,
        model: synthesis.model,
        voice: synthesis.voiceId,
        style: request.style,
        speed: request.speed,
        format: synthesis.format,
        characterCount: [...request.text.trim()].length,
        createdAt: now().toISOString()
      };
      try {
        await mkdir(rootDir, { recursive: true, mode: 0o700 });
        await writeFile(audioPath(result), synthesis.content, { mode: 0o600, flag: 'wx' });
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
      const synthesis = await synthesize(request);
      return { content: synthesis.content, mime: synthesis.mime };
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
  if (typeof request.voice !== 'string' || !request.voice.trim() || request.voice.length > 256) {
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

function mapTtsError(error: unknown): SmartDubbingError {
  if (error instanceof KrillinTtsServiceError) {
    if (error.code === 'creator_tts_config_missing') {
      return new SmartDubbingError(
        'SMART_DUBBING_CONFIG_REQUIRED',
        error.message,
        409
      );
    }
    if (error.code === 'unsupported_capability') {
      return new SmartDubbingError(
        'SMART_DUBBING_PROVIDER_UNSUPPORTED',
        error.message,
        409
      );
    }
    return new SmartDubbingError(
      'SMART_DUBBING_UPSTREAM_ERROR',
      error.message,
      error.statusCode >= 500 ? error.statusCode : 502
    );
  }
  return new SmartDubbingError(
    'SMART_DUBBING_UPSTREAM_ERROR',
    error instanceof Error ? error.message : 'The dubbing provider could not be reached',
    502
  );
}

function validateResultId(id: string) {
  if (!SAFE_RESULT_ID.test(id)) {
    throw new SmartDubbingError('VALIDATION_FAILED', 'result id is invalid', 400);
  }
}

function isSmartDubbingResult(value: unknown): value is SmartDubbingResult {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.fileName === 'string'
    && (value.mime === 'audio/mpeg' || value.mime === 'audio/wav')
    && typeof value.size === 'number'
    && (value.provider === 'openai' || value.provider === 'aliyun' || value.provider === 'minimax')
    && typeof value.model === 'string'
    && typeof value.voice === 'string'
    && value.voice.length > 0
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
