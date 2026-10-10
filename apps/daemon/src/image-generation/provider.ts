import type {
  CreateImageGenerationRequest,
  CreatorServicesConfig,
  ImageGenerationAsset
} from '@opencreator/protocol';
import type { PublicErrorFacts } from '@opencreator/protocol';
import { publicErrorKindForCode, sanitizePublicErrorFacts } from '@opencreator/protocol';
import {
  LocalCodexProviderError,
  type LocalCodexProvider
} from '../codex/local-provider.js';
import type { startCodexExec } from '../codex/runner.js';
import { setTimeout as delay } from 'node:timers/promises';
import { DIRECT_IMAGE_TIMEOUT_MS } from '../gateway/direct-transport.js';
import { generateCodexNativeImage, type NativeImageProgress } from './codex-native.js';
import { inspectCodexImageRuntime, readCodexImageConfiguration } from './codex-runtime.js';
import { createKlingAuthorization } from '../creator-services/kling-auth.js';
import {
  appendEndpointPath,
  creatorProviderEndpoint,
  creatorServiceErrorInfo,
  fetchCreatorService,
  isRecord,
  openAiCompatibleEndpoint
} from '../creator-services/upstream-fetch.js';
import { publicFactsFromFailure } from '../creator/public-error-facts.js';
import { gatewayCreatorBinding } from '../gateway/creator-service-source.js';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 120 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;

export type GeneratedImageContent = {
  content: Buffer;
  mime: ImageGenerationAsset['mime'];
};

export type CodexNativeImageRuntime = {
  codexHome: string;
  codexBin?: string;
  readProvider?: () => Promise<LocalCodexProvider>;
  checkNativeCapability?: () => Promise<{ supported: boolean; version?: string }>;
  startExec?: typeof startCodexExec;
};

export type ImageGenerationCapabilities = {
  supportsReferenceImage: boolean;
  maxReferenceImages: number;
};

export function imageGenerationCapabilities(
  provider: CreateImageGenerationRequest['provider']
): ImageGenerationCapabilities {
  return {
    supportsReferenceImage: provider === 'openai' || provider === 'gemini' || provider === 'codex-native',
    maxReferenceImages: provider === 'openai' || provider === 'gemini' || provider === 'codex-native' ? 8 : 0
  };
}

export class ImageGenerationProviderError extends Error {
  readonly publicFacts: PublicErrorFacts;
  constructor(
    readonly code: 'config_missing' | 'upstream_error' | 'unsupported_capability',
    message: string,
    publicFacts?: PublicErrorFacts,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ImageGenerationProviderError';
    this.publicFacts = sanitizePublicErrorFacts({
      ...(publicFacts ?? { kind: publicErrorKindForCode(code) ?? 'unknown' }),
      upstreamMessage: publicFacts?.upstreamMessage ?? message
    });
  }
}

