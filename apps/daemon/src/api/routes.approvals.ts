import type { ApprovalListQuery, ApprovalStatus } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  ApprovalManagerError,
  type ApprovalManager
} from '../approvals/manager.js';
import { apiError } from './errors.js';

const APPROVAL_STATUSES: ReadonlySet<string> = new Set([
  'all',
  'pending',
  'approved',
  'rejected',
  'expired',
  'canceled'
]);

export async function registerApprovalRoutes(
  server: FastifyInstance,
  manager: ApprovalManager
): Promise<void> {
  server.get('/approvals', async (request, reply) => {
    const parsed = parseApprovalQuery(request.query);
    if (!parsed.ok) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    }
    return { approvals: manager.list(parsed.value) };
  });

  server.get('/approvals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const approval = manager.get(id);
    if (approval === undefined) {
      return reply.code(404).send(apiError('APPROVAL_NOT_FOUND', 'Approval not found'));
    }
    return approval;
  });

  server.post('/approvals/:id/approve', async (request, reply) => {
    return resolveApproval(request.params, reply, manager, 'approve');
  });

  server.post('/approvals/:id/reject', async (request, reply) => {
    return resolveApproval(request.params, reply, manager, 'reject');
  });
}

function resolveApproval(
  params: unknown,
  reply: FastifyReply,
  manager: ApprovalManager,
  action: 'approve' | 'reject'
) {
  const { id } = params as { id: string };
  try {
    return manager[action](id);
  } catch (error) {
    if (error instanceof ApprovalManagerError) {
      return reply.code(404).send(apiError(error.code, error.message));
    }
    throw error;
  }
}

function parseApprovalQuery(
  value: unknown
): { ok: true; value: ApprovalListQuery } | { ok: false; message: string } {
  const query = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const result: ApprovalListQuery = {};
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !APPROVAL_STATUSES.has(query.status)) {
      return { ok: false, message: 'status must be a valid approval status or all' };
    }
    result.status = query.status as ApprovalStatus | 'all';
  }
  for (const key of ['runId', 'threadId'] as const) {
    if (query[key] === undefined) continue;
    if (typeof query[key] !== 'string' || query[key].length === 0) {
      return { ok: false, message: `${key} must be a non-empty string` };
    }
    result[key] = query[key];
  }
  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return { ok: false, message: 'limit must be an integer between 1 and 500' };
    }
    result.limit = limit;
  }
  return { ok: true, value: result };
}
