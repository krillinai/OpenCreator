import { describe, expect, it, vi } from 'vitest';
import type { ScheduleResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';
import { createScheduleService } from './schedule-service.js';

describe('ScheduleService', () => {
  it('maps schedule CRUD and detail requests to runtime endpoints', async () => {
    const schedule = createScheduleResponse();
    const get = vi.fn(async (_path: string) => ({ schedules: [] }));
    const post = vi.fn(async (_path: string, _body?: unknown) => schedule);
    const patch = vi.fn(async (_path: string, _body: unknown) => schedule);
    const remove = vi.fn(async (_path: string) => ({ deleted: true }));
    const service = createScheduleService(createClient({ get, post, patch, remove }));

    await service.listSchedules();
    await service.getSchedule('schedule/中文');
    const created = await service.createSchedule({
      name: '每日总结',
      cron: '0 18 * * *',
      prompt: '总结今天的工作'
    });
    await service.updateSchedule('schedule/中文', { enabled: false });
    await service.deleteSchedule('schedule/中文');

    expect(get).toHaveBeenNthCalledWith(1, '/schedules');
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/schedules/schedule%2F%E4%B8%AD%E6%96%87'
    );
    expect(post).toHaveBeenCalledWith('/schedules', {
      name: '每日总结',
      cron: '0 18 * * *',
      prompt: '总结今天的工作'
    });
    expect(created.threadId).toBe('thread-schedule-1');
    expect(patch).toHaveBeenCalledWith(
      '/schedules/schedule%2F%E4%B8%AD%E6%96%87',
      { enabled: false }
    );
    expect(remove).toHaveBeenCalledWith(
      '/schedules/schedule%2F%E4%B8%AD%E6%96%87'
    );
  });

  it('runs a schedule and loads bounded operation history', async () => {
    const get = vi.fn(async (_path: string) => ({ operations: [] }));
    const post = vi.fn(async (_path: string) => ({
      run: null,
      schedule: { id: 'schedule-1' },
      skipped: true,
      queued: false
    }));
    const service = createScheduleService(createClient({
      get,
      post,
      patch: vi.fn(),
      remove: vi.fn()
    }));

    await service.runNow('schedule/中文');
    await service.listOperations('schedule/中文', 25);

    expect(post).toHaveBeenCalledWith(
      '/schedules/schedule%2F%E4%B8%AD%E6%96%87/run-now'
    );
    expect(get).toHaveBeenCalledWith(
      '/schedules/schedule%2F%E4%B8%AD%E6%96%87/operations?limit=25'
    );
  });
});

function createScheduleResponse(): ScheduleResponse {
  return {
    id: 'schedule-1',
    threadId: 'thread-schedule-1',
    name: '每日总结',
    cron: '0 18 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    promptPreviewRedacted: '总结今天的工作',
    profile: 'default',
    cwd: '/workspace/project',
    canonicalCwd: '/workspace/project',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'queue',
    misfirePolicy: 'skip',
    nextRunAt: null,
    lastRunAt: null,
    lastRunId: null,
    lastStatus: null,
    pendingTrigger: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z'
  };
}

function createClient(input: {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  patch: (path: string, body: unknown) => Promise<unknown>;
  remove: (path: string) => Promise<unknown>;
}): RuntimeClient {
  return {
    get<T>(path: string): Promise<T> {
      return input.get(path) as Promise<T>;
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return (
        body === undefined
          ? input.post(path)
          : input.post(path, body)
      ) as Promise<T>;
    },
    patch<T>(path: string, body: unknown): Promise<T> {
      return input.patch(path, body) as Promise<T>;
    },
    delete<T>(path: string): Promise<T> {
      return input.remove(path) as Promise<T>;
    }
  } as RuntimeClient;
}
