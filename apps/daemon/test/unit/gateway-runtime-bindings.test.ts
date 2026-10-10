import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as bindings from '../../src/gateway/runtime-bindings.js';
import type { GatewayRuntimeBindingsInput } from '../../src/gateway/runtime-bindings.js';
import { createCodexAppServerHost } from '../../src/codex/app-server-host-2026-07-28.js';
import { runCodexExec } from '../../src/codex/runner.js';
import { spawnCodexProcess } from '../../src/codex/process.js';

vi.mock('../../src/codex/process.js', () => ({
  spawnCodexProcess: vi.fn(() => { throw new Error('test spawn stopped'); }),
  terminateCodexProcess: vi.fn()
}));

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function setup(overrides: Partial<GatewayRuntimeBindingsInput> = {}) {
  expect(bindings).toHaveProperty('createGatewayRuntimeBindings', expect.any(Function));
  const root = mkdtempSync(join(tmpdir(), 'oc-gateway-runtime-'));
  roots.push(root);
  return bindings.createGatewayRuntimeBindings({
    codexHome: join(root, 'official'),
    baseUrl: 'https://gateway.example/v1',
    model: 'gateway-text',
    readCredentials: async () => ({ accountId: 'account-a', modelKey: 'test-cloud-secret', keyVersion: '1' }),
    closeRuntime: async () => undefined,
    parentEnvironment: {
      PATH: process.env.PATH,
      HOME: '/personal-home',
      OPENAI_API_KEY: 'test-personal-secret',
      OPENAI_BASE_URL: 'https://personal.example',
      ANTHROPIC_API_KEY: 'test-other-secret',
      CODEX_HOME: '/personal-codex',
      HTTP_PROXY: 'http://personal-proxy',
      NODE_OPTIONS: '--require /personal-hook.js'
    },
    ...overrides
  });
}

describe('official Runtime bindings', () => {
  it('respects an explicit base environment at both subprocess boundaries', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-parent-secret');
    try {
      const input = {
        codexBin: 'codex', codexHome: '/official-home', cwd: '/work',
        profile: 'default', args: ['exec'], prompt: 'hello',
        baseEnvironment: { PATH: '/test-path' },
        env: { OC_GATEWAY_MODEL_KEY: 'test-cloud-secret' }
      };
      expect(() => createCodexAppServerHost(input)).toThrow('test spawn stopped');
      const expected = {
        PATH: '/test-path', OC_GATEWAY_MODEL_KEY: 'test-cloud-secret', CODEX_HOME: '/official-home'
      };
      const hostEnvironment = vi.mocked(spawnCodexProcess).mock.lastCall?.[2]?.env;
      expect(Object.keys(hostEnvironment ?? {}).sort()).toEqual(Object.keys(expected).sort());
      expect(hostEnvironment).toMatchObject(expected);
      await expect(runCodexExec(input)).rejects.toThrow('test spawn stopped');
      const execEnvironment = vi.mocked(spawnCodexProcess).mock.lastCall?.[2]?.env;
      expect(Object.keys(execEnvironment ?? {}).sort()).toEqual(Object.keys(expected).sort());
      expect(execEnvironment).toMatchObject(expected);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('isolates credentials and never persists the cloud key in Runtime config', async () => {
    const runtime = setup();
    const prepared = await runtime.prepare();
    expect(prepared.env.OC_GATEWAY_MODEL_KEY).toBe('test-cloud-secret');
    expect(prepared.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(prepared.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(prepared.env).not.toHaveProperty('OPENAI_BASE_URL');
    expect(prepared.env).not.toHaveProperty('HTTP_PROXY');
    expect(prepared.env).not.toHaveProperty('NODE_OPTIONS');
    expect(prepared.env.HOME).toBe(prepared.codexHome);
    const config = readFileSync(join(prepared.codexHome, 'config.toml'), 'utf8');
    expect(config).toContain('env_key = "OC_GATEWAY_MODEL_KEY"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('request_max_retries = 0');
    expect(config).toContain('stream_max_retries = 0');
    expect(config).not.toContain('test-cloud-secret');
    expect(config).not.toContain('test-personal-secret');
    expect(existsSync(join(prepared.codexHome, 'auth.json'))).toBe(false);
    if (process.platform !== 'win32') {
      expect(statSync(prepared.codexHome).mode & 0o777).toBe(0o700);
      expect(statSync(join(prepared.codexHome, 'config.toml')).mode & 0o777).toBe(0o600);
    }
    await runtime.close();
    expect(prepared.env).not.toHaveProperty('OC_GATEWAY_MODEL_KEY');
  });

  it('rejects new and delayed preparations after logout begins', async () => {
    let release!: (value: { accountId: string; modelKey: string; keyVersion: string }) => void;
    const runtime = setup({ readCredentials: () => new Promise(resolve => { release = resolve; }) });
    const preparing = runtime.prepare();
    runtime.beginLogout();
    release({ accountId: 'account-a', modelKey: 'late-secret', keyVersion: '1' });
    await expect(preparing).rejects.toThrow('signed out');
    await expect(runtime.prepare()).rejects.toThrow('signed out');
    await runtime.close();
  });

  it('does not report logout complete before credential-holding processes exit', async () => {
    let exited!: () => void;
    const closeRuntime = vi.fn(() => new Promise<void>(resolve => { exited = resolve; }));
    const runtime = setup({ closeRuntime });
    const prepared = await runtime.prepare();
    let completed = false;
    const closing = runtime.close().then(() => { completed = true; });
    await expect(runtime.prepare()).rejects.toThrow('signed out');
    expect(completed).toBe(false);
    expect(prepared.env.OC_GATEWAY_MODEL_KEY).toBe('test-cloud-secret');
    exited();
    await closing;
    await runtime.close();
    expect(completed).toBe(true);
    expect(closeRuntime).toHaveBeenCalledOnce();
    expect(prepared.env).not.toHaveProperty('OC_GATEWAY_MODEL_KEY');
  });

  it('fails closed when credential shutdown fails', async () => {
    const runtime = setup({ closeRuntime: async () => { throw new Error('process did not exit'); } });
    await runtime.prepare();
    await expect(runtime.close()).rejects.toThrow('process did not exit');
    await expect(runtime.prepare()).rejects.toThrow('signed out');
  });
});
