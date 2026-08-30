import type {
  CreateImageGenerationRequest,
  CreatorServicesConfig,
  ImageGenerationAsset
} from '@opencreator/protocol';
import { createKlingAuthorization } from '../creator-services/kling-auth.js';
import {
  appendEndpointPath,
  creatorProviderEndpoint,
  creatorServiceErrorMessage,
  fetchCreatorService,
  isRecord,
  openAiCompatibleEndpoint
} from '../creator-services/upstream-fetch.js';

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 120 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;

export type GeneratedImageContent = {
  content: Buffer;
  mime: ImageGenerationAsset['mime'];
};

export class ImageGenerationProviderError extends Error {
  constructor(
    readonly code: 'config_missing' | 'upstream_error' | 'unsupported_capability',
    message: string
  ) {
    super(message);
    this.name = 'ImageGenerationProviderError';
  }
}

export async function generateImageContents(
  request: CreateImageGenerationRequest,
  config: CreatorServicesConfig,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    referenceImage?: GeneratedImageContent;
  } = {}
): Promise<{ model: string; contents: GeneratedImageContent[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(options.signal?.reason);
  timeout.unref();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (
      options.referenceImage !== undefined
      && request.provider !== 'openai'
      && request.provider !== 'gemini'
    ) {
      throw new ImageGenerationProviderError(
        'unsupported_capability',
        `The ${request.provider} image provider does not support reference images`
      );
    }
    if (request.provider === 'gemini') {
      return await generateGeminiImages(
        request,
        config,
        controller.signal,
        options.referenceImage,
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
      options.referenceImage,
      options.fetchImpl
    );
  } catch (error) {
    if (error instanceof ImageGenerationProviderError) throw error;
    if (options.signal?.aborted) throw error;
    throw new ImageGenerationProviderError(
      'upstream_error',
      'The image generation provider could not be reached'
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
  referenceImage?: GeneratedImageContent,
  fetchImpl?: typeof fetch
) {
  const provider = request.provider === 'jimeng' ? config.image.jimeng : config.image.openai;
  if (!provider.apiKey.trim()) missingConfig(request.provider);
  const model = provider.model.trim()
    || (request.provider === 'jimeng' ? 'doubao-seedream-4-0-250828' : 'gpt-image-1');
  const endpoint = openAiImageEndpoint(
    provider.baseUrl,
    referenceImage === undefined ? 'generations' : 'edits'
  );
  const multipart = referenceImage === undefined
    ? undefined
    : createImageEditBody({
        model,
        prompt: request.prompt.trim(),
        size: request.size,
        quality: request.quality,
        count: request.count,
        image: referenceImage
      });
  const response = await fetchCreatorService({
    endpoint,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': multipart?.contentType ?? 'application/json'
    },
    body: multipart?.body ?? JSON.stringify({
        model,
        prompt: request.prompt.trim(),
        size: request.size,
        ...(request.provider === 'openai' ? { quality: request.quality } : {}),
        n: request.count
      }),
    proxy: config.proxy.trim(),
    signal,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    fetchImpl
  });
  if (!response.ok) {
    throw new ImageGenerationProviderError(
      'upstream_error',
      await creatorServiceErrorMessage(response, 'Image generation')
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
  referenceImage?: GeneratedImageContent,
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
            ...(referenceImage === undefined
              ? []
              : [{
                  inlineData: {
                    mimeType: referenceImage.mime,
                    data: referenceImage.content.toString('base64')
                  }
                }]),
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
      throw new ImageGenerationProviderError(
        'upstream_error',
        await creatorServiceErrorMessage(response, 'Gemini image')
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
  const endpoint = openAiCompatibleEndpoint(baseUrl, 'images/generations');
  endpoint.pathname = endpoint.pathname.replace(
    /\/images\/generations$/i,
    `/images/${operation}`
  );
  return endpoint;
}

function createImageEditBody(input: {
  model: string;
  prompt: string;
  size: string;
  quality: string;
  count: number;
  image: GeneratedImageContent;
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
  addField('quality', input.quality);
  addField('n', String(input.count));
  parts.push(Buffer.from([
    `--${boundary}`,
    'Content-Disposition: form-data; name="image"; filename="reference-image"',
    `Content-Type: ${input.image.mime}`,
    '',
    ''
  ].join('\r\n')));
  parts.push(input.image.content);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
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
    throw new ImageGenerationProviderError(
      'upstream_error',
      await creatorServiceErrorMessage(response, 'Kling image')
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
      throw new ImageGenerationProviderError(
        'upstream_error',
        await creatorServiceErrorMessage(statusResponse, 'Kling image')
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
