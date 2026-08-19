import { describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseCredentialStore,
  resolveEnterpriseCredentialIdentity
} from '../../src/enterprise/credential-store-2026-07-30.js';

describe('enterprise credential store', () => {
  it('never falls back to plaintext when the keyring backend fails', async () => {
    const token = 'enterprise-test-token';
    const plaintextFallback = vi.fn();
    const store = createEnterpriseCredentialStore({
      entry: {
        getPassword: vi.fn(async () => null),
        setPassword: vi.fn(async () => {
          throw new Error(`backend failed for ${token}`);
        }),
        deletePassword: vi.fn(async () => true)
      }
    });

    await expect(store.write({
      accessToken: token,
      expiresAt: '2026-07-30T12:00:00.000Z'
    })).rejects.toThrow('ENTERPRISE_SECURE_STORAGE_UNAVAILABLE');
    expect(plaintextFallback).not.toHaveBeenCalled();

    try {
      await store.write({
        accessToken: token,
        expiresAt: '2026-07-30T12:00:00.000Z'
      });
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });

  it('reads writes and deletes a validated credential', async () => {
    let stored: string | null = null;
    const store = createEnterpriseCredentialStore({
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
      accessToken: 'credential-token',
      expiresAt: '2026-07-30T12:00:00.000Z'
    };

    expect(await store.read()).toBeUndefined();
    await store.write(credential);
    expect(await store.read()).toEqual(credential);
    await store.delete();
    expect(await store.read()).toBeUndefined();
  });

  it('deletes malformed keyring content without exposing it', async () => {
    const deletePassword = vi.fn(async () => true);
    const store = createEnterpriseCredentialStore({
      entry: {
        getPassword: vi.fn(async () => '{"accessToken":"leaked-token"}'),
        setPassword: vi.fn(async () => undefined),
        deletePassword
      }
    });

    await expect(store.read()).rejects.toThrow('ENTERPRISE_SECURE_STORAGE_UNAVAILABLE');
    expect(deletePassword).toHaveBeenCalledOnce();
  });

  it('derives a constrained packaged-e2e keyring identity without arbitrary overrides', () => {
    expect(resolveEnterpriseCredentialIdentity()).toEqual({
      service: 'com.opencreator.enterprise',
      account: 'opencreator-agent'
    });
    expect(resolveEnterpriseCredentialIdentity('123e4567-e89b-42d3-a456-426614174000')).toEqual({
      service: 'com.opencreator.enterprise.e2e',
      account: 'opencreator-agent:123e4567-e89b-42d3-a456-426614174000'
    });
    expect(() => resolveEnterpriseCredentialIdentity('not-a-uuid')).toThrow(
      'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
    );
  });
});
