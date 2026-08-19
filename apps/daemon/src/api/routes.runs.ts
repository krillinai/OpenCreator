import type { AttachmentResponse, RunRequest, RunResponse } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { realpathSync } from 'node:fs';
import {
  AttachmentServiceError,
  type AttachmentService
} from '../attachments/service.js';
import {
  isResumeExecutionSupported,
  type RuntimeCapabilityMatrix
} from '../codex/capabilities.js';
import type { RunManager } from '../runs/manager.js';
import type { RuntimeThread, ThreadManager } from '../threads/types.js';
import { ThreadManagerError } from '../threads/types.js';
import type { MemoryService } from '../memory/service.js';
import { apiError } from './errors.js';
import { formatSseEvent } from './sse.js';

export async function registerRunRoutes(
  server: FastifyInstance,
  manager: RunManager,
  options: {
    sseHeartbeatMs?: number;
    threadManager?: ThreadManager;
    profileValidator?: ProfileValidator;
    attachmentService?: AttachmentService;
    capabilities?: RuntimeCapabilityMatrix;
    memoryService?: MemoryService;
  } = {}
): Promise<void> {
  const sseHeartbeatMs = options.sseHeartbeatMs ?? 15_000;
  server.post<{ Body: unknown }>('/runs', async (request, reply) => {
    const parsedBody = parseRunRequest(request.body);
    if (!parsedBody.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', parsedBody.message));
    }
    const body = parsedBody.value;

    let thread: RuntimeThread | undefined;
    if (body.threadId !== undefined) {
      const threadManager = options.threadManager;
      thread = threadManager?.getPublicThread(body.threadId);
      if (thread === undefined) {
        return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
      }
      try {
        thread = threadManager?.assertRunnableThread(body.threadId) ?? thread;
      } catch (error) {
        return sendThreadManagerError(reply, error);
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

      const attachments = resolveRunAttachments(body, thread, options);
      if (!attachments.ok) return sendRunAttachmentError(reply, attachments.error);
      const context = options.memoryService?.prepareRunContext({
        prompt: body.prompt,
        threadId: thread.id,
        projectKey: thread.purpose === 'conversation'
          ? thread.projectId ?? ''
          : ''
      });

      const run = manager.startRun({
        prompt: body.prompt,
        executionPrompt: context?.executionPrompt,
        contextItems: context?.items,
        cwd: thread.cwd,
        profile: thread.profile,
        sandbox: thread.sandbox,
        threadId: thread.id,
        resumeMode: body.resumeMode ?? 'auto',
        model: thread.model ?? undefined,
        reasoning: thread.reasoning ?? undefined,
        imagePaths: attachments.imagePaths,
        attachmentIds: body.attachmentIds,
        submissionMode: body.submissionMode
      });

      try {
        const committed = await commitRunAttachments(body, thread.id, run.id, options);
        return reply.code(202).send(withAttachments(run, committed));
      } catch (error) {
        manager.cancelRun(run.id);
        return sendRunAttachmentError(reply, error);
      }
    }

    if ((body.attachmentIds?.length ?? 0) > 0) {
      return reply
        .code(400)
        .send(apiError('VALIDATION_FAILED', 'threadId is required when attachmentIds are provided'));
    }
    if (body.submissionMode === 'interrupt_and_enqueue') {
      return reply
        .code(400)
        .send(apiError('VALIDATION_FAILED', 'interrupt_and_enqueue requires threadId'));
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
      sandbox: body.sandbox ?? 'workspace-write',
      threadId: body.threadId,
      resumeMode: body.resumeMode,
      model: body.model,
      reasoning: body.reasoning,
      submissionMode: body.submissionMode
    });

    return reply.code(202).send(withAttachments(run, []));
  });

  server.get('/runs', async request => {
    const query = request.query as { limit?: string } | undefined;
    const limit = query?.limit === undefined ? undefined : Number(query.limit);
    return {
      runs: manager.listRuns(Number.isFinite(limit) ? limit : undefined).map(run =>
        withAttachments(run, options.attachmentService?.listByRun(run.id) ?? [])
      )
    };
  });

  server.get('/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    return withAttachments(run, options.attachmentService?.listByRun(run.id) ?? []);
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

  server.post('/runs/:id/steer', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) {
      return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    }
    if (run.status !== 'queued') {
      return reply
        .code(409)
        .send(apiError('VALIDATION_FAILED', 'Only queued runs can be steered'));
    }
    const steered = manager.steerRun?.(id) ?? false;
    return reply.code(steered ? 202 : 409).send({ id, steered });
  });

  server.get('/runs/:id/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = manager.getRun(id);
    if (run === undefined) {
      return reply.code(404).send(apiError('RUN_NOT_FOUND', 'Run not found'));
    }

    const replayAfterSeq = getReplayAfterSeq(request.headers['last-event-id'], request.query);
    if (!replayAfterSeq.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', replayAfterSeq.message));
    }

    for (const [header, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(header, value);
    }
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

    for (const event of manager.listEvents(id, replayAfterSeq.value)) writeEvent(event);
    if (reply.raw.destroyed || reply.raw.writableEnded) return reply;
    if (isTerminalRunStatus(run.status)) {
      closeSse(reply);
      return reply;
    }

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
  for (const key of ['threadId', 'draftId', 'cwd', 'profile', 'model'] as const) {
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

  if (
    input.submissionMode !== undefined
    && input.submissionMode !== 'enqueue'
    && input.submissionMode !== 'interrupt_and_enqueue'
  ) {
    return {
      ok: false,
      message: 'submissionMode must be enqueue or interrupt_and_enqueue'
    };
  }
  if (input.submissionMode !== undefined) value.submissionMode = input.submissionMode;

  if (input.attachmentIds !== undefined) {
    if (!Array.isArray(input.attachmentIds)) {
      return { ok: false, message: 'attachmentIds must be an array' };
    }
    if (input.attachmentIds.length > 8) {
      return { ok: false, message: 'attachmentIds must contain at most 8 items' };
    }
    if (
      input.attachmentIds.some(
        id => typeof id !== 'string' || id.trim().length === 0
      )
    ) {
      return { ok: false, message: 'attachmentIds must contain non-empty strings' };
    }
    value.attachmentIds = input.attachmentIds as string[];
    if (value.attachmentIds.length > 0 && value.draftId === undefined) {
      return { ok: false, message: 'draftId is required when attachmentIds are provided' };
    }
  }

  return { ok: true, value };
}

function resolveRunAttachments(
  body: RunRequest,
  thread: RuntimeThread,
  options: {
    attachmentService?: AttachmentService;
    capabilities?: RuntimeCapabilityMatrix;
  }
):
  | { ok: true; imagePaths: string[] }
  | { ok: false; error: unknown } {
  const ids = body.attachmentIds ?? [];
  if (ids.length === 0) return { ok: true, imagePaths: [] };
  if (body.draftId === undefined) {
    return {
      ok: false,
      error: new AttachmentServiceError(
        'VALIDATION_FAILED',
        'draftId is required when attachmentIds are provided',
        400
      )
    };
  }
  if (options.attachmentService === undefined) {
    return {
      ok: false,
      error: new AttachmentServiceError(
        'ATTACHMENT_STORAGE_FAILED',
        'Attachment service is unavailable',
        503
      )
    };
  }

  const usesResume = body.resumeMode === 'resume_thread'
    || (
      (body.resumeMode === undefined || body.resumeMode === 'auto')
      && thread.codexThreadId !== undefined
      && thread.codexThreadId !== null
      && options.capabilities !== undefined
      && isResumeExecutionSupported(options.capabilities)
    );
  const supported = usesResume
    ? options.capabilities?.resumeImages === true
    : options.capabilities?.execImages === true;
  if (!supported) {
    return {
      ok: false,
      error: new AttachmentServiceError(
        'CODEX_IMAGE_INPUT_UNSUPPORTED',
        'Current Codex version does not support image input',
        409
      )
    };
  }

  try {
    return {
      ok: true,
      imagePaths: options.attachmentService.resolveImagesForRun({
        ids,
        draftId: body.draftId
      }).map(item => item.path)
    };
  } catch (error) {
    return { ok: false, error };
  }
}

async function commitRunAttachments(
  body: RunRequest,
  threadId: string,
  runId: string,
  options: { attachmentService?: AttachmentService }
): Promise<AttachmentResponse[]> {
  const ids = body.attachmentIds ?? [];
  if (ids.length === 0) return [];
  if (body.draftId === undefined || options.attachmentService === undefined) {
    throw new AttachmentServiceError(
      'ATTACHMENT_STORAGE_FAILED',
      'Attachment service is unavailable',
      503
    );
  }
  return options.attachmentService.commit({
    ids,
    draftId: body.draftId,
    threadId,
    runId
  });
}

function withAttachments<T extends RunResponse>(
  run: T,
  attachments: AttachmentResponse[]
): T & { attachments: AttachmentResponse[] } {
  return { ...run, attachments };
}

function sendRunAttachmentError(reply: FastifyReply, error: unknown) {
  if (error instanceof AttachmentServiceError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, error.message, error.details));
  }
  throw error;
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

function getReplayAfterSeq(
  lastEventId: string | string[] | undefined,
  query: unknown
): ParseResult<number> {
  if (isPlainObject(query)) {
    if (Object.hasOwn(query, 'fromSeq')) return parseReplaySeq(query.fromSeq, 'fromSeq');
    if (Object.hasOwn(query, 'afterSeq')) return parseReplaySeq(query.afterSeq, 'afterSeq');
  }
  const header = Array.isArray(lastEventId) ? lastEventId[0] : lastEventId;
  return header === undefined
    ? { ok: true, value: 0 }
    : parseReplaySeq(header, 'Last-Event-ID');
}

function parseReplaySeq(value: unknown, field: string): ParseResult<number> {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return { ok: false, message: `${field} must be a non-negative integer` };
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? { ok: true, value: parsed }
    : { ok: false, message: `${field} must be a non-negative integer` };
}

function isTerminalRunStatus(
  status: NonNullable<ReturnType<RunManager['getRun']>>['status']
): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function closeSse(reply: FastifyReply): void {
  setImmediate(() => {
    if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
  });
}
