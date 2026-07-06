import { describe, expect, it, vi } from 'vitest';
import { createRunService } from './run-service.js';

describe('RunService', () => {
  it('does not send immutable thread config overrides for thread runs', async () => {
    const client = { post: vi.fn(async () => ({ id: 'run_1', threadId: 'thread_1', status: 'running' })) };
    const service = createRunService(client);

    await service.startThreadRun({ threadId: 'thread_1', prompt: 'hello', resumeMode: 'auto' });

    expect(client.post).toHaveBeenCalledWith('/runs', {
      threadId: 'thread_1',
      prompt: 'hello',
      resumeMode: 'auto'
    });
  });
});
