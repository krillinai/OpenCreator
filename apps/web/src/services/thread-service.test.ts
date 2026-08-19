import { describe, expect, it, vi } from 'vitest';
import type { ThreadResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';
import { createThreadService } from './thread-service.js';

describe('ThreadService', () => {
  it('loads bounded interactive and schedule task thread summaries separately', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.includes('purpose=conversation')) {
        return {
          threads: [createThreadResponse({
            id: 'thread-conversation',
            purpose: 'conversation',
            scheduleId: undefined
          })]
        };
      }
      if (path.includes('purpose=schedule_task')) {
        return { threads: [createThreadResponse()] };
      }
      throw new Error(`Unexpected request ${path}`);
    });
    const service = createThreadService(createClient(get));

    const response = await service.listActiveThreads();

    expect(get).toHaveBeenCalledWith(
      '/threads?status=active&purpose=conversation&limit=50'
    );
    expect(get).toHaveBeenCalledWith(
      '/threads?status=active&purpose=schedule_task&limit=100'
    );
    expect(response.threads).toHaveLength(2);
    expect(response.threads[1]).toMatchObject({
      id: 'thread-task',
      purpose: 'schedule_task',
      scheduleId: 'schedule-1'
    });
  });

  it('falls back to the legacy thread list when purpose filters are unavailable', async () => {
    const get = vi.fn(async (path: string) => {
      if (path === '/threads?status=active&limit=50') {
        return { threads: [createThreadResponse()] };
      }
      return {
        threads: [
          createThreadResponse({
            id: 'thread-conversation',
            purpose: 'conversation',
            scheduleId: undefined
          })
        ]
      };
    });
    const service = createThreadService(createClient(get));

    const response = await service.listActiveThreads();

    expect(get).toHaveBeenLastCalledWith('/threads?status=active&limit=50');
    expect(response.threads).toHaveLength(1);
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

  it('archives a task draft through the thread archive endpoint', async () => {
    const post = vi.fn(async () => ({
      thread: createThreadResponse({
        id: 'thread-draft',
        purpose: 'schedule_draft',
        scheduleId: undefined,
        status: 'archived'
      })
    }));
    const service = createThreadService(createClient(vi.fn(), post));

    await service.archiveThread('thread/draft');

    expect(post).toHaveBeenCalledWith('/threads/thread%2Fdraft/archive', {});
  });

  it('permanently deletes a thread through the encoded delete endpoint', async () => {
    const del = vi.fn(async () => undefined);
    const client = createClient(vi.fn()) as RuntimeClient & {
      delete(path: string): Promise<void>;
    };
    client.delete = del as RuntimeClient['delete'];
    const service = createThreadService(client);

    await service.deleteThread('thread/中文');

    expect(del).toHaveBeenCalledWith('/threads/thread%2F%E4%B8%AD%E6%96%87');
  });

  it('uses dedicated account-scoped knowledge conversation endpoints', async () => {
    const get = vi.fn(async (path: string) => (
      path.endsWith('/latest') ? { thread: null } : { thread: createThreadResponse() }
    ));
    const post = vi.fn(async () => ({ thread: createThreadResponse() }));
    const service = createThreadService(createClient(get, post));

    await expect(service.getLatestKnowledgeThread()).resolves.toEqual({ thread: null });
    await service.createKnowledgeThread('project-default');
    await service.getKnowledgeThread('thread/knowledge');
    await service.listKnowledgeThreadRuns('thread/knowledge');
    await service.getKnowledgeThreadHistory('thread/knowledge', { limit: 50 });

    expect(post).toHaveBeenCalledWith('/enterprise/knowledge-conversations', {
      projectId: 'project-default'
    });
    expect(get).toHaveBeenCalledWith(
      '/enterprise/knowledge-conversations/thread%2Fknowledge/history?limit=50'
    );
  });
});

function createThreadResponse(overrides: Partial<ThreadResponse> = {}): ThreadResponse {
  return {
    id: 'thread-task',
    title: '每日总结',
    projectId: null,
    origin: 'opencreator_created',
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
    archivedAt: null,
    ...overrides
  };
}

function createClient(
  get: (path: string) => Promise<unknown>,
  post: (path: string, body?: unknown) => Promise<unknown> = async () => ({})
): RuntimeClient {
  return {
    get<T>(path: string): Promise<T> {
      return get(path) as Promise<T>;
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return post(path, body) as Promise<T>;
    }
  } as RuntimeClient;
}
