import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type {
  SocialPublishPlatform,
  SocialPublishPlatformResult,
  SocialPublishTiktokPrivacy,
  SocialPublishYoutubePrivacy
} from '@opencreator/protocol';

export const uploadPostApiBaseUrl = 'https://api.upload-post.com';

const maxResponseBytes = 1024 * 1024;

export type UploadPostTransportRequest = {
  url: URL;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Readable;
  signal: AbortSignal;
};

export type UploadPostTransportResponse = {
  status: number;
  body: string;
};

/** Injected in tests; the default one streams over HTTPS and honours the configured proxy. */
export type UploadPostTransport = (
  request: UploadPostTransportRequest
) => Promise<UploadPostTransportResponse>;

export class UploadPostApiError extends Error {
  constructor(
    readonly code:
      | 'upload_post_auth_failed'
      | 'upload_post_rejected'
      | 'upload_post_forbidden'
      | 'upload_post_rate_limited'
      | 'upload_post_http_error'
      | 'upload_post_invalid_response',
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'UploadPostApiError';
  }
}

export type UploadPostVideoRequest = {
  requestId: string;
  profile: string;
  platforms: SocialPublishPlatform[];
  videoPath: string;
  title: string;
  description: string;
  youtubePrivacy: SocialPublishYoutubePrivacy;
  tiktokPrivacy: SocialPublishTiktokPrivacy;
  aiGenerated: boolean;
  signal: AbortSignal;
};

export type UploadPostStatus = {
  /** pending | queued | processing | in_progress | completed | failed | not_found */
  status: string;
  completed: number;
  total: number | null;
  results: SocialPublishPlatformResult[];
};

export type UploadPostClient = ReturnType<typeof createUploadPostClient>;

export function createUploadPostClient(input: {
  apiKey: string;
  proxy?: string;
  baseUrl?: string;
  transport?: UploadPostTransport;
}) {
  const baseUrl = input.baseUrl ?? uploadPostApiBaseUrl;
  const transport = input.transport ?? createHttpsTransport(input.proxy);
  // Upload-Post API keys go in an "Apikey" header, not "Bearer".
  const authorization = `Apikey ${input.apiKey}`;

  return {
    /**
     * Sends the video once with `async_upload=true`. The caller-chosen request id is
     * also the Idempotency-Key, so a retried submit can never create a second post.
     */
    async submitVideo(request: UploadPostVideoRequest): Promise<{ requestId: string }> {
      const fields: Array<[string, string]> = [
        ['user', request.profile],
        ['title', request.title],
        ['request_id', request.requestId],
        ['async_upload', 'true'],
        ...request.platforms.map(platform => ['platform[]', platform] as [string, string])
      ];
      if (request.description.trim().length > 0) fields.push(['description', request.description]);
      if (request.aiGenerated) fields.push(['is_ai_generated', 'true']);
      if (request.platforms.includes('youtube')) fields.push(['privacyStatus', request.youtubePrivacy]);
      if (request.platforms.includes('tiktok') && request.tiktokPrivacy !== 'account-default') {
        fields.push(['privacy_level', request.tiktokPrivacy]);
      }
      const multipart = await createMultipartBody(fields, {
        name: 'video',
        path: request.videoPath,
        contentType: 'video/mp4'
      });
      const response = await transport({
        url: new URL('/api/upload', baseUrl),
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Idempotency-Key': request.requestId,
          'Content-Type': `multipart/form-data; boundary=${multipart.boundary}`,
          'Content-Length': String(multipart.length)
        },
        body: multipart.stream,
        signal: request.signal
      });
      const payload = parseJson(response);
      if (response.status >= 400) throw apiError(response.status, payload);
      const requestId = isRecord(payload) && typeof payload.request_id === 'string'
        ? payload.request_id
        : request.requestId;
      return { requestId };
    },

    async getStatus(requestId: string, signal: AbortSignal): Promise<UploadPostStatus> {
      const url = new URL('/api/uploadposts/status', baseUrl);
      url.searchParams.set('request_id', requestId);
      const response = await transport({
        url,
        method: 'GET',
        headers: { Authorization: authorization },
        signal
      });
      const payload = parseJson(response);
      if (response.status === 404) return { status: 'not_found', completed: 0, total: null, results: [] };
      if (response.status >= 400) throw apiError(response.status, payload);
      if (!isRecord(payload) || typeof payload.status !== 'string') {
        throw new UploadPostApiError('upload_post_invalid_response', 'Upload-Post returned an unexpected status payload');
      }
      return {
        status: payload.status,
        completed: typeof payload.completed === 'number' ? payload.completed : 0,
        total: typeof payload.total === 'number' ? payload.total : null,
        results: normalizeUploadPostResults(payload.results)
      };
    }
  };
}

