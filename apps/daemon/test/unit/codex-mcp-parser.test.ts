import { describe, expect, it } from 'vitest';
import { isMcpNotFoundOutput, parseMcpGetOutput, parseMcpListOutput } from '../../src/codex/mcp/parser.js';

describe('codex mcp parser', () => {
  it('parses JSON get output', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: 'secret'
        },
        status: 'ignored',
        diagnostics: []
      }),
      stderr: '',
      exitCode: 0
    });

    expect(result).toMatchObject({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      envKeys: ['GITHUB_TOKEN'],
      hasSecrets: true,
      status: 'configured',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      diagnostics: []
    });
    expect(result).not.toHaveProperty('raw');
  });

  it('returns redacted raw diagnostics for unparsed get output', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'github stdio command=node GITHUB_TOKEN=secret',
      stderr: '',
      exitCode: 0
    });

    expect(result.transport).toBe('unknown');
    expect(result.status).toBe('configured');
    expect(result.raw).toContain('GITHUB_TOKEN=[REDACTED]');
    expect(result.raw).not.toContain('secret');
    expect(result.diagnostics.join('\n')).toContain('not fully recognized');
    expect(result.diagnostics.join('\n')).not.toContain('secret');
  });

  it('detects not found output without matching permission errors', () => {
    expect(isMcpNotFoundOutput('server not found')).toBe(true);
    expect(isMcpNotFoundOutput('No MCP server named github is configured')).toBe(true);
    expect(isMcpNotFoundOutput('permission denied')).toBe(false);
  });

  it('parses JSON array list output', () => {
    const result = parseMcpListOutput({
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'global',
      stdout: JSON.stringify([
        {
          name: 'github',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_TOKEN: 'secret'
          }
        }
      ]),
      stderr: '',
      exitCode: 0
    });

    expect(result.requiresWriteConfirmation).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      name: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      envKeys: ['GITHUB_TOKEN'],
      hasSecrets: true,
      status: 'configured',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'global',
      diagnostics: []
    });
  });

  it('redacts raw output and diagnostics for unparsed get and list output', () => {
    const getResult = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'GITHUB_TOKEN=secret',
      stderr: '',
      exitCode: 0
    });
    const listResult = parseMcpListOutput({
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'GITHUB_TOKEN=secret',
      stderr: '',
      exitCode: 0
    });

    expect(getResult.raw).toBe('GITHUB_TOKEN=[REDACTED]');
    expect(getResult.raw).not.toContain('secret');
    expect(getResult.diagnostics.join('\n')).not.toContain('secret');
    expect(listResult.diagnostics.join('\n')).toContain('not fully recognized');
    expect(listResult.diagnostics.join('\n')).not.toContain('secret');
  });

  it('redacts parsed diagnostics using env values', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'http',
        url: 'https://example.test/mcp',
        env: {
          GITHUB_TOKEN: 'exact-secret'
        },
        diagnostics: ['server responded with exact-secret']
      }),
      stderr: '',
      exitCode: 0
    });

    expect(result.diagnostics).toEqual(['server responded with [REDACTED]']);
    expect(result.diagnostics.join('\n')).not.toContain('exact-secret');
  });

  it('returns empty servers for unparsed list output', () => {
    const result = parseMcpListOutput({
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'github stdio command=node',
      stderr: '',
      exitCode: 0
    });

    expect(result.servers).toEqual([]);
    expect(result.diagnostics.join('\n')).toContain('not fully recognized');
  });
});
