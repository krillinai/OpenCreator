import { ApiClientError } from './errors.js';
import type { ApiErrorPayload, ConnectionConfig } from './types.js';
import { isRecord } from './validators.js';

export { ApiClientError };

export type RuntimeClientInput = ConnectionConfig & {
  fetchImpl?: typeof fetch;
};

export type RuntimeRequestOptions = {
  signal?: AbortSignal;
};

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(input: RuntimeClientInput) {
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.token = input.token;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async rawGet(path: string, options: RuntimeRequestOptions = {}): Promise<Response> {
    return this.rawRequest(path, { method: 'GET', signal: options.signal });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async postBinary<T = unknown>(
    path: string,
    body: BodyInit,
    contentType = 'application/octet-stream'
  ): Promise<T> {
    const response = await this.rawRequest(path, {
      method: 'POST',
      binaryBody: body,
      binaryContentType: contentType
    });
    return await readSuccessfulJson(response) as T;
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async request<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    const response = await this.rawRequest(path, input);
    const payload = await readSuccessfulJson(response);
    return payload as T;
  }

  async rawRequest(
    path: string,
    input: {
      method: string;
      body?: unknown;
      binaryBody?: BodyInit;
      binaryContentType?: string;
      signal?: AbortSignal;
    }
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (path !== '/healthz' && this.token !== undefined && this.token.length > 0) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    if (input.binaryBody !== undefined) {
      headers['Content-Type'] =
        input.binaryContentType ?? 'application/octet-stream';
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: input.method,
      headers,
      signal: input.signal,
      body: input.binaryBody ?? (
        input.body === undefined ? undefined : JSON.stringify(input.body)
      )
    });

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      const error = parseApiError(payload);
      throw new ApiClientError({
        status: response.status,
        code: error.error.code,
        message: error.error.message,
        details: error.error.details
      });
    }
    return response;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  return JSON.parse(text) as unknown;
}

async function readSuccessfulJson(response: Response): Promise<unknown> {
  const payload = await readJson(response);
  if (!isApiErrorPayload(payload)) return payload;
  const error = parseApiError(payload);
  throw new ApiClientError({
    status: response.status >= 400 ? response.status : 500,
    code: error.error.code,
    message: error.error.message,
    details: error.error.details
  });
}

function isApiErrorPayload(payload: unknown): boolean {
  return (
    isRecord(payload)
    && isRecord(payload.error)
    && typeof payload.error.code === 'string'
  );
}

function parseApiError(payload: unknown): ApiErrorPayload {
  if (!isRecord(payload)) {
    return { error: { code: 'HTTP_ERROR', message: 'Runtime request failed' } };
  }
  if (!isRecord(payload.error)) {
    const code = typeof payload.code === 'string' ? payload.code : 'HTTP_ERROR';
    const message = typeof payload.message === 'string'
      ? payload.message
      : 'Runtime request failed';
    return { error: { code, message } };
  }
  const code = typeof payload.error.code === 'string' ? payload.error.code : 'HTTP_ERROR';
  const message = typeof payload.error.message === 'string' ? payload.error.message : 'Runtime request failed';
  const details = isRecord(payload.error.details) ? payload.error.details : undefined;
  return { error: { code, message, details } };
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await readJson(response);
  } catch {
    return {};
  }
}
