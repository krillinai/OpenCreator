import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createTaskService } from './task-service.js';

describe('TaskService', () => {
  it('encodes task filters and pagination cursors', async () => {
    const get = vi.fn(async () => ({ tasks: [], hasMore: false }));
    const service = createTaskService({ get } as unknown as RuntimeClient);

    await service.list({
      status: 'waiting_approval',
      limit: 20,
      cursor: 'cursor+/='
    });

    expect(get).toHaveBeenCalledWith(
      '/tasks?status=waiting_approval&limit=20&cursor=cursor%2B%2F%3D'
    );
  });
});
