import type { ThreadResponse } from '@clawee/protocol';
import type { FastifyInstance } from 'fastify';
import type { RunManager } from '../runs/manager.js';
import type { CreateRuntimeThreadInput, RuntimeThread, ThreadManager } from '../threads/types.js';
import { apiError } from './errors.js';

export async function registerThreadRoutes(
  server: FastifyInstance,
  manager: ThreadManager,
  runManager: Pick<RunManager, 'listRunsByThread'>
): Promise<void> {
  server.post<{ Body: CreateRuntimeThreadInput }>('/threads', async (request, reply) => {
    const thread = manager.createThread(request.body ?? {});
    return reply.code(201).send({ thread: toThreadResponse(thread) });
  });

  server.get('/threads', async request => {
    const query = request.query as { status?: string; limit?: string } | undefined;
    const status = parseThreadStatus(query?.status);
    const limit = parseLimit(query?.limit);
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

    const query = request.query as { limit?: string } | undefined;
    return { runs: runManager.listRunsByThread(id, parseLimit(query?.limit)) };
  });

  server.post('/threads/:id/archive', async (request, reply) => {
    const { id } = request.params as { id: string };
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

function parseThreadStatus(status: string | undefined): 'active' | 'archived' | 'all' | undefined {
  return status === 'active' || status === 'archived' || status === 'all' ? status : undefined;
}

function parseLimit(limit: string | undefined): number | undefined {
  if (limit === undefined) return undefined;
  const parsed = Number(limit);
  return Number.isFinite(parsed) ? parsed : undefined;
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
