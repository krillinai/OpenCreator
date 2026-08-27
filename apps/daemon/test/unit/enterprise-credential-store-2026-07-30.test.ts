import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseCredentialStore,
  createFileEnterpriseCredentialStore
} from '../../src/enterprise/credential-store-2026-07-30.js';

describe('enterprise credential store', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('does not leak credentials when the persistence backend fails', async () => {
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
    })).rejects.toThrow('ENTERPRISE_CONFIG_FILE_UNAVAILABLE');
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

  it('persists the enterprise session in a local JSON file', async () => {
    root = mkdtempSync(join(tmpdir(), 'opencreator-enterprise-session-'));
    const path = join(root, 'config', 'enterprise-session.json');
    const store = createFileEnterpriseCredentialStore({ path });
    const credential = {
      accessToken: 'file-token',
      expiresAt: '2026-08-26T12:00:00.000Z'
    };

    await store.write(credential);

    await expect(store.read()).resolves.toEqual(credential);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(credential);
  });

  it('deletes malformed persisted content without exposing it', async () => {
    const deletePassword = vi.fn(async () => true);
    const store = createEnterpriseCredentialStore({
      entry: {
        getPassword: vi.fn(async () => '{"accessToken":"leaked-token"}'),
        setPassword: vi.fn(async () => undefined),
        deletePassword
      }
    });

    await expect(store.read()).rejects.toThrow('ENTERPRISE_CONFIG_FILE_UNAVAILABLE');
    expect(deletePassword).toHaveBeenCalledOnce();
  });
});
