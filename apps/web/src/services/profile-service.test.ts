import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createProfileService } from './profile-service.js';

describe('ProfileService', () => {
  it('maps profile CRUD requests to runtime endpoints', async () => {
    const get = vi.fn(async (_path: string) => ({ profiles: [] }));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({ profile: { name: 'review' } }));
    const patch = vi.fn(async (_path: string, _body: unknown) => ({ profile: { name: 'review' } }));
    const remove = vi.fn(async (_path: string) => ({ deleted: true }));
    const service = createProfileService(createClient({ get, post, patch, remove }));

    await service.listProfiles();
    await service.getProfile('review/中文');
    await service.createProfile({
      name: 'review',
      config: { model: 'gpt-5.3-codex', model_reasoning_effort: 'high' }
    });
    await service.updateProfile('review/中文', {
      config: { sandbox_mode: 'workspace-write' }
    });
    await service.deleteProfile('review/中文');

    expect(get).toHaveBeenNthCalledWith(1, '/codex/profiles');
    expect(get).toHaveBeenNthCalledWith(2, '/codex/profiles/review%2F%E4%B8%AD%E6%96%87');
    expect(post).toHaveBeenCalledWith('/codex/profiles', {
      name: 'review',
      config: { model: 'gpt-5.3-codex', model_reasoning_effort: 'high' }
    });
    expect(patch).toHaveBeenCalledWith(
      '/codex/profiles/review%2F%E4%B8%AD%E6%96%87',
      { config: { sandbox_mode: 'workspace-write' } }
    );
    expect(remove).toHaveBeenCalledWith('/codex/profiles/review%2F%E4%B8%AD%E6%96%87');
  });
});

function createClient(input: {
  get: (path: string) => Promise<unknown>;
  post: (path: string, body?: unknown) => Promise<unknown>;
  patch: (path: string, body: unknown) => Promise<unknown>;
  remove: (path: string) => Promise<unknown>;
}): RuntimeClient {
  return {
    get<T>(path: string): Promise<T> {
      return input.get(path) as Promise<T>;
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return input.post(path, body) as Promise<T>;
    },
    patch<T>(path: string, body: unknown): Promise<T> {
      return input.patch(path, body) as Promise<T>;
    },
    delete<T>(path: string): Promise<T> {
      return input.remove(path) as Promise<T>;
    }
  } as RuntimeClient;
}
