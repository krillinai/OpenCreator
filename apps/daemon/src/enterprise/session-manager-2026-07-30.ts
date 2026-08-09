import type {
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  EnterpriseSessionReason,
  EnterpriseSessionResponse,
  EnterpriseTransportSecurity,
  RuntimeErrorCode
} from '@clawee/protocol';
import type {
  EnterpriseCredential,
  EnterpriseCredentialStore
} from './credential-store-2026-07-30.js';
import { EnterpriseCredentialStoreError } from './credential-store-2026-07-30.js';
import type {
  EnterpriseAgentIdentityStore
} from './agent-identity-2026-08-02.js';
import {
  EnterpriseAgentIdentityStoreError
} from './agent-identity-2026-08-02.js';
import type {
  EnterpriseCollectorInstaller
} from './collector-installer-2026-08-06.js';
import {
  EnterpriseCollectorInstallError
} from './collector-installer-2026-08-06.js';
import type {
  EnterpriseHttpClient,
  EnterpriseLoginResult
} from './http-client-2026-07-30.js';
import { EnterpriseHttpError } from './http-client-2026-07-30.js';

export type EnterpriseSessionManager = {
  startRestore(): void;
  getSnapshot(): EnterpriseSessionResponse;
  refresh(): Promise<EnterpriseSessionResponse>;
  login(input: EnterpriseLoginRequest): Promise<EnterpriseSessionResponse>;
  register(input: EnterpriseRegisterRequest): Promise<EnterpriseSessionResponse>;
  logout(): Promise<EnterpriseSessionResponse>;
  requireAccessToken(): Promise<string>;
  invalidateUnauthorized(reason?: 'session_expired'): Promise<void>;
  close(): Promise<void>;
};

export type EnterpriseIdentity = {
  subjectId: string;
  agentId: string;
  accessToken: string;
};

export type EnterpriseIdentityProvider = {
  requireIdentity(): Promise<EnterpriseIdentity>;
};

export class EnterpriseSessionError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>
  ) {
    super(`${code}: enterprise session operation failed`);
    this.name = 'EnterpriseSessionError';
  }
}

