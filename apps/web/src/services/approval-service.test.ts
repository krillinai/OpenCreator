import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createApprovalService } from './approval-service.js';

describe('ApprovalService', () => {
  it('encodes list filters and approval decisions', async () => {
    const get = vi.fn(async () => ({ approvals: [] }));
    const post = vi.fn(async () => ({ approval: {}, changed: true }));
    const service = createApprovalService({ get, post } as unknown as RuntimeClient);

    await service.list({
      status: 'pending',
      runId: 'run / 1',
      threadId: 'thread+/=',
      limit: 25
    });
    await service.approve('approval / 1');
    await service.reject('approval+/=2');

    expect(get).toHaveBeenCalledWith(
      '/approvals?status=pending&runId=run+%2F+1&threadId=thread%2B%2F%3D&limit=25'
    );
    expect(post).toHaveBeenNthCalledWith(1, '/approvals/approval%20%2F%201/approve');
    expect(post).toHaveBeenNthCalledWith(2, '/approvals/approval%2B%2F%3D2/reject');
  });
});
