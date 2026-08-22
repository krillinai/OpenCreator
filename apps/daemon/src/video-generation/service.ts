import {
  videoGenerationDurations,
  videoGenerationSizes,
  type CreateVideoGenerationRequest,
  type RuntimeErrorCode,
  type VideoGenerationProvider,
  type VideoGenerationResult,
  type VideoGenerationStatus
} from '@opencreator/protocol';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CreatorServicesConfig } from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../creator-services/config-store.js';
import { createKlingAuthorization } from '../creator-services/kling-auth.js';
import {
  appendEndpointPath,
  creatorProviderEndpoint,
  creatorServiceErrorMessage,
  fetchCreatorService,
  isRecord
} from '../creator-services/upstream-fetch.js';

const MAX_PROMPT_LENGTH = 4_000;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const SAFE_RESULT_ID = /^[A-Za-z0-9_-]{12,64}$/;
const videoProviders = ['seedance', 'kling', 'veo'] as const;

type StoredVideoGeneration = {
  result: VideoGenerationResult;
  upstreamId: string;
  generationMode?: 'text-to-video' | 'image-to-video';
};

export type VideoGenerationService = {
  create(request: CreateVideoGenerationRequest): Promise<VideoGenerationResult>;
  get(id: string): Promise<VideoGenerationResult>;
  refresh(id: string): Promise<VideoGenerationResult>;
  read(id: string): Promise<{ result: VideoGenerationResult; content: Buffer }>;
};

export class VideoGenerationError extends Error {
  constructor(
    readonly code: Extract<RuntimeErrorCode,
      | 'VALIDATION_FAILED'
      | 'VIDEO_GENERATION_CONFIG_REQUIRED'
      | 'VIDEO_GENERATION_UPSTREAM_ERROR'
      | 'VIDEO_GENERATION_RESULT_NOT_FOUND'
      | 'VIDEO_GENERATION_NOT_READY'
      | 'VIDEO_GENERATION_STORAGE_FAILED'>,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'VideoGenerationError';
  }
}

