import { ApiClientError } from './errors.js';
import type { ApiErrorPayload, ConnectionConfig } from './types.js';
import { isRecord } from './validators.js';

export { ApiClientError };

export type RuntimeClientInput = ConnectionConfig & {
  fetchImpl?: typeof fetch;
};

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: RuntimeClientInput) {
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.token = input.token;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async request<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    const headers: Record<string, string> = {};
    if (path !== '/healthz') headers.Authorization = `Bearer ${this.token}`;
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
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
    const payload = await readJson(response);
    return payload as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  return JSON.parse(text) as unknown;
}

function parseApiError(payload: unknown): ApiErrorPayload {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return { error: { code: 'HTTP_ERROR', message: 'Runtime request failed' } };
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
