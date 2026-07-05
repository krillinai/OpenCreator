import { describe, expect, it } from 'vitest';
import { redactMcpArgv, redactMcpText } from '../../src/codex/mcp/redaction.js';

describe('codex mcp redaction', () => {
  it('redacts env values in argv', () => {
    expect(redactMcpArgv([
      'mcp',
      'add',
      'github',
      '--env',
      'GITHUB_TOKEN=secret',
      '--env',
      'SAFE=value',
      '--',
      'node',
      'server.js'
    ])).toEqual([
      'mcp',
      'add',
      'github',
      '--env',
      'GITHUB_TOKEN=[REDACTED]',
      '--env',
      'SAFE=[REDACTED]',
      '--',
      'node',
      'server.js'
    ]);
  });

  it('redacts separated token-like argv values', () => {
    expect(redactMcpArgv([
      'mcp',
      'add',
      'github',
      '--',
      'node',
      'server.js',
      '--api-key',
      'secret-value',
      '--safe',
      'visible'
    ])).toEqual([
      'mcp',
      'add',
      'github',
      '--',
      'node',
      'server.js',
      '[REDACTED]',
      '[REDACTED]',
      '--safe',
      'visible'
    ]);
  });

  it('redacts token-like text and url query secrets', () => {
    expect(redactMcpText('GITHUB_TOKEN=secret\nAuthorization: Bearer abc123')).toContain('GITHUB_TOKEN=[REDACTED]');
    expect(redactMcpText('Authorization: Bearer abc123')).toContain('Authorization: Bearer [REDACTED]');
    expect(redactMcpText('https://example.test/mcp?token=secret&safe=ok')).toContain('token=[REDACTED]');
  });

  it('redacts authorization credentials for common schemes and no scheme', () => {
    expect(redactMcpText('Authorization: Basic abc123')).toBe('Authorization: Basic [REDACTED]');
    expect(redactMcpText('Authorization: token abc123')).toBe('Authorization: token [REDACTED]');
    expect(redactMcpText('Authorization: abc123')).toBe('Authorization: [REDACTED]');
  });

  it('redacts exact sensitive values', () => {
    expect(redactMcpText('server responded with exact-secret', ['exact-secret'])).toBe(
      'server responded with [REDACTED]'
    );
  });
});
