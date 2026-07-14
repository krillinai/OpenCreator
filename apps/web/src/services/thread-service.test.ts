import { describe, expect, it, vi } from 'vitest';
import type { ThreadResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';
import { createThreadService } from './thread-service.js';

describe('ThreadService', () => {
  it('loads active thread purpose and schedule binding fields', async () => {
    const get = vi.fn(async (_path: string) => ({
      threads: [createThreadResponse()]
    }));
    const service = createThreadService(createClient(get));

    const response = await service.listActiveThreads();

    expect(get).toHaveBeenCalledWith('/threads?status=active&limit=50');
    expect(response.threads[0]).toMatchObject({
      id: 'thread-task',
      purpose: 'schedule_task',
      scheduleId: 'schedule-1'
    });
  });

  it('keeps the legacy full-history request when pagination is omitted', async () => {
    const get = vi.fn(async (_path: string) => ({ threadId: 'thread_1', items: [] }));
    const service = createThreadService(createClient(get));

    await service.getThreadHistory('thread/中文');

    expect(get).toHaveBeenCalledWith(
      '/threads/thread%2F%E4%B8%AD%E6%96%87/history'
    );
  });

  it('encodes history pagination parameters', async () => {
    const get = vi.fn(async (_path: string) => ({ threadId: 'thread_1', items: [] }));
    const service = createThreadService(createClient(get));

    await service.getThreadHistory('thread_1', {
      limit: 50,
      before: 'cursor+/='
    });

    expect(get).toHaveBeenCalledWith(
      '/threads/thread_1/history?limit=50&before=cursor%2B%2F%3D'
    );
  });

  it('encodes a target history item without loading all previous pages', async () => {
    const get = vi.fn(async (_path: string) => ({ threadId: 'thread_1', items: [] }));
    const service = createThreadService(createClient(get));

    await service.getThreadHistory('thread_1', {
      limit: 50,
      targetItemId: 'item/中文'
    });

    expect(get).toHaveBeenCalledWith(
      '/threads/thread_1/history?limit=50&targetItemId=item%2F%E4%B8%AD%E6%96%87'
    );
  });
});

function createThreadResponse(): ThreadResponse {
  return {
    id: 'thread-task',
    title: '每日总结',
    codexThreadId: 'codex-thread-task',
    cwd: '/workspace/project',
    canonicalCwd: '/workspace/project',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'schedule_task',
    scheduleId: 'schedule-1',
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    archivedAt: null
  };
}

function createClient(get: (path: string) => Promise<unknown>): RuntimeClient {
  return {
    get<T>(path: string): Promise<T> {
      return get(path) as Promise<T>;
    }
  } as RuntimeClient;
}