export async function generateImageContents(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    referenceImage?: GeneratedImageContent;
    referenceImages?: GeneratedImageContent[];
    codexNative?: CodexNativeImageRuntime;
    onProgress?(progress: NativeImageProgress): void;
    logicalId?: string;
    onGatewayRequest?(id: string): void;
  } = {}
): Promise<{ model: string; contents: GeneratedImageContent[] }> {
  if (gatewayCreatorBinding(config)) request = { ...request, provider: 'openai' };
  const referenceImages = options.referenceImages
    ?? (options.referenceImage === undefined ? [] : [options.referenceImage]);
  const gateway = gatewayCreatorBinding(config);
  const capabilities = gateway ? { supportsReferenceImage: gateway.capabilities?.image?.includes('edit') === true, maxReferenceImages: gateway.capabilities?.image?.includes('edit') ? 1 : 0 } : imageGenerationCapabilities(request.provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException(gateway ? '图片生成等待超时，请先查询请求状态，避免重复扣费' : '图片生成超时，请重试', 'TimeoutError')), gateway ? DIRECT_IMAGE_TIMEOUT_MS + 30_000 : REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(options.signal?.reason);
  timeout.unref();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  let nativeExecution = false;
  try {
    controller.signal.throwIfAborted();
    if (
      referenceImages.length > capabilities.maxReferenceImages
    ) {
      throw new ImageGenerationProviderError(
        'unsupported_capability',
        capabilities.supportsReferenceImage
          ? `The ${request.provider} image provider supports at most ${capabilities.maxReferenceImages} reference images`
          : `The ${request.provider} image provider does not support reference images`
      );
    }
    if (request.provider === 'codex-native') {
      if (request.count !== 1) {
        throw new ImageGenerationProviderError(
          'unsupported_capability',
          'The codex-native image provider supports exactly one image per request'
        );
      }
      if (options.codexNative === undefined) {
        throw new ImageGenerationProviderError(
          'config_missing',
          'Configure the local Codex executable and CODEX_HOME before generating images'
        );
      }
      try {
        const configuration = await readCodexImageConfiguration(options.codexNative);
        if (configuration.authentication === 'chatgpt') {
          nativeExecution = true;
          options.onProgress?.({ phase: 'preparing_native_image', message: '正在检查 ChatGPT 登录态和 Codex 原生生图能力…' });
          const status = await inspectCodexImageRuntime(options.codexNative);
          if (!status.ready) throw new ImageGenerationProviderError('config_missing', status.message);
          if (status.executionMode !== 'native') throw new ImageGenerationProviderError('config_missing', 'Codex 认证模式已变化，请刷新状态后重试');
          const image = await generateCodexNativeImage({
            runtime: options.codexNative,
            request,
            referenceImages,
            signal: controller.signal,
            onProgress: options.onProgress
          });
          return { model: 'codex-native', contents: [image] };
        }
        return await generateOpenAiImages(
          request,
          config,
          controller.signal,
          referenceImages,
          options.fetchImpl,
          configuration.provider
        );
      } catch (error) {
        if (error instanceof LocalCodexProviderError) {
          throw new ImageGenerationProviderError('config_missing', error.message);
        }
        throw error;
      }
    }
    if (request.provider === 'gemini') {
      return await generateGeminiImages(
        request,
        config,
        controller.signal,
        referenceImages,
        options.fetchImpl
      );
    }
    if (request.provider === 'kling') {
      return await generateKlingImages(request, config, controller.signal, options.fetchImpl);
    }
    return await generateOpenAiImages(
      request,
      config,
      controller.signal,
      referenceImages,
      options.fetchImpl,
      undefined,
      options.logicalId,
      options.onGatewayRequest,
      gateway !== undefined
    );
  } catch (error) {
    if (error instanceof ImageGenerationProviderError) throw error;
    if (options.signal?.aborted) throw error;
    if (controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError') {
      const message = gateway ? '图片生成等待超时，请先查询请求状态，避免重复扣费' : '图片生成超时，请稍后重试';
      throw new ImageGenerationProviderError('upstream_error', message,
        { kind: 'timeout', provider: request.provider, upstreamMessage: message }, { cause: error });
    }
    if (nativeExecution && error instanceof Error) {
      throw new ImageGenerationProviderError('upstream_error', error.message,
        publicFactsFromFailure(error, request.provider), { cause: error });
    }
    throw new ImageGenerationProviderError(
      'upstream_error',
      'The image generation provider could not be reached',
      publicFactsFromFailure(error, request.provider, {
        timedOut: controller.signal.aborted && options.signal?.aborted !== true
      }),
      { cause: error }
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

async function generateOpenAiImages(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  signal: AbortSignal,
  referenceImages: GeneratedImageContent[],
  fetchImpl?: typeof fetch,
  providerOverride?: LocalCodexProvider,
  logicalId?: string,
  onGatewayRequest?: (id: string) => void,
  official = false
) {
  const provider = providerOverride
    ?? (request.provider === 'jimeng' ? config.image.jimeng : config.image.openai);
  if (!provider.apiKey.trim()) missingConfig(request.provider);
  const model = provider.model.trim()
    || (request.provider === 'jimeng' ? 'doubao-seedream-4-0-250828' : 'gpt-image-1');
  const endpoint = openAiImageEndpoint(
    provider.baseUrl,
    referenceImages.length === 0 ? 'generations' : 'edits'
  );
  const multipart = referenceImages.length === 0
    ? undefined
    : createImageEditBody({
        model,
        prompt: request.prompt.trim(),
        size: request.size,
        quality: request.quality,
        count: request.count,
        images: referenceImages,
        ...(official ? { official: true, aspectRatio: request.aspectRatio, resolution: request.resolution, officialQuality: request.officialQuality } : {})
      });
  let response = await fetchCreatorService({
    endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': multipart?.contentType ?? 'application/json'
      ,...(logicalId ? { 'Idempotency-Key': logicalId } : {})
      ,...(official ? { Prefer: 'respond-async' } : {})
    },
    body: multipart?.body ?? JSON.stringify({
        model,
        prompt: request.prompt.trim(),
        size: request.size,
        ...(official ? { aspect_ratio: request.aspectRatio, resolution: request.resolution, quality: request.officialQuality } : request.provider === 'jimeng' ? {} : { quality: request.quality }),
        n: request.count
      }),
    proxy: config.proxy.trim(),
    signal,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    fetchImpl
  });
  const gatewayRequest = response.headers.get('x-request-id');
  if (gatewayRequest && /^[A-Za-z0-9_-]{12,128}$/.test(gatewayRequest)) onGatewayRequest?.(gatewayRequest);
  if (official && response.status === 202) {
    const accepted = await response.json() as { requestId?: string };
    if (!accepted.requestId || accepted.requestId !== gatewayRequest || !/^ocdir_[a-f0-9]{48}$/.test(accepted.requestId)) {
      throw new ImageGenerationProviderError('upstream_error', '图片生成请求回执无效');
    }
    const statusUrl = openAiCompatibleEndpoint(provider.baseUrl, `requests/${accepted.requestId}`);
    for (;;) {
      signal.throwIfAborted();
      const status = await fetchCreatorService({ endpoint: statusUrl, method: 'GET', headers: { Authorization: `Bearer ${provider.apiKey}` }, proxy: config.proxy.trim(), signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), maxResponseBytes: 16_384, fetchImpl });
      if (!status.ok) {
        void status.body?.cancel().catch(() => undefined);
        throw new ImageGenerationProviderError('upstream_error', '暂时无法查询图片生成结果，请保留任务，避免重复扣费', { kind: 'provider-failed', upstreamCode: 'request_outcome_unknown', requestId: accepted.requestId });
      }
      const receipt = await status.json() as { state?: string; error?: { code?: string; status?: number } };
      if (receipt.state === 'succeeded') {
        response = await fetchCreatorService({ endpoint: appendEndpointPath(statusUrl, 'result'), method: 'GET', headers: { Authorization: `Bearer ${provider.apiKey}` }, proxy: config.proxy.trim(), signal, maxResponseBytes: MAX_RESPONSE_BYTES, fetchImpl });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new ImageGenerationProviderError('upstream_error', '图片结果暂时无法下载，请保留任务，避免重复扣费', { kind: 'provider-failed', upstreamCode: 'request_outcome_unknown', requestId: accepted.requestId });
        }
        break;
      }
      if (receipt.state === 'failed') {
        response = Response.json({ error: { code: receipt.error?.code ?? 'official_service_unavailable', message: receipt.error?.code === 'credits_insufficient' ? '积分不足，请补充积分后再试' : '图片生成请求被拒绝' } }, { status: receipt.error?.status ?? 503 });
        break;
      }
      if (receipt.state === 'outcome_unknown') throw new ImageGenerationProviderError('upstream_error', '图片生成结果尚未确认，请先查询请求状态，避免重复扣费', { kind: 'provider-failed', upstreamCode: 'request_outcome_unknown', requestId: accepted.requestId });
      if (!['submitting', 'waiting_upstream'].includes(receipt.state ?? '')) throw new ImageGenerationProviderError('upstream_error', '图片生成请求状态无效');
      await delay(1_000, undefined, { signal });
    }
  }
  if (!response.ok) {
    const failure = await creatorServiceErrorInfo(response, 'Image generation', request.provider);
    throw new ImageGenerationProviderError(
      'upstream_error',
      failure.message,
      failure.publicFacts
    );
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
  referenceImages: GeneratedImageContent[],
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
        contents: [{
          parts: [
            ...referenceImages.map(referenceImage => ({
              inlineData: {
                mimeType: referenceImage.mime,
                data: referenceImage.content.toString('base64')
              }
            })),
            { text: request.prompt.trim() }
          ]
        }],
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
      const failure = await creatorServiceErrorInfo(response, 'Gemini image', request.provider);
      throw new ImageGenerationProviderError(
        'upstream_error',
        failure.message,
        failure.publicFacts
      );
    }
    const part = findGeminiImagePart(await response.json() as unknown);
    if (!part) {
      throw new ImageGenerationProviderError('upstream_error', 'Gemini returned no image data');
    }
    const content = Buffer.from(part.data, 'base64');
    validateImageContent(content);
    return { content, mime: mimeFromHeader(part.mime) ?? detectImageMime(content) };
  }));
  return { model, contents: generated };
}

