import type { VideoMetadataResponse } from '@opencreator/protocol';
import { request as httpsRequest } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const METADATA_TIMEOUT_MS = 5_000;

export class VideoMetadataError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_SOURCE' | 'UPSTREAM_ERROR',
    message: string
  ) {
    super(message);
  }
}

export type VideoMetadataService = {
  get(url: string): Promise<VideoMetadataResponse>;
};

export function createVideoMetadataService(input: {
  fetchImpl?: typeof fetch;
  getProxy?(): string | Promise<string>;
} = {}): VideoMetadataService {
  return {
    async get(value: string): Promise<VideoMetadataResponse> {
      const source = parseVideoSource(value);
      const endpoint = createMetadataEndpoint(source);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
      timeout.unref();

      try {
        const response = input.fetchImpl === undefined
          ? await fetchMetadata(endpoint, await resolveProxy(input.getProxy), controller.signal)
          : await input.fetchImpl(endpoint, {
              headers: { Accept: 'application/json' },
              signal: controller.signal
            });
        if (!response.ok) {
          throw new VideoMetadataError('UPSTREAM_ERROR', 'Video metadata request failed');
        }
        const payload = await response.json() as unknown;
        return parseMetadataPayload(source, payload);
      } catch (error) {
        if (error instanceof VideoMetadataError) throw error;
        throw new VideoMetadataError('UPSTREAM_ERROR', 'Video metadata request failed');
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

async function resolveProxy(getProxy?: () => string | Promise<string>): Promise<string> {
  const configured = (await getProxy?.())?.trim();
  if (configured) return configured;
  return (
    process.env.HTTPS_PROXY
    ?? process.env.https_proxy
    ?? process.env.HTTP_PROXY
    ?? process.env.http_proxy
    ?? process.env.ALL_PROXY
    ?? process.env.all_proxy
    ?? ''
  ).trim();
}

async function fetchMetadata(
  url: URL,
  proxy: string,
  signal: AbortSignal
): Promise<Response> {
  if (!proxy) {
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      signal
    });
  }

  return await new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      agent: new HttpsProxyAgent(proxy),
      signal
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) {
          response.destroy(new Error('Video metadata response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 502
        }));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

type ParsedVideoSource =
  | { platform: 'youtube'; videoId: string }
  | { platform: 'bilibili'; videoId: string };

function parseVideoSource(value: string): ParsedVideoSource {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new VideoMetadataError('UNSUPPORTED_SOURCE', 'Video URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new VideoMetadataError('UNSUPPORTED_SOURCE', 'Video URL is invalid');
  }

  const hostname = url.hostname.replace(/^www\./, '').toLowerCase();
  let videoId = '';
  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
  } else if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    videoId = url.searchParams.get('v') ?? '';
    if (!videoId) {
      videoId = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] ?? '';
    }
  }

  if (!videoId || videoId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(videoId)) {
    const bilibiliId = (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com'))
      ? url.pathname.match(/\/(BV[A-Za-z0-9]+|av\d+)(?:[/?#]|$)/i)?.[1]
      : undefined;
    if (bilibiliId) return { platform: 'bilibili', videoId: bilibiliId };
    throw new VideoMetadataError('UNSUPPORTED_SOURCE', 'Only YouTube and Bilibili video metadata is supported');
  }
  return { platform: 'youtube', videoId };
}

function createMetadataEndpoint(source: ParsedVideoSource): URL {
  if (source.platform === 'youtube') {
    const endpoint = new URL('https://www.youtube.com/oembed');
    endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${encodeURIComponent(source.videoId)}`);
    endpoint.searchParams.set('format', 'json');
    return endpoint;
  }
  const endpoint = new URL('https://api.bilibili.com/x/web-interface/view');
  const isAid = source.videoId.toLowerCase().startsWith('av');
  endpoint.searchParams.set(isAid ? 'aid' : 'bvid', isAid ? source.videoId.slice(2) : source.videoId);
  return endpoint;
}

function parseMetadataPayload(source: ParsedVideoSource, payload: unknown): VideoMetadataResponse {
  if (source.platform === 'youtube') {
    if (!isRecord(payload) || typeof payload.title !== 'string' || payload.title.trim().length === 0) {
      throw new VideoMetadataError('UPSTREAM_ERROR', 'Video metadata response is invalid');
    }
    const authorName = boundedText(payload.author_name, 160);
    const width = boundedDimension(payload.width);
    const height = boundedDimension(payload.height);
    return {
      platform: 'youtube',
      title: payload.title.trim().slice(0, 300),
      ...(authorName === undefined ? {} : { authorName }),
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(source.videoId)}/hqdefault.jpg`,
      ...(width === undefined || height === undefined ? {} : { width, height })
    };
  }

  if (!isRecord(payload) || payload.code !== 0 || !isRecord(payload.data)) {
    throw new VideoMetadataError('UPSTREAM_ERROR', 'Video metadata response is invalid');
  }
  const title = boundedText(payload.data.title, 300);
  if (title === undefined) {
    throw new VideoMetadataError('UPSTREAM_ERROR', 'Video metadata response is invalid');
  }
  const owner = isRecord(payload.data.owner) ? payload.data.owner : undefined;
  const authorName = boundedText(owner?.name, 160);
  const thumbnailUrl = boundedText(payload.data.pic, 2048);
  const dimension = isRecord(payload.data.dimension) ? payload.data.dimension : undefined;
  let width = boundedDimension(dimension?.width);
  let height = boundedDimension(dimension?.height);
  const rotation = boundedRotation(dimension?.rotate);
  if (width !== undefined && height !== undefined && (rotation === 90 || rotation === 270)) {
    [width, height] = [height, width];
  }
  return {
    platform: 'bilibili',
    title,
    ...(authorName === undefined ? {} : { authorName }),
    ...(thumbnailUrl === undefined ? {} : { thumbnailUrl }),
    ...(width === undefined || height === undefined ? {} : { width, height })
  };
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, maximum)
    : undefined;
}

function boundedDimension(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 16_384
    ? value
    : undefined;
}

function boundedRotation(value: unknown): number | undefined {
  return typeof value === 'number' && [0, 90, 180, 270].includes(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
