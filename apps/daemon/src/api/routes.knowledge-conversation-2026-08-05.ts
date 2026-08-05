import type {
  RunResponse,
  ThreadHistoryResponse,
  ThreadResponse,
  ThreadRunsResponse
} from '@clawee/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AttachmentService } from '../attachments/service.js';
import type { CodexSessionProvider } from '../codex/sessions/app-server-provider.js';
import {
  KnowledgeConversationError,
  type KnowledgeConversationManager
} from '../enterprise/knowledge-conversation-2026-08-05.js';
import {
  EnterpriseSessionError
} from '../enterprise/session-manager-2026-07-30.js';
import type { RunManager } from '../runs/manager.js';
import type { RuntimeThread } from '../threads/types.js';
import { apiError } from './errors.js';

export async function registerKnowledgeConversationRoutes(
  server: FastifyInstance,
  manager: KnowledgeConversationManager,
  runManager: Pick<RunManager, 'getLastEventSeq' | 'listRunsByThread'>,
  options: {
    attachmentService?: AttachmentService;
    sessionProvider: Pick<CodexSessionProvider, 'listTurns'>;
  }
): Promise<void> {
  server.post<{ Body: unknown }>('/enterprise/knowledge-conversations', async (request, reply) => {
    if (!isEmptyObject(request.body)) {
      return reply.code(400).send(apiError(
        'VALIDATION_FAILED',
        'body must be an empty object'
      ));
    }
    try {
      return reply.code(201).send({ thread: toThreadResponse(await manager.create()) });
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
        : await options.sessionProvider.listTurns({
            codexThreadId: thread.codexThreadId,
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
    archivedAt: thread.archivedAt
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

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === 0;
}

function sendKnowledgeError(reply: FastifyReply, error: unknown) {
  if (error instanceof KnowledgeConversationError) {
    return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
  }
  if (error instanceof EnterpriseSessionError) {
    return reply.code(error.statusCode).send(apiError(error.code, 'Enterprise operation failed'));
  }
  throw error;
}
