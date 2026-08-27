import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseMcpTokenStore,
  createFileEnterpriseMcpTokenStore
} from '../../src/enterprise/mcp-token-store-2026-08-07.js';

describe('enterprise MCP token store', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('stores only validated MCP credentials', async () => {
    let stored: string | null = null;
    const store = createEnterpriseMcpTokenStore({
      entry: {
        getPassword: vi.fn(async () => stored),
        setPassword: vi.fn(async value => {
          stored = value;
        }),
        deletePassword: vi.fn(async () => {
          stored = null;
          return true;
        })
      }
    });
    const credential = {
      tokenId: 'token_1',
      agentId: 'opencreator_550e8400-e29b-41d4-a716-446655440000',
      token: 'agent-mcp-secret',
      tokenType: 'Bearer' as const,
      fingerprint: 'fingerprint-1',
      expiresAt: null,
      scopes: ['mcp:call'],
      createdAt: '2026-08-07T00:00:00Z'
    };

    expect(await store.read()).toBeUndefined();
    await store.write(credential);
    expect(await store.read()).toEqual(credential);
    await store.delete();
    expect(await store.read()).toBeUndefined();
  });

  it('rejects malformed credentials without leaking the token in errors', async () => {
    const store = createEnterpriseMcpTokenStore({
      entry: {
        getPassword: vi.fn(async () => null),
        setPassword: vi.fn(async () => undefined),
        deletePassword: vi.fn(async () => true)
      }
    });
    const secret = 'must-not-appear';

    await expect(store.write({
      tokenId: 'token_1',
      agentId: 'agent_1',
      token: secret,
      tokenType: 'Bearer',
      fingerprint: 'fingerprint-1',
      expiresAt: null,
      scopes: ['wrong:scope'],
      createdAt: '2026-08-07T00:00:00Z'
    })).rejects.not.toThrow(secret);
  });

  it('persists the enterprise MCP token in a local JSON file', async () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-enterprise-mcp-'));
    const path = join(root, 'config', 'enterprise-mcp-token.json');
    const store = createFileEnterpriseMcpTokenStore({ path });
    const credential = {
      tokenId: 'token_file',
      agentId: 'opencreator_550e8400-e29b-41d4-a716-446655440000',
      token: 'file-mcp-token',
      tokenType: 'Bearer' as const,
      fingerprint: 'file-fingerprint',
      expiresAt: null,
      scopes: ['mcp:call'],
      createdAt: '2026-08-26T12:00:00Z'
    };

    await store.write(credential);

    await expect(store.read()).resolves.toEqual(credential);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(credential);
  });
});
