import { request as httpsRequest } from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

export async function fetchCreatorService(input: {
  endpoint: URL;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string | Buffer;
  proxy?: string;
  signal: AbortSignal;
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
      signal: input.signal
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

export async function creatorServiceErrorMessage(
  response: Response,
  label: string
): Promise<string> {
  try {
    const payload = await response.json() as unknown;
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      return `${label} provider rejected the request: ${payload.error.message.slice(0, 300)}`;
    }
    if (isRecord(payload) && typeof payload.message === 'string') {
      return `${label} provider rejected the request: ${payload.message.slice(0, 300)}`;
    }
  } catch {
    // Some providers return an HTML or empty error response.
  }
  return `${label} provider rejected the request with status ${response.status}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
