import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createModelService } from './model-service-2026-08-05.js';

describe('ModelService', () => {
  it('loads the Runtime Codex model catalog', async () => {
    const get = vi.fn(async (_path: string) => ({ models: [] }));
    const service = createModelService({
      get<T>(path: string): Promise<T> {
        return get(path) as Promise<T>;
      }
    } satisfies Pick<RuntimeClient, 'get'>);

    await expect(service.listModels()).resolves.toEqual({ models: [] });
    expect(get).toHaveBeenCalledWith('/codex/models');
  });
});
