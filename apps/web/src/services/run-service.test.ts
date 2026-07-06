import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createRunService } from './run-service.js';

describe('RunService', () => {
  it('does not send immutable thread config overrides for thread runs', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({ id: 'run_1', threadId: 'thread_1', status: 'running' }));
    const client = {
      post<T>(path: string, body?: unknown): Promise<T> {
        return post(path, body) as Promise<T>;
      },
      get<T>(): Promise<T> {
        throw new Error('Unexpected get');
      }
    } satisfies Pick<RuntimeClient, 'post' | 'get'>;
    const service = createRunService(client);

    await service.startThreadRun({ threadId: 'thread_1', prompt: 'hello', resumeMode: 'auto' });

    expect(post).toHaveBeenCalledWith('/runs', {
      threadId: 'thread_1',
      prompt: 'hello',
      resumeMode: 'auto'
    });
  });
});
