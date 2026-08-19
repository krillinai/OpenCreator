import type {
  RunResponse,
  ThreadHistoryResponse,
  ThreadResponse,
  ThreadRunsResponse
} from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AttachmentService } from '../attachments/service.js';
import type { CodexThreadHistoryPage } from '../codex/sessions/app-server-provider.js';
import {
  KnowledgeConversationError,
  type KnowledgeConversationManager
} from '../enterprise/knowledge-conversation-2026-08-05.js';
import {
  EnterpriseSessionError
} from '../enterprise/session-manager-2026-07-30.js';
import type { RunManager } from '../runs/manager.js';
import { ThreadManagerError, type RuntimeThread } from '../threads/types.js';
import { apiError } from './errors.js';

export async function registerKnowledgeConversationRoutes(
  server: FastifyInstance,
  manager: KnowledgeConversationManager,
  runManager: Pick<RunManager, 'getLastEventSeq' | 'listRunsByThread' | 'startRun'>,
  options: {
    attachmentService?: AttachmentService;
    readHistory(
      thread: RuntimeThread,
      options: { limit: number; cursor?: string }
    ): Promise<CodexThreadHistoryPage>;
  }
): Promise<void> {
  server.post<{ Body: unknown }>('/enterprise/knowledge-conversations', async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (
      body === null
      || typeof body !== 'object'
      || typeof body.projectId !== 'string'
      || body.projectId.trim().length === 0
      || Object.keys(body).some(key => key !== 'projectId')
    ) {
      return reply.code(400).send(apiError(
        'VALIDATION_FAILED',
        'projectId is required'
      ));
    }
    try {
      return reply.code(201).send({
        thread: toThreadResponse(await manager.create(body.projectId.trim()))
      });
    } catch (error) {
      return sendKnowledgeError(reply, error);
    }
  });

  server.get('/enterprise/knowledge-conversations/latest', async (_request, reply) => {
    try {
      const thread = await manager.latest();
      if (thread === undefined) return reply.code(204).send();
      return { thread: toThreadResponse(thread) };
    } catch (error) {
      return sendKnowledgeError(reply, error);
    }
  });

  server.get('/enterprise/knowledge-conversations/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return { thread: toThreadResponse(await manager.requireOwnedThread(id)) };
    } catch (error) {
      return sendKnowledgeError(reply, error);
    }
  });

  server.get('/enterprise/knowledge-conversations/:id/runs', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await manager.requireOwnedThread(id);
      const limit = parseLimit(request.query);
      if (limit === null) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'limit must be an integer between 1 and 100'));
      }
      const response: ThreadRunsResponse = {
        runs: runManager.listRunsByThread(id, limit).map((run): RunResponse => ({
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
    } catch (error) {
      return sendKnowledgeError(reply, error);
    }
  });

  server.post<{ Body: unknown }>(
    '/enterprise/knowledge-conversations/:id/runs',
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const thread = await manager.requireOwnedThread(id);
        const body = request.body as Record<string, unknown> | null;
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
        if (prompt.length === 0 || prompt.length > 100_000) {
          return reply.code(400).send(apiError('VALIDATION_FAILED', 'prompt is invalid'));
        }
        const run = runManager.startRun({
          prompt,
          publicPrompt: prompt,
          threadId: thread.id,
          resumeMode: 'auto',
          createdBy: 'api',
          submissionMode: 'enqueue'
        });
        return reply.code(202).send({
          ...run,
          lastEventSeq: runManager.getLastEventSeq(run.id),
          attachments: []
        } satisfies RunResponse);
      } catch (error) {
        return sendKnowledgeError(reply, error);
      }
    }
  );

  server.get('/enterprise/knowledge-conversations/:id/history', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const thread = await manager.requireOwnedThread(id);
      const query = request.query as Record<string, unknown>;
      const limit = parseLimit(query);
      if (limit === null || hasInvalidString(query.before) || hasInvalidString(query.targetItemId)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'history query is invalid'));
      }
      if (query.targetItemId !== undefined) {
        return reply.code(400).send(apiError(
          'VALIDATION_FAILED',
          'Codex app-server search results do not expose message item ids'
        ));
      }
      const paginationRequested = query.limit !== undefined || query.before !== undefined;
      const history = thread.codexThreadId === undefined || thread.codexThreadId === null
        ? { items: [], ...(paginationRequested ? { hasMore: false } : {}) }
        : await options.readHistory(thread, {
            limit: limit ?? 50,
            ...(typeof query.before === 'string' ? { cursor: query.before } : {})
          });
      const response: ThreadHistoryResponse = {
        threadId: id,
        codexThreadId: thread.codexThreadId,
        ...history
      };
      return response;
    } catch (error) {
      return sendKnowledgeError(reply, error);
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
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt
  };
}

function parseLimit(query: unknown): number | undefined | null {
  const value = (query as Record<string, unknown> | undefined)?.limit;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 100 ? parsed : null;
}

function hasInvalidString(value: unknown): boolean {
  return value !== undefined && typeof value !== 'string';
}

function sendKnowledgeError(reply: FastifyReply, error: unknown) {
  if (error instanceof KnowledgeConversationError) {
    return reply.code(error.statusCode).send(apiError(
      error.code,
      error.code === 'THREAD_NOT_FOUND'
        ? 'Thread not found'
        : error.code === 'KNOWLEDGE_SEARCH_NOT_GRANTED'
          ? 'Knowledge search is not granted'
          : 'Enterprise knowledge is unavailable'
    ));
  }
  if (error instanceof EnterpriseSessionError) {
    return reply.code(error.statusCode).send(apiError(error.code, 'Enterprise operation failed'));
  }
  if (error instanceof ThreadManagerError) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return reply.code(404).send(apiError(error.code, error.message));
    }
    if (error.code === 'PROJECT_DIRECTORY_UNAVAILABLE') {
      return reply.code(422).send(apiError(error.code, error.message));
    }
    return reply.code(409).send(apiError(error.code, error.message));
  }
  throw error;
}