export function createEnterpriseSessionManager(input: {
  agentIdentityStore: EnterpriseAgentIdentityStore;
  collectorInstaller?: EnterpriseCollectorInstaller;
  credentialStore: EnterpriseCredentialStore;
  httpClient: EnterpriseHttpClient;
  transportSecurity: EnterpriseTransportSecurity;
  onSignedOut?(): void;
}): EnterpriseSessionManager & EnterpriseIdentityProvider {
  let generation = 0;
  let closed = false;
  let credential: EnterpriseCredential | undefined;
  let accountCache: EnterpriseSessionResponse['account'];
  let snapshot: EnterpriseSessionResponse = checkingSnapshot();

  function checkingSnapshot(): EnterpriseSessionResponse {
    return {
      status: 'checking',
      transportSecurity: input.transportSecurity
    };
  }

  function signedOutSnapshot(
    reason?: EnterpriseSessionReason
  ): EnterpriseSessionResponse {
    return {
      status: 'signed_out',
      ...(reason === undefined ? {} : { reason }),
      transportSecurity: input.transportSecurity
    };
  }

  function publish(
    operationGeneration: number,
    next: EnterpriseSessionResponse
  ): boolean {
    if (closed || operationGeneration !== generation) return false;
    snapshot = next;
    if (next.status === 'signed_out') input.onSignedOut?.();
    return true;
  }

  function beginOperation(): number {
    generation += 1;
    snapshot = checkingSnapshot();
    return generation;
  }

  async function readCredential(
    operationGeneration: number
  ): Promise<EnterpriseCredential | undefined> {
    if (credential !== undefined) return credential;
    try {
      const stored = await input.credentialStore.read();
      if (operationGeneration === generation) credential = stored;
      return stored;
    } catch (error) {
      if (error instanceof EnterpriseCredentialStoreError) {
        publish(
          operationGeneration,
          signedOutSnapshot('secure_storage_unavailable')
        );
        throw new EnterpriseSessionError(
          'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
          503
        );
      }
      publish(operationGeneration, signedOutSnapshot());
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        500
      );
    }
  }

  async function clearCredential(
    operationGeneration: number,
    reason?: EnterpriseSessionReason
  ): Promise<void> {
    try {
      await input.credentialStore.delete();
      if (operationGeneration === generation) {
        credential = undefined;
        accountCache = undefined;
      }
      publish(operationGeneration, signedOutSnapshot(reason));
    } catch (error) {
      if (error instanceof EnterpriseCredentialStoreError) {
        publish(
          operationGeneration,
          signedOutSnapshot('secure_storage_unavailable')
        );
        throw new EnterpriseSessionError(
          'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
          503
        );
      }
      publish(operationGeneration, signedOutSnapshot());
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        500
      );
    }
  }

  async function readAgentId(operationGeneration: number): Promise<string> {
    try {
      return await input.agentIdentityStore.getOrCreate();
    } catch (error) {
      publish(operationGeneration, signedOutSnapshot());
      if (error instanceof EnterpriseAgentIdentityStoreError) {
        throw new EnterpriseSessionError(
          'ENTERPRISE_PROTOCOL_ERROR',
          500
        );
      }
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        500
      );
    }
  }

  async function validateAuthenticatedSession(request: {
    operationGeneration: number;
    credential: EnterpriseCredential;
    expectedAgentId: string;
    persist: boolean;
  }): Promise<EnterpriseSessionResponse> {
    let me;
    try {
      me = await input.httpClient.getMe(request.credential.accessToken);
    } catch (error) {
      if (error instanceof EnterpriseHttpError) {
        if (error.code === 'ENTERPRISE_UNAUTHORIZED') {
          if (request.persist) {
            await revokeQuietly(request.credential.accessToken);
            publish(
              request.operationGeneration,
              signedOutSnapshot('session_expired')
            );
          } else {
            await clearCredential(
              request.operationGeneration,
              'session_expired'
            );
          }
          throw new EnterpriseSessionError(
            request.persist
              ? 'ENTERPRISE_UNAUTHORIZED'
              : 'ENTERPRISE_SESSION_EXPIRED',
            401
          );
        }
        if (error.code === 'ENTERPRISE_SERVICE_UNAVAILABLE') {
          if (request.persist) {
            await revokeQuietly(request.credential.accessToken);
          } else if (request.operationGeneration === generation) {
            credential = request.credential;
          }
          publish(request.operationGeneration, {
            status: 'service_unavailable',
            ...(accountCache === undefined
              ? {}
              : { account: accountCache }),
            expiresAt: request.credential.expiresAt,
            reason: 'service_unavailable',
            transportSecurity: input.transportSecurity
          });
          throw new EnterpriseSessionError(
            'ENTERPRISE_SERVICE_UNAVAILABLE',
            503
          );
        }
        await rejectUnusableCredential(request);
        throw sessionErrorFromHttp(error);
      }
      await rejectUnusableCredential(request);
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        500
      );
    }

    if (me.agentId !== request.expectedAgentId) {
      await rejectUnusableCredential(request);
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        502
      );
    }

    if (me.status !== 'active') {
      if (request.persist) {
        await revokeQuietly(request.credential.accessToken);
        publish(
          request.operationGeneration,
          signedOutSnapshot('account_inactive')
        );
      } else {
        await clearCredential(
          request.operationGeneration,
          'account_inactive'
        );
      }
      throw new EnterpriseSessionError(
        'ENTERPRISE_ACCOUNT_INACTIVE',
        403
      );
    }

    if (!me.frontendAllowed) {
      if (request.persist) {
        await revokeQuietly(request.credential.accessToken);
        publish(
          request.operationGeneration,
          signedOutSnapshot('frontend_forbidden')
        );
      } else {
        await clearCredential(
          request.operationGeneration,
          'frontend_forbidden'
        );
      }
      throw new EnterpriseSessionError(
        'ENTERPRISE_FRONTEND_FORBIDDEN',
        403
      );
    }

    if (request.persist) {
      try {
        await input.credentialStore.write(request.credential);
      } catch (error) {
        await revokeQuietly(request.credential.accessToken);
        if (error instanceof EnterpriseCredentialStoreError) {
          publish(
            request.operationGeneration,
            signedOutSnapshot('secure_storage_unavailable')
          );
          throw new EnterpriseSessionError(
            'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
            503
          );
        }
        publish(request.operationGeneration, signedOutSnapshot());
        throw new EnterpriseSessionError(
          'ENTERPRISE_PROTOCOL_ERROR',
          500
        );
      }
    }

    if (request.operationGeneration === generation) {
      credential = request.credential;
      accountCache = me.account;
    }
    const shouldInstallCollector =
      input.collectorInstaller !== undefined
      && me.collectorRegistration !== undefined;
    const next: EnterpriseSessionResponse = {
      status: 'signed_in',
      account: me.account,
      ...(shouldInstallCollector
        ? { collector: { status: 'installing' as const } }
        : {}),
      expiresAt: request.credential.expiresAt,
      transportSecurity: input.transportSecurity
    };
    publish(request.operationGeneration, next);
    if (shouldInstallCollector) {
      void input.collectorInstaller!
        .install(me.collectorRegistration!)
        .then(() => {
          publishCollectorState(request.operationGeneration, {
            status: 'installed'
          });
        })
        .catch(error => {
          const errorCode = error instanceof EnterpriseCollectorInstallError
            ? error.code
            : 'COLLECTOR_INSTALL_FAILED';
          publishCollectorState(request.operationGeneration, {
            status: 'failed',
            errorCode
          });
          console.warn(`Enterprise collector installation failed [${errorCode}]`);
        });
    }
    return next;
  }

  function publishCollectorState(
    operationGeneration: number,
    collector: NonNullable<EnterpriseSessionResponse['collector']>
  ): void {
    if (
      closed
      || operationGeneration !== generation
      || snapshot.status !== 'signed_in'
    ) {
      return;
    }
    snapshot = {
      ...snapshot,
      collector
    };
  }

  async function authenticateNew(
    operationGeneration: number,
    request: EnterpriseLoginRequest,
    agentId: string
  ): Promise<EnterpriseSessionResponse> {
    let login: EnterpriseLoginResult;
    try {
      login = await input.httpClient.login(request, agentId);
    } catch (error) {
      publish(operationGeneration, signedOutSnapshot());
      if (error instanceof EnterpriseHttpError) {
        throw sessionErrorFromHttp(error);
      }
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        500
      );
    }
    if (login.agentId !== agentId) {
      await revokeQuietly(login.accessToken);
      publish(operationGeneration, signedOutSnapshot());
      throw new EnterpriseSessionError(
        'ENTERPRISE_PROTOCOL_ERROR',
        502
      );
    }
    return validateAuthenticatedSession({
      operationGeneration,
      credential: {
        accessToken: login.accessToken,
        expiresAt: login.expiresAt
      },
      expectedAgentId: agentId,
      persist: true
    });
  }

  async function refreshForGeneration(
    operationGeneration: number
  ): Promise<EnterpriseSessionResponse> {
    const stored = await readCredential(operationGeneration);
    if (stored === undefined) {
      const next = signedOutSnapshot();
      publish(operationGeneration, next);
      return next;
    }
    const agentId = await readAgentId(operationGeneration);
    return validateAuthenticatedSession({
      operationGeneration,
      credential: stored,
      expectedAgentId: agentId,
      persist: false
    });
  }

  async function rejectUnusableCredential(request: {
    operationGeneration: number;
    credential: EnterpriseCredential;
    persist: boolean;
  }): Promise<void> {
    if (request.persist) {
      await revokeQuietly(request.credential.accessToken);
      publish(request.operationGeneration, signedOutSnapshot());
      return;
    }
    await clearCredential(request.operationGeneration);
  }

  async function revokeQuietly(accessToken: string): Promise<void> {
    try {
      await input.httpClient.logout(accessToken);
    } catch {
      console.warn('Enterprise session revocation failed after authentication rejection');
    }
  }

  return {
    startRestore() {
      const operationGeneration = beginOperation();
      void refreshForGeneration(operationGeneration).catch(error => {
        if (snapshot.status === 'checking') {
          publish(operationGeneration, signedOutSnapshot());
        }
        console.warn(
          `Enterprise session restore failed [${sessionErrorCode(error)}]`
        );
      });
    },

    getSnapshot() {
      return snapshot;
    },

    async refresh() {
      return refreshForGeneration(beginOperation());
    },

    async login(request) {
      const operationGeneration = beginOperation();
      const agentId = await readAgentId(operationGeneration);
      return authenticateNew(operationGeneration, request, agentId);
    },

    async register(request) {
      const operationGeneration = beginOperation();
      const agentId = await readAgentId(operationGeneration);
      try {
        await input.httpClient.register(request, agentId);
      } catch (error) {
        publish(operationGeneration, signedOutSnapshot());
        if (error instanceof EnterpriseHttpError) {
          throw sessionErrorFromHttp(error);
        }
        throw new EnterpriseSessionError(
          'ENTERPRISE_PROTOCOL_ERROR',
          500
        );
      }
      try {
        return await authenticateNew(
          operationGeneration,
          {
            email: request.email,
            password: request.password
          },
          agentId
        );
      } catch {
        const email = request.email.trim().toLowerCase();
        throw new EnterpriseSessionError(
          'ENTERPRISE_REGISTERED_LOGIN_REQUIRED',
          409,
          { email }
        );
      }
    },

    async logout() {
      const operationGeneration = beginOperation();
      const stored = await readCredential(operationGeneration);
      if (stored === undefined) {
        const next = signedOutSnapshot();
        publish(operationGeneration, next);
        return next;
      }

      try {
        await input.httpClient.logout(stored.accessToken);
      } catch (error) {
        if (
          error instanceof EnterpriseHttpError &&
          error.code === 'ENTERPRISE_UNAUTHORIZED'
        ) {
          await clearCredential(operationGeneration, 'session_expired');
          return snapshot;
        }
        if (
          error instanceof EnterpriseHttpError &&
          error.code === 'ENTERPRISE_SERVICE_UNAVAILABLE'
        ) {
          if (operationGeneration === generation) credential = stored;
          publish(operationGeneration, {
            status: 'service_unavailable',
            ...(accountCache === undefined
              ? {}
              : { account: accountCache }),
            expiresAt: stored.expiresAt,
            reason: 'service_unavailable',
            transportSecurity: input.transportSecurity
          });
          throw new EnterpriseSessionError(
            'ENTERPRISE_SERVICE_UNAVAILABLE',
            503
          );
        }
        if (operationGeneration === generation) credential = stored;
        publish(operationGeneration, {
          status: 'service_unavailable',
          ...(accountCache === undefined
            ? {}
            : { account: accountCache }),
          expiresAt: stored.expiresAt,
          reason: 'service_unavailable',
          transportSecurity: input.transportSecurity
        });
        if (error instanceof EnterpriseHttpError) {
          throw sessionErrorFromHttp(error);
        }
        throw new EnterpriseSessionError(
          'ENTERPRISE_PROTOCOL_ERROR',
          500
        );
      }

      await clearCredential(operationGeneration, 'session_expired');
      const next = signedOutSnapshot();
      publish(operationGeneration, next);
      return next;
    },

    async requireAccessToken() {
      const operationGeneration = generation;
      const stored = await readCredential(operationGeneration);
      if (stored === undefined || snapshot.status === 'signed_out') {
        throw new EnterpriseSessionError('ENTERPRISE_UNAUTHORIZED', 401);
      }
      return stored.accessToken;
    },

    async requireIdentity() {
      const operationGeneration = beginOperation();
      const stored = await readCredential(operationGeneration);
      if (stored === undefined) {
        publish(operationGeneration, signedOutSnapshot());
        throw new EnterpriseSessionError('ENTERPRISE_UNAUTHORIZED', 401);
      }
      const agentId = await readAgentId(operationGeneration);
      const verified = await validateAuthenticatedSession({
        operationGeneration,
        credential: stored,
        expectedAgentId: agentId,
        persist: false
      });
      if (operationGeneration !== generation) {
        throw new EnterpriseSessionError('ENTERPRISE_UNAUTHORIZED', 401);
      }
      if (verified.status !== 'signed_in' || verified.account === undefined) {
        throw new EnterpriseSessionError('ENTERPRISE_UNAUTHORIZED', 401);
      }
      return {
        subjectId: verified.account.subjectId,
        agentId,
        accessToken: stored.accessToken
      };
    },

    async invalidateUnauthorized(reason = 'session_expired') {
      await clearCredential(beginOperation(), reason);
    },

    async close() {
      closed = true;
      generation += 1;
      credential = undefined;
      accountCache = undefined;
      await input.collectorInstaller?.close();
    }
  };
}

function sessionErrorFromHttp(error: EnterpriseHttpError): EnterpriseSessionError {
  switch (error.code) {
    case 'ENTERPRISE_INVALID_REQUEST':
      return new EnterpriseSessionError(error.code, 400);
    case 'ENTERPRISE_UNAUTHORIZED':
      return new EnterpriseSessionError(error.code, 401);
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return new EnterpriseSessionError(error.code, 503);
    default:
      return new EnterpriseSessionError(error.code, error.statusCode ?? 500);
  }
}

function sessionErrorCode(error: unknown): string {
  if (
    error instanceof EnterpriseSessionError
    || error instanceof EnterpriseHttpError
  ) {
    return error.code;
  }
  return 'ENTERPRISE_PROTOCOL_ERROR';
}
