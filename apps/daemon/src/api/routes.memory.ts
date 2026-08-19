import type {
  CreateMemoryRequest,
  MemoryListQuery,
  MemoryScope,
  UpdateMemoryRequest
} from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import {
  MemoryServiceError,
  type MemoryService
} from '../memory/service.js';
import { apiError } from './errors.js';

export async function registerMemoryRoutes(
  server: FastifyInstance,
  service: MemoryService,
  options: {
    readThreadHistory(
      threadId: string
    ): Promise<{ items: import('@opencreator/protocol').ThreadHistoryItem[] } | undefined>
      | { items: import('@opencreator/protocol').ThreadHistoryItem[] }
      | undefined;
  }
): Promise<void> {
  server.get('/memories', async (request, reply) => {
    const query = parseMemoryListQuery(request.query);
    if (!query.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', query.message));
    return service.listMemories(query.value);
  });

  server.post<{ Body: unknown }>('/memories', async (request, reply) => {
    const body = parseCreateMemory(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
    try {
      return reply.code(201).send({ memory: service.createMemory(body.value) });
    } catch (error) {
      return sendMemoryError(reply, error);
    }
  });

  server.patch<{ Body: unknown }>('/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseUpdateMemory(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));
    try {
      const memory = service.updateMemory(id, body.value);
      if (memory === undefined) {
        return reply.code(404).send(apiError('MEMORY_NOT_FOUND', 'Memory not found'));
      }
      return { memory };
    } catch (error) {
      return sendMemoryError(reply, error);
    }
  });

  server.delete('/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!service.deleteMemory(id)) {
      return reply.code(404).send(apiError('MEMORY_NOT_FOUND', 'Memory not found'));
    }
    return { deleted: true };
  });

  server.post('/memories/disable-all', async () => ({
    disabledCount: service.disableAll()
  }));

  server.get('/summaries', async (request, reply) => {
    const query = request.query as { threadId?: unknown; limit?: unknown } | undefined;
    if (query?.threadId !== undefined && typeof query.threadId !== 'string') {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'threadId must be a string'));
    }
    const limit = query?.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'limit must be between 1 and 100'));
    }
    return service.listSummaries({
      ...(query?.threadId === undefined ? {} : { threadId: query.threadId }),
      ...(limit === undefined ? {} : { limit })
    });
  });

  server.post('/threads/:id/summaries', async (request, reply) => {
    const { id } = request.params as { id: string };
    const history = await options.readThreadHistory(id);
    if (history === undefined) {
      return reply.code(404).send(apiError('THREAD_NOT_FOUND', 'Thread not found'));
    }
    try {
      return reply.code(201).send({
        summary: service.createSummary({ threadId: id, items: history.items })
      });
    } catch (error) {
      return sendMemoryError(reply, error);
    }
  });

  server.delete('/summaries/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!service.deleteSummary(id)) {
      return reply.code(404).send(apiError('SUMMARY_NOT_FOUND', 'Summary not found'));
    }
    return { deleted: true };
  });

  server.get('/runs/:id/context', async (request) => {
    const { id } = request.params as { id: string };
    return service.listRunContext(id);
  });
}

function parseMemoryListQuery(value: unknown):
  | { ok: true; value: MemoryListQuery }
  | { ok: false; message: string } {
  const query = isRecord(value) ? value : {};
  const result: MemoryListQuery = {};
  if (query.query !== undefined) {
    if (typeof query.query !== 'string') return { ok: false, message: 'query must be a string' };
    result.query = query.query;
  }
  if (query.scope !== undefined) {
    if (!isMemoryScope(query.scope) && query.scope !== 'all') {
      return { ok: false, message: 'scope must be global, project, thread, or all' };
    }
    result.scope = query.scope;
  }
  if (query.scopeKey !== undefined) {
    if (typeof query.scopeKey !== 'string') return { ok: false, message: 'scopeKey must be a string' };
    result.scopeKey = query.scopeKey;
  }
  if (query.enabled !== undefined) {
    if (query.enabled === 'all') result.enabled = 'all';
    else if (query.enabled === 'true') result.enabled = true;
    else if (query.enabled === 'false') result.enabled = false;
    else return { ok: false, message: 'enabled must be true, false, or all' };
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, message: 'limit must be between 1 and 100' };
    }
    result.limit = limit;
  }
  return { ok: true, value: result };
}

function parseCreateMemory(value: unknown):
  | { ok: true; value: CreateMemoryRequest }
  | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'body must be an object' };
  if (typeof value.content !== 'string') return { ok: false, message: 'content must be a string' };
  if (!isMemoryScope(value.scope)) return { ok: false, message: 'scope must be global, project, or thread' };
  if (value.source !== 'user' && value.source !== 'agent_suggestion') {
    return { ok: false, message: 'source must be user or agent_suggestion' };
  }
  if (value.scopeKey !== undefined && typeof value.scopeKey !== 'string') {
    return { ok: false, message: 'scopeKey must be a string' };
  }
  if (value.acknowledgeSensitive !== undefined && typeof value.acknowledgeSensitive !== 'boolean') {
    return { ok: false, message: 'acknowledgeSensitive must be a boolean' };
  }
  return {
    ok: true,
    value: {
      content: value.content,
      scope: value.scope,
      source: value.source,
      ...(value.scopeKey === undefined ? {} : { scopeKey: value.scopeKey }),
      ...(value.acknowledgeSensitive === undefined
        ? {}
        : { acknowledgeSensitive: value.acknowledgeSensitive })
    }
  };
}

function parseUpdateMemory(value: unknown):
  | { ok: true; value: UpdateMemoryRequest }
  | { ok: false; message: string } {
  if (!isRecord(value)) return { ok: false, message: 'body must be an object' };
  const result: UpdateMemoryRequest = {};
  if (value.content !== undefined) {
    if (typeof value.content !== 'string') return { ok: false, message: 'content must be a string' };
    result.content = value.content;
  }
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') return { ok: false, message: 'enabled must be a boolean' };
    result.enabled = value.enabled;
  }
  if (value.acknowledgeSensitive !== undefined) {
    if (typeof value.acknowledgeSensitive !== 'boolean') {
      return { ok: false, message: 'acknowledgeSensitive must be a boolean' };
    }
    result.acknowledgeSensitive = value.acknowledgeSensitive;
  }
  if (Object.keys(result).length === 0) return { ok: false, message: 'at least one field is required' };
  return { ok: true, value: result };
}

function sendMemoryError(reply: import('fastify').FastifyReply, error: unknown) {
  if (error instanceof MemoryServiceError) {
    return reply.code(error.statusCode).send(apiError(error.code, error.message));
  }
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMemoryScope(value: unknown): value is MemoryScope {
  return value === 'global' || value === 'project' || value === 'thread';
}
