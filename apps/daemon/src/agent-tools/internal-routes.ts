import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  ScheduleAgentActor,
  ScheduleCoordinator
} from '../scheduler/coordinator.js';
import { SchedulerError, type SchedulerService } from '../scheduler/service.js';
import { scheduleOperationActors } from '../scheduler/types.js';
import type { RuntimeThread, ThreadManager } from '../threads/types.js';
import { apiError } from '../api/errors.js';
import {
  AgentCapabilityTokenError,
  type AgentCapabilityGrant,
  type AgentCapabilityScope,
  type AgentCapabilityTokenStore
} from './capability-token.js';

export const AGENT_TOOL_ROUTE_PREFIX = '/internal/agent-tools';

export type AgentScheduleActor = ScheduleAgentActor;

type MaybePromise<T> = T | Promise<T>;

export type AgentScheduleOperations = {
  getActorThread(actor: AgentScheduleActor): MaybePromise<RuntimeThread | undefined>;
  listSchedules(actor: AgentScheduleActor): MaybePromise<ScheduleResponse[]>;
  getSchedule(
    id: string,
    actor: AgentScheduleActor
  ): MaybePromise<ScheduleDetailResponse | undefined>;
  createSchedule(
    input: CreateScheduleRequest | Record<string, unknown>,
    actor: AgentScheduleActor
  ): MaybePromise<ScheduleResponse>;
  updateSchedule(
    id: string,
    input: UpdateScheduleRequest | Record<string, unknown>,
    actor: AgentScheduleActor
  ): MaybePromise<ScheduleResponse>;
  pauseSchedule(id: string, actor: AgentScheduleActor): MaybePromise<ScheduleResponse>;
  resumeSchedule(id: string, actor: AgentScheduleActor): MaybePromise<ScheduleResponse>;
  runScheduleNow(
    id: string,
    actor: AgentScheduleActor
  ): MaybePromise<RunScheduleNowResponse>;
};

export function isAgentToolInternalRequest(url: string): boolean {
  const path = url.split('?', 1)[0] ?? url;
  return path === AGENT_TOOL_ROUTE_PREFIX
    || path.startsWith(`${AGENT_TOOL_ROUTE_PREFIX}/`);
}

export function createDefaultAgentScheduleOperations(input: {
  coordinator: ScheduleCoordinator;
  scheduler: SchedulerService;
  threadManager: Pick<ThreadManager, 'getThread'>;
}): AgentScheduleOperations {
  return {
    getActorThread(actor) {
      return input.threadManager.getThread(actor.threadId);
    },
    listSchedules() {
      return input.scheduler.listSchedules().schedules;
    },
    getSchedule(id) {
      return input.scheduler.getSchedule(id);
    },
    createSchedule(create, actor) {
      return input.coordinator.createFromAgent(create, actor);
    },
    updateSchedule(id, update, actor) {
      return input.coordinator.updateFromAgent(
        id,
        update as UpdateScheduleRequest,
        actor
      );
    },
    pauseSchedule(id, actor) {
      return input.coordinator.updateFromAgent(id, { enabled: false }, actor);
    },
    resumeSchedule(id, actor) {
      return input.coordinator.updateFromAgent(id, { enabled: true }, actor);
    },
    runScheduleNow(id, actor) {
      return input.scheduler.runNow(
        id,
        scheduleOperationActors.agent(actor.runId)
      );
    }
  };
}

