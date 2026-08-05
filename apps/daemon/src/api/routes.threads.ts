import type {
  AssignThreadProjectRequest,
  RunResponse,
  ThreadHistoryItem,
  ThreadHistoryQuery,
  ThreadHistoryResponse,
  ThreadResponse,
  ThreadRunsResponse,
  UpdateThreadRequest
} from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CodexAppServerResponseError } from '../codex/app-server-client.js';
import {
  ThreadHistoryCursorError
} from '../codex/sessions/index-repository.js';
import type { AttachmentService } from '../attachments/service.js';
import type { RunManager, RuntimeRun } from '../runs/manager.js';
import type {
  CreateConversationThreadInput,
  CreateScheduleThreadInput,
  RuntimeThread,
  ThreadManager
} from '../threads/types.js';
import { ThreadManagerError } from '../threads/types.js';
import { apiError } from './errors.js';

export async function registerThreadRoutes(
  server: FastifyInstance,
  manager: ThreadManager,
  runManager: Pick<RunManager, 'getLastEventSeq' | 'hasActiveRunForThread' | 'listRunsByThread'>,
  options: {
    profileValidator?: ProfileValidator;
    attachmentService?: AttachmentService;
    readThreadHistory?: ReadThreadHistory;
  } = {}
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

    try {
      const thread = 'projectId' in body.value
        ? manager.createConversationThread(body.value)
        : manager.createScheduleThread(body.value);
      return reply.code(201).send({ thread: toThreadResponse(thread) });
    } catch (error) {
      return sendThreadManagerError(reply, error);
    }
  });

  server.get('/threads', async (request, reply) => {
    const query = parseThreadListQuery(request.query);
    if (!query.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', query.message));

    const {
      status = 'active',
      purpose,
      excludePurpose,
      assignment = 'assigned',
      limit = 50
    } = query.value;
    const threads = manager.listPublicThreads({
      status,
      purpose,
      excludePurpose: purpose === undefined && excludePurpose === undefined
        ? 'knowledge_conversation'
        : excludePurpose,
      assignment,
      limit
    });
    return { threads: threads.map(toThreadResponse) };
  });

  server.get('/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = manager.getPublicThread(id);
    if (thread === undefined || thread.purpose === 'knowledge_conversation') {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    return { thread: toThreadResponse(thread) };
  });

  server.get('/threads/:id/runs', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = manager.getPublicThread(id);
    if (thread === undefined || thread.purpose === 'knowledge_conversation') {
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
        lastEventSeq: runManager.getLastEventSeq(run.id),
        attachments: options.attachmentService?.listByRun(run.id) ?? [],
        submissionMode: run.submissionMode,
        ...(run.queuePosition === undefined ? {} : { queuePosition: run.queuePosition })
      }))
    };
    return response;
  });

  server.get('/threads/:id/history', async (request, reply) => {
    const { id } = request.params as { id: string };
    const thread = manager.getPublicThread(id);
    if (thread === undefined || thread.purpose === 'knowledge_conversation') {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }

    const query = parseThreadHistoryQuery(request.query);
    if (!query.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', query.message));

    if (query.value.targetItemId !== undefined) {
      return reply.code(400).send(apiError(
        'VALIDATION_FAILED',
        'Codex app-server search results do not expose message item ids'
      ));
    }
    const paginationRequested =
      query.value.limit !== undefined || query.value.before !== undefined;
    let history: ThreadHistoryReadResult;
    try {
      history = thread.codexThreadId === undefined || thread.codexThreadId === null
        ? {
            items: [],
            ...(paginationRequested ? { hasMore: false } : {})
          }
        : await options.readThreadHistory?.(
            thread.codexThreadId,
            {
              limit: query.value.limit ?? DEFAULT_HISTORY_LIMIT,
              ...(query.value.before === undefined ? {} : { cursor: query.value.before })
            }
          ) ?? {
            items: [],
            ...(paginationRequested ? { hasMore: false } : {})
          };
    } catch (error) {
      if (
        query.value.before !== undefined
        && error instanceof CodexAppServerResponseError
      ) {
        return reply.code(400).send(apiError(
          'THREAD_HISTORY_CURSOR_INVALID',
          'Thread history cursor is invalid'
        ));
      }
      if (error instanceof ThreadHistoryCursorError) {
        const statusCode = error.code === 'THREAD_HISTORY_CURSOR_INVALID'
          ? 400
          : error.code === 'THREAD_HISTORY_CURSOR_MISMATCH'
            ? 409
            : error.code === 'THREAD_HISTORY_TARGET_NOT_FOUND'
              ? 404
              : 410;
        return reply.code(statusCode).send(apiError(error.code, error.message));
      }
      throw error;
    }
    history = {
      ...history,
      items: attachScheduleRunMetadata(
        history.items,
        runManager.listRunsByThread(id, 10_000)
      )
    };

    const response: ThreadHistoryResponse = {
      threadId: thread.id,
      codexThreadId: thread.codexThreadId,
      ...history
    };
    return response;
  });

  server.post<{ Params: { id: string }; Body: unknown }>(
    '/threads/:id/assign-project',
    async (request, reply) => {
      const body = parseAssignThreadProjectRequest(request.body);
      if (!body.ok) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
      }
      try {
        return {
          thread: toThreadResponse(
            manager.assignProject(request.params.id, body.value.projectId)
          )
        };
      } catch (error) {
        return sendThreadManagerError(reply, error);
      }
    }
  );

  server.patch<{ Body: unknown }>('/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseUpdateThreadRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    const existing = manager.getPublicThread(id);
    if (existing === undefined || existing.purpose === 'knowledge_conversation') {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    if (existing.purpose === 'schedule_task') {
      return reply
        .code(409)
        .send(apiError('THREAD_MANAGED_BY_SCHEDULE', 'Thread is managed by a schedule'));
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
      if (error instanceof Error && error.message === 'THREAD_MANAGED_BY_SCHEDULE') {
        return reply
          .code(409)
          .send(apiError('THREAD_MANAGED_BY_SCHEDULE', 'Thread is managed by a schedule'));
      }
      throw error;
    }
  });

  server.post('/threads/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = manager.getPublicThread(id);
    if (existing === undefined || existing.purpose === 'knowledge_conversation') {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    if (existing.purpose === 'schedule_task') {
      return reply
        .code(409)
        .send(apiError('THREAD_MANAGED_BY_SCHEDULE', 'Thread is managed by a schedule'));
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
      if (error instanceof Error && error.message === 'THREAD_MANAGED_BY_SCHEDULE') {
        return reply
          .code(409)
          .send(apiError('THREAD_MANAGED_BY_SCHEDULE', 'Thread is managed by a schedule'));
      }
      throw error;
    }
  });
}

