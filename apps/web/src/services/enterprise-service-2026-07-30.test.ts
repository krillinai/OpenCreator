import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createEnterpriseService } from './enterprise-service-2026-07-30.js';

describe('enterprise service', () => {
  it('posts only account fields to exact enterprise runtime routes', async () => {
    const get = vi.fn(async (_path: string) => ({}));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const service = createEnterpriseService(createClient({ get, post }));

    await service.getSession();
    await service.refreshSession();
    await service.login({ email: 'member@example.com', password: 'secret' });
    await service.register({
      email: 'new@example.com',
      name: 'New Member',
      password: 'secret'
    });
    await service.logout();

    expect(get).toHaveBeenCalledWith('/enterprise/session');
    expect(post).toHaveBeenCalledWith('/enterprise/session/refresh');
    expect(post).toHaveBeenCalledWith('/enterprise/login', {
      email: 'member@example.com',
      password: 'secret'
    });
    expect(post).toHaveBeenCalledWith('/enterprise/register', {
      email: 'new@example.com',
      name: 'New Member',
      password: 'secret'
    });
    expect(post).toHaveBeenCalledWith('/enterprise/logout');
  });

  it('uses exact encoded skill routes without version or digest bodies', async () => {
    const get = vi.fn(async (_path: string) => ({}));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({}));
    const service = createEnterpriseService(createClient({ get, post }));

    await service.listSkills();
    await service.getSkillDetail('folder/中文 skill');
    await service.installSkill('folder/中文 skill');
    await service.updateSkill('folder/中文 skill');

    const encoded = 'folder%2F%E4%B8%AD%E6%96%87%20skill';
    expect(get).toHaveBeenCalledWith('/enterprise/skills');
    expect(get).toHaveBeenCalledWith(`/enterprise/skills/${encoded}`);
    expect(post).toHaveBeenCalledWith(`/enterprise/skills/${encoded}/install`);
    expect(post).toHaveBeenCalledWith(`/enterprise/skills/${encoded}/update`);
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
    }
  };
}