export function createVideoGenerationService(input: {
  dataDir: string;
  configStore: CreatorServicesConfigStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  createId?: () => string;
}): VideoGenerationService {
  const rootDir = resolve(input.dataDir, 'video-generation');
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? (() => randomBytes(12).toString('base64url'));

  async function readStored(id: string): Promise<StoredVideoGeneration> {
    validateResultId(id);
    try {
      const value = JSON.parse(await readFile(metadataPath(id), 'utf8')) as unknown;
      if (!isStoredVideoGeneration(value) || value.result.id !== id) throw new Error('invalid metadata');
      return value;
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new VideoGenerationError('VIDEO_GENERATION_RESULT_NOT_FOUND', 'Video generation job was not found', 404);
      }
      if (error instanceof VideoGenerationError) throw error;
      throw new VideoGenerationError('VIDEO_GENERATION_STORAGE_FAILED', 'Video generation metadata is unavailable', 500);
    }
  }

  async function writeStored(value: StoredVideoGeneration) {
    try {
      await mkdir(resultDir(value.result.id), { recursive: true, mode: 0o700 });
      await writeFile(metadataPath(value.result.id), `${JSON.stringify(value)}\n`, { mode: 0o600 });
    } catch {
      throw new VideoGenerationError('VIDEO_GENERATION_STORAGE_FAILED', 'Video generation metadata could not be stored', 500);
    }
  }

  async function completeFromPayload(
    stored: StoredVideoGeneration,
    payload: Record<string, unknown>,
    config: CreatorServicesConfig
  ): Promise<StoredVideoGeneration> {
    const download = resolveVideoDownload(stored, payload, config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    timeout.unref();
    let response: Response;
    try {
      response = await fetchCreatorService({
        endpoint: download.endpoint,
        method: 'GET',
        headers: download.headers,
        proxy: config.proxy.trim(),
        signal: controller.signal,
        maxResponseBytes: MAX_VIDEO_BYTES,
        fetchImpl: input.fetchImpl
      });
    } catch {
      throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The generated video could not be downloaded', 502);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new VideoGenerationError(
        'VIDEO_GENERATION_UPSTREAM_ERROR',
        await creatorServiceErrorMessage(response, 'Video download'),
        502
      );
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length === 0 || content.length > MAX_VIDEO_BYTES) {
      throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The video provider returned an invalid video file', 502);
    }
    const result: VideoGenerationResult = {
      ...stored.result,
      status: 'completed',
      progress: 100,
      fileName: `OpenCreator-video-${stored.result.id}.mp4`,
      mime: 'video/mp4',
      size: content.length,
      error: undefined,
      updatedAt: now().toISOString()
    };
    try {
      await writeFile(videoPath(result.id), content, { mode: 0o600, flag: 'wx' });
      await writeStored({ ...stored, result });
    } catch (error) {
      await rm(videoPath(result.id), { force: true }).catch(() => undefined);
      if (error instanceof VideoGenerationError) throw error;
      throw new VideoGenerationError('VIDEO_GENERATION_STORAGE_FAILED', 'The generated video could not be stored', 500);
    }
    return { ...stored, result };
  }

  return {
    async create(request) {
      validateRequest(request);
      const config = await input.configStore.read();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timeout.unref();
      let remote: RemoteVideoJob;
      try {
        remote = await createRemoteVideoJob(request, config, controller.signal, input.fetchImpl);
      } catch (error) {
        if (error instanceof VideoGenerationError) throw error;
        throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The video generation provider could not be reached', 502);
      } finally {
        clearTimeout(timeout);
      }

      const id = createId();
      validateResultId(id);
      const timestamp = now().toISOString();
      let stored: StoredVideoGeneration = {
        upstreamId: remote.upstreamId,
        generationMode: request.referenceImage ? 'image-to-video' : 'text-to-video',
        result: {
          id,
          prompt: request.prompt.trim(),
          provider: request.provider,
          model: remote.model,
          videoSize: request.size,
          duration: request.duration,
          status: remote.status,
          progress: remote.progress,
          error: remote.error,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      };
      try {
        await mkdir(resultDir(id), { recursive: true, mode: 0o700 });
        if (remote.status === 'completed') {
          stored = await completeFromPayload(stored, remote.payload, config);
        } else {
          await writeStored(stored);
        }
      } catch (error) {
        await rm(resultDir(id), { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      return stored.result;
    },
    async get(id) {
      return (await readStored(id)).result;
    },
    async refresh(id) {
      let stored = await readStored(id);
      if (stored.result.status === 'completed' || stored.result.status === 'failed') return stored.result;
      const config = await input.configStore.read();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timeout.unref();
      let remote: RemoteVideoJob;
      try {
        remote = await refreshRemoteVideoJob(stored, config, controller.signal, input.fetchImpl);
      } catch (error) {
        if (error instanceof VideoGenerationError) throw error;
        throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The video generation status could not be refreshed', 502);
      } finally {
        clearTimeout(timeout);
      }

      stored = {
        ...stored,
        result: {
          ...stored.result,
          status: remote.status,
          progress: remote.progress,
          error: remote.error,
          updatedAt: now().toISOString()
        }
      };
      if (remote.status === 'completed') {
        stored = await completeFromPayload(stored, remote.payload, config);
      } else {
        await writeStored(stored);
      }
      return stored.result;
    },
    async read(id) {
      const stored = await readStored(id);
      if (stored.result.status !== 'completed' || !stored.result.fileName || !stored.result.mime) {
        throw new VideoGenerationError('VIDEO_GENERATION_NOT_READY', 'Generated video is not ready', 409);
      }
      try {
        return { result: stored.result, content: await readFile(videoPath(id)) };
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new VideoGenerationError('VIDEO_GENERATION_RESULT_NOT_FOUND', 'Generated video file was not found', 404);
        }
        throw new VideoGenerationError('VIDEO_GENERATION_STORAGE_FAILED', 'Generated video is unavailable', 500);
      }
    }
  };

  function resultDir(id: string) {
    return resolve(rootDir, id);
  }

  function metadataPath(id: string) {
    return resolve(resultDir(id), 'result.json');
  }

  function videoPath(id: string) {
    return resolve(resultDir(id), 'video.mp4');
  }
}

type RemoteVideoJob = {
  upstreamId: string;
  model: string;
  payload: Record<string, unknown>;
  status: VideoGenerationStatus;
  progress: number;
  error?: string;
};

async function createRemoteVideoJob(
  request: CreateVideoGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<RemoteVideoJob> {
  if (request.provider === 'kling') return await createKlingVideoJob(request, config, signal, fetchImpl);
  if (request.provider === 'veo') return await createVeoVideoJob(request, config, signal, fetchImpl);
  return await createSeedanceVideoJob(request, config, signal, fetchImpl);
}

async function refreshRemoteVideoJob(
  stored: StoredVideoGeneration,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
): Promise<RemoteVideoJob> {
  const provider = stored.result.provider;
  let endpoint: URL;
  let headers: Record<string, string>;
  if (provider === 'kling') {
    const settings = config.video.kling;
    requireKlingConfig(settings.accessKey, settings.secretKey, 'kling');
    endpoint = appendEndpointPath(
      klingVideoEndpoint(settings.baseUrl, stored.generationMode === 'image-to-video'),
      stored.upstreamId
    );
    headers = { Authorization: createKlingAuthorization(settings.accessKey, settings.secretKey) };
  } else if (provider === 'veo') {
    const settings = config.video.veo;
    requireApiKey(settings.apiKey, 'veo');
    endpoint = creatorProviderEndpoint(
      settings.baseUrl,
      'https://generativelanguage.googleapis.com/v1beta',
      stored.upstreamId
    );
    headers = { 'x-goog-api-key': settings.apiKey };
  } else {
    const settings = config.video.seedance;
    requireApiKey(settings.apiKey, 'seedance');
    endpoint = appendEndpointPath(seedanceVideoEndpoint(settings.baseUrl), stored.upstreamId);
    headers = { Authorization: `Bearer ${settings.apiKey}` };
  }
  const payload = await requestVideoJson({ endpoint, method: 'GET', headers, config, signal, fetchImpl });
  return normalizeRemoteVideoJob(provider, stored.upstreamId, stored.result.model, payload);
}

async function createSeedanceVideoJob(
  request: CreateVideoGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
) {
  const settings = config.video.seedance;
  requireApiKey(settings.apiKey, 'seedance');
  const model = settings.model.trim() || 'doubao-seedance-1-0-pro-250528';
  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: request.prompt.trim() }
  ];
  if (request.referenceImage) {
    content.push({
      type: 'image_url',
      image_url: {
        url: referenceImageDataUrl(request.referenceImage)
      }
    });
  }
  const payload = await requestVideoJson({
    endpoint: seedanceVideoEndpoint(settings.baseUrl),
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      content,
      ratio: videoAspectRatio(request.size),
      duration: request.duration,
      watermark: false
    }),
    config,
    signal,
    fetchImpl
  });
  const upstreamId = readString(payload, ['id']);
  if (!upstreamId) invalidRemoteJob('Seedance');
  return normalizeRemoteVideoJob('seedance', upstreamId, model, payload);
}

