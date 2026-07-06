import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createSettingsService } from './settings-service.js';

describe('SettingsService', () => {
  it('sends cleanup confirmation only from an explicit caller confirmation', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({ deleted: [], failed: [], totalDeletedBytes: 0, warnings: [] }));
    const client = {
      get<T>(): Promise<T> {
        throw new Error('Unexpected get');
      },
      post<T>(path: string, body?: unknown): Promise<T> {
        return post(path, body) as Promise<T>;
      },
      patch<T>(): Promise<T> {
        throw new Error('Unexpected patch');
      },
      delete<T>(): Promise<T> {
        throw new Error('Unexpected delete');
      }
    } satisfies Pick<RuntimeClient, 'get' | 'post' | 'patch' | 'delete'>;
    const service = createSettingsService(client);

    await service.deleteCleanup({ olderThanDays: 30, confirm: true });

    expect(post).toHaveBeenCalledWith('/runtime/cleanup', { olderThanDays: 30, confirm: true });
  });
});