function toThreadResponse(thread: RuntimeThread): ThreadResponse {
  return {
    id: thread.id,
    title: thread.title,
    projectId: thread.projectId,
    origin: thread.origin,
    codexThreadId: thread.codexThreadId,
    cwd: thread.cwd,
    canonicalCwd: thread.canonicalCwd,
    workspaceMode: thread.workspaceMode,
    profile: thread.profile,
    model: thread.model,
    reasoning: thread.reasoning,
    sandbox: thread.sandbox,
    status: thread.status,
    purpose: thread.purpose,
    ...(thread.scheduleId === undefined ? {} : { scheduleId: thread.scheduleId }),
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
type ThreadHistoryReadResult = Pick<
  ThreadHistoryResponse,
  'items' | 'hasMore' | 'nextCursor' | 'oldestItemAt' | 'targetItemId'
>;
type ThreadHistoryPageOptions = {
  limit: number;
  cursor?: string;
};
type ReadThreadHistory = (
  codexThreadId: string,
  options: ThreadHistoryPageOptions
) => Promise<ThreadHistoryReadResult> | ThreadHistoryReadResult;

function attachScheduleRunMetadata(
  items: ThreadHistoryItem[],
  runs: RuntimeRun[]
): ThreadHistoryItem[] {
  const runsByTriggeredAt = new Map<string, RuntimeRun[]>();
  for (const run of runs) {
    if (
      run.createdBy !== 'schedule'
      || run.publicPrompt === undefined
      || run.triggeredAt === undefined
    ) {
      continue;
    }
    const matches = runsByTriggeredAt.get(run.triggeredAt) ?? [];
    matches.push(run);
    runsByTriggeredAt.set(run.triggeredAt, matches);
  }

  return items.map(item => {
    if (item.type !== 'schedule_trigger') return item;
    const candidates = runsByTriggeredAt.get(item.triggeredAt) ?? [];
    const run = candidates.find(candidate => candidate.publicPrompt === item.prompt)
      ?? candidates[0];
    if (run === undefined) return item;
    return {
      ...item,
      prompt: run.publicPrompt!,
      triggeredAt: run.triggeredAt!,
      runId: run.id
    };
  });
}

const WORKSPACE_MODES = ['managed', 'external'] as const;
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
const REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
const THREAD_PURPOSES = ['conversation', 'schedule_draft', 'schedule_task'] as const;
const THREAD_STATUSES = ['active', 'archived', 'all'] as const;
const LIMIT_PATTERN = /^[1-9]\d*$/;
const MAX_LIMIT = 100;
const DEFAULT_HISTORY_LIMIT = 50;

function parseCreateThreadRequest(
  body: unknown
): ParseResult<CreateConversationThreadInput | CreateScheduleThreadInput> {
  if (body === undefined) return { ok: false, message: 'body must be an object' };
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const input = body as Record<string, unknown>;
  if (input.enterpriseSubjectId !== undefined) {
    return { ok: false, message: 'enterpriseSubjectId is server controlled' };
  }
  if (input.purpose === 'schedule_draft') {
    if (input.projectId !== undefined) {
      return { ok: false, message: 'schedule drafts must not specify projectId' };
    }
    const value: CreateScheduleThreadInput = { purpose: 'schedule_draft' };
    for (const key of ['title', 'cwd', 'profile', 'model'] as const) {
      const field = input[key];
      if (field === undefined) continue;
      if (typeof field !== 'string') return { ok: false, message: `${key} must be a string` };
      value[key] = field;
    }
    const shared = parseThreadCreateOptions(input, value, true);
    return shared.ok ? { ok: true, value } : shared;
  }

  if (input.purpose !== undefined && input.purpose !== 'conversation') {
    return { ok: false, message: 'purpose must be conversation or schedule_draft' };
  }
  if (typeof input.projectId !== 'string' || input.projectId.trim().length === 0) {
    return { ok: false, message: 'projectId is required for conversation threads' };
  }
  if (input.cwd !== undefined || input.workspaceMode !== undefined) {
    return {
      ok: false,
      message: 'conversation cwd and workspaceMode are controlled by the project'
    };
  }

  const value: CreateConversationThreadInput = { projectId: input.projectId };
  for (const key of ['title', 'profile', 'model'] as const) {
    const field = input[key];
    if (field === undefined) continue;
    if (typeof field !== 'string') return { ok: false, message: `${key} must be a string` };
    value[key] = field;
  }
  const shared = parseThreadCreateOptions(input, value, false);
  return shared.ok ? { ok: true, value } : shared;
}

function parseThreadCreateOptions(
  input: Record<string, unknown>,
  value: CreateConversationThreadInput | CreateScheduleThreadInput,
  allowWorkspaceMode: boolean
): ParseResult<undefined> {
  if (input.workspaceMode !== undefined) {
    if (!allowWorkspaceMode) {
      return { ok: false, message: 'workspaceMode is controlled by the project' };
    }
    if (!isOneOf(input.workspaceMode, WORKSPACE_MODES)) {
      return { ok: false, message: 'workspaceMode must be managed or external' };
    }
    (value as CreateScheduleThreadInput).workspaceMode = input.workspaceMode;
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

  return { ok: true, value: undefined };
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

function parseAssignThreadProjectRequest(
  body: unknown
): ParseResult<AssignThreadProjectRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (
    Object.keys(body).some(key => key !== 'projectId')
    || typeof body.projectId !== 'string'
    || body.projectId.trim().length === 0
  ) {
    return { ok: false, message: 'projectId is required' };
  }
  return { ok: true, value: { projectId: body.projectId } };
}

function parseThreadListQuery(
  query: unknown
): ParseResult<{
  status?: 'active' | 'archived' | 'all';
  purpose?: RuntimeThread['purpose'];
  excludePurpose?: RuntimeThread['purpose'];
  assignment?: 'assigned' | 'unassigned';
  limit?: number;
}> {
  const status = getQueryString(query, 'status');
  if (!status.ok) return status;
  if (status.value !== undefined && !isOneOf(status.value, THREAD_STATUSES)) {
    return { ok: false, message: 'status must be active, archived, or all' };
  }

  const purpose = getQueryString(query, 'purpose');
  if (!purpose.ok) return purpose;
  if (purpose.value !== undefined && !isOneOf(purpose.value, THREAD_PURPOSES)) {
    return { ok: false, message: 'purpose must be a valid thread purpose' };
  }

  const excludePurpose = getQueryString(query, 'excludePurpose');
  if (!excludePurpose.ok) return excludePurpose;
  if (
    excludePurpose.value !== undefined
    && !isOneOf(excludePurpose.value, THREAD_PURPOSES)
  ) {
    return { ok: false, message: 'excludePurpose must be a valid thread purpose' };
  }
  if (purpose.value !== undefined && excludePurpose.value !== undefined) {
    return {
      ok: false,
      message: 'purpose and excludePurpose cannot be used together'
    };
  }

  const assignment = getQueryString(query, 'assignment');
  if (!assignment.ok) return assignment;
  if (
    assignment.value !== undefined
    && assignment.value !== 'assigned'
    && assignment.value !== 'unassigned'
  ) {
    return { ok: false, message: 'assignment must be assigned or unassigned' };
  }
  if (assignment.value === 'unassigned' && purpose.value !== 'conversation') {
    return {
      ok: false,
      message: 'assignment=unassigned requires purpose=conversation'
    };
  }

  const limit = parseLimitQuery(query);
  if (!limit.ok) return limit;

  return {
    ok: true,
    value: {
      ...(status.value === undefined ? {} : { status: status.value }),
      ...(purpose.value === undefined ? {} : { purpose: purpose.value }),
      ...(excludePurpose.value === undefined
        ? {}
        : { excludePurpose: excludePurpose.value }),
      ...(assignment.value === undefined
        ? {}
        : { assignment: assignment.value }),
      ...(limit.value === undefined ? {} : { limit: limit.value })
    }
  };
}

function parseThreadHistoryQuery(query: unknown): ParseResult<ThreadHistoryQuery> {
  const limit = parseLimitQuery(query);
  if (!limit.ok) return limit;
  const before = getQueryString(query, 'before');
  if (!before.ok) return before;
  const targetItemId = getQueryString(query, 'targetItemId');
  if (!targetItemId.ok) return targetItemId;
  if (before.value !== undefined && targetItemId.value !== undefined) {
    return { ok: false, message: 'before and targetItemId cannot be used together' };
  }

  return {
    ok: true,
    value: {
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(before.value === undefined ? {} : { before: before.value }),
      ...(targetItemId.value === undefined ? {} : { targetItemId: targetItemId.value })
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

function sendThreadManagerError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ThreadManagerError)) throw error;
  if (error.code === 'THREAD_NOT_FOUND' || error.code === 'PROJECT_NOT_FOUND') {
    return reply.code(404).send(apiError(error.code, error.message));
  }
  if (error.code === 'PROJECT_DIRECTORY_UNAVAILABLE') {
    return reply.code(422).send(apiError(error.code, error.message));
  }
  return reply.code(409).send(apiError(error.code, error.message));
}
