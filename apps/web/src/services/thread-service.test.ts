import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createThreadService } from './thread-service.js';

describe('ThreadService', () => {
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
});

function createClient(get: (path: string) => Promise<unknown>): RuntimeClient {
  return {
    get<T>(path: string): Promise<T> {
      return get(path) as Promise<T>;
    }
  } as RuntimeClient;
}
