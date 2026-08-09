import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'toml';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCodexIsolatedHome,
  createCodexProbeHome
} from '../../src/codex/probe-home.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Codex Probe 临时 Home', () => {
  it('为知识会话保留隔离 Home 中的 Codex rollout', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-isolated-home-test-'));
    const sourceHome = join(tempDir, 'source');
    const isolatedPath = join(tempDir, 'knowledge', 'codex-home');
    mkdirSync(sourceHome, { recursive: true });
    writeFileSync(join(sourceHome, 'auth.json'), '{"token":"secret"}\n');

    const first = createCodexIsolatedHome(sourceHome, isolatedPath);
    mkdirSync(join(first.path, 'sessions'), { recursive: true });
    writeFileSync(join(first.path, 'sessions', 'rollout.jsonl'), 'turn\n');
    first.cleanup();
    const second = createCodexIsolatedHome(sourceHome, isolatedPath);

    expect(second.path).toBe(isolatedPath);
    expect(readFileSync(join(second.path, 'sessions', 'rollout.jsonl'), 'utf8')).toBe('turn\n');
    second.cleanup();
    expect(existsSync(isolatedPath)).toBe(true);
  });

  it('只保留模型调用所需配置，不复制 Skills、Plugins 或 MCP 凭据', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-probe-home-test-'));
    const sourceHome = join(tempDir, 'source');
    const temporaryRoot = join(tempDir, 'temporary');
    mkdirSync(join(sourceHome, 'model-catalogs'), { recursive: true });
    mkdirSync(join(sourceHome, 'skills', 'example'), { recursive: true });
    mkdirSync(join(sourceHome, 'plugins', 'example'), { recursive: true });
    mkdirSync(temporaryRoot, { recursive: true });
    const sourceCatalog = join(sourceHome, 'model-catalogs', 'custom.json');
    writeFileSync(join(sourceHome, 'config.toml'), [
      'model = "test-model"',
      'model_provider = "custom"',
      `model_catalog_json = ${JSON.stringify(sourceCatalog)}`,
      'openai_base_url = "https://api.example.test/v1"',
      'cli_auth_credentials_store = "file"',
      'forced_login_method = "api"',
      'notify = ["/tmp/slow-notifier"]',
      'check_for_update_on_startup = true',
      '',
      '[model_providers.custom]',
      'name = "Custom Provider"',
      'base_url = "https://provider.example.test/v1"',
      'wire_api = "responses"',
      'requires_openai_auth = true',
      'http_headers = { X_Probe = "enabled" }',
      '',
      '[projects."/tmp/project"]',
      'trust_level = "trusted"',
      '',
      '[mcp_servers.slow]',
      'command = "slow-server"',
      '',
      '[plugins.example]',
      'enabled = true',
      ''
    ].join('\n'));
    writeFileSync(join(sourceHome, 'auth.json'), '{"token":"secret"}\n');
    writeFileSync(sourceCatalog, '{}\n');
    writeFileSync(join(sourceHome, 'model-catalogs', 'unused.json'), '{"unused":true}\n');
    writeFileSync(join(sourceHome, 'skills', 'example', 'SKILL.md'), 'skill\n');
    writeFileSync(join(sourceHome, 'plugins', 'example', 'plugin.json'), '{}\n');
    writeFileSync(join(sourceHome, 'mcp_oauth_credentials.json'), '{"secret":true}\n');

    const probeHome = createCodexProbeHome(sourceHome, temporaryRoot);
    try {
      const config = parse(readFileSync(join(probeHome.path, 'config.toml'), 'utf8'));
      expect(config).toMatchObject({
        model: 'test-model',
        model_provider: 'custom',
        openai_base_url: 'https://api.example.test/v1',
        cli_auth_credentials_store: 'file',
        forced_login_method: 'api',
        model_providers: {
          custom: {
            name: 'Custom Provider',
            base_url: 'https://provider.example.test/v1',
            wire_api: 'responses',
            requires_openai_auth: true,
            http_headers: { X_Probe: 'enabled' }
          }
        }
      });
      expect(config).not.toHaveProperty('projects');
      expect(config).not.toHaveProperty('mcp_servers');
      expect(config).not.toHaveProperty('plugins');
      expect(config).not.toHaveProperty('notify');
      expect(config).not.toHaveProperty('check_for_update_on_startup');
      expect(config.model_catalog_json).toBe(
        join(probeHome.path, 'model-catalogs', 'custom.json')
      );
      expect(readFileSync(join(probeHome.path, 'auth.json'), 'utf8'))
        .toBe('{"token":"secret"}\n');
      expect(existsSync(join(probeHome.path, 'model-catalogs', 'custom.json'))).toBe(true);
      expect(existsSync(join(probeHome.path, 'model-catalogs', 'unused.json'))).toBe(false);
      expect(existsSync(join(probeHome.path, 'skills'))).toBe(false);
      expect(existsSync(join(probeHome.path, 'plugins'))).toBe(false);
      expect(existsSync(join(probeHome.path, 'mcp_oauth_credentials.json'))).toBe(false);
    } finally {
      probeHome.cleanup();
    }

    expect(existsSync(probeHome.path)).toBe(false);
  });

  it('没有 config.toml 时仍创建可用的空 Probe Home', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-probe-home-empty-test-'));
    const sourceHome = join(tempDir, 'source');
    const temporaryRoot = join(tempDir, 'temporary');
    mkdirSync(sourceHome, { recursive: true });
    mkdirSync(temporaryRoot, { recursive: true });
    writeFileSync(join(sourceHome, 'auth.json'), '{"token":"secret"}\n');

    const probeHome = createCodexProbeHome(sourceHome, temporaryRoot);
    try {
      expect(existsSync(join(probeHome.path, 'config.toml'))).toBe(false);
      expect(readFileSync(join(probeHome.path, 'auth.json'), 'utf8'))
        .toBe('{"token":"secret"}\n');
    } finally {
      probeHome.cleanup();
    }
  });

  it('忽略 Codex 已废弃的顶层 profile 选择器和内联 profile', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-probe-home-profile-test-'));
    const sourceHome = join(tempDir, 'source');
    const temporaryRoot = join(tempDir, 'temporary');
    mkdirSync(sourceHome, { recursive: true });
    mkdirSync(temporaryRoot, { recursive: true });
    writeFileSync(join(sourceHome, 'config.toml'), [
      'profile = "work"',
      'model = "base-model"',
      'model_provider = "base"',
      '',
      '[model_providers.base]',
      'name = "Base"',
      'base_url = "https://base.example.test/v1"',
      '',
      '[model_providers.work]',
      'name = "Work"',
      'base_url = "https://work.example.test/v1"',
      '',
      '[profiles.work]',
      'model = "inline-work-model"',
      'model_provider = "work"',
      ''
    ].join('\n'));
    writeFileSync(join(sourceHome, 'work.config.toml'), [
      'model = "work-model"',
      'model_provider = "work"',
      'notify = ["/tmp/profile-notifier"]',
      ''
    ].join('\n'));

    const probeHome = createCodexProbeHome(sourceHome, temporaryRoot);
    try {
      const config = parse(readFileSync(join(probeHome.path, 'config.toml'), 'utf8'));
      expect(config).toMatchObject({
        model: 'base-model',
        model_provider: 'base',
        model_providers: {
          base: {
            name: 'Base',
            base_url: 'https://base.example.test/v1'
          }
        }
      });
      expect(config).not.toHaveProperty('profile');
      expect(config).not.toHaveProperty('profiles');
      expect(config).not.toHaveProperty('notify');
      expect(config.model_providers).not.toHaveProperty('work');
      expect(existsSync(join(probeHome.path, 'work.config.toml'))).toBe(false);
    } finally {
      probeHome.cleanup();
    }
  });
});
