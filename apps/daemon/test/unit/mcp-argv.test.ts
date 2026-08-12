import { describe, expect, it } from 'vitest';
import {
  buildMcpAddArgs,
  buildMcpGetArgs,
  buildMcpListArgs,
  buildMcpLoginArgs,
  buildMcpLogoutArgs,
  buildMcpRemoveArgs
} from '../../src/codex/mcp.js';

describe('mcp argv', () => {
  it('builds list get remove login and logout args', () => {
    expect(buildMcpListArgs()).toEqual(['mcp', 'list', '--json']);
    expect(buildMcpGetArgs('github')).toEqual([
      'mcp',
      'get',
      'github',
      '--json'
    ]);
    expect(buildMcpRemoveArgs('github')).toEqual(['mcp', 'remove', 'github']);
    expect(buildMcpLoginArgs('github')).toEqual(['mcp', 'login', 'github']);
    expect(buildMcpLogoutArgs('github')).toEqual(['mcp', 'logout', 'github']);
  });

  it('builds stdio mcp add args with env before separator', () => {
    expect(
      buildMcpAddArgs({
        name: 'github',
        transport: 'stdio',
        env: { GITHUB_TOKEN: 'secret' },
        command: 'node',
        args: ['server.js']
      })
    ).toEqual(['mcp', 'add', 'github', '--env', 'GITHUB_TOKEN=secret', '--', 'node', 'server.js']);
  });

  it('builds url and oauth mcp add args', () => {
    expect(
      buildMcpAddArgs({
        name: 'remote',
        transport: 'http',
        url: 'https://example.test/mcp',
        bearerTokenEnvVar: 'REMOTE_TOKEN'
      })
    ).toEqual([
      'mcp',
      'add',
      'remote',
      '--bearer-token-env-var',
      'REMOTE_TOKEN',
      '--url',
      'https://example.test/mcp'
    ]);

    expect(
      buildMcpAddArgs({
        name: 'oauth',
        transport: 'sse',
        url: 'https://example.test/sse',
        oauthClientId: 'client-1',
        oauthResource: 'https://example.test'
      })
    ).toEqual([
      'mcp',
      'add',
      'oauth',
      '--oauth-client-id',
      'client-1',
      '--oauth-resource',
      'https://example.test',
      '--url',
      'https://example.test/sse'
    ]);
  });
});
