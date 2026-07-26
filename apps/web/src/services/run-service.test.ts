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

  it('sends attachment ids with their draft scope', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({
      id: 'run_1',
      threadId: 'thread_1',
      status: 'running'
    }));
    const client = {
      post<T>(path: string, body?: unknown): Promise<T> {
        return post(path, body) as Promise<T>;
      },
      get<T>(): Promise<T> {
        throw new Error('Unexpected get');
      }
    } satisfies Pick<RuntimeClient, 'post' | 'get'>;

    await createRunService(client).startThreadRun({
      threadId: 'thread_1',
      prompt: '描述图片',
      draftId: 'draft_1',
      attachmentIds: ['attachment_1'],
      submissionMode: 'interrupt_and_enqueue'
    });

    expect(post).toHaveBeenCalledWith('/runs', {
      threadId: 'thread_1',
      prompt: '描述图片',
      resumeMode: 'auto',
      draftId: 'draft_1',
      attachmentIds: ['attachment_1'],
      submissionMode: 'interrupt_and_enqueue'
    });
  });

  it('steers a selected queued run through its dedicated endpoint', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({
      id: 'run_queued',
      steered: true
    }));
    const client = {
      post<T>(path: string, body?: unknown): Promise<T> {
        return post(path, body) as Promise<T>;
      },
      get<T>(): Promise<T> {
        throw new Error('Unexpected get');
      }
    } satisfies Pick<RuntimeClient, 'post' | 'get'>;

    await createRunService(client).steerRun('run/queued');

    expect(post).toHaveBeenCalledWith('/runs/run%2Fqueued/steer', undefined);
  });
});
