import {
  imageGenerationSizes,
  type CreateImageGenerationRequest,
  type ImageGenerationAsset,
  type ImageGenerationResult,
  type RuntimeErrorCode
} from '@opencreator/protocol';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { isRecord } from '../creator-services/upstream-fetch.js';
import {
  generateImageContents,
  ImageGenerationProviderError
} from './provider.js';

const MAX_PROMPT_LENGTH = 4_000;
const SAFE_RESULT_ID = /^[A-Za-z0-9_-]{12,64}$/;
const imageProviders = ['openai', 'jimeng', 'kling', 'gemini'] as const;

export type ImageGenerationService = {
  generate(request: CreateImageGenerationRequest): Promise<ImageGenerationResult>;
  get(id: string): Promise<ImageGenerationResult>;
  read(id: string, index: number): Promise<{
    result: ImageGenerationResult;
    asset: ImageGenerationAsset;
    content: Buffer;
  }>;
};

export class ImageGenerationError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode,
      | 'VALIDATION_FAILED'
      | 'IMAGE_GENERATION_CONFIG_REQUIRED'
      | 'IMAGE_GENERATION_UPSTREAM_ERROR'
      | 'IMAGE_GENERATION_RESULT_NOT_FOUND'
      | 'IMAGE_GENERATION_STORAGE_FAILED'>,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'ImageGenerationError';
  }
}

export function createImageGenerationService(input: {
  dataDir: string;
  configStore: CreatorServicesConfigStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
}): ImageGenerationService {
  const rootDir = resolve(input.dataDir, 'image-generation');
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? (() => randomBytes(12).toString('base64url'));

  async function get(id: string): Promise<ImageGenerationResult> {
    validateResultId(id);
    try {
      const value = JSON.parse(await readFile(metadataPath(id), 'utf8')) as unknown;
      if (!isImageGenerationResult(value) || value.id !== id) throw new Error('invalid metadata');
      return value;
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new ImageGenerationError('IMAGE_GENERATION_RESULT_NOT_FOUND', 'Image result was not found', 404);
      }
      if (error instanceof ImageGenerationError) throw error;
      throw new ImageGenerationError('IMAGE_GENERATION_STORAGE_FAILED', 'Image result metadata is unavailable', 500);
    }
  }

  return {
    async generate(request) {
      validateRequest(request);
      const config = await input.configStore.read();
      let generated: Awaited<ReturnType<typeof generateImageContents>>;
      try {
        generated = await generateImageContents(request, config, { fetchImpl: input.fetchImpl });
      } catch (error) {
        throw mapProviderError(error);
      }

      const id = createId();
      validateResultId(id);
      const images: ImageGenerationAsset[] = generated.contents.map(({ content, mime }, index) => ({
        index,
        fileName: `OpenCreator-image-${id}-${index + 1}.${extensionForMime(mime)}`,
        mime,
        size: content.length
      }));
      const result: ImageGenerationResult = {
        id,
        prompt: request.prompt.trim(),
        provider: request.provider,
        model: generated.model,
        imageSize: request.size,
        quality: request.quality,
        count: images.length,
        images,
        createdAt: now().toISOString()
      };
      try {
        await mkdir(resultDir(id), { recursive: true, mode: 0o700 });
        await Promise.all(images.map((asset, index) => (
          writeFile(assetPath(id, asset), generated.contents[index]!.content, { mode: 0o600, flag: 'wx' })
        )));
        await writeFile(metadataPath(id), `${JSON.stringify(result)}\n`, { mode: 0o600, flag: 'wx' });
      } catch {
        await rm(resultDir(id), { recursive: true, force: true }).catch(() => undefined);
        throw new ImageGenerationError(
          'IMAGE_GENERATION_STORAGE_FAILED',
          'The generated images could not be stored',
          500
        );
      }
      return result;
    },
    get,
    async read(id, index) {
      const result = await get(id);
      const asset = result.images.find(item => item.index === index);
      if (!asset) {
        throw new ImageGenerationError('IMAGE_GENERATION_RESULT_NOT_FOUND', 'Generated image was not found', 404);
      }
      try {
        return { result, asset, content: await readFile(assetPath(id, asset)) };
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new ImageGenerationError('IMAGE_GENERATION_RESULT_NOT_FOUND', 'Generated image was not found', 404);
        }
        throw new ImageGenerationError('IMAGE_GENERATION_STORAGE_FAILED', 'Generated image is unavailable', 500);
      }
    }
  };

  function resultDir(id: string) {
    return resolve(rootDir, id);
  }

  function metadataPath(id: string) {
    return resolve(resultDir(id), 'result.json');
  }

  function assetPath(id: string, asset: Pick<ImageGenerationAsset, 'index' | 'mime'>) {
    return resolve(resultDir(id), `${asset.index}.${extensionForMime(asset.mime)}`);
  }
}

function mapProviderError(error: unknown): ImageGenerationError {
  if (error instanceof ImageGenerationProviderError) {
    return error.code === 'config_missing'
      ? new ImageGenerationError('IMAGE_GENERATION_CONFIG_REQUIRED', error.message, 409)
      : new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', error.message, 502);
  }
  return new ImageGenerationError(
    'IMAGE_GENERATION_UPSTREAM_ERROR',
    error instanceof Error ? error.message : 'The image generation provider could not be reached',
    502
  );
}

function validateRequest(request: CreateImageGenerationRequest) {
  if (!isRecord(request)) {
    throw new ImageGenerationError('VALIDATION_FAILED', 'request body must be an object', 400);
  }
  const prompt = request.prompt?.trim();
  if (!prompt || [...prompt].length > MAX_PROMPT_LENGTH) {
    throw new ImageGenerationError(
      'VALIDATION_FAILED',
      `prompt must contain between 1 and ${MAX_PROMPT_LENGTH} characters`,
      400
    );
  }
  if (!(imageProviders as readonly unknown[]).includes(request.provider)) {
    throw new ImageGenerationError('VALIDATION_FAILED', 'image provider is invalid', 400);
  }
  if (!(imageGenerationSizes as readonly unknown[]).includes(request.size)) {
    throw new ImageGenerationError('VALIDATION_FAILED', 'image size is invalid', 400);
  }
  if (request.quality !== 'low' && request.quality !== 'medium' && request.quality !== 'high') {
    throw new ImageGenerationError('VALIDATION_FAILED', 'image quality is invalid', 400);
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 4) {
    throw new ImageGenerationError('VALIDATION_FAILED', 'image count must be between 1 and 4', 400);
  }
}

function validateResultId(id: string) {
  if (!SAFE_RESULT_ID.test(id)) {
    throw new ImageGenerationError('VALIDATION_FAILED', 'result id is invalid', 400);
  }
}

function extensionForMime(mime: ImageGenerationAsset['mime']) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function isImageGenerationResult(value: unknown): value is ImageGenerationResult {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.prompt === 'string'
    && (imageProviders as readonly unknown[]).includes(value.provider)
    && typeof value.model === 'string'
    && (imageGenerationSizes as readonly unknown[]).includes(value.imageSize)
    && (value.quality === 'low' || value.quality === 'medium' || value.quality === 'high')
    && typeof value.count === 'number'
    && Array.isArray(value.images)
    && value.images.every(isImageAsset)
    && typeof value.createdAt === 'string';
}

function isImageAsset(value: unknown): value is ImageGenerationAsset {
  return isRecord(value)
    && typeof value.index === 'number'
    && typeof value.fileName === 'string'
    && (value.mime === 'image/png' || value.mime === 'image/jpeg' || value.mime === 'image/webp')
    && typeof value.size === 'number';
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
