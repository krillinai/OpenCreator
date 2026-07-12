import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createCleanupService } from './cleanup-service.js';

describe('CleanupService', () => {
  it('previews cleanup candidates with an encoded retention value', async () => {
    const get = vi.fn(async (_path: string) => ({
      olderThanDays: 30,
      items: [],
      totalSizeBytes: 0,
      warnings: []
    }));
    const client = {
      get<T>(path: string): Promise<T> {
        return get(path) as Promise<T>;
      },
      post<T>(): Promise<T> {
        throw new Error('Unexpected post');
      }
    } satisfies Pick<RuntimeClient, 'get' | 'post'>;

    await createCleanupService(client).previewCleanup(30);

    expect(get).toHaveBeenCalledWith('/runtime/cleanup/preview?olderThanDays=30');
  });

  it('sends cleanup confirmation only from an explicit caller confirmation', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({
      deleted: [],
      failed: [],
      totalDeletedBytes: 0,
      warnings: []
    }));
    const client = {
      get<T>(): Promise<T> {
        throw new Error('Unexpected get');
      },
      post<T>(path: string, body?: unknown): Promise<T> {
        return post(path, body) as Promise<T>;
      }
    } satisfies Pick<RuntimeClient, 'get' | 'post'>;

    await createCleanupService(client).deleteCleanup({ olderThanDays: 30, confirm: true });

    expect(post).toHaveBeenCalledWith('/runtime/cleanup', {
      olderThanDays: 30,
      confirm: true
    });
  });
});
