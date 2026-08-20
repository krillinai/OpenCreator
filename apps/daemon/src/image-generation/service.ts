import {
  imageGenerationSizes,
  type CreateImageGenerationRequest,
  type CreatorServicesConfig,
  type ImageGenerationAsset,
  type ImageGenerationResult,
  type RuntimeErrorCode
} from '@opencreator/protocol';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { createKlingAuthorization } from '../creator-services/kling-auth.js';
import {
  appendEndpointPath,
  creatorProviderEndpoint,
  creatorServiceErrorMessage,
  fetchCreatorService,
  isRecord,
  openAiCompatibleEndpoint
} from '../creator-services/upstream-fetch.js';

const MAX_PROMPT_LENGTH = 4_000;
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 120 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
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
      const { model, contents } = await generateImageContents(request, config, input.fetchImpl);

      const id = createId();
      validateResultId(id);
      const images: ImageGenerationAsset[] = contents.map(({ content, mime }, index) => ({
        index,
        fileName: `OpenCreator-image-${id}-${index + 1}.${extensionForMime(mime)}`,
        mime,
        size: content.length
      }));
      const result: ImageGenerationResult = {
        id,
        prompt: request.prompt.trim(),
        provider: request.provider,
        model,
        imageSize: request.size,
        quality: request.quality,
        count: images.length,
        images,
        createdAt: now().toISOString()
      };
      try {
        await mkdir(resultDir(id), { recursive: true, mode: 0o700 });
        await Promise.all(images.map((asset, index) => (
          writeFile(assetPath(id, asset), contents[index]!.content, { mode: 0o600, flag: 'wx' })
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

async function generateImageContents(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  fetchImpl?: typeof fetch
): Promise<{ model: string; contents: Array<{ content: Buffer; mime: ImageGenerationAsset['mime'] }> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref();
  try {
    if (request.provider === 'gemini') {
      return await generateGeminiImages(request, config, controller.signal, fetchImpl);
    }
    if (request.provider === 'kling') {
      return await generateKlingImages(request, config, controller.signal, fetchImpl);
    }
    return await generateOpenAiImages(request, config, controller.signal, fetchImpl);
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    throw new ImageGenerationError(
      'IMAGE_GENERATION_UPSTREAM_ERROR',
      'The image generation provider could not be reached',
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function generateOpenAiImages(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
) {
  const provider = request.provider === 'jimeng' ? config.image.jimeng : config.image.openai;
  if (!provider.apiKey.trim()) missingConfig(request.provider);
  const model = provider.model.trim() || (request.provider === 'jimeng' ? 'doubao-seedream-4-0-250828' : 'gpt-image-1');
  const endpoint = openAiCompatibleEndpoint(provider.baseUrl, 'images/generations');
  const response = await fetchCreatorService({
    endpoint,
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: request.prompt.trim(),
      size: request.size,
      quality: request.quality,
      n: request.count
    }),
    proxy: config.proxy.trim(),
    signal,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    fetchImpl
  });
  if (!response.ok) {
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', await creatorServiceErrorMessage(response, 'Image generation'), 502);
  }
  const contents = await readGeneratedImages(await response.json() as unknown, {
    apiKey: provider.apiKey,
    authOrigin: endpoint.origin,
    proxy: config.proxy.trim(),
    signal,
    fetchImpl
  });
  return { model, contents };
}

async function generateGeminiImages(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
) {
  const provider = config.image.gemini;
  if (!provider.apiKey.trim()) missingConfig('gemini');
  const model = provider.model.trim() || 'gemini-2.5-flash-image';
  const endpoint = creatorProviderEndpoint(
    provider.baseUrl,
    'https://generativelanguage.googleapis.com/v1beta',
    `models/${encodeURIComponent(model)}:generateContent`
  );
  const generated = await Promise.all(Array.from({ length: request.count }, async () => {
    const response = await fetchCreatorService({
      endpoint,
      method: 'POST',
      headers: { 'x-goog-api-key': provider.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt.trim() }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: imageAspectRatio(request.size) }
        }
      }),
      proxy: config.proxy.trim(),
      signal,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      fetchImpl
    });
    if (!response.ok) {
      throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', await creatorServiceErrorMessage(response, 'Gemini image'), 502);
    }
    const payload = await response.json() as unknown;
    const part = findGeminiImagePart(payload);
    if (!part) {
      throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'Gemini returned no image data', 502);
    }
    const content = Buffer.from(part.data, 'base64');
    validateImageContent(content);
    return { content, mime: mimeFromHeader(part.mime) ?? detectImageMime(content) };
  }));
  return { model, contents: generated };
}

