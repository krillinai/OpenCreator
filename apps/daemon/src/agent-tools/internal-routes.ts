import type {
  CreateScheduleRequest,
  RunScheduleNowResponse,
  ScheduleDetailResponse,
  ScheduleResponse,
  UpdateScheduleRequest
} from '@clawee/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ScheduleCoordinator } from '../scheduler/coordinator.js';
import { SchedulerError, type SchedulerService } from '../scheduler/service.js';
import { apiError } from '../api/errors.js';
import {
  AgentCapabilityTokenError,
  type AgentCapabilityGrant,
  type AgentCapabilityScope,
  type AgentCapabilityTokenStore
} from './capability-token.js';

export const AGENT_TOOL_ROUTE_PREFIX = '/internal/agent-tools';

export type AgentScheduleActor = Pick<
  AgentCapabilityGrant,
  'runId' | 'threadId' | 'createdBy'
>;

type MaybePromise<T> = T | Promise<T>;

export type AgentScheduleOperations = {
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
}): AgentScheduleOperations {
  return {
    getSchedule(id) {
      return input.scheduler.getSchedule(id);
    },
    createSchedule() {
      throw new AgentScheduleOperationUnavailableError();
    },
    updateSchedule(id, update) {
      return input.coordinator.update(id, update as UpdateScheduleRequest);
    },
    pauseSchedule(id) {
      return input.coordinator.update(id, { enabled: false });
    },
    resumeSchedule(id) {
      return input.coordinator.update(id, { enabled: true });
    },
    runScheduleNow(id) {
      return input.scheduler.runNow(id);
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
        const schedule = await requireBoundSchedule(
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
        const existing = await requireBoundSchedule(
          request.params.id,
          actor,
          input.schedules,
          reply
        );
        if (existing === undefined) return;
        return await input.schedules.updateSchedule(request.params.id, body, actor);
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
        const existing = await requireBoundSchedule(
          request.params.id,
          actor,
          input.schedules,
          reply
        );
        if (existing === undefined) return;
        return reply.code(successStatus).send(await operation(request.params.id, actor));
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
    return capabilities.authorize(readBearerToken(request.headers.authorization), { scope });
  } catch (error) {
    if (!(error instanceof AgentCapabilityTokenError)) throw error;
    reply.code(error.statusCode).send(
      internalApiError(error.code, capabilityErrorMessage(error.code))
    );
    return undefined;
  }
}

async function requireBoundSchedule(
  id: string,
  actor: AgentScheduleActor,
  schedules: AgentScheduleOperations,
  reply: FastifyReply
): Promise<ScheduleDetailResponse | undefined> {
  const schedule = await schedules.getSchedule(id, actor);
  if (schedule === undefined) {
    reply.code(404).send(apiError('SCHEDULE_NOT_FOUND', 'Schedule not found'));
    return undefined;
  }
  if (schedule.threadId !== actor.threadId) {
    reply.code(403).send(internalApiError(
      'CAPABILITY_THREAD_FORBIDDEN',
      'Capability does not allow access to this schedule'
    ));
    return undefined;
  }
  return schedule;
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
  if (error instanceof AgentScheduleOperationUnavailableError) {
    return reply.code(501).send(internalApiError(error.code, error.message));
  }
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

class AgentScheduleOperationUnavailableError extends Error {
  readonly code = 'AGENT_SCHEDULE_CREATE_NOT_READY';

  constructor() {
    super('Agent schedule creation is not available yet');
    this.name = 'AgentScheduleOperationUnavailableError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function internalApiError(code: string, message: string) {
  return { error: { code, message } };
}