function openAiImageEndpoint(
  baseUrl: string,
  operation: 'generations' | 'edits'
): URL {
  const endpoint = openAiCompatibleEndpoint(
    versionedOpenAiImageBaseUrl(baseUrl),
    'images/generations'
  );
  endpoint.pathname = endpoint.pathname.replace(
    /\/images\/generations$/i,
    `/images/${operation}`
  );
  return endpoint;
}

function versionedOpenAiImageBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return trimmed;
  const url = new URL(trimmed);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.some(segment => /^v\d+(?:[a-z][a-z0-9-]*)?$/i.test(segment))) {
    return url.toString();
  }
  const imagesIndex = segments.findIndex(segment => segment.toLowerCase() === 'images');
  if (imagesIndex >= 0) segments.splice(imagesIndex, 0, 'v1');
  else segments.push('v1');
  url.pathname = `/${segments.join('/')}`;
  return url.toString();
}

function createImageEditBody(input: {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  images: GeneratedImageContent[];
  aspectRatio?: string;
  resolution?: string;
  officialQuality?: string;
  official?: boolean;
}): { contentType: string; body: Buffer } {
  const boundary = `opencreator-${crypto.randomUUID()}`;
  const parts: Buffer[] = [];
  const addField = (name: string, value: string) => {
    parts.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${name}"`,
      '',
      value,
      ''
    ].join('\r\n')));
  };
  addField('model', input.model);
  addField('prompt', input.prompt);
  addField('size', input.size);
  if (!input.official) addField('quality', input.quality);
  if (input.aspectRatio) addField('aspect_ratio', input.aspectRatio);
  if (input.resolution) addField('resolution', input.resolution);
  if (input.officialQuality) addField('quality', input.officialQuality);
  addField('n', String(input.count));
  for (const [index, image] of input.images.entries()) {
    const fieldName = input.images.length === 1 ? 'image' : 'image[]';
    parts.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${fieldName}"; filename="reference-image-${index + 1}"`,
      `Content-Type: ${image.mime}`,
      '',
      ''
    ].join('\r\n')));
    parts.push(image.content);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts)
  };
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
    const failure = await creatorServiceErrorInfo(response, 'Kling image', request.provider);
    throw new ImageGenerationProviderError(
      'upstream_error',
      failure.message,
      failure.publicFacts
    );
  }
  let payload = await response.json() as unknown;
  const taskId = readNestedString(payload, ['data', 'task_id']);
  if (!taskId) {
    throw new ImageGenerationProviderError('upstream_error', 'Kling returned an invalid image task');
  }
  for (;;) {
    const status = readNestedString(payload, ['data', 'task_status']);
    if (status === 'succeed' || status === 'succeeded' || status === 'completed') break;
    if (status === 'failed') {
      throw new ImageGenerationProviderError('upstream_error', 'Kling image generation failed');
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
      const failure = await creatorServiceErrorInfo(statusResponse, 'Kling image', request.provider);
      throw new ImageGenerationProviderError(
        'upstream_error',
        failure.message,
        failure.publicFacts
      );
    }
    payload = await statusResponse.json() as unknown;
  }
  const items = readNestedArray(payload, ['data', 'task_result', 'images']);
  if (!items?.length) {
    throw new ImageGenerationProviderError('upstream_error', 'Kling returned no generated images');
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
  throw new ImageGenerationProviderError(
    'config_missing',
    `Configure ${provider} image generation credentials before generating images`
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
      const inline = isRecord(part.inlineData)
        ? part.inlineData
        : isRecord(part.inline_data)
          ? part.inline_data
          : undefined;
      if (inline && typeof inline.data === 'string') {
        const mime = typeof inline.mimeType === 'string'
          ? inline.mimeType
          : typeof inline.mime_type === 'string'
            ? inline.mime_type
            : null;
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
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolveWait();
    };
    const timer = setTimeout(finish, 1_500);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

async function readGeneratedImages(
  payload: unknown,
  input: {
    apiKey: string;
    authOrigin: string;
    proxy: string;
    signal: AbortSignal;
    fetchImpl?: typeof fetch;
  }
): Promise<GeneratedImageContent[]> {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new ImageGenerationProviderError('upstream_error', 'The image provider returned no images');
  }
  return await Promise.all(payload.data.slice(0, 4).map(async item => {
    if (!isRecord(item)) {
      throw new ImageGenerationProviderError('upstream_error', 'The image provider returned invalid image data');
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
        throw new ImageGenerationProviderError('upstream_error', 'The image provider returned an invalid image URL');
      }
      if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
        throw new ImageGenerationProviderError('upstream_error', 'The image provider returned an unsupported image URL');
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
        throw new ImageGenerationProviderError('upstream_error', 'The generated image could not be downloaded');
      }
      const content = Buffer.from(await response.arrayBuffer());
      validateImageContent(content);
      return {
        content,
        mime: mimeFromHeader(response.headers.get('content-type')) ?? detectImageMime(content)
      };
    }
    throw new ImageGenerationProviderError('upstream_error', 'The image provider returned invalid image data');
  }));
}

function validateImageContent(content: Buffer) {
  if (content.length === 0 || content.length > MAX_IMAGE_BYTES) {
    throw new ImageGenerationProviderError('upstream_error', 'The image provider returned an invalid image file');
  }
}

function detectImageMime(content: Buffer): ImageGenerationAsset['mime'] {
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (content[0] === 0xff && content[1] === 0xd8) return 'image/jpeg';
  if (content.subarray(0, 4).toString('ascii') === 'RIFF'
    && content.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/png';
}

function mimeFromHeader(value: string | null): ImageGenerationAsset['mime'] | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') return mime;
  return undefined;
}
