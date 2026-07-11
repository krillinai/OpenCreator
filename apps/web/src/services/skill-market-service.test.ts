import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createSkillMarketService } from './skill-market-service.js';

describe('skill market service', () => {
  it('lists install records from the exact runtime endpoint', async () => {
    const get = vi.fn(async (_path: string) => ({ records: [] }));
    const client = createClient({ get });
    const service = createSkillMarketService(client);

    await service.listInstallRecords();

    expect(get).toHaveBeenCalledWith('/codex/skill-market/install-records');
  });

  it('posts install and update requests with encoded skill ids', async () => {
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const client = createClient({ post });
    const service = createSkillMarketService(client);

    await service.installSkill('frontend-slides');
    await service.updateSkill('folder/中文 skill');

    expect(post).toHaveBeenCalledWith(
      '/codex/skill-market/frontend-slides/install'
    );
    expect(post).toHaveBeenCalledWith(
      '/codex/skill-market/folder%2F%E4%B8%AD%E6%96%87%20skill/update'
    );
  });
});

function createClient(
  overrides: {
    get?: (path: string) => Promise<unknown>;
    post?: (path: string, body?: unknown) => Promise<unknown>;
  }
): Pick<RuntimeClient, 'get' | 'post'> {
  return {
    get<T>(path: string): Promise<T> {
      if (overrides.get) return overrides.get(path) as Promise<T>;
      throw new Error(`Unexpected get: ${path}`);
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      if (overrides.post) {
        return (
          body === undefined ? overrides.post(path) : overrides.post(path, body)
        ) as Promise<T>;
      }
      throw new Error(`Unexpected post: ${path}`);
    },
  };
}
