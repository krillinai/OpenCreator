import type {
  CreateKrillinTaskRequest,
  KrillinCapabilitiesResponse,
  KrillinResultManifest,
  KrillinTask,
  KrillinTaskEventsResponse
} from '@opencreator/protocol';

export class KrillinServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'KrillinServiceError';
  }
}

export type KrillinServiceClient = ReturnType<typeof createKrillinServiceClient>;

export function createKrillinServiceClient(input: {
  origin: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  const fetchImpl = input.fetch ?? globalThis.fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, input.origin), {
        method,
        headers: {
          Authorization: `Bearer ${input.token}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (cause) {
      throw new KrillinServiceError(
        'krillin_service_unavailable',
        cause instanceof Error ? cause.message : 'KrillinAI service is unavailable'
      );
    }
    const payload = await readJson(response);
    if (!response.ok) {
      const error = isObject(payload) && isObject(payload.error) ? payload.error : {};
      throw new KrillinServiceError(
        typeof error.code === 'string' ? error.code : 'krillin_service_request_failed',
        typeof error.message === 'string' ? error.message : `KrillinAI service returned HTTP ${response.status}`,
        response.status
      );
    }
    return payload as T;
  }

  return {
    health: () => request<{ ok: boolean; generation: number }>('GET', '/v1/health'),
    capabilities: () => request<KrillinCapabilitiesResponse>('GET', '/v1/capabilities'),
    createTask: (body: CreateKrillinTaskRequest) => request<KrillinTask>('POST', '/v1/tasks', body),
    getTask: (taskId: string) => request<KrillinTask>('GET', `/v1/tasks/${encodeURIComponent(taskId)}`),
    cancelTask: (taskId: string) => request<KrillinTask>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/cancel`),
    events: (taskId: string, afterSeq: number) => request<KrillinTaskEventsResponse>(
      'GET',
      `/v1/tasks/${encodeURIComponent(taskId)}/events?afterSeq=${afterSeq}`
    ),
    result: (taskId: string) => request<KrillinResultManifest>('GET', `/v1/tasks/${encodeURIComponent(taskId)}/result`)
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new KrillinServiceError(
      'krillin_invalid_response',
      `KrillinAI service returned invalid JSON (${response.status})`,
      response.status
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
