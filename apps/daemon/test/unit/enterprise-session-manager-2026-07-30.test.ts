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
  EnterpriseAgentIdentityStore
} from '../../src/enterprise/agent-identity-2026-08-02.js';
import type {
  EnterpriseHttpClient,
  EnterpriseMeResult
} from '../../src/enterprise/http-client-2026-07-30.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';

const credential: EnterpriseCredential = {
  accessToken: 'enterprise-session-token',
  expiresAt: '2026-07-31T10:00:00Z'
};
const agentId = 'clawee_550e8400-e29b-41d4-a716-446655440000';

describe('enterprise session manager', () => {
  it('starts restore asynchronously and publishes a valid session later', async () => {
    const me = deferred<EnterpriseMeResult>();
    const store = createStore(credential);
    const client = createClient({
      getMe: vi.fn(async () => me.promise)
    });
    const manager = createEnterpriseSessionManager({
      agentIdentityStore: createAgentIdentityStore(),
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
      agentIdentityStore: createAgentIdentityStore(),
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
      agentIdentityStore: createAgentIdentityStore(),
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
      agentIdentityStore: createAgentIdentityStore(),
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
      agentIdentityStore: createAgentIdentityStore(),
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
      agentIdentityStore: createAgentIdentityStore(),
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

  it('settles asynchronous restore after a protocol failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createStore(credential);
    const protocolClient = createClient({
      getMe: vi.fn(async () => {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          200
        );
      })
    });
    const restoring = createEnterpriseSessionManager({
      agentIdentityStore: createAgentIdentityStore(),
      credentialStore: store,
      httpClient: protocolClient,
      transportSecurity: 'secure_https'
    });

    restoring.startRestore();
    await vi.waitFor(() => {
      expect(restoring.getSnapshot()).toEqual({
        status: 'signed_out',
        transportSecurity: 'secure_https'
      });
    });
    expect(store.delete).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Enterprise session restore failed [ENTERPRISE_PROTOCOL_ERROR]'
    );
    warn.mockRestore();
  });

  it('sends one stable agent id through login and validation', async () => {
    const login = vi.fn(async () => ({
      account: { email: 'user@example.com', name: 'User' },
      agentId,
      accessToken: credential.accessToken,
      tokenType: 'Bearer' as const,
      expiresAt: credential.expiresAt
    }));
    const getMe = vi.fn(async () => activeMe());
    const loggingIn = createEnterpriseSessionManager({
      agentIdentityStore: createAgentIdentityStore(),
      credentialStore: createStore(),
      httpClient: createClient({ getMe, login }),
      transportSecurity: 'secure_https'
    });
    const request = {
      email: 'user@example.com',
      password: 'password-123'
    };

    await expect(loggingIn.login(request)).resolves.toMatchObject({
      status: 'signed_in'
    });
    expect(login).toHaveBeenCalledWith(request, agentId);
    expect(getMe).toHaveBeenCalledWith(credential.accessToken);
  });

  it('rejects mismatched agent identities without persisting a session', async () => {
    const store = createStore();
    const logout = vi.fn(async () => undefined);
    const manager = createEnterpriseSessionManager({
      agentIdentityStore: createAgentIdentityStore(),
      credentialStore: store,
      httpClient: createClient({
        login: vi.fn(async () => ({
          account: { email: 'user@example.com', name: 'User' },
          agentId: 'clawee_123e4567-e89b-42d3-a456-426614174000',
          accessToken: credential.accessToken,
          tokenType: 'Bearer' as const,
          expiresAt: credential.expiresAt
        })),
        logout
      }),
      transportSecurity: 'secure_https'
    });

    await expect(manager.login({
      email: 'user@example.com',
      password: 'password-123'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_PROTOCOL_ERROR',
      statusCode: 502
    });
    expect(logout).toHaveBeenCalledWith(credential.accessToken);
    expect(store.write).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toEqual({
      status: 'signed_out',
      transportSecurity: 'secure_https'
    });
  });

  it('settles registration when the remote request fails', async () => {
    const manager = createEnterpriseSessionManager({
      agentIdentityStore: createAgentIdentityStore(),
      credentialStore: createStore(),
      httpClient: createClient({
        register: vi.fn(async () => {
          throw new EnterpriseHttpError(
            'ENTERPRISE_AGENT_ID_CONFLICT',
            'response',
            409,
            'agent_id_conflict'
          );
        })
      }),
      transportSecurity: 'secure_https'
    });

    await expect(manager.register({
      email: 'user@example.com',
      name: 'User',
      password: 'password-123'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_AGENT_ID_CONFLICT',
      statusCode: 409
    });
    expect(manager.getSnapshot()).toEqual({
      status: 'signed_out',
      transportSecurity: 'secure_https'
    });
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
      agentId,
      accessToken: credential.accessToken,
      tokenType: 'Bearer' as const,
      expiresAt: credential.expiresAt
    })),
    getMe: vi.fn(async () => activeMe()),
    logout: vi.fn(async () => undefined),
    listKnowledgeBases: vi.fn(async () => ({
      knowledgeBases: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    listKnowledgeDocuments: vi.fn(async () => ({
      documents: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    uploadKnowledgeDocument: vi.fn(async () => {
      throw new Error('not implemented');
    }),
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
    agentId,
    status: 'active',
    frontendAllowed: true
  };
}

function createAgentIdentityStore(): EnterpriseAgentIdentityStore {
  return {
    getOrCreate: vi.fn(async () => agentId)
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
