import { describe, expect, it, vi } from 'vitest';
import {
  AgentScheduleToolError,
  createAgentScheduleHttpClient,
  createAgentScheduleToolDefinitions
} from '../../src/agent-tools/schedule-tools.js';

describe('agent schedule tools', () => {
  it('converts structured create timing and returns a compact schedule result', async () => {
    const request = vi.fn(async () => scheduleResponse());
    const tools = createAgentScheduleToolDefinitions({
      request,
      defaultTimezone: 'UTC'
    });

    const result = await tools.opencreator_schedule_create.execute({
      name: '每日总结',
      task: '总结今天的工作',
      timing: {
        type: 'daily',
        time: '18:00',
        weekdaysOnly: true
      },
      timezone: 'Asia/Shanghai',
      concurrencyPolicy: 'queue'
    });

    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/internal/agent-tools/schedules',
      body: {
        name: '每日总结',
        prompt: '总结今天的工作',
        cron: '0 18 * * 1-5',
        timezone: 'Asia/Shanghai',
        concurrencyPolicy: 'queue'
      }
    });
    expect(result).toEqual({
      scheduleId: 'schedule-1',
      threadId: 'thread-1',
      name: '每日总结',
      enabled: true,
      nextRunAt: '2026-07-15T10:00:00.000Z'
    });
  });

  it('supports current-thread update without accepting actor identity fields', async () => {
    const request = vi.fn(async () => scheduleResponse({
      cron: '0 20 * * *',
      nextRunAt: '2026-07-15T12:00:00.000Z'
    }));
    const tools = createAgentScheduleToolDefinitions({
      request,
      defaultTimezone: 'UTC'
    });

    await tools.opencreator_schedule_update.execute({
      task: '控制在 200 字以内',
      timing: { type: 'daily', time: '20:00' },
      timezone: 'Asia/Shanghai'
    });

    expect(request).toHaveBeenCalledWith({
      method: 'PATCH',
      path: '/internal/agent-tools/schedules/current',
      body: {
        prompt: '控制在 200 字以内',
        cron: '0 20 * * *',
        timezone: 'Asia/Shanghai'
      }
    });

    await expect(tools.opencreator_schedule_update.execute({
      scheduleId: 'schedule-1',
      threadId: 'thread-forged'
    })).rejects.toThrow('Unrecognized key');
    await expect(tools.opencreator_schedule_create.execute({
      name: '伪造任务',
      task: '内容',
      timing: { type: 'daily', time: '09:00' },
      runId: 'run-forged'
    })).rejects.toThrow('Unrecognized key');
  });

  it('registers strict schemas for all six tools', async () => {
    const tools = createAgentScheduleToolDefinitions({
      request: async () => scheduleResponse(),
      defaultTimezone: 'UTC'
    });

    expect(Object.keys(tools)).toEqual([
      'opencreator_schedule_create',
      'opencreator_schedule_update',
      'opencreator_schedule_pause',
      'opencreator_schedule_resume',
      'opencreator_schedule_run_now',
      'opencreator_schedule_get'
    ]);

    for (const tool of Object.values(tools)) {
      expect(tool.inputSchema.safeParse({ unknownField: true }).success).toBe(false);
    }
  });

  it('maps pause, resume, run-now and get to the internal capability api', async () => {
    const request = vi.fn(async ({ path }: { path: string }) => (
      path.endsWith('/run-now')
        ? {
            schedule: scheduleResponse(),
            run: { id: 'run-1', threadId: 'thread-1', status: 'queued' },
            skipped: false,
            queued: false
          }
        : scheduleResponse()
    ));
    const tools = createAgentScheduleToolDefinitions({
      request,
      defaultTimezone: 'UTC'
    });

    await tools.opencreator_schedule_pause.execute({ scheduleId: 'schedule-1' });
    await tools.opencreator_schedule_resume.execute({ scheduleId: 'schedule-1' });
    const runNow = await tools.opencreator_schedule_run_now.execute({ scheduleId: 'schedule-1' });
    await tools.opencreator_schedule_get.execute({});

    expect(request.mock.calls.map(([input]) => input)).toEqual([
      {
        method: 'POST',
        path: '/internal/agent-tools/schedules/schedule-1/pause'
      },
      {
        method: 'POST',
        path: '/internal/agent-tools/schedules/schedule-1/resume'
      },
      {
        method: 'POST',
        path: '/internal/agent-tools/schedules/schedule-1/run-now'
      },
      {
        method: 'GET',
        path: '/internal/agent-tools/schedules/current'
      }
    ]);
    expect(runNow).toMatchObject({
      scheduleId: 'schedule-1',
      threadId: 'thread-1',
      runId: 'run-1',
      runStatus: 'queued',
      skipped: false,
      queued: false
    });
  });

  it('returns schedule candidates as a structured tool result', async () => {
    const selection = {
      error: {
        code: 'SCHEDULE_SELECTION_REQUIRED',
        message: 'Multiple schedules are available'
      },
      candidates: [
        {
          scheduleId: 'schedule-1',
          threadId: 'thread-1',
          name: '每日总结',
          enabled: true,
          nextRunAt: '2026-07-15T10:00:00.000Z'
        },
        {
          scheduleId: 'schedule-2',
          threadId: 'thread-2',
          name: '每周复盘',
          enabled: false,
          nextRunAt: null
        }
      ]
    };
    const request = vi.fn(async () => selection);
    const tools = createAgentScheduleToolDefinitions({
      request,
      defaultTimezone: 'UTC'
    });

    await expect(tools.opencreator_schedule_update.execute({
      name: '需要先选择'
    })).resolves.toEqual({
      selectionRequired: true,
      code: 'SCHEDULE_SELECTION_REQUIRED',
      message: 'Multiple schedules are available',
      candidates: selection.candidates
    });
    await expect(tools.opencreator_schedule_run_now.execute({})).resolves.toEqual({
      selectionRequired: true,
      code: 'SCHEDULE_SELECTION_REQUIRED',
      message: 'Multiple schedules are available',
      candidates: selection.candidates
    });
  });

  it('preserves a valid schedule-selection response from the internal api', async () => {
    const selection = {
      error: {
        code: 'SCHEDULE_SELECTION_REQUIRED',
        message: 'Multiple schedules are available'
      },
      candidates: [{
        scheduleId: 'schedule-1',
        threadId: 'thread-1',
        name: '每日总结',
        enabled: true,
        nextRunAt: null
      }]
    };
    const client = createAgentScheduleHttpClient({
      baseUrl: 'http://127.0.0.1:3000',
      token: 'clwcap_test',
      fetch: vi.fn(async () => new Response(JSON.stringify(selection), {
        status: 409,
        headers: { 'content-type': 'application/json' }
      })) as typeof fetch
    });

    await expect(client.request({
      method: 'PATCH',
      path: '/internal/agent-tools/schedules/current',
      body: { name: '需要先选择' }
    })).resolves.toEqual(selection);
  });

  it('reports daemon unavailability, timeout and api failures without exposing the token', async () => {
    const token = 'clwcap_VerySecretCapabilityValue';
    const unavailable = createAgentScheduleHttpClient({
      baseUrl: 'http://127.0.0.1:1',
      token,
      fetch: vi.fn(async () => {
        throw new Error(`connect failed with ${token}`);
      }) as typeof fetch
    });
    await expect(unavailable.request({
      method: 'GET',
      path: '/internal/agent-tools/schedules/current'
    })).rejects.toThrow('OpenCreator daemon is unreachable');

    const timedOut = createAgentScheduleHttpClient({
      baseUrl: 'http://127.0.0.1:3000',
      token,
      timeoutMs: 5,
      fetch: vi.fn(() => new Promise(() => undefined)) as typeof fetch
    });
    await expect(timedOut.request({
      method: 'GET',
      path: '/internal/agent-tools/schedules/current'
    })).rejects.toThrow('timed out');

    const bodyTimedOut = createAgentScheduleHttpClient({
      baseUrl: 'http://127.0.0.1:3000',
      token,
      timeoutMs: 5,
      fetch: vi.fn(async (_url, init) => ({
        ok: true,
        status: 200,
        text: () => new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('response body aborted'));
          });
        })
      }) as Response) as typeof fetch
    });
    await expect(bodyTimedOut.request({
      method: 'GET',
      path: '/internal/agent-tools/schedules/current'
    })).rejects.toThrow('timed out');

    const rejected = createAgentScheduleHttpClient({
      baseUrl: 'http://127.0.0.1:3000',
      token,
      fetch: vi.fn(async () => new Response(JSON.stringify({
        error: {
          code: 'CAPABILITY_SCOPE_FORBIDDEN',
          message: 'Capability does not allow this operation'
        }
      }), {
        status: 403,
        headers: { 'content-type': 'application/json' }
      })) as typeof fetch
    });
    await expect(rejected.request({
      method: 'POST',
      path: '/internal/agent-tools/schedules/current/pause'
    })).rejects.toThrow('CAPABILITY_SCOPE_FORBIDDEN');

    for (const client of [unavailable, timedOut, bodyTimedOut, rejected]) {
      try {
        await client.request({
          method: 'GET',
          path: '/internal/agent-tools/schedules/current'
        });
      } catch (error) {
        expect(error).toBeInstanceOf(AgentScheduleToolError);
        expect(String(error)).not.toContain(token);
      }
    }
  });
});

function scheduleResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    threadId: 'thread-1',
    name: '每日总结',
    cron: '0 18 * * 1-5',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结今天的工作',
    profile: 'default',
    cwd: '/workspace/current',
    canonicalCwd: '/workspace/current',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'queue',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-15T10:00:00.000Z',
    lastRunAt: null,
    lastRunId: null,
    lastStatus: null,
    pendingTrigger: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    ...overrides
  };
}
