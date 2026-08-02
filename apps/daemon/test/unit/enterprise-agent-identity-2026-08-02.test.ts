import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseAgentIdentityStore,
  EnterpriseAgentIdentityStoreError
} from '../../src/enterprise/agent-identity-2026-08-02.js';

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
    const generateId = vi.fn(() => firstAgentId);
    const store = createEnterpriseAgentIdentityStore({ dataDir, generateId });

    await expect(Promise.all([
      store.getOrCreate(),
      store.getOrCreate()
    ])).resolves.toEqual([firstAgentId, firstAgentId]);

    expect(generateId).toHaveBeenCalledOnce();
    expect(JSON.parse(
      readFileSync(join(dataDir, 'enterprise-agent.json'), 'utf8')
    )).toEqual({
      version: 1,
      agentId: firstAgentId
    });

    const restored = createEnterpriseAgentIdentityStore({
      dataDir,
      generateId: vi.fn(() => 'clawee_123e4567-e89b-42d3-a456-426614174000')
    });
    await expect(restored.getOrCreate()).resolves.toBe(firstAgentId);
  });

  it('rejects malformed persisted identity without rotating it', async () => {
    const dataDir = createTempDirectory();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(dataDir, 'enterprise-agent.json'),
      JSON.stringify({ version: 1, agentId: 'invalid-agent-id' })
    );
    const generateId = vi.fn(() => firstAgentId);
    const store = createEnterpriseAgentIdentityStore({ dataDir, generateId });

    await expect(store.getOrCreate()).rejects.toBeInstanceOf(
      EnterpriseAgentIdentityStoreError
    );
    expect(generateId).not.toHaveBeenCalled();
  });
});

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'clawee-enterprise-agent-'));
  createdDirectories.push(directory);
  return directory;
}
