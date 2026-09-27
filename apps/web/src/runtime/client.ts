import type { IssueCategory, IssueSource, OpenCreatorIssue, PublicErrorFacts } from '@opencreator/protocol';
import { isOpenCreatorIssue, isPublicErrorFacts, publicErrorKindForCode, safePublicErrorCode } from '@opencreator/protocol';
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
    return await readSuccessfulJson(response, path) as T;
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }

  async request<T>(path: string, input: { method: string; body?: unknown }): Promise<T> {
    const response = await this.rawRequest(path, input);
    const payload = await readSuccessfulJson(response, path);
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

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: input.method,
        headers,
        signal: input.signal,
        body: input.binaryBody ?? (
          input.body === undefined ? undefined : JSON.stringify(input.body)
        )
      });
    } catch (cause) {
      if (isUserAbort(cause, input.signal)) throw cause;
      const timeout = isNamedError(cause, 'TimeoutError');
      const code = timeout ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR';
      throw new ApiClientError({
        status: 0,
        code,
        message: timeout ? 'Runtime request timed out' : 'Runtime request failed',
        publicFacts: { kind: timeout ? 'timeout' : 'unknown' },
        issue: createPageIssue({
          path,
          code,
          source: 'network',
          category: 'network',
          fallbackMessage: timeout ? '请求超时，请检查连接后重试。' : '无法连接本地服务，请检查服务状态后重试。',
          publicFacts: { kind: timeout ? 'timeout' : 'unknown' }
        })
      });
    }

    if (!response.ok) {
      const payload = await readErrorPayload(response);
      const error = parseApiError(payload, path, response.status);
      throw new ApiClientError({
        status: response.status,
        code: error.error.code,
        message: error.error.message,
        details: error.error.details,
        publicFacts: error.error.publicFacts,
        issue: error.error.issue
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

async function readSuccessfulJson(response: Response, path: string): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await readJson(response);
  } catch {
    throw new ApiClientError({
      status: response.status,
      code: 'INVALID_JSON_RESPONSE',
      message: 'Runtime returned an invalid JSON response',
      publicFacts: { kind: 'invalid-response' },
      issue: createPageIssue({
        path,
        code: 'INVALID_JSON_RESPONSE',
        source: 'api',
        category: 'execution',
        fallbackMessage: '本地服务返回了无法读取的结果，请重试。',
        publicFacts: { kind: 'invalid-response' }
      })
    });
  }
  if (!isApiErrorPayload(payload)) return payload;
  const error = parseApiError(payload, path, response.status);
  throw new ApiClientError({
    status: response.status >= 400 ? response.status : 500,
    code: error.error.code,
    message: error.error.message,
    details: error.error.details,
    publicFacts: error.error.publicFacts,
    issue: error.error.issue
  });
}

function isApiErrorPayload(payload: unknown): boolean {
  return (
    isRecord(payload)
    && isRecord(payload.error)
    && typeof payload.error.code === 'string'
  );
}

function parseApiError(payload: unknown, path: string, status: number): ApiErrorPayload {
  if (!isRecord(payload)) {
    return legacyApiError(path, status, 'HTTP_ERROR', 'Runtime request failed');
  }
  if (!isRecord(payload.error)) {
    const code = safePublicErrorCode(payload.code) ?? 'HTTP_ERROR';
    const message = typeof payload.message === 'string'
      ? payload.message
      : 'Runtime request failed';
    return legacyApiError(path, status, code, message);
  }
  const code = safePublicErrorCode(payload.error.code) ?? 'HTTP_ERROR';
  const message = typeof payload.error.message === 'string' ? payload.error.message : 'Runtime request failed';
  const details = isRecord(payload.error.details) ? payload.error.details : undefined;
  const suppliedPublicFacts = isPublicErrorFacts(payload.error.publicFacts)
    ? payload.error.publicFacts
    : undefined;
  const publicFacts = suppliedPublicFacts ?? publicFactsForApiError(code, status);
  const issue = isOpenCreatorIssue(payload.error.issue)
    ? payload.error.issue.publicFacts === undefined && suppliedPublicFacts !== undefined
      ? { ...payload.error.issue, publicFacts: suppliedPublicFacts }
      : payload.error.issue
    : createPageIssue({
        path,
        code,
        source: 'api',
        category: categoryForStatus(status),
        fallbackMessage: fallbackForApiError(code, status),
        publicFacts
      });
  return { error: { code, message, details, publicFacts, issue } };
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await readJson(response);
  } catch {
    return {};
  }
}