async function createKlingVideoJob(
  request: CreateVideoGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
) {
  const settings = config.video.kling;
  requireKlingConfig(settings.accessKey, settings.secretKey, 'kling');
  const model = settings.model.trim() || 'kling-v2-1-master';
  const payload = await requestVideoJson({
    endpoint: klingVideoEndpoint(settings.baseUrl, request.referenceImage !== undefined),
    method: 'POST',
    headers: {
      Authorization: createKlingAuthorization(settings.accessKey, settings.secretKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model_name: model,
      prompt: request.prompt.trim(),
      ...(request.referenceImage ? { image: request.referenceImage.data } : {}),
      mode: 'std',
      duration: String(request.duration),
      aspect_ratio: videoAspectRatio(request.size)
    }),
    config,
    signal,
    fetchImpl
  });
  const upstreamId = readString(payload, ['data', 'task_id']);
  if (!upstreamId) invalidRemoteJob('Kling');
  return normalizeRemoteVideoJob('kling', upstreamId, model, payload);
}

async function createVeoVideoJob(
  request: CreateVideoGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  fetchImpl?: typeof fetch
) {
  const settings = config.video.veo;
  requireApiKey(settings.apiKey, 'veo');
  const model = settings.model.trim() || 'veo-3.1-generate-preview';
  const instance = {
    prompt: request.prompt.trim(),
    ...(request.referenceImage ? {
      image: {
        bytesBase64Encoded: request.referenceImage.data,
        mimeType: request.referenceImage.mime
      }
    } : {})
  };
  const payload = await requestVideoJson({
    endpoint: creatorProviderEndpoint(
      settings.baseUrl,
      'https://generativelanguage.googleapis.com/v1beta',
      `models/${encodeURIComponent(model)}:predictLongRunning`
    ),
    method: 'POST',
    headers: { 'x-goog-api-key': settings.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [instance],
      parameters: {
        aspectRatio: videoAspectRatio(request.size),
        durationSeconds: request.duration,
        sampleCount: 1
      }
    }),
    config,
    signal,
    fetchImpl
  });
  const upstreamId = readString(payload, ['name']);
  if (!upstreamId) invalidRemoteJob('Veo');
  return normalizeRemoteVideoJob('veo', upstreamId, model, payload);
}

