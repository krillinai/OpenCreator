import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTICS_REDACTION_WARNING,
  redactDiagnosticContent,
  redactDiagnosticFiles
} from '../../src/diagnostics/redactor.js';
import { redactValue } from '../../src/security/redaction.js';

describe('diagnostics redactor', () => {
  it('redacts common secret assignments and authorization headers', () => {
    const content = [
      'OPENAI_API_KEY=sk-secret-value',
      'MCP_TOKEN=mcp-secret-value',
      'PASSWORD=db-password',
      'Authorization: Bearer bearer-secret-value',
      'auth=lowercase-secret',
      'API token: sk-labeled-secret-value',
      'standalone credential sk-standalone-secret-value',
      'tool token clwcap_VerySecretCapabilityValue'
    ].join('\n');

    const redacted = redactDiagnosticContent(content);

    expect(redacted).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(redacted).toContain('MCP_TOKEN=[REDACTED]');
    expect(redacted).toContain('PASSWORD=[REDACTED]');
    expect(redacted).toContain('Authorization: Bearer [REDACTED]');
    expect(redacted).toContain('auth=[REDACTED]');
    expect(redacted).not.toContain('sk-secret-value');
    expect(redacted).not.toContain('mcp-secret-value');
    expect(redacted).not.toContain('db-password');
    expect(redacted).not.toContain('bearer-secret-value');
    expect(redacted).not.toContain('lowercase-secret');
    expect(redacted).not.toContain('sk-labeled-secret-value');
    expect(redacted).not.toContain('sk-standalone-secret-value');
    expect(redacted).not.toContain('clwcap_VerySecretCapabilityValue');
  });

  it('redacts every exported diagnostic file and exposes a fixed warning', () => {
    const files = redactDiagnosticFiles([
      { name: 'stderr.redacted.log', content: 'TOKEN=plain-token' },
      { name: 'diagnostics.json', content: '{"authorization":"AUTH=plain-auth"}' }
    ]);

    expect(files).toEqual([
      { name: 'stderr.redacted.log', content: 'TOKEN=[REDACTED]' },
      { name: 'diagnostics.json', content: '{"authorization":"AUTH=[REDACTED]"}' }
    ]);
    expect(DIAGNOSTICS_REDACTION_WARNING).toBe(
      'Diagnostics are redacted on a best-effort basis.'
    );
  });

  it('removes prompt fields from JSON and NDJSON diagnostics', () => {
    const content = [
      JSON.stringify({ type: 'meta', prompt: 'private task', nested: { userPrompt: 'private nested task' } }),
      JSON.stringify({ type: 'status', message: 'running' })
    ].join('\n');

    const redacted = redactDiagnosticContent(content);

    expect(redacted).not.toContain('private task');
    expect(redacted).not.toContain('private nested task');
    expect(redacted).toContain('"prompt":"[REDACTED]"');
    expect(redacted).toContain('"userPrompt":"[REDACTED]"');
    expect(redacted).toContain('"message":"running"');
  });

  it('redacts parsed values without corrupting escaped quotes in tool output', () => {
    const redacted = redactValue({
      method: 'item/completed',
      params: {
        item: {
          aggregatedOutput: 'TOKEN=abc\\"def next'
        }
      }
    });
    const serialized = JSON.stringify(redacted);

    expect(() => JSON.parse(serialized)).not.toThrow();
    expect(serialized).not.toContain('abc');
    expect(JSON.parse(serialized)).toMatchObject({
      params: {
        item: {
          aggregatedOutput: 'TOKEN=[REDACTED]"def next'
        }
      }
    });
  });

  it('redacts enterprise bearer cookie and token fields from diagnostics', () => {
    const secrets = [
      'enterprise-access-token',
      'enterprise-cookie',
      'enterprise-password',
      '2026-07-31T10:00:00Z'
    ];
    const content = JSON.stringify({
      enterprise: {
        access_token: secrets[0],
        expires_at: secrets[3],
        password: secrets[2]
      },
      headers: {
        Authorization: `Token ${secrets[0]}`,
        Cookie: `enterprise_session=${secrets[1]}`,
        'Set-Cookie': `enterprise_session=${secrets[1]}`
      }
    });

    const redacted = redactDiagnosticContent(content);

    for (const secret of secrets) expect(redacted).not.toContain(secret);
    expect(redacted).toContain('[REDACTED]');
  });
});
