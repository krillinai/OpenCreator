import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createMcpService } from './mcp-service.js';

describe('McpService', () => {
  it('maps list, detail, add, enable, remove, login, and logout requests', async () => {
    const get = vi.fn(async (_path: string) => ({ servers: [] }));
    const post = vi.fn(async (_path: string, _body?: unknown) => ({ operation: { id: 'op-1' } }));
    const patch = vi.fn(async (_path: string, _body: unknown) => ({
      server: {},
      operation: { id: 'op-enable' }
    }));
    const remove = vi.fn(async (_path: string) => ({ removed: true }));
    const service = createMcpService(createClient({ get, post, patch, remove }));

    await service.listServers();
    await service.getServer('github/中文');
    await service.addServer({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' },
      confirmWriteToCodexHome: true
    });
    await service.setServerEnabled('github/中文', false, true);
    await service.removeServer('github/中文', true);
    await service.loginServer('github/中文', true);
    await service.logoutServer('github/中文', false);

    expect(get).toHaveBeenNthCalledWith(1, '/codex/mcp');
    expect(get).toHaveBeenNthCalledWith(2, '/codex/mcp/github%2F%E4%B8%AD%E6%96%87');
    expect(post).toHaveBeenNthCalledWith(1, '/codex/mcp/add', {
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'secret' },
      confirmWriteToCodexHome: true
    });
    expect(patch).toHaveBeenCalledWith(
      '/codex/mcp/github%2F%E4%B8%AD%E6%96%87',
      { enabled: false, confirmWriteToCodexHome: true }
    );
    expect(remove).toHaveBeenCalledWith(
      '/codex/mcp/github%2F%E4%B8%AD%E6%96%87?confirmWriteToCodexHome=true'
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/codex/mcp/github%2F%E4%B8%AD%E6%96%87/login',
      { confirmWriteToCodexHome: true }
    );
    expect(post).toHaveBeenNthCalledWith(
      3,
      '/codex/mcp/github%2F%E4%B8%AD%E6%96%87/logout'
    );
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
      return (body === undefined ? input.post(path) : input.post(path, body)) as Promise<T>;
    },
    patch<T>(path: string, body: unknown): Promise<T> {
      return input.patch(path, body) as Promise<T>;
    },
    delete<T>(path: string): Promise<T> {
      return input.remove(path) as Promise<T>;
    }
  } as RuntimeClient;
}
