import { describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseMcpTokenStore,
  resolveEnterpriseMcpTokenIdentity
} from '../../src/enterprise/mcp-token-store-2026-08-07.js';

describe('enterprise MCP token store', () => {
  it('stores only validated MCP credentials in the dedicated keyring entry', async () => {
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

  it('uses a keyring namespace separate from the enterprise app session', () => {
    expect(resolveEnterpriseMcpTokenIdentity()).toEqual({
      service: 'com.opencreator.enterprise.mcp',
      account: 'opencreator-agent-mcp'
    });
    expect(resolveEnterpriseMcpTokenIdentity(
      '123e4567-e89b-42d3-a456-426614174000'
    )).toEqual({
      service: 'com.opencreator.enterprise.mcp.e2e',
      account: 'opencreator-agent-mcp:123e4567-e89b-42d3-a456-426614174000'
    });
  });
});
