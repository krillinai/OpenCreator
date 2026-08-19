import { describe, expect, it } from 'vitest';
import {
  readEnterpriseClientConfig,
  serializeEnterpriseClientConfig
} from '../../src/enterprise/client-config-2026-08-06.js';

const agentId = 'opencreator_550e8400-e29b-41d4-a716-446655440000';

describe('enterprise client config', () => {
  it('accepts a gateway and optional agent id', () => {
    expect(readEnterpriseClientConfig(
      '/tmp/config.toml',
      () => [
        'gateway = "https://enterprise.example/"',
        `agent_id = "${agentId}"`
      ].join('\n')
    )).toEqual({
      gateway: 'https://enterprise.example',
      agentId
    });
    expect(serializeEnterpriseClientConfig({
      gateway: 'https://enterprise.example',
      agentId
    })).toBe([
      'gateway = "https://enterprise.example"',
      `agent_id = "${agentId}"`,
      ''
    ].join('\n'));
  });

  it.each([
    'gateway = "https://enterprise.example"\nextra = true\n',
    'gateway = "https://enterprise.example/path"\n',
    'gateway = "ftp://enterprise.example"\n',
    'gateway = "https://enterprise.example"\nagent_id = "invalid"\n',
    'not-toml = '
  ])('rejects invalid gateway configuration', contents => {
    expect(() => readEnterpriseClientConfig(
      '/tmp/config.toml',
      () => contents
    )).toThrow('ENTERPRISE_CONFIG_INVALID');
  });
});
