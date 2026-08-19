import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '@iarna/toml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getCodexMcpConfigurationFingerprint,
  setCodexMcpServerEnabled
} from '../../src/codex/mcp/config-store-2026-08-12.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = '';
});

describe('Codex MCP config store', () => {
  it('updates only the native enabled flag and preserves other config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-config-'));
    const configPath = join(tempDir, 'config.toml');
    writeFileSync(configPath, [
      'model = "gpt-test"',
      '',
      '[mcp_servers.github]',
      'url = "https://example.test/mcp"',
      'bearer_token_env_var = "GITHUB_TOKEN"',
      '',
      '[mcp_servers.local]',
      'command = "node"',
      'args = ["server.js"]',
      ''
    ].join('\n'));

    await setCodexMcpServerEnabled({
      codexHome: tempDir,
      name: 'github',
      enabled: false
    });

    const parsed = parse(readFileSync(configPath, 'utf8')) as {
      model: string;
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(parsed.model).toBe('gpt-test');
    expect(parsed.mcp_servers.github).toMatchObject({
      url: 'https://example.test/mcp',
      bearer_token_env_var: 'GITHUB_TOKEN',
      enabled: false
    });
    expect(parsed.mcp_servers.local).toMatchObject({
      command: 'node',
      args: ['server.js']
    });
  });

  it('rejects missing servers without creating a new config entry', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-config-'));
    const configPath = join(tempDir, 'config.toml');
    writeFileSync(configPath, 'model = "gpt-test"\n');

    await expect(setCodexMcpServerEnabled({
      codexHome: tempDir,
      name: 'missing',
      enabled: true
    })).rejects.toThrow('MCP_SERVER_NOT_FOUND');

    expect(parse(readFileSync(configPath, 'utf8'))).toEqual({
      model: 'gpt-test'
    });
  });

  it('fingerprints every native MCP field but ignores unrelated config', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-config-'));
    const configPath = join(tempDir, 'config.toml');
    writeFileSync(configPath, [
      'model = "gpt-test"',
      '',
      '[mcp_servers.github]',
      'url = "https://example.test/mcp"',
      '',
      '[mcp_servers.github.http_headers]',
      'X-Tenant = "tenant-a"',
      ''
    ].join('\n'));
    const initial = await getCodexMcpConfigurationFingerprint(tempDir);

    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(
      'model = "gpt-test"',
      'model = "gpt-other"'
    ));
    await expect(getCodexMcpConfigurationFingerprint(tempDir))
      .resolves.toBe(initial);

    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(
      'tenant-a',
      'tenant-b'
    ));
    const changed = await getCodexMcpConfigurationFingerprint(tempDir);
    expect(changed).toMatch(/^[0-9a-f]{64}$/);
    expect(changed).not.toBe(initial);
    expect(changed).not.toContain('tenant-b');
  });
});
