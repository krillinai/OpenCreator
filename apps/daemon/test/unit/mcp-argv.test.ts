import { describe, expect, it } from 'vitest';
import { buildMcpAddArgs, buildMcpGetArgs } from '../../src/codex/mcp.js';

describe('mcp argv', () => {
  it('builds mcp get args', () => {
    expect(buildMcpGetArgs('github')).toEqual(['mcp', 'get', 'github']);
  });

  it('builds stdio mcp add args with env before separator', () => {
    expect(
      buildMcpAddArgs({
        name: 'github',
        env: { GITHUB_TOKEN: 'secret' },
        command: 'node',
        args: ['server.js'],
      }),
    ).toEqual(['mcp', 'add', 'github', '--env', 'GITHUB_TOKEN=secret', '--', 'node', 'server.js']);
  });
});
