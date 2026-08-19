import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
const firstAgentId = 'opencreator_550e8400-e29b-41d4-a716-446655440000';

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
      collectorConfigPath: join(dataDir, 'missing-collector.toml'),
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
      collectorConfigPath: join(dataDir, 'missing-collector.toml'),
      generateId: vi.fn(() => 'opencreator_123e4567-e89b-42d3-a456-426614174000')
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
      collectorConfigPath: join(dataDir, 'missing-collector.toml'),
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
      () => 'opencreator_123e4567-e89b-42d3-a456-426614174000'
    );
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      legacyDataDir: dataDir,
      collectorConfigPath: join(dataDir, 'missing-collector.toml'),
      generateId
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(generateId).not.toHaveBeenCalled();
    expect(readEnterpriseClientConfig(configPath).agentId).toBe(firstAgentId);
  });

  it('inherits the collector agent id when opencreator-agent has none', async () => {
    const dataDir = createTempDirectory();
    const configPath = writeConfig(dataDir);
    const collectorConfigPath = join(dataDir, 'collector', 'config.toml');
    mkdirSync(join(dataDir, 'collector'));
    writeFileSync(
      collectorConfigPath,
      `office_url = "https://enterprise.example"\nagent_id = "${firstAgentId}"\n`
    );
    const generateId = vi.fn(() =>
      'opencreator_123e4567-e89b-42d3-a456-426614174000'
    );
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      collectorConfigPath,
      generateId
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(generateId).not.toHaveBeenCalled();
    expect(readEnterpriseClientConfig(configPath).agentId).toBe(firstAgentId);
  });

  it('keeps the opencreator-agent id authoritative over collector config', async () => {
    const dataDir = createTempDirectory();
    const configPath = join(dataDir, 'config.toml');
    writeFileSync(
      configPath,
      `gateway = "https://enterprise.example"\nagent_id = "${firstAgentId}"\n`
    );
    const collectorConfigPath = join(dataDir, 'collector', 'config.toml');
    mkdirSync(join(dataDir, 'collector'));
    writeFileSync(
      collectorConfigPath,
      'office_url = "https://enterprise.example"\nagent_id = "opencreator_123e4567-e89b-42d3-a456-426614174000"\n'
    );
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      collectorConfigPath
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(readFileSync(collectorConfigPath, 'utf8')).toContain(firstAgentId);
  });

  it('keeps identities independent when collector uses another origin', async () => {
    const dataDir = createTempDirectory();
    const configPath = join(dataDir, 'config.toml');
    writeFileSync(
      configPath,
      `gateway = "https://public.enterprise.example"\nagent_id = "${firstAgentId}"\n`
    );
    const collectorConfigPath = join(dataDir, 'collector.toml');
    const collectorContents =
      'office_url = "https://private.enterprise.example"\n'
      + 'agent_id = "opencreator_123e4567-e89b-42d3-a456-426614174000"\n';
    writeFileSync(collectorConfigPath, collectorContents);
    const onDiagnostic = vi.fn();
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      collectorConfigPath,
      onDiagnostic
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(readFileSync(collectorConfigPath, 'utf8')).toBe(collectorContents);
    expect(onDiagnostic).toHaveBeenCalledWith({
      type: 'enterprise_collector_identity_sync_skipped',
      reason: 'different_origin',
      opencreatorOrigin: 'https://public.enterprise.example',
      collectorOrigin: 'https://private.enterprise.example'
    });
  });

  it('generates an independent identity instead of inheriting from another origin', async () => {
    const dataDir = createTempDirectory();
    const configPath = join(dataDir, 'config.toml');
    writeFileSync(configPath, 'gateway = "https://public.enterprise.example"\n');
    const collectorConfigPath = join(dataDir, 'collector.toml');
    const collectorContents =
      'office_url = "https://private.enterprise.example"\n'
      + `agent_id = "${firstAgentId}"\n`;
    writeFileSync(collectorConfigPath, collectorContents);
    const generatedAgentId = 'opencreator_123e4567-e89b-42d3-a456-426614174000';
    const generateId = vi.fn(() => generatedAgentId);
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      collectorConfigPath,
      generateId,
      onDiagnostic: vi.fn()
    });

    await expect(store.getOrCreate()).resolves.toBe(generatedAgentId);
    expect(generateId).toHaveBeenCalledOnce();
    expect(readEnterpriseClientConfig(configPath).agentId).toBe(generatedAgentId);
    expect(readFileSync(collectorConfigPath, 'utf8')).toBe(collectorContents);
  });

  it('ignores a malformed collector identity from another origin', async () => {
    const dataDir = createTempDirectory();
    const configPath = writeConfig(dataDir);
    const collectorConfigPath = join(dataDir, 'collector.toml');
    const collectorContents =
      'office_url = "https://private.enterprise.example"\n'
      + 'agent_id = "invalid-agent-id"\n';
    writeFileSync(collectorConfigPath, collectorContents);
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      collectorConfigPath,
      generateId: () => firstAgentId,
      onDiagnostic: vi.fn()
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(readFileSync(collectorConfigPath, 'utf8')).toBe(collectorContents);
  });

  it('ignores an invalid collector config on the same origin', async () => {
    const dataDir = createTempDirectory();
    const configPath = writeConfig(dataDir);
    const collectorConfigPath = join(dataDir, 'collector.toml');
    writeFileSync(collectorConfigPath, 'not valid toml = [');
    const onDiagnostic = vi.fn();
    const store = createEnterpriseAgentIdentityStore({
      configPath,
      collectorConfigPath,
      generateId: () => firstAgentId,
      onDiagnostic
    });

    await expect(store.getOrCreate()).resolves.toBe(firstAgentId);
    expect(onDiagnostic).toHaveBeenCalledWith({
      type: 'enterprise_collector_identity_sync_skipped',
      reason: 'invalid_config',
      opencreatorOrigin: 'https://enterprise.example'
    });
  });
});

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'opencreator-enterprise-agent-'));
  createdDirectories.push(directory);
  return directory;
}

function writeConfig(dataDir: string): string {
  const configPath = join(dataDir, 'config.toml');
  writeFileSync(configPath, 'gateway = "https://enterprise.example"\n');
  return configPath;
}
