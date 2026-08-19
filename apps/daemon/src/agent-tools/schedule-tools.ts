import { z } from 'zod';
import {
  convertAgentScheduleTiming,
  type AgentScheduleTiming
} from './schedule-timing.js';

export const AGENT_SCHEDULE_TOOL_NAMES = [
  'opencreator_schedule_create',
  'opencreator_schedule_update',
  'opencreator_schedule_pause',
  'opencreator_schedule_resume',
  'opencreator_schedule_run_now',
  'opencreator_schedule_get'
] as const;

export type AgentScheduleToolName = typeof AGENT_SCHEDULE_TOOL_NAMES[number];

export type AgentScheduleApiRequest = {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
};

export type AgentScheduleApiClient = {
  request(input: AgentScheduleApiRequest): Promise<unknown>;
};

export class AgentScheduleToolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgentScheduleToolError';
    this.code = code;
  }
}

type AgentScheduleToolDefinition = {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute(input: unknown): Promise<Record<string, unknown>>;
};

export type AgentScheduleToolDefinitions = Record<
  AgentScheduleToolName,
  AgentScheduleToolDefinition
>;

const timingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('interval'),
    everyMinutes: z.number().int().min(1).max(60),
    startTime: z.string().optional(),
    endTime: z.string().optional()
  }).strict(),
  z.object({
    type: z.literal('daily'),
    time: z.string(),
    weekdaysOnly: z.boolean().optional()
  }).strict(),
  z.object({
    type: z.literal('weekly'),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1),
    time: z.string()
  }).strict(),
  z.object({
    type: z.literal('cron'),
    expression: z.string().min(1)
  }).strict()
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  task: z.string().min(1),
  timing: timingSchema,
  timezone: z.string().optional(),
  enabled: z.boolean().optional(),
  concurrencyPolicy: z.enum(['queue', 'skip']).optional()
}).strict();

const updateSchema = z.object({
  scheduleId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  task: z.string().min(1).optional(),
  timing: timingSchema.optional(),
  timezone: z.string().optional(),
  enabled: z.boolean().optional()
}).strict().refine(
  value => Object.keys(value).some(key => key !== 'scheduleId'),
  { message: 'at least one schedule field must be updated' }
);

const scheduleReferenceSchema = z.object({
  scheduleId: z.string().min(1).optional()
}).strict();

export function createAgentScheduleToolDefinitions(input: {
  request: AgentScheduleApiClient['request'];
  defaultTimezone?: string;
}): AgentScheduleToolDefinitions {
  const request = input.request;
  return {
    opencreator_schedule_create: {
      description: '创建一个 OpenCreator 定时任务。时间必须使用结构化 timing，不要要求用户填写 cron。',
      inputSchema: createSchema,
      async execute(value) {
        const parsed = createSchema.parse(value);
        const timing = convertTiming(parsed.timing, parsed.timezone, input.defaultTimezone);
        const response = await request({
          method: 'POST',
          path: '/internal/agent-tools/schedules',
          body: compactObject({
            name: parsed.name,
            prompt: parsed.task,
            cron: timing.cron,
            timezone: timing.timezone,
            enabled: parsed.enabled,
            concurrencyPolicy: parsed.concurrencyPolicy
          })
        });
        return scheduleSummary(response);
      }
    },
    opencreator_schedule_update: {
      description: '更新当前任务会话绑定的定时任务，或更新明确指定的 scheduleId。',
      inputSchema: updateSchema,
      async execute(value) {
        const parsed = updateSchema.parse(value);
        const timing = parsed.timing === undefined
          ? undefined
          : convertTiming(parsed.timing, parsed.timezone, input.defaultTimezone);
        const response = await request({
          method: 'PATCH',
          path: schedulePath(parsed.scheduleId),
          body: compactObject({
            name: parsed.name,
            prompt: parsed.task,
            cron: timing?.cron,
            timezone: timing?.timezone ?? parsed.timezone,
            enabled: parsed.enabled
          })
        });
        return scheduleSummary(response);
      }
    },
    opencreator_schedule_pause: {
      description: '暂停当前任务会话绑定的定时任务，或暂停明确指定的 scheduleId。',
      inputSchema: scheduleReferenceSchema,
      async execute(value) {
        const parsed = scheduleReferenceSchema.parse(value);
        return scheduleSummary(await request({
          method: 'POST',
          path: `${schedulePath(parsed.scheduleId)}/pause`
        }));
      }
    },
    opencreator_schedule_resume: {
      description: '恢复当前任务会话绑定的定时任务，或恢复明确指定的 scheduleId。',
      inputSchema: scheduleReferenceSchema,
      async execute(value) {
        const parsed = scheduleReferenceSchema.parse(value);
        return scheduleSummary(await request({
          method: 'POST',
          path: `${schedulePath(parsed.scheduleId)}/resume`
        }));
      }
    },
    opencreator_schedule_run_now: {
      description: '立即触发当前任务会话绑定的定时任务，或触发明确指定的 scheduleId。',
      inputSchema: scheduleReferenceSchema,
      async execute(value) {
        const parsed = scheduleReferenceSchema.parse(value);
        return runNowSummary(await request({
          method: 'POST',
          path: `${schedulePath(parsed.scheduleId)}/run-now`
        }));
      }
    },
    opencreator_schedule_get: {
      description: '读取当前任务会话绑定的定时任务，或读取明确指定的 scheduleId。',
      inputSchema: scheduleReferenceSchema,
      async execute(value) {
        const parsed = scheduleReferenceSchema.parse(value);
        return scheduleSummary(await request({
          method: 'GET',
          path: schedulePath(parsed.scheduleId)
        }));
      }
    }
  };
}

