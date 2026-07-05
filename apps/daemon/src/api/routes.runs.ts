import type { RunRequest } from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { realpathSync } from 'node:fs';
import type { RunManager } from '../runs/manager.js';
import type { RuntimeThread, ThreadManager } from '../threads/types.js';
import { apiError } from './errors.js';
import { formatSseEvent } from './sse.js';

export async function registerRunRoutes(
  server: FastifyInstance,
  manager: RunManager,
  options: {
    sseHeartbeatMs?: number;
    threadManager?: ThreadManager;
    profileValidator?: ProfileValidator;
  } = {}
): Promise<void> {
  const sseHeartbeatMs = options.sseHeartbeatMs ?? 15_000;
  server.post<{ Body: unknown }>('/runs', async (request, reply) => {
    const parsedBody = parseRunRequest(request.body);
    if (!parsedBody.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', parsedBody.message));
    }
    const body = parsedBody.value;

    if (body.threadId !== undefined) {
      const threadManager = options.threadManager;
      const thread = threadManager?.getThread(body.threadId);
      if (thread === undefined) {
        return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
      }
      if (thread.status === 'archived') {
        return reply.code(409).send(apiError('THREAD_ARCHIVED', 'Thread is archived'));
      }
      const immutable = overridesThreadConfig(body, thread);
      if (!immutable.ok) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', immutable.message));
      }
      if (immutable.value) {
        return reply
          .code(409)
          .send(apiError('THREAD_CONFIG_IMMUTABLE', 'Thread run config is immutable'));
      }

      const validation = options.profileValidator?.validateProfileForRun(thread.profile);
      if (validation !== undefined && !validation.ok) {
        return sendProfileValidationError(reply, validation);
      }

      const run = manager.startRun({
        prompt: body.prompt,
        cwd: thread.cwd,
        profile: thread.profile,
        sandbox: thread.sandbox,
        threadId: thread.id,
        resumeMode: body.resumeMode ?? 'auto',
        model: thread.model ?? undefined,
        reasoning: thread.reasoning ?? undefined
      });

      return reply.code(202).send(run);
    }

    if (body.profile !== undefined) {
      const validation = options.profileValidator?.validateProfileForRun(body.profile);
      if (validation !== undefined && !validation.ok) {
        return sendProfileValidationError(reply, validation);
      }
    }

    const run = manager.startRun({
      prompt: body.prompt,
      cwd: body.cwd ?? process.cwd(),
      profile: body.profile ?? 'default',
      sandbox: body.sandbox ?? 'read-only',
      threadId: body.threadId,
      resumeMode: body.resumeMode,
      model: body.model,
      reasoning: body.reasoning
    });

    return reply.code(202).send(run);
  });

  server.get('/runs', async request => {
    const query = request.query as { limit?: string } | undefined;
    const limit = query?.limit === undefined ? undefined : Number(query.limit);
    return { runs: manager.listRuns(Number.isFinite(limit) ? limit : undefined) };
  });

  server.get('/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    return run;
  });

  server.post('/runs/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) {
      return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    }
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      return reply
        .code(409)
        .send(apiError('RUN_ALREADY_TERMINAL', 'Run is already terminal'));
    }
    const canceled = manager.cancelRun(id);
    return reply.code(canceled ? 202 : 409).send({ id, canceled });
  });

  server.get('/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (manager.getRun(id) === undefined) {
      return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    }

    const afterSeq = getReplayAfterSeq(request.headers['last-event-id'], request.query);
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });

    const writeEvent = (event: ReturnType<RunManager['listEvents']>[number]) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(formatSseEvent({ id: String(event.seq), event: event.type, data: event }));
      if (event.type === 'done') closeSse(reply);
    };

    for (const event of manager.listEvents(id, afterSeq)) writeEvent(event);
    if (reply.raw.destroyed || reply.raw.writableEnded) return reply;

    const unsubscribe = manager.subscribe(id, writeEvent);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(': heartbeat\n\n');
    }, sseHeartbeatMs);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on('close', cleanup);
    reply.raw.on('close', cleanup);

    return reply;
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };
type ProfileValidationResult = { ok: true } | { ok: false; code: string; message: string };
type ProfileValidator = {
  validateProfileForRun(name: string): ProfileValidationResult;
};

const RESUME_MODES = ['auto', 'new_thread', 'resume_thread'] as const;
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
const REASONING_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;

function parseRunRequest(body: unknown): ParseResult<RunRequest> {
  if (body === undefined) return { ok: false, message: 'prompt is required' };
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const input = body as Record<string, unknown>;
  const prompt = input.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { ok: false, message: 'prompt is required' };
  }

  const value: RunRequest = { prompt };
  for (const key of ['threadId', 'cwd', 'profile', 'model'] as const) {
    const field = input[key];
    if (field === undefined) continue;
    if (typeof field !== 'string') return { ok: false, message: `${key} must be a string` };
    value[key] = field;
  }

  if (input.resumeMode !== undefined) {
    if (!isOneOf(input.resumeMode, RESUME_MODES)) {
      return { ok: false, message: 'resumeMode must be auto, new_thread, or resume_thread' };
    }
    value.resumeMode = input.resumeMode;
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

function overridesThreadConfig(body: RunRequest, thread: RuntimeThread): ParseResult<boolean> {
  let cwdChanged = false;
  if (body.cwd !== undefined) {
    try {
      cwdChanged = realpathSync(body.cwd) !== thread.canonicalCwd;
    } catch {
      return { ok: false, message: 'cwd must exist' };
    }
  }

  return {
    ok: true,
    value:
      cwdChanged
      || (body.profile !== undefined && body.profile !== thread.profile)
      || (body.model !== undefined && body.model !== thread.model)
      || (body.reasoning !== undefined && body.reasoning !== thread.reasoning)
      || (body.sandbox !== undefined && body.sandbox !== thread.sandbox)
  };
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

function getReplayAfterSeq(lastEventId: string | string[] | undefined, query: unknown): number {
  const queryValue = typeof query === 'object' && query !== null
    ? Number((query as { afterSeq?: string; fromSeq?: string }).fromSeq ?? (query as { afterSeq?: string }).afterSeq)
    : undefined;
  if (typeof queryValue === 'number' && Number.isFinite(queryValue)) return queryValue;

  const header = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
  const parsedHeader = header === undefined ? undefined : Number(header);
  return typeof parsedHeader === 'number' && Number.isFinite(parsedHeader) ? parsedHeader : 0;
}

function closeSse(reply: FastifyReply): void {
  setImmediate(() => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  });
}