async function requestVideoJson(input: {
  endpoint: URL;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  config: CreatorServicesConfig;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const response = await fetchCreatorService({
    endpoint: input.endpoint,
    method: input.method,
    headers: input.headers,
    body: input.body,
    proxy: input.config.proxy.trim(),
    signal: input.signal,
    maxResponseBytes: MAX_JSON_BYTES,
    fetchImpl: input.fetchImpl
  });
  if (!response.ok) {
    throw new VideoGenerationError(
      'VIDEO_GENERATION_UPSTREAM_ERROR',
      await creatorServiceErrorMessage(response, 'Video generation'),
      502
    );
  }
  const payload = await response.json() as unknown;
  if (!isRecord(payload)) invalidRemoteJob('Video provider');
  return payload;
}

function normalizeRemoteVideoJob(
  provider: VideoGenerationProvider,
  upstreamId: string,
  model: string,
  payload: Record<string, unknown>
): RemoteVideoJob {
  let rawStatus: unknown;
  let progress: unknown;
  if (provider === 'kling') {
    rawStatus = readValue(payload, ['data', 'task_status']);
    progress = readValue(payload, ['data', 'task_progress']);
  } else if (provider === 'veo') {
    rawStatus = isRecord(payload.error) ? 'failed' : payload.done === true ? 'completed' : 'in_progress';
    progress = payload.done === true ? 100 : 10;
  } else {
    rawStatus = payload.status;
    progress = payload.progress;
  }
  const status = normalizeStatus(rawStatus);
  return {
    upstreamId,
    model,
    payload,
    status,
    progress: readProgress(progress, status),
    error: status === 'failed' ? readJobError(payload) : undefined
  };
}

function resolveVideoDownload(
  stored: StoredVideoGeneration,
  payload: Record<string, unknown>,
  config: CreatorServicesConfig
): { endpoint: URL; headers: Record<string, string> } {
  const urlValue = stored.result.provider === 'kling'
    ? readString(payload, ['data', 'task_result', 'videos', '0', 'url'])
    : stored.result.provider === 'veo'
      ? readString(payload, ['response', 'generateVideoResponse', 'generatedSamples', '0', 'video', 'uri'])
        ?? readString(payload, ['response', 'generatedVideos', '0', 'video', 'uri'])
      : readString(payload, ['content', 'video_url'])
        ?? readString(payload, ['content', 'videoUrl'])
        ?? readString(payload, ['output_url']);
  if (!urlValue) {
    throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The video provider returned no downloadable video', 502);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(urlValue);
  } catch {
    throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The video provider returned an invalid download URL', 502);
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', 'The video provider returned an unsupported download URL', 502);
  }
  return {
    endpoint,
    headers: stored.result.provider === 'veo'
      && endpoint.origin === new URL(config.video.veo.baseUrl.trim() || 'https://generativelanguage.googleapis.com/v1beta').origin
      ? { 'x-goog-api-key': config.video.veo.apiKey }
      : {}
  };
}

function seedanceVideoEndpoint(baseUrl: string) {
  return creatorProviderEndpoint(
    baseUrl,
    'https://ark.cn-beijing.volces.com/api/v3',
    'contents/generations/tasks'
  );
}

function klingVideoEndpoint(baseUrl: string, imageToVideo = false) {
  return creatorProviderEndpoint(
    baseUrl,
    'https://api-beijing.klingai.com',
    imageToVideo ? 'v1/videos/image2video' : 'v1/videos/text2video'
  );
}

function referenceImageDataUrl(referenceImage: NonNullable<CreateVideoGenerationRequest['referenceImage']>) {
  return `data:${referenceImage.mime};base64,${referenceImage.data}`;
}

function videoAspectRatio(size: CreateVideoGenerationRequest['size']) {
  if (size === '720x1280') return '9:16';
  if (size === '1024x1024') return '1:1';
  return '16:9';
}

function requireApiKey(apiKey: string, provider: string): asserts apiKey is string {
  if (!apiKey.trim()) missingVideoConfig(provider);
}

function requireKlingConfig(accessKey: string, secretKey: string, provider: string) {
  if (!accessKey.trim() || !secretKey.trim()) missingVideoConfig(provider);
}

function missingVideoConfig(provider: string): never {
  throw new VideoGenerationError(
    'VIDEO_GENERATION_CONFIG_REQUIRED',
    `Configure ${provider} video generation credentials before generating video`,
    409
  );
}

function invalidRemoteJob(provider: string): never {
  throw new VideoGenerationError('VIDEO_GENERATION_UPSTREAM_ERROR', `${provider} returned an invalid video job`, 502);
}

function readString(value: unknown, path: string[]): string | undefined {
  const result = readValue(value, path);
  return typeof result === 'string' ? result : undefined;
}

function readValue(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isRecord(current)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function normalizeStatus(value: unknown): VideoGenerationStatus {
  if (value === 'completed' || value === 'succeeded' || value === 'succeed' || value === 'success') return 'completed';
  if (value === 'failed' || value === 'cancelled' || value === 'canceled') return 'failed';
  if (value === 'in_progress' || value === 'processing' || value === 'running') return 'in_progress';
  return 'queued';
}

function readProgress(value: unknown, status: VideoGenerationStatus): number {
  if (status === 'completed') return 100;
  if (typeof value !== 'number' || !Number.isFinite(value)) return status === 'in_progress' ? 10 : 0;
  return Math.max(0, Math.min(99, Math.round(value)));
}

function readJobError(payload: Record<string, unknown>): string {
  if (typeof payload.error === 'string') return payload.error.slice(0, 500);
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message.slice(0, 500);
  const klingMessage = readString(payload, ['data', 'task_status_msg']);
  if (klingMessage) return klingMessage.slice(0, 500);
  return 'Video generation failed';
}

function validateRequest(request: CreateVideoGenerationRequest) {
  if (!isRecord(request)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'request body must be an object', 400);
  }
  const prompt = request.prompt?.trim();
  if (!prompt || [...prompt].length > MAX_PROMPT_LENGTH) {
    throw new VideoGenerationError('VALIDATION_FAILED', `prompt must contain between 1 and ${MAX_PROMPT_LENGTH} characters`, 400);
  }
  if (!(videoProviders as readonly unknown[]).includes(request.provider)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'video provider is invalid', 400);
  }
  if (!(videoGenerationSizes as readonly unknown[]).includes(request.size)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'video size is invalid', 400);
  }
  if (!(videoGenerationDurations as readonly unknown[]).includes(request.duration)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'video duration is invalid', 400);
  }
  const validDurations = request.provider === 'veo' ? [4, 6, 8] : [5, 10];
  if (!validDurations.includes(request.duration)) {
    throw new VideoGenerationError('VALIDATION_FAILED', `video duration is not supported by ${request.provider}`, 400);
  }
  validateReferenceImage(request.referenceImage);
}

