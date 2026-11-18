import { request as httpsRequest } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { safePublicRequestId, sanitizePublicErrorFacts, type PublicErrorFacts } from '@opencreator/protocol';
import { publicFactsFromHttpResponse } from '../creator/public-error-facts.js';

export async function fetchCreatorService(input: {
  endpoint: URL;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | Buffer;
  proxy?: string;
  signal: AbortSignal;
  redirect?: 'manual';
  maxResponseBytes: number;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (input.fetchImpl !== undefined || !input.proxy || input.endpoint.protocol !== 'https:') {
    return await (input.fetchImpl ?? fetch)(input.endpoint, {
      method: input.method,
      headers: input.headers,
      body: input.body === undefined
        ? undefined
        : typeof input.body === 'string'
          ? input.body
          : new Uint8Array(input.body),
      signal: input.signal,
      ...(input.redirect === undefined ? {} : { redirect: input.redirect })
    });
  }

  return await new Promise<Response>((resolveResponse, reject) => {
    const headers = { ...input.headers };
    if (input.body !== undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(input.body));
    }
    const request = httpsRequest(input.endpoint, {
      method: input.method,
      headers,
      agent: new HttpsProxyAgent(input.proxy!),
      signal: input.signal
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > input.maxResponseBytes) {
          response.destroy(new Error('Creator service response is too large'));
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

export function openAiCompatibleEndpoint(baseUrl: string, resource: string): URL {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return new URL(`https://api.openai.com/v1/${resource}`);
  const base = new URL(trimmed);
  if (base.pathname.toLowerCase().endsWith(`/${resource.toLowerCase()}`)) return base;
  if (base.pathname === '' || base.pathname === '/') {
    base.pathname = `/v1/${resource}`;
  } else {
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/${resource}`;
  }
  return base;
}

export function appendEndpointPath(endpoint: URL, suffix: string): URL {
  const next = new URL(endpoint);
  next.pathname = `${next.pathname.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
  return next;
}

export function creatorProviderEndpoint(baseUrl: string, defaultBaseUrl: string, path: string): URL {
  const base = new URL(baseUrl.trim() || defaultBaseUrl);
  const normalizedPath = path.replace(/^\/+/, '');
  if (!base.pathname.toLowerCase().endsWith(`/${normalizedPath.toLowerCase()}`)) {
    base.pathname = `${base.pathname.replace(/\/+$/, '')}/${normalizedPath}`;
  }
  return base;
}

export async function creatorServiceErrorInfo(
  response: Response,
  label: string,
  provider?: string
): Promise<{ message: string; publicFacts: PublicErrorFacts }> {
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {}
  const publicFacts = creatorServiceFailureFacts(payload, provider, {
    httpStatus: response.status,
    requestId: response.headers.get('x-request-id') ?? response.headers.get('x-tt-logid') ?? undefined
  });
  return {
    message: `${label} provider rejected the request with status ${response.status}`
      + (publicFacts.upstreamCode === undefined ? '' : ` (${publicFacts.upstreamCode})`)
      + (publicFacts.upstreamMessage === undefined ? '' : `: ${publicFacts.upstreamMessage}`),
    publicFacts
  };
}

export function creatorServiceFailureFacts(
  payload: unknown,
  provider?: string,
  options: { httpStatus?: number; requestId?: string } = {}
): PublicErrorFacts {
  const root = isRecord(payload) ? payload : {};
  const data = isRecord(root.data) ? root.data : {};
  const detail = isRecord(root.error) ? root.error : isRecord(data.error) ? data.error : isRecord(root.data) ? data : root;
  const code = detail.upstreamCode ?? detail.code ?? detail.error_code ?? detail.type
    ?? (options.httpStatus === undefined ? undefined : root.code ?? root.error_code);
  const message = detail.task_status_msg ?? detail.message ?? detail.error_msg ?? detail.msg
    ?? root.message ?? root.error_msg ?? (typeof root.error === 'string' ? root.error : undefined);
  const requestId = [detail.request_id, detail.requestId, root.request_id, root.requestId, options.requestId]
    .map(safePublicRequestId).find(candidate => candidate !== undefined);
  return sanitizePublicErrorFacts({
    ...(options.httpStatus === undefined
      ? { kind: 'provider-failed' as const, ...(provider === undefined ? {} : { provider }) }
      : publicFactsFromHttpResponse(options.httpStatus, provider)),
    upstreamCode: typeof code === 'number' && Number.isSafeInteger(code) ? String(code)
      : typeof code === 'string' ? code : undefined,
    upstreamMessage: typeof message === 'string' ? message : undefined,
    requestId
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
