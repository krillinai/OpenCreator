import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listEnterpriseMcpIsolationServerNames
} from '../../src/enterprise/mcp-isolation-2026-08-07.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('enterprise MCP runtime isolation', () => {
  it('disables only enabled HTTP MCP servers routed through the enterprise Gateway', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-mcp-isolation-'));
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'config.toml'), [
      '[mcp_servers.claw-mcp]',
      'url = "http://1.13.175.31:1904/mcp"',
      'enabled = true',
      '',
      '[mcp_servers.legacy-upstream]',
      'url = "http://1.13.175.31:1904/mcp/servers/knowledge-adapter"',
      '',
      '[mcp_servers.already-disabled]',
      'url = "http://1.13.175.31:1904/mcp"',
      'enabled = false',
      '',
      '[mcp_servers.same-origin-api]',
      'url = "http://1.13.175.31:1904/api/v1/app/skills"',
      '',
      '[mcp_servers.other-enterprise]',
      'url = "https://other.example/mcp"',
      '',
      '[mcp_servers.local-tool]',
      'command = "local-tool"',
      ''
    ].join('\n'));

    expect(listEnterpriseMcpIsolationServerNames({
      codexHome: tempDir,
      enterpriseOrigin: 'http://1.13.175.31:1904'
    })).toEqual([
      'claw-mcp',
      'legacy-upstream'
    ]);
  });

  it('returns no overrides when CODEX_HOME has no config', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-mcp-isolation-empty-'));

    expect(listEnterpriseMcpIsolationServerNames({
      codexHome: tempDir,
      enterpriseOrigin: 'https://enterprise.example'
    })).toEqual([]);
  });
});
