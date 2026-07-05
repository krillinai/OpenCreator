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

  it('redacts separated secret flag values in unparsed get raw output', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'node --api-key secret',
      stderr: '',
      exitCode: 0
    });

    expect(result.raw).toBe('node --api-key [REDACTED]');
    expect(result.raw).not.toContain('secret');
    expect(result.hasSecrets).toBe(true);
  });

  it('redacts token-like separated flag values in unparsed get raw output', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: 'node --github-token secret',
      stderr: '',
      exitCode: 0
    });

    expect(result.raw).toBe('node --github-token [REDACTED]');
    expect(result.raw).not.toContain('secret');
    expect(result.hasSecrets).toBe(true);
  });

  it('redacts quoted secrets in unparsed get raw output', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: [
        'GITHUB_TOKEN="secret"',
        "GITHUB_TOKEN='secret'",
        '--api-key="secret"',
        "--api-key='secret'"
      ].join('\n'),
      stderr: '',
      exitCode: 0
    });

    expect(result.raw).toContain('GITHUB_TOKEN=[REDACTED]');
    expect(result.raw).toContain('--api-key=[REDACTED]');
    expect(result.raw).not.toContain('secret');
    expect(result.hasSecrets).toBe(true);
  });

  it('maps not found get output to missing status', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: '',
      stderr: 'No MCP server named github is configured',
      exitCode: 1
    });

    expect(result.transport).toBe('unknown');
    expect(result.status).toBe('missing');
    expect(result.raw).toBe('No MCP server named github is configured');
    expect(result.diagnostics.join('\n')).toContain('server is missing');
  });

  it('marks missing get output with redacted raw secrets', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: '',
      stderr: 'server not found --github-token secret',
      exitCode: 1
    });

    expect(result.status).toBe('missing');
    expect(result.raw).toContain('--github-token [REDACTED]');
    expect(result.raw).not.toContain('secret');
    expect(result.hasSecrets).toBe(true);
  });

  it('detects not found output without matching permission errors', () => {
    expect(isMcpNotFoundOutput('server not found')).toBe(true);
    expect(isMcpNotFoundOutput('server not configured')).toBe(true);
    expect(isMcpNotFoundOutput('mcp server not configured')).toBe(true);
    expect(isMcpNotFoundOutput('No MCP server named github is configured')).toBe(true);
    expect(isMcpNotFoundOutput('missing mcp server github')).toBe(true);
    expect(isMcpNotFoundOutput('missing token')).toBe(false);
    expect(isMcpNotFoundOutput('missing required env')).toBe(false);
    expect(isMcpNotFoundOutput('missing permission')).toBe(false);
    expect(isMcpNotFoundOutput('MCP server github missing required env GITHUB_TOKEN')).toBe(false);
    expect(isMcpNotFoundOutput('MCP server github missing token')).toBe(false);
    expect(isMcpNotFoundOutput('GITHUB_TOKEN not configured')).toBe(false);
    expect(isMcpNotFoundOutput('env var not configured')).toBe(false);
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

  it('parses JSON get stdout when stderr contains a redacted warning', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio',
        command: 'npx',
        env: {
          GITHUB_TOKEN: 'secret'
        }
      }),
      stderr: 'GITHUB_TOKEN=secret warning',
      exitCode: 0
    });

    expect(result.status).toBe('configured');
    expect(result.transport).toBe('stdio');
    expect(result.diagnostics.join('\n')).toContain('GITHUB_TOKEN=[REDACTED] warning');
    expect(result.diagnostics.join('\n')).not.toContain('secret');
  });

  it('redacts separated secret flag values in stderr diagnostics', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio'
      }),
      stderr: 'warning --token secret',
      exitCode: 0
    });

    expect(result.status).toBe('configured');
    expect(result.diagnostics.join('\n')).toContain('warning --token [REDACTED]');
    expect(result.diagnostics.join('\n')).not.toContain('secret');
  });

  it('parses JSON list stdout when stderr contains a redacted warning', () => {
    const result = parseMcpListOutput({
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify([
        {
          name: 'github',
          transport: 'stdio',
          env: {
            GITHUB_TOKEN: 'secret'
          }
        }
      ]),
      stderr: 'GITHUB_TOKEN=secret warning',
      exitCode: 0
    });

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.status).toBe('configured');
    expect(result.diagnostics.join('\n')).toContain('GITHUB_TOKEN=[REDACTED] warning');
    expect(result.diagnostics.join('\n')).not.toContain('secret');
  });

  it('redacts parsed command args and url while marking secrets', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'http',
        command: 'node --api-key=secret',
        args: ['--api-key=secret'],
        url: 'https://example.test/mcp?token=secret'
      }),
      stderr: '',
      exitCode: 0
    });

    expect(result.command).toBe('node --api-key=[REDACTED]');
    expect(result.args).toEqual(['--api-key=[REDACTED]']);
    expect(result.url).toBe('https://example.test/mcp?token=[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.hasSecrets).toBe(true);
  });

  it('redacts separated secret flag values in parsed command and args', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio',
        command: 'node --api-key secret',
        args: ['--api-key', 'secret']
      }),
      stderr: '',
      exitCode: 0
    });

    expect(result.command).toBe('node --api-key [REDACTED]');
    expect(result.args).toEqual(['--api-key', '[REDACTED]']);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.hasSecrets).toBe(true);
  });

  it('redacts token-like separated flag values in parsed command and args', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio',
        command: 'node --github-token secret',
        args: ['--client-secret', 'client-secret-value']
      }),
      stderr: '',
      exitCode: 0
    });

    expect(result.command).toBe('node --github-token [REDACTED]');
    expect(result.args).toEqual(['--client-secret', '[REDACTED]']);
    expect(JSON.stringify(result)).not.toContain(' secret');
    expect(JSON.stringify(result)).not.toContain('client-secret-value');
    expect(result.hasSecrets).toBe(true);
  });

  it('redacts quoted secrets in parsed args', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({
        name: 'github',
        transport: 'stdio',
        args: ['GITHUB_TOKEN="secret"', '--api-key="secret2"']
      }),
      stderr: '',
      exitCode: 0
    });

    expect(result.args).toEqual(['GITHUB_TOKEN=[REDACTED]', '--api-key=[REDACTED]']);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('secret2');
    expect(result.hasSecrets).toBe(true);
  });

  it('maps JSON not found errors to missing status', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({ error: 'server not found' }),
      stderr: '',
      exitCode: 1
    });

    expect(result.status).toBe('missing');
    expect(result.transport).toBe('unknown');
    expect(result.envKeys).toEqual([]);
    expect(result.hasSecrets).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('server is missing');
  });

  it('maps nested JSON error messages to missing status', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({ error: { message: 'server not found' } }),
      stderr: '',
      exitCode: 1
    });

    expect(result.status).toBe('missing');
    expect(result.transport).toBe('unknown');
  });

  it('maps non-missing JSON errors to unknown status', () => {
    const tokenResult = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({ error: 'missing token' }),
      stderr: '',
      exitCode: 1
    });
    const permissionResult = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({ message: 'permission denied' }),
      stderr: '',
      exitCode: 1
    });

    expect(tokenResult.status).toBe('unknown');
    expect(tokenResult.transport).toBe('unknown');
    expect(tokenResult.diagnostics.join('\n')).toContain('missing token');
    expect(permissionResult.status).toBe('unknown');
    expect(permissionResult.transport).toBe('unknown');
    expect(permissionResult.diagnostics.join('\n')).toContain('permission denied');
  });

  it('does not map JSON diagnostics about missing token to missing status', () => {
    const result = parseMcpGetOutput({
      name: 'github',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify({ name: 'github', transport: 'stdio', diagnostics: ['missing token'] }),
      stderr: '',
      exitCode: 1
    });

    expect(result.status).not.toBe('missing');
    expect(result.status).toBe('configured');
  });

  it('adds diagnostics when list output contains non-object entries', () => {
    const result = parseMcpListOutput({
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      stdout: JSON.stringify([{ name: 'github', transport: 'stdio' }, 'bad']),
      stderr: '',
      exitCode: 0
    });

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('github');
    expect(result.diagnostics).toContain('codex mcp list output contained non-object entries');
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
    expect(getResult.hasSecrets).toBe(true);
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
