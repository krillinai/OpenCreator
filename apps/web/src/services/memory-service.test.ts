import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createMemoryService } from './memory-service.js';

describe('MemoryService', () => {
  it('encodes memory filters and resource identifiers', async () => {
    const get = vi.fn(async () => ({ memories: [] }));
    const post = vi.fn(async () => ({}));
    const patch = vi.fn(async () => ({}));
    const remove = vi.fn(async () => ({}));
    const service = createMemoryService({
      get,
      post,
      patch,
      delete: remove
    } as unknown as RuntimeClient);

    await service.listMemories({
      query: 'pnpm + 测试',
      scope: 'project',
      scopeKey: '/tmp/project a',
      enabled: false,
      limit: 20
    });
    await service.updateMemory('memory / 1', { enabled: false });
    await service.deleteMemory('memory / 1');
    await service.createSummary('thread / 1');
    await service.deleteSummary('summary / 1');
    await service.getRunContext('run / 1');

    expect(get).toHaveBeenNthCalledWith(
      1,
      '/memories?query=pnpm+%2B+%E6%B5%8B%E8%AF%95&scope=project&scopeKey=%2Ftmp%2Fproject+a&enabled=false&limit=20'
    );
    expect(patch).toHaveBeenCalledWith('/memories/memory%20%2F%201', { enabled: false });
    expect(remove).toHaveBeenNthCalledWith(1, '/memories/memory%20%2F%201');
    expect(post).toHaveBeenCalledWith('/threads/thread%20%2F%201/summaries');
    expect(remove).toHaveBeenNthCalledWith(2, '/summaries/summary%20%2F%201');
    expect(get).toHaveBeenNthCalledWith(2, '/runs/run%20%2F%201/context');
  });
});