export function createAgentScheduleHttpClient(input: {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): AgentScheduleApiClient {
  const fetchImplementation = input.fetch ?? fetch;
  const timeoutMs = input.timeoutMs ?? 30_000;
  const baseUrl = input.baseUrl.replace(/\/+$/, '');

  return {
    async request(request) {
      const controller = new AbortController();
      let timeout: NodeJS.Timeout | undefined;
      try {
        const requestWork = (async () => {
          const response = await fetchImplementation(`${baseUrl}${request.path}`, {
            method: request.method,
            headers: {
              authorization: `Bearer ${input.token}`,
              ...(request.body === undefined
                ? {}
                : { 'content-type': 'application/json' })
            },
            body: request.body === undefined
              ? undefined
              : JSON.stringify(request.body),
            signal: controller.signal
          });
          const body = await readJsonResponse(response);
          if (!response.ok) {
            if (
              response.status === 409
              && scheduleSelectionSummary(body) !== undefined
            ) {
              return body;
            }
            const apiError = extractApiError(body);
            throw new AgentScheduleToolError(
              apiError?.code ?? 'AGENT_TOOL_REQUEST_FAILED',
              apiError === undefined
                ? `OpenCreator schedule tool request failed with status ${response.status}`
                : `${apiError.code}: ${apiError.message}`
            );
          }
          return body;
        })();
        return await Promise.race([
          requestWork,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(new AgentScheduleToolError(
                'AGENT_TOOL_TIMEOUT',
                `OpenCreator schedule tool timed out after ${timeoutMs}ms`
              ));
              controller.abort();
            }, timeoutMs);
          })
        ]);
      } catch (error) {
        if (error instanceof AgentScheduleToolError) throw error;
        throw new AgentScheduleToolError(
          'AGENT_TOOL_DAEMON_UNREACHABLE',
          'OpenCreator daemon is unreachable'
        );
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
    }
  };
}

function convertTiming(
  timing: z.infer<typeof timingSchema>,
  timezone: string | undefined,
  defaultTimezone: string | undefined
) {
  return convertAgentScheduleTiming({
    timing: timing as AgentScheduleTiming,
    timezone,
    defaultTimezone
  });
}

function schedulePath(scheduleId: string | undefined): string {
  return `/internal/agent-tools/schedules/${
    scheduleId === undefined ? 'current' : encodeURIComponent(scheduleId)
  }`;
}

function compactObject(
  value: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function scheduleSummary(value: unknown): Record<string, unknown> {
  const selection = scheduleSelectionSummary(value);
  if (selection !== undefined) return selection;
  const schedule = requireRecord(value, 'schedule response');
  return {
    scheduleId: requireString(schedule, 'id'),
    threadId: requireString(schedule, 'threadId'),
    name: requireString(schedule, 'name'),
    enabled: schedule.enabled === true,
    nextRunAt: optionalString(schedule.nextRunAt)
  };
}

function runNowSummary(value: unknown): Record<string, unknown> {
  const selection = scheduleSelectionSummary(value);
  if (selection !== undefined) return selection;
  const response = requireRecord(value, 'run-now response');
  const schedule = scheduleSummary(response.schedule);
  const run = isRecord(response.run) ? response.run : undefined;
  return {
    ...schedule,
    runId: run === undefined ? null : requireString(run, 'id'),
    runStatus: run === undefined ? null : requireString(run, 'status'),
    skipped: response.skipped === true,
    queued: response.queued === true
  };
}

function scheduleSelectionSummary(
  value: unknown
): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  if (
    value.error.code !== 'SCHEDULE_SELECTION_REQUIRED'
    || typeof value.error.message !== 'string'
    || !Array.isArray(value.candidates)
    || value.candidates.length === 0
  ) {
    return undefined;
  }

  const candidates = [];
  for (const candidate of value.candidates) {
    if (
      !isRecord(candidate)
      || typeof candidate.scheduleId !== 'string'
      || typeof candidate.threadId !== 'string'
      || typeof candidate.name !== 'string'
      || typeof candidate.enabled !== 'boolean'
      || (
        candidate.nextRunAt !== null
        && candidate.nextRunAt !== undefined
        && typeof candidate.nextRunAt !== 'string'
      )
    ) {
      return undefined;
    }
    candidates.push({
      scheduleId: candidate.scheduleId,
      threadId: candidate.threadId,
      name: candidate.name,
      enabled: candidate.enabled,
      nextRunAt: candidate.nextRunAt ?? null
    });
  }

  return {
    selectionRequired: true,
    code: 'SCHEDULE_SELECTION_REQUIRED',
    message: value.error.message,
    candidates
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AgentScheduleToolError(
      'AGENT_TOOL_INVALID_RESPONSE',
      'OpenCreator daemon returned an invalid response'
    );
  }
}

function extractApiError(
  value: unknown
): { code: string; message: string } | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  const code = value.error.code;
  const message = value.error.message;
  return typeof code === 'string' && typeof message === 'string'
    ? { code, message }
    : undefined;
}

function requireRecord(
  value: unknown,
  name: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AgentScheduleToolError(
      'AGENT_TOOL_INVALID_RESPONSE',
      `OpenCreator daemon returned an invalid ${name}`
    );
  }
  return value;
}

function requireString(
  value: Record<string, unknown>,
  field: string
): string {
  const result = value[field];
  if (typeof result !== 'string') {
    throw new AgentScheduleToolError(
      'AGENT_TOOL_INVALID_RESPONSE',
      `OpenCreator daemon response is missing ${field}`
    );
  }
  return result;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
