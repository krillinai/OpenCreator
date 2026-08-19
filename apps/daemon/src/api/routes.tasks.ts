import type { TaskListQuery, TaskStatusFilter } from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import {
  TaskCursorError,
  type TaskService
} from '../tasks/service.js';
import { apiError } from './errors.js';

const TASK_STATUSES: ReadonlySet<string> = new Set([
  'all',
  'active',
  'terminal',
  'waiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled'
]);

export async function registerTaskRoutes(
  server: FastifyInstance,
  service: TaskService
): Promise<void> {
  server.get('/tasks', async (request, reply) => {
    const parsed = parseTaskQuery(request.query);
    if (!parsed.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    }
    try {
      return service.list(parsed.value);
    } catch (error) {
      if (error instanceof TaskCursorError) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', error.message));
      }
      throw error;
    }
  });
}

function parseTaskQuery(
  value: unknown
): { ok: true; value: TaskListQuery } | { ok: false; message: string } {
  const query = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const result: TaskListQuery = {};
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !TASK_STATUSES.has(query.status)) {
      return { ok: false, message: 'status must be a valid task status' };
    }
    result.status = query.status as TaskStatusFilter;
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return { ok: false, message: 'limit must be an integer between 1 and 100' };
    }
    result.limit = limit;
  }
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== 'string' || query.cursor.length === 0) {
      return { ok: false, message: 'cursor must be a non-empty string' };
    }
    result.cursor = query.cursor;
  }
  return { ok: true, value: result };
}