export async function registerAgentToolRoutes(
  server: FastifyInstance,
  input: {
    capabilities: AgentCapabilityTokenStore;
    schedules: AgentScheduleOperations;
  }
): Promise<void> {
  server.get<{ Params: { id: string } }>(
    `${AGENT_TOOL_ROUTE_PREFIX}/schedules/:id`,
    async (request, reply) => {
      const grant = authorizeRequest(request, reply, input.capabilities, 'schedule:get');
      if (grant === undefined) return;
      const actor = toActor(grant);
      try {
        const schedule = await resolveAccessibleSchedule(
          request.params.id,
          actor,
          input.schedules,
          reply
        );
        if (schedule === undefined) return;
        return schedule;
      } catch (error) {
        return sendAgentScheduleError(error, reply);
      }
    }
  );

  server.post<{ Body: unknown }>(
    `${AGENT_TOOL_ROUTE_PREFIX}/schedules`,
    async (request, reply) => {
      const grant = authorizeRequest(request, reply, input.capabilities, 'schedule:create');
      if (grant === undefined) return;
      const body = parseBody(request.body, reply);
      if (body === undefined) return;
      try {
        const schedule = await input.schedules.createSchedule(body, toActor(grant));
        return reply.code(201).send(schedule);
      } catch (error) {
        return sendAgentScheduleError(error, reply);
      }
    }
  );

  server.patch<{ Params: { id: string }; Body: unknown }>(
    `${AGENT_TOOL_ROUTE_PREFIX}/schedules/:id`,
    async (request, reply) => {
      const grant = authorizeRequest(request, reply, input.capabilities, 'schedule:update');
      if (grant === undefined) return;
      const body = parseBody(request.body, reply);
      if (body === undefined) return;
      const actor = toActor(grant);
      try {
        const existing = await resolveAccessibleSchedule(
          request.params.id,
          actor,
          input.schedules,
          reply
        );
        if (existing === undefined) return;
        return await input.schedules.updateSchedule(existing.id, body, actor);
      } catch (error) {
        return sendAgentScheduleError(error, reply);
      }
    }
  );

  await registerBoundActionRoute(
    server,
    input,
    'pause',
    'schedule:pause',
    async (id, actor) => input.schedules.pauseSchedule(id, actor)
  );
  await registerBoundActionRoute(
    server,
    input,
    'resume',
    'schedule:resume',
    async (id, actor) => input.schedules.resumeSchedule(id, actor)
  );
  await registerBoundActionRoute(
    server,
    input,
    'run-now',
    'schedule:run_now',
    async (id, actor) => input.schedules.runScheduleNow(id, actor),
    202
  );
}

async function registerBoundActionRoute(
  server: FastifyInstance,
  input: {
    capabilities: AgentCapabilityTokenStore;
    schedules: AgentScheduleOperations;
  },
  action: string,
  scope: AgentCapabilityScope,
  operation: (
    id: string,
    actor: AgentScheduleActor
  ) => Promise<ScheduleResponse | RunScheduleNowResponse>,
  successStatus = 200
): Promise<void> {
  server.post<{ Params: { id: string }; Body: unknown }>(
    `${AGENT_TOOL_ROUTE_PREFIX}/schedules/:id/${action}`,
    async (request, reply) => {
      const grant = authorizeRequest(request, reply, input.capabilities, scope);
      if (grant === undefined) return;
      if (hasActorOverride(request.body)) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'runId and threadId are not accepted')
        );
      }
      const actor = toActor(grant);
      try {
        const existing = await resolveAccessibleSchedule(
          request.params.id,
          actor,
          input.schedules,
          reply
        );
        if (existing === undefined) return;
        return reply.code(successStatus).send(await operation(existing.id, actor));
      } catch (error) {
        return sendAgentScheduleError(error, reply);
      }
    }
  );
}

function authorizeRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  capabilities: AgentCapabilityTokenStore,
  scope: AgentCapabilityScope
): AgentCapabilityGrant | undefined {
  try {
    const grant = capabilities.authorize(
      readBearerToken(request.headers.authorization),
      { scope }
    );
    if (grant.createdBy === 'schedule' && scope !== 'schedule:get') {
      reply.code(403).send(internalApiError(
        'CAPABILITY_SCOPE_FORBIDDEN',
        'Automatic schedule runs cannot mutate schedules'
      ));
      return undefined;
    }
    return grant;
  } catch (error) {
    if (!(error instanceof AgentCapabilityTokenError)) throw error;
    reply.code(error.statusCode).send(
      internalApiError(error.code, capabilityErrorMessage(error.code))
    );
    return undefined;
  }
}

