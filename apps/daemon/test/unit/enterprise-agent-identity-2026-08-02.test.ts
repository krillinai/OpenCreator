import {
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseAgentIdentityStore,
  EnterpriseAgentIdentityStoreError
} from '../../src/enterprise/agent-identity-2026-08-02.js';
import {
  readEnterpriseClientConfig
} from '../../src/enterprise/client-config-2026-08-06.js';

const createdDirectories: string[] = [];
const firstAgentId = 'clawee_550e8400-e29b-41d4-a716-446655440000';

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('enterprise agent identity store', () => {
  it('persists one stable agent id before returning it', async () => {
    const dataDir = createTempDirectory();
    const configPath = writeConfig(dataDir);
    const generateId = vi.fn(() => firstAgentId);
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      legacyDataDir: dataDir,
      generateId
    });

    await expect(Promise.all([
      store.getOrCreate(),
      store.getOrCreate()
    ])).resolves.toEqual([firstAgentId, firstAgentId]);

    expect(generateId).toHaveBeenCalledOnce();
    expect(readEnterpriseClientConfig(configPath)).toEqual({
      gateway: 'https://enterprise.example',
      agentId: firstAgentId
    });

    const restored = createEnterpriseAgentIdentityStore({
      configPath,
      legacyDataDir: dataDir,
      generateId: vi.fn(() => 'clawee_123e4567-e89b-42d3-a456-426614174000')
    });
    await expect(restored.getOrCreate()).resolves.toBe(firstAgentId);
  });

  it('rejects malformed persisted identity without rotating it', async () => {
    const dataDir = createTempDirectory();
    const configPath = join(dataDir, 'config.toml');
    writeFileSync(
      configPath,
      'gateway = "https://enterprise.example"\nagent_id = "invalid-agent-id"\n'
    );
    const generateId = vi.fn(() => firstAgentId);
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      legacyDataDir: dataDir,
      generateId
    });

    await expect(store.getOrCreate()).rejects.toBeInstanceOf(
      EnterpriseAgentIdentityStoreError
    );
    expect(generateId).not.toHaveBeenCalled();
  });

  it('migrates the legacy agent identity into config.toml', async () => {
    const dataDir = createTempDirectory();
    const configPath = writeConfig(dataDir);
    writeFileSync(
      join(dataDir, 'enterprise-agent.json'),
      `${JSON.stringify({ version: 1, agentId: firstAgentId }, null, 2)}\n`
    );
    const generateId = vi.fn(
      () => 'clawee_123e4567-e89b-42d3-a456-426614174000'
    );
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      legacyDataDir: dataDir,
      generateId
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(generateId).not.toHaveBeenCalled();
    expect(readEnterpriseClientConfig(configPath).agentId).toBe(firstAgentId);
  });
});

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'clawee-enterprise-agent-'));
  createdDirectories.push(directory);
  return directory;
}

function writeConfig(dataDir: string): string {
  const configPath = join(dataDir, 'config.toml');
  writeFileSync(configPath, 'gateway = "https://enterprise.example"\n');
  return configPath;
}
