import type { AgentEventEnvelope, RunResponse } from '@clawee/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  createScheduleAssistant,
  parseScheduleAssistantResponse,
} from './schedule-assistant.js';

describe('schedule assistant', () => {
  it('parses a fenced Clawee response into an editable schedule draft', () => {
    expect(parseScheduleAssistantResponse(`
\`\`\`json
{
  "name": "每日简报",
  "prompt": "总结项目进展和今天的优先事项",
  "repeat": "weekdays",
  "time": "08:00",
  "days": []
}
\`\`\`
    `)).toEqual({
      name: '每日简报',
      prompt: '总结项目进展和今天的优先事项',
      frequency: {
        repeat: 'weekdays',
        time: '08:00',
        days: [],
      },
    });
  });

  it('runs a real standalone Codex task and returns the generated draft', async () => {
    const startStandaloneRun = vi.fn(async (): Promise<RunResponse> => ({
      id: 'run-assistant',
      status: 'running',
      submissionMode: 'enqueue',
      queuePosition: 0,
      attachments: [],
    }));
    const cancelRun = vi.fn();
    const subscribe = vi.fn(async (input: {
      onEvent(event: AgentEventEnvelope): void;
    }) => {
      input.onEvent(event('assistant_message', {
        type: 'assistant_message',
        text: '{"name":"每周回顾","prompt":"整理本周进展","repeat":"weekly","time":"16:00","days":[5]}',
        format: 'plain_text',
        delivery: 'message',
      }));
      input.onEvent(event('done', {
        type: 'done',
        status: 'succeeded',
        terminationReason: 'completed',
      }));
    });
    const assistant = createScheduleAssistant({
      runService: { startStandaloneRun, cancelRun },
      subscribeRunEvents: subscribe,
      connection: {
        baseUrl: 'http://127.0.0.1:1234',
        token: 'token',
      },
      fetchImpl: vi.fn(),
    });

    const draft = await assistant.generate({
      description: '每周五下午四点整理本周工作',
      cwd: '/workspace/current',
      profile: 'default',
      timezone: 'Asia/Shanghai',
    });

    expect(startStandaloneRun).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace/current',
      profile: 'default',
    }));
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-assistant',
      baseUrl: 'http://127.0.0.1:1234',
      token: 'token',
    }));
    expect(draft.frequency).toEqual({
      repeat: 'weekly',
      time: '16:00',
      days: [5],
    });
  });

  it('cancels a generation that exceeds the assistant timeout', async () => {
    const cancelRun = vi.fn(async () => ({ id: 'run-timeout', canceled: true }));
    const assistant = createScheduleAssistant({
      runService: {
        startStandaloneRun: vi.fn(async (): Promise<RunResponse> => ({
          id: 'run-timeout',
          status: 'running',
          submissionMode: 'enqueue',
          queuePosition: 0,
          attachments: [],
        })),
        cancelRun,
      },
      subscribeRunEvents: vi.fn(async input => {
        await new Promise<void>(resolve => {
          input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
      connection: {
        baseUrl: 'http://127.0.0.1:1234',
        token: 'token',
      },
      timeoutMs: 10,
    });

    await expect(assistant.generate({
      description: '每天生成简报',
      cwd: '/workspace/current',
      profile: 'default',
      timezone: 'Asia/Shanghai',
    })).rejects.toThrow('Clawee 生成计划超时，请重试');
    expect(cancelRun).toHaveBeenCalledWith('run-timeout');
  });

  it('turns a Codex spawn failure into a user-facing message', async () => {
    const assistant = createScheduleAssistant({
      runService: {
        startStandaloneRun: vi.fn(async (): Promise<RunResponse> => ({
          id: 'run-spawn-failed',
          status: 'running',
          submissionMode: 'enqueue',
          queuePosition: 0,
          attachments: [],
        })),
        cancelRun: vi.fn(),
      },
      subscribeRunEvents: vi.fn(async input => {
        input.onEvent(event('error', {
          type: 'error',
          code: 'CODEX_STREAM_ERROR',
          message: 'spawn codex ENOENT',
        }));
        input.onEvent(event('done', {
          type: 'done',
          status: 'failed',
          terminationReason: 'stream_error',
        }));
      }),
      connection: {
        baseUrl: 'http://127.0.0.1:1234',
        token: 'token',
      },
    });

    await expect(assistant.generate({
      description: '每天生成简报',
      cwd: '/workspace/current',
      profile: 'default',
      timezone: 'Asia/Shanghai',
    })).rejects.toThrow('Clawee 无法启动，请检查所选项目目录是否存在，或重启服务后重试');
  });
});

function event<Type extends AgentEventEnvelope['type']>(
  type: Type,
  payload: Extract<AgentEventEnvelope, { type: Type }>['payload']
): Extract<AgentEventEnvelope, { type: Type }> {
  return {
    id: `event-${type}`,
    runId: 'run-assistant',
    seq: type === 'done' ? 2 : 1,
    ts: '2026-07-13T00:00:00.000Z',
    type,
    payload,
    normalizerVersion: 1,
  } as Extract<AgentEventEnvelope, { type: Type }>;
}
