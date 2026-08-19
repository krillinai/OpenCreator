import type { CreateScheduleRequest, UpdateScheduleRequest } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ScheduleCoordinator } from '../scheduler/coordinator.js';
import { SchedulerError, type SchedulerService } from '../scheduler/service.js';
import { apiError } from './errors.js';

export async function registerScheduleRoutes(
  server: FastifyInstance,
  coordinator: ScheduleCoordinator,
  scheduler: SchedulerService
): Promise<void> {
  server.get('/schedules', async (_request, reply) => {
    try {
      return scheduler.listSchedules();
    } catch (error) {
      return sendSchedulerError(error, reply);
    }
  });

  server.post<{ Body: unknown }>('/schedules', async (request, reply) => {
    const body = parseBodyObject(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    try {
      const schedule = coordinator.createManual(body.value as CreateScheduleRequest);
      return reply.code(201).send(schedule);
    } catch (error) {
      return sendSchedulerError(error, reply);
    }
  });

  server.get<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
    try {
      const schedule = scheduler.getSchedule(request.params.id);
      if (schedule === undefined) {
        return reply.code(404).send(apiError('SCHEDULE_NOT_FOUND', 'Schedule not found'));
      }
      return schedule;
    } catch (error) {
      return sendSchedulerError(error, reply);
    }
  });

  server.patch<{ Params: { id: string }; Body: unknown }>(
    '/schedules/:id',
    async (request, reply) => {
      const body = parseBodyObject(request.body);
      if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

      try {
        return coordinator.update(request.params.id, body.value as UpdateScheduleRequest);
      } catch (error) {
        return sendSchedulerError(error, reply);
      }
    }
  );

  server.delete<{ Params: { id: string } }>('/schedules/:id', async (request, reply) => {
    try {
      coordinator.delete(request.params.id);
      return { deleted: true };
    } catch (error) {
      return sendSchedulerError(error, reply);
    }
  });

  server.post<{ Params: { id: string } }>('/schedules/:id/run-now', async (request, reply) => {
    try {
      const result = scheduler.runNow(request.params.id);
      return reply.code(202).send(result);
    } catch (error) {
      return sendSchedulerError(error, reply);
    }
  });

  server.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/schedules/:id/operations',
    async (request, reply) => {
      const limit = parseLimitQuery(request.query);

      try {
        return scheduler.listOperations(request.params.id, limit);
      } catch (error) {
        return sendSchedulerError(error, reply);
      }
    }
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseBodyObject(body: unknown): ParseResult<Record<string, unknown>> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  return { ok: true, value: body };
}

function parseLimitQuery(query: unknown): number | undefined {
  if (!isPlainObject(query)) return undefined;

  const rawLimit = query.limit;
  if (typeof rawLimit !== 'string') return undefined;

  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(200, Math.max(1, Math.trunc(parsed)));
}

function sendSchedulerError(error: unknown, reply: FastifyReply) {
  if (!(error instanceof SchedulerError)) {
    return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal error'));
  }

  if (error.code === 'VALIDATION_FAILED') {
    return reply.code(400).send(apiError(error.code, error.message));
  }
  if (error.code === 'SCHEDULE_INVALID') {
    return reply.code(422).send(apiError(error.code, error.message));
  }
  if (error.code === 'SCHEDULE_NOT_FOUND' || error.code === 'CODEX_PROFILE_NOT_FOUND') {
    return reply.code(404).send(apiError(error.code, error.message));
  }
  if (
    error.code === 'SCHEDULE_HAS_ACTIVE_RUN'
    || error.code === 'SCHEDULE_THREAD_MISSING'
    || error.code === 'SCHEDULE_THREAD_ARCHIVED'
  ) {
    return reply.code(409).send(apiError(error.code, error.message));
  }
  if (error.code === 'CODEX_PROFILE_INVALID' || error.code === 'CODEX_CONFIG_INVALID') {
    return reply.code(422).send(apiError(error.code, error.message));
  }
  if (error.code === 'INTERNAL_ERROR') {
    return reply.code(500).send(apiError(error.code, 'Internal error'));
  }

  return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal error'));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
