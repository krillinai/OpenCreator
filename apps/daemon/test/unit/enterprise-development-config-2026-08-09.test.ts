import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readEnterpriseClientConfig
} from '../../src/enterprise/client-config-2026-08-06.js';
import {
  createEnterpriseAgentIdentityStore
} from '../../src/enterprise/agent-identity-2026-08-02.js';
import {
  prepareEnterpriseDevelopmentConfig
} from '../../src/enterprise/development-config-2026-08-09.js';

const agentId = 'clawee_550e8400-e29b-41d4-a716-446655440000';
const secondAgentId = 'clawee_123e4567-e89b-42d3-a456-426614174000';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('enterprise development config', () => {
  it('creates an instance config without copying a template agent id', () => {
    const fixture = createFixture(
      `gateway = "https://enterprise.example"\nagent_id = "${agentId}"\n`
    );

    expect(prepareEnterpriseDevelopmentConfig(fixture)).toEqual({
      path: fixture.userPath
    });
    expect(readFileSync(fixture.userPath, 'utf8')).toBe(
      'gateway = "https://enterprise.example"\n'
    );
  });

  it('updates the gateway while preserving the instance agent id', () => {
    const fixture = createFixture(
      'gateway = "https://new-enterprise.example"\n'
    );
    writeFileSync(
      fixture.userPath,
      `gateway = "https://old-enterprise.example"\nagent_id = "${agentId}"\n`
    );

    prepareEnterpriseDevelopmentConfig(fixture);

    expect(readEnterpriseClientConfig(fixture.userPath)).toEqual({
      gateway: 'https://new-enterprise.example',
      agentId
    });
  });

  it('allows separate development instances to persist different agent ids', async () => {
    const fixture = createFixture(
      'gateway = "https://enterprise.example"\n'
    );
    const secondUserPath = join(fixture.root, 'runtime-second', 'config.toml');
    prepareEnterpriseDevelopmentConfig(fixture);
    prepareEnterpriseDevelopmentConfig({
      templatePath: fixture.templatePath,
      userPath: secondUserPath
    });

    const firstStore = createEnterpriseAgentIdentityStore({
      configPath: fixture.userPath,
      generateId: () => agentId
    });
    const secondStore = createEnterpriseAgentIdentityStore({
      configPath: secondUserPath,
      generateId: () => secondAgentId
    });

    await expect(firstStore.getOrCreate()).resolves.toBe(agentId);
    await expect(secondStore.getOrCreate()).resolves.toBe(secondAgentId);
    expect(readEnterpriseClientConfig(fixture.userPath).agentId).toBe(agentId);
    expect(readEnterpriseClientConfig(secondUserPath).agentId).toBe(secondAgentId);
  });
});

function createFixture(template: string) {
  const root = mkdtempSync(join(tmpdir(), 'clawee-enterprise-development-'));
  roots.push(root);
  const templatePath = join(root, 'template.toml');
  const userPath = join(root, 'runtime', 'config.toml');
  mkdirSync(join(root, 'runtime'), { recursive: true });
  writeFileSync(templatePath, template);
  return { root, templatePath, userPath };
}