function validateReferenceImage(referenceImage: CreateVideoGenerationRequest['referenceImage']) {
  if (referenceImage === undefined) return;
  if (!isRecord(referenceImage)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'reference image must be an object', 400);
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(referenceImage.mime)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'reference image type is invalid', 400);
  }
  if (
    typeof referenceImage.data !== 'string'
    || referenceImage.data.length === 0
    || referenceImage.data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(referenceImage.data)
  ) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'reference image data is invalid', 400);
  }
  const content = Buffer.from(referenceImage.data, 'base64');
  if (content.length === 0 || content.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new VideoGenerationError(
      'VALIDATION_FAILED',
      `reference image must be no larger than ${MAX_REFERENCE_IMAGE_BYTES} bytes`,
      400
    );
  }
}

function validateResultId(id: string) {
  if (!SAFE_RESULT_ID.test(id)) {
    throw new VideoGenerationError('VALIDATION_FAILED', 'result id is invalid', 400);
  }
}

function isStoredVideoGeneration(value: unknown): value is StoredVideoGeneration {
  return isRecord(value)
    && typeof value.upstreamId === 'string'
    && (
      value.generationMode === undefined
      || value.generationMode === 'text-to-video'
      || value.generationMode === 'image-to-video'
    )
    && isVideoGenerationResult(value.result);
}

function isVideoGenerationResult(value: unknown): value is VideoGenerationResult {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.prompt === 'string'
    && (videoProviders as readonly unknown[]).includes(value.provider)
    && typeof value.model === 'string'
    && (videoGenerationSizes as readonly unknown[]).includes(value.videoSize)
    && (videoGenerationDurations as readonly unknown[]).includes(value.duration)
    && (value.status === 'queued' || value.status === 'in_progress' || value.status === 'completed' || value.status === 'failed')
    && typeof value.progress === 'number'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string';
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
