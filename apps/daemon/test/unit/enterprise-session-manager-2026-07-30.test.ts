import { describe, expect, it, vi } from 'vitest';
import type {
  EnterpriseCredential,
  EnterpriseCredentialStore
} from '../../src/enterprise/credential-store-2026-07-30.js';
import {
  createEnterpriseSessionManager,
  EnterpriseSessionError
} from '../../src/enterprise/session-manager-2026-07-30.js';
import type {
  EnterpriseHttpClient,
  EnterpriseMeResult
} from '../../src/enterprise/http-client-2026-07-30.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';

const credential: EnterpriseCredential = {
  accessToken: 'enterprise-session-token',
  expiresAt: '2026-07-31T10:00:00Z'
};

describe('enterprise session manager', () => {
  it('starts restore asynchronously and publishes a valid session later', async () => {
    const me = deferred<EnterpriseMeResult>();
    const store = createStore(credential);
    const client = createClient({
      getMe: vi.fn(async () => me.promise)
    });
    const manager = createEnterpriseSessionManager({
      credentialStore: store,
      httpClient: client,
      transportSecurity: 'secure_https'
    });

    manager.startRestore();
    expect(manager.getSnapshot()).toEqual({
      status: 'checking',
      transportSecurity: 'secure_https'
    });

    me.resolve(activeMe());
    await vi.waitFor(() => {
      expect(manager.getSnapshot()).toEqual({
        status: 'signed_in',
        account: {
          email: 'user@example.com',
          name: 'User'
        },
        expiresAt: credential.expiresAt,
        transportSecurity: 'secure_https'
      });
    });
    expect(store.write).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'inactive account',
      me: { ...activeMe(), status: 'disabled' },
      reason: 'account_inactive',
      code: 'ENTERPRISE_ACCOUNT_INACTIVE'
    },
    {
      name: 'frontend forbidden',
      me: { ...activeMe(), frontendAllowed: false },
      reason: 'frontend_forbidden',
      code: 'ENTERPRISE_FRONTEND_FORBIDDEN'
    }
  ])('uses the same validation rule for $name', async ({ me, reason, code }) => {
    const store = createStore();
    const client = createClient({
      getMe: vi.fn(async () => me)
    });
    const manager = createEnterpriseSessionManager({
      credentialStore: store,
      httpClient: client,
      transportSecurity: 'secure_https'
    });

    await expect(manager.login({
      email: 'user@example.com',
      password: 'password-123'
    })).rejects.toMatchObject({ code });
    expect(store.write).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toEqual({
      status: 'signed_out',
      reason,
      transportSecurity: 'secure_https'
    });
  });

  it('deletes expired saved credentials but preserves them on service failure', async () => {
    const expiredStore = createStore(credential);
    const expired = createEnterpriseSessionManager({
      credentialStore: expiredStore,
      httpClient: createClient({
        getMe: vi.fn(async () => {
          throw new EnterpriseHttpError(
            'ENTERPRISE_UNAUTHORIZED',
            'response',
            401
          );
        })
      }),
      transportSecurity: 'secure_https'
    });

    await expect(expired.refresh()).rejects.toMatchObject({
      code: 'ENTERPRISE_SESSION_EXPIRED'
    });
    expect(expiredStore.delete).toHaveBeenCalledOnce();
    expect(expired.getSnapshot()).toEqual({
      status: 'signed_out',
      reason: 'session_expired',
      transportSecurity: 'secure_https'
    });

    const offlineStore = createStore(credential);
    const offline = createEnterpriseSessionManager({
      credentialStore: offlineStore,
      httpClient: createClient({
        getMe: vi.fn(async () => {
          throw new EnterpriseHttpError(
            'ENTERPRISE_SERVICE_UNAVAILABLE',
            'request'
          );
        })
      }),
      transportSecurity: 'secure_https'
    });

    await expect(offline.refresh()).rejects.toMatchObject({
      code: 'ENTERPRISE_SERVICE_UNAVAILABLE'
    });
    expect(offlineStore.delete).not.toHaveBeenCalled();
    expect(offline.getSnapshot()).toEqual({
      status: 'service_unavailable',
      reason: 'service_unavailable',
      expiresAt: credential.expiresAt,
      transportSecurity: 'secure_https'
    });
  });

  it('preserves the token when logout cannot reach the enterprise service', async () => {
    const store = createStore(credential);
    const client = createClient({
      getMe: vi.fn(async () => activeMe()),
      logout: vi.fn(async () => {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'request'
        );
      })
    });
    const manager = createEnterpriseSessionManager({
      credentialStore: store,
      httpClient: client,
      transportSecurity: 'secure_https'
    });
    await manager.refresh();

    await expect(manager.logout()).rejects.toMatchObject({
      code: 'ENTERPRISE_SERVICE_UNAVAILABLE'
    });
    expect(store.delete).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({
      status: 'service_unavailable',
      account: { email: 'user@example.com' }
    });
  });

  it('returns registered-login-required without exposing the password', async () => {
    const password = 'password-that-must-not-escape';
    const manager = createEnterpriseSessionManager({
      credentialStore: createStore(),
      httpClient: createClient({
        login: vi.fn(async () => {
          throw new EnterpriseHttpError(
            'ENTERPRISE_UNAUTHORIZED',
            'response',
            401
          );
        })
      }),
      transportSecurity: 'secure_https'
    });

    let error: unknown;
    try {
      await manager.register({
        email: ' User@Example.com ',
        name: 'User',
        password
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnterpriseSessionError);
    expect(error).toMatchObject({
      code: 'ENTERPRISE_REGISTERED_LOGIN_REQUIRED',
      details: { email: 'user@example.com' },
      statusCode: 409
    });
    expect(String(error)).not.toContain(password);
  });
});

function createStore(
  initial?: EnterpriseCredential
): EnterpriseCredentialStore & {
  read: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  return {
    read: vi.fn(async () => current),
    write: vi.fn(async (next: EnterpriseCredential) => {
      current = next;
    }),
    delete: vi.fn(async () => {
      current = undefined;
    })
  };
}

function createClient(
  overrides: Partial<EnterpriseHttpClient> = {}
): EnterpriseHttpClient {
  return {
    register: vi.fn(async () => undefined),
    login: vi.fn(async () => ({
      account: { email: 'user@example.com', name: 'User' },
      accessToken: credential.accessToken,
      tokenType: 'Bearer' as const,
      expiresAt: credential.expiresAt
    })),
    getMe: vi.fn(async () => activeMe()),
    logout: vi.fn(async () => undefined),
    listSkills: vi.fn(async () => []),
    getSkillDetail: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    downloadSkillPackage: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    ...overrides
  };
}

function activeMe(): EnterpriseMeResult {
  return {
    account: {
      email: 'user@example.com',
      name: 'User'
    },
    status: 'active',
    frontendAllowed: true
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
