import type {
  RunResponse,
  ThreadHistoryQuery,
  ThreadHistoryResponse,
  ThreadResponse,
  ThreadRunsResponse,
  UpdateThreadRequest
} from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ThreadHistoryCursorError,
  type ThreadHistoryPageOptions
} from '../codex/sessions/index-repository.js';
import type { RunManager } from '../runs/manager.js';
import type { CreateRuntimeThreadInput, RuntimeThread, ThreadManager } from '../threads/types.js';
import { apiError } from './errors.js';

export async function registerThreadRoutes(
  server: FastifyInstance,
  manager: ThreadManager,
  runManager: Pick<RunManager, 'getLastEventSeq' | 'hasActiveRunForThread' | 'listRunsByThread'>,
  options: { profileValidator?: ProfileValidator; syncCodexSessions?: SyncCodexSessions; readThreadHistory?: ReadThreadHistory } = {}
): Promise<void> {
  server.post<{ Body: unknown }>('/threads', async (request, reply) => {
    const body = parseCreateThreadRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    if (body.value.profile !== undefined) {
      const validation = options.profileValidator?.validateProfileForRun(body.value.profile);
      if (validation !== undefined && !validation.ok) {
        return sendProfileValidationError(reply, validation);
      }
    }

    const thread = manager.createThread(body.value);
    return reply.code(201).send({ thread: toThreadResponse(thread) });
  });

  server.get('/threads', async (request, reply) => {
    const query = parseThreadListQuery(request.query);
    if (!query.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', query.message));

    const { status, limit } = query.value;
    options.syncCodexSessions?.(limit);
    const threads = manager.listThreads({ status, limit }).map(toThreadResponse);
    return { threads };
  });

  server.get('/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = manager.getThread(id);
    if (thread === undefined) {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    return { thread: toThreadResponse(thread) };
  });

  server.get('/threads/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = manager.getThread(id);
    if (thread === undefined) {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }

    const limit = parseLimitQuery(request.query);
    if (!limit.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', limit.message));

    const response: ThreadRunsResponse = {
      runs: runManager.listRunsByThread(id, limit.value).map((run): RunResponse => ({
        id: run.id,
        threadId: run.threadId,
        codexThreadId: run.codexThreadId,
        status: run.status,
        lastEventSeq: runManager.getLastEventSeq(run.id)
      }))
    };
    return response;
  });

  server.get('/threads/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = manager.getThread(id);
    if (thread === undefined) {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }

    const query = parseThreadHistoryQuery(request.query);
    if (!query.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', query.message));

    const paginationRequested =
      query.value.limit !== undefined || query.value.before !== undefined;
    let history: ThreadHistoryReadResult;
    try {
      history = thread.codexThreadId === undefined || thread.codexThreadId === null
        ? {
            items: [],
            ...(paginationRequested ? { hasMore: false } : {})
          }
        : options.readThreadHistory?.(
            thread.codexThreadId,
            paginationRequested
              ? {
                  limit: query.value.limit ?? DEFAULT_HISTORY_LIMIT,
                  ...(query.value.before === undefined ? {} : { before: query.value.before })
                }
              : undefined
          ) ?? {
            items: [],
            ...(paginationRequested ? { hasMore: false } : {})
          };
    } catch (error) {
      if (error instanceof ThreadHistoryCursorError) {
        const statusCode = error.code === 'THREAD_HISTORY_CURSOR_INVALID'
          ? 400
          : error.code === 'THREAD_HISTORY_CURSOR_MISMATCH'
            ? 409
            : 410;
        return reply.code(statusCode).send(apiError(error.code, error.message));
      }
      throw error;
    }

    const response: ThreadHistoryResponse = {
      threadId: thread.id,
      codexThreadId: thread.codexThreadId,
      ...history
    };
    return response;
  });

  server.patch<{ Body: unknown }>('/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseUpdateThreadRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    const existing = manager.getThread(id);
    if (existing === undefined) {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    if (existing.status === 'archived') {
      return reply.code(409).send(apiError('THREAD_ARCHIVED', 'Thread is archived'));
    }
    if (runManager.hasActiveRunForThread(id)) {
      return reply.code(409).send(apiError('THREAD_HAS_ACTIVE_RUN', 'Thread has active run'));
    }

    try {
      const thread = manager.updateThread(id, body.value);
      return { thread: toThreadResponse(thread) };
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
        return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
      }
      throw error;
    }
  });

  server.post('/threads/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (manager.getThread(id) === undefined) {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    if (runManager.hasActiveRunForThread(id)) {
      return reply.code(409).send(apiError('THREAD_HAS_ACTIVE_RUN', 'Thread has active run'));
    }
    try {
      const thread = manager.archiveThread(id);
      return { thread: toThreadResponse(thread) };
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
        return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
      }
      throw error;
    }
  });
}