function legacyApiError(path: string, status: number, code: string, message: string): ApiErrorPayload {
  return {
    error: {
      code,
      message,
      issue: createPageIssue({
        path,
        code,
        source: 'api',
        category: categoryForStatus(status),
        fallbackMessage: fallbackForApiError(code, status),
        publicFacts: publicFactsForApiError(code, status)
      })
    }
  };
}

function createPageIssue(input: {
  path: string;
  code: string;
  source: IssueSource;
  category: IssueCategory;
  fallbackMessage: string;
  publicFacts?: PublicErrorFacts;
}): OpenCreatorIssue {
  const now = new Date().toISOString();
  const operation = sanitizeOperation(input.path);
  const fingerprint = stableFingerprint(`${input.source}:${input.code}:${operation}`);
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `page:${randomId}`,
    diagnosticId: `OC-${fingerprint.slice(-8).toUpperCase()}`,
    code: safePublicErrorCode(input.code) ?? 'UNKNOWN_ERROR',
    scope: { kind: 'page', surface: surfaceFromPath(operation) },
    source: input.source,
    category: input.category,
    severity: 'error',
    status: 'open',
    operation,
    summaryKey: `issue.${input.category}`,
    summaryParams: {},
    fallbackMessage: input.fallbackMessage,
    ...(input.publicFacts === undefined ? {} : { publicFacts: input.publicFacts }),
    retryable: false,
    repairActions: [],
    fingerprint,
    occurrenceCount: 1,
    occurredAt: now,
    lastOccurredAt: now
  };
}

function sanitizeOperation(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? '/runtime';
  return withoutQuery
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\b(?:job|run|thread|project)_[a-zA-Z0-9_-]+\b/g, ':id')
    .slice(0, 160) || '/runtime';
}

function surfaceFromPath(path: string): string {
  const segment = path.split('/').filter(Boolean)[0];
  return (segment ?? 'runtime').slice(0, 160);
}

function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function categoryForStatus(status: number): IssueCategory {
  if (status === 401 || status === 403) return 'permission';
  if (status === 400 || status === 404 || status === 409 || status === 422) return 'input';
  if (status >= 500 || status === 0) return 'execution';
  return 'unknown';
}

function fallbackForStatus(status: number): string {
  if (status === 401 || status === 403) return '当前操作没有权限，请检查登录或授权设置。';
  if (status === 404) return '请求的内容不存在或已被移除。';
  if (status === 409) return '当前状态已发生变化，请刷新后重试。';
  return '操作未完成，请稍后重试。';
}

function publicFactsForApiError(code: string, status: number): PublicErrorFacts {
  return {
    kind: publicErrorKindForCode(code)
      ?? (status === 429 ? 'rate-limited'
      : status === 401 || status === 403 ? 'unauthorized'
      : 'unknown'),
    ...(status >= 100 && status <= 599 ? { httpStatus: status } : {})
  };
}

function fallbackForApiError(code: string, status: number): string {
  const kind = publicErrorKindForCode(code);
  if (kind === 'configuration') return '缺少或无法读取此操作所需的配置，请检查相关服务设置。';
  if (kind === 'validation') return '输入或参数未通过校验，请检查后重试。';
  if (kind === 'not-found') return '请求的资源不存在或已被移除。';
  if (kind === 'conflict') return '当前状态与此操作冲突，请刷新状态后重试。';
  if (kind === 'unsupported') return '当前环境或服务不支持此操作。';
  if (kind === 'storage') return '本地文件或结果未能写入，请检查存储状态。';
  return fallbackForStatus(status);
}

function isUserAbort(cause: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && isNamedError(cause, 'AbortError');
}

function isNamedError(cause: unknown, name: string): boolean {
  return typeof cause === 'object'
    && cause !== null
    && 'name' in cause
    && (cause as { name?: unknown }).name === name;
}