/** Normalizes Upload-Post per-platform results (list or `{platform: result}` map). */
export function normalizeUploadPostResults(value: unknown): SocialPublishPlatformResult[] {
  const entries: Array<Record<string, unknown>> = Array.isArray(value)
    ? value.filter(isRecord)
    : isRecord(value)
      ? Object.entries(value).flatMap(([platform, result]) => (
          isRecord(result) ? [{ platform, ...result }] : []
        ))
      : [];
  return entries.map(entry => {
    const status: SocialPublishPlatformResult['status'] = entry.skipped === true
      ? 'skipped'
      : isPlatformStatus(entry.status)
        ? entry.status
        : entry.success === true ? 'completed' : 'failed';
    const platform = typeof entry.platform === 'string' ? entry.platform : 'unknown';
    const postId = firstString(entry.platform_post_id, entry.video_id, entry.post_id);
    const rawUrl = firstString(entry.post_url, entry.url);
    let url = rawUrl !== null && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;
    if (url === null && platform === 'youtube' && postId !== null && status === 'completed') {
      // Also valid for private uploads, which Upload-Post reports without a public URL.
      url = `https://www.youtube.com/watch?v=${encodeURIComponent(postId)}`;
    }
    return {
      platform,
      status,
      url,
      postId,
      note: rawUrl !== null && url === null ? rawUrl : null,
      error: status === 'completed' ? null : firstString(entry.error_message, entry.error),
      inbox: entry.fallback_to_inbox === true
    };
  });
}

async function createMultipartBody(
  fields: Array<[string, string]>,
  file: { name: string; path: string; contentType: string }
): Promise<{ boundary: string; length: number; stream: Readable }> {
  const boundary = `----OpenCreatorUploadPost${randomBytes(12).toString('hex')}`;
  const head = Buffer.concat([
    ...fields.map(([name, value]) => Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(name)}"\r\n\r\n${value}\r\n`,
      'utf8'
    )),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(file.name)}"; filename="${escapeName(basename(file.path))}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      'utf8'
    )
  ]);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const { size } = await stat(file.path);
  async function* chunks() {
    yield head;
    yield* createReadStream(file.path);
    yield tail;
  }
  return { boundary, length: head.length + size + tail.length, stream: Readable.from(chunks()) };
}

function createHttpsTransport(proxy?: string): UploadPostTransport {
  return request => new Promise((resolve, reject) => {
    const outgoing = httpsRequest(request.url, {
      method: request.method,
      headers: request.headers,
      ...(proxy ? { agent: new HttpsProxyAgent(proxy) } : {}),
      signal: request.signal
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          response.destroy(new Error('Upload-Post response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 502,
        body: Buffer.concat(chunks).toString('utf8')
      }));
      response.on('error', reject);
    });
    outgoing.on('error', reject);
    if (request.body === undefined) outgoing.end();
    else request.body.on('error', reject).pipe(outgoing);
  });
}

function apiError(status: number, payload: unknown): UploadPostApiError {
  const detail = isRecord(payload)
    ? firstString(payload.message, payload.error) ?? `HTTP ${status}`
    : `HTTP ${status}`;
  const message = `Upload-Post: ${detail}`;
  if (status === 401) return new UploadPostApiError('upload_post_auth_failed', message, status);
  if (status === 400 || status === 422) return new UploadPostApiError('upload_post_rejected', message, status);
  if (status === 403) return new UploadPostApiError('upload_post_forbidden', message, status);
  if (status === 429) return new UploadPostApiError('upload_post_rate_limited', message, status);
  return new UploadPostApiError('upload_post_http_error', message, status);
}

function parseJson(response: UploadPostTransportResponse): unknown {
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    return undefined;
  }
}

function isPlatformStatus(value: unknown): value is SocialPublishPlatformResult['status'] {
  return value === 'completed' || value === 'failed' || value === 'retryable'
    || value === 'skipped' || value === 'queued' || value === 'processing';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function escapeName(value: string): string {
  return value.replace(/["\r\n\\]/g, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