function toThreadResponse(thread: RuntimeThread): ThreadResponse {
  return {
    id: thread.id,
    title: thread.title,
    codexThreadId: thread.codexThreadId,
    cwd: thread.cwd,
    canonicalCwd: thread.canonicalCwd,
    workspaceMode: thread.workspaceMode,
    profile: thread.profile,
    model: thread.model,
    reasoning: thread.reasoning,
    sandbox: thread.sandbox,
    status: thread.status,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt
  };
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };
type ProfileValidationResult = { ok: true } | { ok: false; code: string; message: string };
type ProfileValidator = {
  validateProfileForRun(name: string): ProfileValidationResult;
};
type SyncCodexSessions = (limit?: number) => void;
type ThreadHistoryReadResult = Pick<
  ThreadHistoryResponse,
  'items' | 'hasMore' | 'nextCursor' | 'oldestItemAt'
>;
type ReadThreadHistory = (
  codexThreadId: string,
  options?: ThreadHistoryPageOptions
) => ThreadHistoryReadResult;

const WORKSPACE_MODES = ['managed', 'external'] as const;
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
const REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
const THREAD_STATUSES = ['active', 'archived', 'all'] as const;
const LIMIT_PATTERN = /^[1-9]\d*$/;
const MAX_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 50;

function parseCreateThreadRequest(body: unknown): ParseResult<CreateRuntimeThreadInput> {
  if (body === undefined) return { ok: true, value: {} };
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const input = body as Record<string, unknown>;
  const value: CreateRuntimeThreadInput = {};

  for (const key of ['title', 'cwd', 'profile', 'model'] as const) {
    const field = input[key];
    if (field === undefined) continue;
    if (typeof field !== 'string') return { ok: false, message: `${key} must be a string` };
    value[key] = field;
  }

  if (input.workspaceMode !== undefined) {
    if (!isOneOf(input.workspaceMode, WORKSPACE_MODES)) {
      return { ok: false, message: 'workspaceMode must be managed or external' };
    }
    value.workspaceMode = input.workspaceMode;
  }

  if (input.sandbox !== undefined) {
    if (!isOneOf(input.sandbox, SANDBOX_MODES)) {
      return { ok: false, message: 'sandbox must be a valid sandbox mode' };
    }
    value.sandbox = input.sandbox;
  }

  if (input.reasoning !== undefined) {
    if (!isOneOf(input.reasoning, REASONING_EFFORTS)) {
      return { ok: false, message: 'reasoning must be a valid reasoning effort' };
    }
    value.reasoning = input.reasoning;
  }

  return { ok: true, value };
}

function parseUpdateThreadRequest(body: unknown): ParseResult<Required<UpdateThreadRequest>> {
  if (body === undefined) return { ok: false, message: 'body must be an object' };
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const input = body as Record<string, unknown>;
  const sandbox = input.sandbox;
  if (!isOneOf(sandbox, SANDBOX_MODES)) {
    return { ok: false, message: 'sandbox must be a valid sandbox mode' };
  }

  return { ok: true, value: { sandbox } };
}

function parseThreadListQuery(
  query: unknown
): ParseResult<{ status?: 'active' | 'archived' | 'all'; limit?: number }> {
  const status = getQueryString(query, 'status');
  if (!status.ok) return status;
  if (status.value !== undefined && !isOneOf(status.value, THREAD_STATUSES)) {
    return { ok: false, message: 'status must be active, archived, or all' };
  }

  const limit = parseLimitQuery(query);
  if (!limit.ok) return limit;

  return {
    ok: true,
    value: {
      ...(status.value === undefined ? {} : { status: status.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value })
    }
  };
}

function parseThreadHistoryQuery(query: unknown): ParseResult<ThreadHistoryQuery> {
  const limit = parseLimitQuery(query);
  if (!limit.ok) return limit;
  const before = getQueryString(query, 'before');
  if (!before.ok) return before;

  return {
    ok: true,
    value: {
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(before.value === undefined ? {} : { before: before.value })
    }
  };
}

function parseLimitQuery(query: unknown): ParseResult<number | undefined> {
  const limit = getQueryString(query, 'limit');
  if (!limit.ok) return limit;
  if (limit.value === undefined) return { ok: true, value: undefined };
  if (!LIMIT_PATTERN.test(limit.value)) {
    return { ok: false, message: 'limit must be an integer between 1 and 100' };
  }

  const parsed = Number(limit.value);
  if (parsed < 1 || parsed > MAX_LIMIT) {
    return { ok: false, message: 'limit must be an integer between 1 and 100' };
  }
  return { ok: true, value: parsed };
}

function getQueryString(query: unknown, key: string): ParseResult<string | undefined> {
  if (query === undefined || query === null) return { ok: true, value: undefined };
  if (typeof query !== 'object' || Array.isArray(query)) {
    return { ok: false, message: 'query must be an object' };
  }

  const value = (query as Record<string, unknown>)[key];
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false, message: `${key} must be a string` };
  return { ok: true, value };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<const T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === 'string' && options.includes(value);
}

function sendProfileValidationError(
  reply: FastifyReply,
  validation: Extract<ProfileValidationResult, { ok: false }>
) {
  if (validation.code === 'CODEX_PROFILE_NOT_FOUND') {
    return reply.code(404).send(apiError('CODEX_PROFILE_NOT_FOUND', validation.message));
  }
  if (validation.code === 'CODEX_CONFIG_INVALID') {
    return reply.code(422).send(apiError('CODEX_CONFIG_INVALID', validation.message));
  }
  return reply.code(422).send(apiError('CODEX_PROFILE_INVALID', validation.message));
}