async function generateKlingImages(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
) {
  const provider = config.image.kling;
  if (!provider.accessKey.trim() || !provider.secretKey.trim()) missingConfig('kling');
  const model = provider.model.trim() || 'kling-v2-1';
  const endpoint = creatorProviderEndpoint(
    provider.baseUrl,
    'https://api-beijing.klingai.com',
    'v1/images/generations'
  );
  const response = await fetchCreatorService({
    endpoint,
    method: 'POST',
    headers: {
      Authorization: createKlingAuthorization(provider.accessKey, provider.secretKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model_name: model,
      prompt: request.prompt.trim(),
      aspect_ratio: imageAspectRatio(request.size),
      n: request.count
    }),
    proxy: config.proxy.trim(),
    signal,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    fetchImpl
  });
  if (!response.ok) {
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', await creatorServiceErrorMessage(response, 'Kling image'), 502);
  }
  let payload = await response.json() as unknown;
  const taskId = readNestedString(payload, ['data', 'task_id']);
  if (!taskId) {
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'Kling returned an invalid image task', 502);
  }
  for (;;) {
    const status = readNestedString(payload, ['data', 'task_status']);
    if (status === 'succeed' || status === 'succeeded' || status === 'completed') break;
    if (status === 'failed') {
      throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'Kling image generation failed', 502);
    }
    await waitForRetry(signal);
    const statusResponse = await fetchCreatorService({
      endpoint: appendEndpointPath(endpoint, taskId),
      method: 'GET',
      headers: { Authorization: createKlingAuthorization(provider.accessKey, provider.secretKey) },
      proxy: config.proxy.trim(),
      signal,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      fetchImpl
    });
    if (!statusResponse.ok) {
      throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', await creatorServiceErrorMessage(statusResponse, 'Kling image'), 502);
    }
    payload = await statusResponse.json() as unknown;
  }
  const items = readNestedArray(payload, ['data', 'task_result', 'images']);
  if (!items?.length) {
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'Kling returned no generated images', 502);
  }
  const contents = await readGeneratedImages({ data: items }, {
    apiKey: '',
    authOrigin: endpoint.origin,
    proxy: config.proxy.trim(),
    signal,
    fetchImpl
  });
  return { model, contents };
}

function missingConfig(provider: CreateImageGenerationRequest['provider']): never {
  throw new ImageGenerationError(
    'IMAGE_GENERATION_CONFIG_REQUIRED',
    `Configure ${provider} image generation credentials before generating images`,
    409
  );
}

function imageAspectRatio(size: CreateImageGenerationRequest['size']) {
  if (size === '1536x1024') return '3:2';
  if (size === '1024x1536') return '2:3';
  return '1:1';
}

function findGeminiImagePart(payload: unknown): { data: string; mime: string | null } | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return undefined;
  for (const candidate of payload.candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) continue;
    for (const part of candidate.content.parts) {
      if (!isRecord(part)) continue;
      const inline = isRecord(part.inlineData) ? part.inlineData : isRecord(part.inline_data) ? part.inline_data : undefined;
      if (inline && typeof inline.data === 'string') {
        const mime = typeof inline.mimeType === 'string' ? inline.mimeType : typeof inline.mime_type === 'string' ? inline.mime_type : null;
        return { data: inline.data, mime };
      }
    }
  }
  return undefined;
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function readNestedArray(value: unknown, path: string[]): unknown[] | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return Array.isArray(current) ? current : undefined;
}

async function waitForRetry(signal: AbortSignal) {
  await new Promise<void>((resolveWait, reject) => {
    const timer = setTimeout(resolveWait, 1_500);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function readGeneratedImages(
  payload: unknown,
  input: { apiKey: string; authOrigin: string; proxy: string; signal: AbortSignal; fetchImpl?: typeof fetch }
): Promise<Array<{ content: Buffer; mime: ImageGenerationAsset['mime'] }>> {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The image provider returned no images', 502);
  }
  const images = await Promise.all(payload.data.slice(0, 4).map(async item => {
    if (!isRecord(item)) {
      throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The image provider returned invalid image data', 502);
    }
    if (typeof item.b64_json === 'string') {
      const content = Buffer.from(item.b64_json, 'base64');
      validateImageContent(content);
      return { content, mime: detectImageMime(content) };
    }
    if (typeof item.url === 'string') {
      let endpoint: URL;
      try {
        endpoint = new URL(item.url);
      } catch {
        throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The image provider returned an invalid image URL', 502);
      }
      if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
        throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The image provider returned an unsupported image URL', 502);
      }
      const response = await fetchCreatorService({
        endpoint,
        method: 'GET',
        headers: endpoint.origin === input.authOrigin
          ? { Authorization: `Bearer ${input.apiKey}` }
          : {},
        proxy: input.proxy,
        signal: input.signal,
        maxResponseBytes: MAX_IMAGE_BYTES,
        fetchImpl: input.fetchImpl
      });
      if (!response.ok) {
        throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The generated image could not be downloaded', 502);
      }
      const content = Buffer.from(await response.arrayBuffer());
      validateImageContent(content);
      return { content, mime: mimeFromHeader(response.headers.get('content-type')) ?? detectImageMime(content) };
    }
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The image provider returned invalid image data', 502);
  }));
  return images;
}

function validateRequest(request: CreateImageGenerationRequest) {
  if (!isRecord(request)) {
    throw new ImageGenerationError('VALIDATION_FAILED', 'request body must be an object', 400);
  }
  const prompt = request.prompt?.trim();
  if (!prompt || [...prompt].length > MAX_PROMPT_LENGTH) {
    throw new ImageGenerationError('VALIDATION_FAILED', `prompt must contain between 1 and ${MAX_PROMPT_LENGTH} characters`, 400);
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

function validateImageContent(content: Buffer) {
  if (content.length === 0 || content.length > MAX_IMAGE_BYTES) {
    throw new ImageGenerationError('IMAGE_GENERATION_UPSTREAM_ERROR', 'The image provider returned an invalid image file', 502);
  }
}

function detectImageMime(content: Buffer): ImageGenerationAsset['mime'] {
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (content[0] === 0xff && content[1] === 0xd8) return 'image/jpeg';
  if (content.subarray(0, 4).toString('ascii') === 'RIFF' && content.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

function mimeFromHeader(value: string | null): ImageGenerationAsset['mime'] | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') return mime;
  return undefined;
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