async function resolveAccessibleSchedule(
  id: string,
  actor: AgentScheduleActor,
  schedules: AgentScheduleOperations,
  reply: FastifyReply
): Promise<ScheduleDetailResponse | undefined> {
  const actorThread = await schedules.getActorThread(actor);
  if (actorThread === undefined || actorThread.status !== 'active') {
    reply.code(403).send(internalApiError(
      'CAPABILITY_THREAD_FORBIDDEN',
      'Capability thread is unavailable'
    ));
    return undefined;
  }

  let resolvedId = id;
  if (id === 'current') {
    if (actorThread.purpose === 'schedule_task') {
      if (actorThread.scheduleId === undefined) {
        reply.code(409).send(apiError(
          'SCHEDULE_THREAD_MISSING',
          'Current task thread is not bound to a schedule'
        ));
        return undefined;
      }
      resolvedId = actorThread.scheduleId;
    } else {
      const candidates = (await schedules.listSchedules(actor))
        .filter(schedule => schedule.canonicalCwd === actorThread.canonicalCwd);
      if (candidates.length === 0) {
        reply.code(404).send(apiError('SCHEDULE_NOT_FOUND', 'Schedule not found'));
        return undefined;
      }
      if (candidates.length > 1) {
        reply.code(409).send({
          ...internalApiError(
            'SCHEDULE_SELECTION_REQUIRED',
            'Multiple schedules are available'
          ),
          candidates: candidates.map(toScheduleCandidate)
        });
        return undefined;
      }
      resolvedId = candidates[0]!.id;
    }
  }

  const schedule = await schedules.getSchedule(resolvedId, actor);
  if (schedule === undefined) {
    reply.code(404).send(apiError('SCHEDULE_NOT_FOUND', 'Schedule not found'));
    return undefined;
  }
  const allowed = actorThread.purpose === 'schedule_task'
    ? schedule.threadId === actorThread.id
    : schedule.canonicalCwd === actorThread.canonicalCwd;
  if (!allowed) {
    reply.code(403).send(internalApiError(
      'CAPABILITY_THREAD_FORBIDDEN',
      'Capability does not allow access to this schedule'
    ));
    return undefined;
  }
  return schedule;
}

function toScheduleCandidate(schedule: ScheduleResponse) {
  return {
    scheduleId: schedule.id,
    threadId: schedule.threadId,
    name: schedule.name,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt ?? null
  };
}

function parseBody(
  body: unknown,
  reply: FastifyReply
): Record<string, unknown> | undefined {
  if (!isPlainObject(body)) {
    reply.code(400).send(apiError('VALIDATION_FAILED', 'body must be an object'));
    return undefined;
  }
  if (hasActorOverride(body)) {
    reply.code(400).send(
      apiError('VALIDATION_FAILED', 'runId and threadId are not accepted')
    );
    return undefined;
  }
  return body;
}

function hasActorOverride(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasActorOverride);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, entry]) => {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    if (
      normalized === 'runid'
      || normalized === 'threadid'
      || normalized === 'actorrunid'
      || normalized === 'actorthreadid'
    ) {
      return true;
    }
    return hasActorOverride(entry);
  });
}

function readBearerToken(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length);
  return token.length === 0 || /\s/.test(token) ? undefined : token;
}

function toActor(grant: AgentCapabilityGrant): AgentScheduleActor {
  return {
    runId: grant.runId,
    threadId: grant.threadId,
    createdBy: grant.createdBy
  };
}

function capabilityErrorMessage(code: AgentCapabilityTokenError['code']): string {
  if (code === 'CAPABILITY_TOKEN_MISSING') return 'Capability token required';
  if (
    code === 'CAPABILITY_TOKEN_INVALID'
    || code === 'CAPABILITY_TOKEN_EXPIRED'
    || code === 'CAPABILITY_TOKEN_REVOKED'
  ) {
    return 'Capability token is invalid';
  }
  return 'Capability does not allow this operation';
}

function sendAgentScheduleError(error: unknown, reply: FastifyReply) {
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
  return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal error'));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function internalApiError(code: string, message: string) {
  return { error: { code, message } };
}
