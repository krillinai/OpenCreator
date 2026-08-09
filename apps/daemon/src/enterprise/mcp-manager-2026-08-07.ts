import type {
  EnterpriseMcpCatalogResponse,
  EnterpriseMcpPreferenceUpdateRequest,
  EnterpriseMcpTokenStatus,
  RuntimeErrorCode
} from '@clawee/protocol';
import { createHash } from 'node:crypto';
import type { AgentToolRunInjection } from '../agent-tools/run-injection.js';
import type { CodexMcpServerConfig } from '../codex/argv.js';
import type { RuntimeThread } from '../threads/types.js';
import type {
  EnterpriseAgentIdentityStore
} from './agent-identity-2026-08-02.js';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteMcpCatalog
} from './http-client-2026-07-30.js';
import { EnterpriseHttpError } from './http-client-2026-07-30.js';
import type {
  EnterpriseMcpPreferenceRepository
} from './mcp-preferences-2026-08-07.js';
import type {
  EnterpriseMcpTokenCredential,
  EnterpriseMcpTokenStore
} from './mcp-token-store-2026-08-07.js';
import { EnterpriseMcpTokenStoreError } from './mcp-token-store-2026-08-07.js';
import type {
  EnterpriseSessionManager
} from './session-manager-2026-07-30.js';

export const ENTERPRISE_MCP_TOKEN_ENV = 'CLAWEE_ENTERPRISE_MCP_TOKEN';

export type EnterpriseMcpManager = {
  listConnections(): Promise<EnterpriseMcpCatalogResponse>;
  refreshConnections(): Promise<EnterpriseMcpCatalogResponse>;
  updatePreference(
    upstreamId: string,
    update: EnterpriseMcpPreferenceUpdateRequest
  ): Promise<EnterpriseMcpCatalogResponse>;
  prepareRuntime(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api' | 'schedule';
  }): Promise<AgentToolRunInjection | undefined>;
  handleSessionAuthenticated(): void;
  handleSessionSignedOut(): Promise<void>;
};

export class EnterpriseMcpManagerError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly statusCode: number
  ) {
    super(`${code}: enterprise MCP operation failed`);
    this.name = 'EnterpriseMcpManagerError';
  }
}

type CatalogCache = {
  catalog: EnterpriseRemoteMcpCatalog;
  tokenStatus: EnterpriseMcpTokenStatus;
  refreshedAt: string;
};

type TokenRefreshResult = {
  status: EnterpriseMcpTokenStatus;
  runtimeConfigurationChanged: boolean;
};

export function createEnterpriseMcpManager(input: {
  enterpriseOrigin: string;
  agentIdentityStore: EnterpriseAgentIdentityStore;
  sessionManager: EnterpriseSessionManager;
  httpClient: EnterpriseHttpClient;
  tokenStore: EnterpriseMcpTokenStore;
  preferences: EnterpriseMcpPreferenceRepository;
  listRuntimeIsolationServerNames?(): string[];
  onRuntimeConfigurationChanged?(reason: string): void;
  now?: () => Date;
}): EnterpriseMcpManager {
  const now = input.now ?? (() => new Date());
  let cache: CatalogCache | undefined;
  let refreshWork: Promise<CatalogCache> | undefined;
  let sessionSignOutWork: Promise<void> | undefined;

  async function refreshRemote(): Promise<CatalogCache> {
    refreshWork ??= (async () => {
      const accessToken = await input.sessionManager.requireAccessToken();
      const expectedAgentId = await input.agentIdentityStore.getOrCreate();
      const previousCatalog = cache?.catalog;
      try {
        const catalog = await input.httpClient.getMcpCatalog(accessToken);
        assertAgentId(catalog.agentId, expectedAgentId);
        const tokenRefresh = await refreshToken(accessToken, expectedAgentId);
        const next = {
          catalog,
          tokenStatus: tokenRefresh.status,
          refreshedAt: now().toISOString()
        };
        cache = next;
        if (tokenRefresh.runtimeConfigurationChanged) {
          input.onRuntimeConfigurationChanged?.('enterprise_mcp_token_changed');
        } else if (
          previousCatalog !== undefined
          && runtimeCatalogChanged(previousCatalog, catalog)
        ) {
          input.onRuntimeConfigurationChanged?.('enterprise_mcp_catalog_changed');
        }
        return next;
      } catch (error) {
        await handleRemoteFailure(error);
        throw mapManagerError(error);
      }
    })().finally(() => {
      refreshWork = undefined;
    });
    return refreshWork;
  }

  async function refreshToken(
    accessToken: string,
    expectedAgentId: string
  ): Promise<TokenRefreshResult> {
    let previous: EnterpriseMcpTokenCredential | undefined;
    try {
      previous = await input.tokenStore.read();
    } catch (error) {
      throw mapManagerError(error);
    }
    try {
      const token = await input.httpClient.revealAgentMcpToken(accessToken);
      assertAgentId(token.agentId, expectedAgentId);
      await input.tokenStore.write(token);
      return {
        status: 'ready',
        runtimeConfigurationChanged: previous !== undefined && (
          previous.agentId !== token.agentId
          || previous.fingerprint !== token.fingerprint
        )
      };
    } catch (error) {
      if (
        error instanceof EnterpriseHttpError
        && error.code === 'ENTERPRISE_MCP_TOKEN_NOT_FOUND'
      ) {
        if (previous !== undefined) {
          try {
            await deleteToken();
          } catch (deleteError) {
            input.onRuntimeConfigurationChanged?.(
              'enterprise_mcp_token_changed'
            );
            throw deleteError;
          }
        }
        return {
          status: 'missing',
          runtimeConfigurationChanged: previous !== undefined
        };
      }
      throw error;
    }
  }

  async function currentCache(): Promise<CatalogCache> {
    return cache ?? refreshRemote();
  }

  async function responseFrom(current: CatalogCache) {
    const agentId = current.catalog.agentId;
    const preferences = new Map(
      input.preferences
        .list(input.enterpriseOrigin, agentId)
        .map(preference => [preference.upstreamId, preference])
    );
    return {
      agentId,
      tokenStatus: current.tokenStatus,
      upstreams: current.catalog.upstreams.map(upstream => {
        const preference = preferences.get(upstream.upstreamId);
        return {
          ...upstream,
          installed: preference?.installed ?? false,
          enabled: preference?.enabled ?? false
        };
      }),
      refreshedAt: current.refreshedAt
    } satisfies EnterpriseMcpCatalogResponse;
  }

  async function deleteToken(): Promise<void> {
    try {
      await input.tokenStore.delete();
    } catch (error) {
      if (error instanceof EnterpriseMcpTokenStoreError) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
          503
        );
      }
      throw error;
    }
  }

  async function readRuntimeToken(
    agentId: string,
    accessToken: string
  ): Promise<EnterpriseMcpTokenCredential> {
    let token: EnterpriseMcpTokenCredential | undefined;
    try {
      token = await input.tokenStore.read();
    } catch (error) {
      throw mapManagerError(error);
    }
    if (
      token !== undefined
      && token.agentId === agentId
      && !isExpired(token.expiresAt, now())
    ) {
      return token;
    }
    const refresh = await refreshToken(accessToken, agentId);
    if (refresh.runtimeConfigurationChanged) {
      input.onRuntimeConfigurationChanged?.('enterprise_mcp_token_changed');
    }
    if (refresh.status === 'missing') {
      throw new EnterpriseMcpManagerError(
        'ENTERPRISE_MCP_TOKEN_NOT_FOUND',
        404
      );
    }
    try {
      const refreshed = await input.tokenStore.read();
      if (refreshed === undefined || refreshed.agentId !== agentId) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE',
          503
        );
      }
      return refreshed;
    } catch (error) {
      throw mapManagerError(error);
    }
  }

  async function handleRemoteFailure(error: unknown): Promise<void> {
    if (
      !(error instanceof EnterpriseHttpError)
      || error.code !== 'ENTERPRISE_UNAUTHORIZED'
    ) {
      return;
    }
    cache = undefined;
    await input.sessionManager.invalidateUnauthorized().catch(() => undefined);
    await input.tokenStore.delete().catch(() => undefined);
    input.onRuntimeConfigurationChanged?.('enterprise_session_expired');
  }

  return {
    async listConnections() {
      return responseFrom(await currentCache());
    },
    async refreshConnections() {
      return responseFrom(await refreshRemote());
    },
    async updatePreference(upstreamId, update) {
      const current = await currentCache();
      if (
        !current.catalog.upstreams.some(
          upstream => upstream.upstreamId === upstreamId
        )
      ) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_MCP_UPSTREAM_NOT_FOUND',
          404
        );
      }
      const previous = input.preferences.get(
        input.enterpriseOrigin,
        current.catalog.agentId,
        upstreamId
      );
      const previousInstalled = previous?.installed ?? false;
      const previousEnabled = previous?.enabled ?? false;
      if (update.enabled === true && !previousInstalled) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_INVALID_REQUEST',
          400
        );
      }
      const installed = update.installed ?? previousInstalled;
      const enabled = update.enabled ?? previousEnabled;
      const normalizedEnabled = installed ? enabled : false;
      if (
        previousInstalled !== installed
        || previousEnabled !== normalizedEnabled
      ) {
        input.preferences.upsert({
          enterpriseOrigin: input.enterpriseOrigin,
          agentId: current.catalog.agentId,
          upstreamId,
          installed,
          enabled: normalizedEnabled
        });
        input.onRuntimeConfigurationChanged?.('enterprise_mcp_preference_changed');
      }
      return responseFrom(current);
    },
    async prepareRuntime(run) {
      const isolationServerNames = normalizedIsolationServerNames(
        input.listRuntimeIsolationServerNames?.() ?? []
      );
      const isolationServers = isolationServerNames.map(
        (name): CodexMcpServerConfig => ({
          name,
          enabled: false
        })
      );
      if (
        run.createdBy !== 'api'
        || run.thread.purpose === 'schedule_task'
        || input.sessionManager.getSnapshot().status !== 'signed_in'
      ) {
        return isolationOnlyInjection(isolationServers, isolationServerNames);
      }
      const agentId = await input.agentIdentityStore.getOrCreate();
      const enabledIds = new Set(
        input.preferences
          .list(input.enterpriseOrigin, agentId)
          .filter(preference => preference.installed && preference.enabled)
          .map(preference => preference.upstreamId)
      );
      if (enabledIds.size === 0) {
        return isolationOnlyInjection(isolationServers, isolationServerNames);
      }

      const current = await currentCache();
      assertAgentId(current.catalog.agentId, agentId);
      const enabledUpstreams = current.catalog.upstreams.filter(upstream =>
        enabledIds.has(upstream.upstreamId)
      );
      if (enabledUpstreams.length === 0) {
        return isolationOnlyInjection(isolationServers, isolationServerNames);
      }

      const accessToken = await input.sessionManager.requireAccessToken();
      let token: EnterpriseMcpTokenCredential;
      try {
        token = await readRuntimeToken(agentId, accessToken);
      } catch (error) {
        await handleRemoteFailure(error);
        throw mapManagerError(error);
      }
      const configurationFingerprint = createHash('sha256')
        .update(JSON.stringify({
          agentId,
          isolationServerNames,
          tokenFingerprint: token.fingerprint,
          upstreams: enabledUpstreams
            .map(upstream => ({
              endpoint: upstream.endpoint,
              upstreamId: upstream.upstreamId
            }))
            .sort((left, right) =>
              left.upstreamId.localeCompare(right.upstreamId)
            )
        }))
        .digest('hex');

      return {
        mcpServers: [
          ...isolationServers,
          ...enabledUpstreams.map(
            (upstream): CodexMcpServerConfig => ({
              name: mcpServerName(upstream.upstreamId),
              url: upstream.endpoint,
              bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV,
              enabled: true,
              required: false,
              startupTimeoutSec: 15,
              toolTimeoutSec: 120
            })
          )
        ],
        env: {
          [ENTERPRISE_MCP_TOKEN_ENV]: token.token
        },
        configurationFingerprint
      };
    },
    handleSessionAuthenticated() {
      cache = undefined;
      input.onRuntimeConfigurationChanged?.('enterprise_session_changed');
    },
    async handleSessionSignedOut() {
      sessionSignOutWork ??= (async () => {
        const hadCachedConfiguration = cache !== undefined;
        cache = undefined;
        let token: EnterpriseMcpTokenCredential | undefined;
        let cleanupError: unknown;
        try {
          token = await input.tokenStore.read();
        } catch (error) {
          cleanupError = error;
        }
        if (token !== undefined) {
          try {
            await deleteToken();
          } catch (error) {
            cleanupError ??= error;
          }
        }
        if (
          hadCachedConfiguration
          || token !== undefined
          || cleanupError !== undefined
        ) {
          input.onRuntimeConfigurationChanged?.('enterprise_session_signed_out');
        }
        if (cleanupError !== undefined) {
          throw mapManagerError(cleanupError);
        }
      })().finally(() => {
        sessionSignOutWork = undefined;
      });
      return sessionSignOutWork;
    }
  };
}

function isolationOnlyInjection(
  servers: CodexMcpServerConfig[],
  serverNames: string[]
): AgentToolRunInjection | undefined {
  if (servers.length === 0) return undefined;
  return {
    mcpServers: servers,
    env: {},
    configurationFingerprint: createHash('sha256')
      .update(JSON.stringify({ isolationServerNames: serverNames }))
      .digest('hex')
  };
}

function normalizedIsolationServerNames(names: string[]): string[] {
  return [...new Set(names)]
    .filter(name => /^[A-Za-z0-9_-]+$/.test(name))
    .sort((left, right) => left.localeCompare(right));
}

function assertAgentId(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new EnterpriseMcpManagerError(
      'ENTERPRISE_PROTOCOL_ERROR',
      502
    );
  }
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime();
}

function mcpServerName(upstreamId: string): string {
  const readable = upstreamId
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'upstream';
  const suffix = createHash('sha256').update(upstreamId).digest('hex').slice(0, 8);
  return `enterprise_${readable}_${suffix}`;
}

function runtimeCatalogChanged(
  previous: EnterpriseRemoteMcpCatalog,
  next: EnterpriseRemoteMcpCatalog
): boolean {
  const runtimeShape = (catalog: EnterpriseRemoteMcpCatalog) => (
    catalog.upstreams
      .map(upstream => ({
        endpoint: upstream.endpoint,
        upstreamId: upstream.upstreamId
      }))
      .sort((left, right) => left.upstreamId.localeCompare(right.upstreamId))
  );
  return JSON.stringify(runtimeShape(previous)) !== JSON.stringify(runtimeShape(next));
}

function mapManagerError(error: unknown): EnterpriseMcpManagerError {
  if (error instanceof EnterpriseMcpManagerError) return error;
  if (error instanceof EnterpriseMcpTokenStoreError) {
    return new EnterpriseMcpManagerError(
      'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
      503
    );
  }
  if (error instanceof EnterpriseHttpError) {
    return new EnterpriseMcpManagerError(
      error.code,
      managerHttpStatus(error)
    );
  }
  return new EnterpriseMcpManagerError(
    'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE',
    503
  );
}

function managerHttpStatus(error: EnterpriseHttpError): number {
  if (error.statusCode !== undefined && error.statusCode >= 400) {
    return error.statusCode;
  }
  switch (error.code) {
    case 'ENTERPRISE_INVALID_REQUEST':
      return 400;
    case 'ENTERPRISE_UNAUTHORIZED':
    case 'ENTERPRISE_SESSION_EXPIRED':
      return 401;
    case 'ENTERPRISE_FORBIDDEN':
    case 'ENTERPRISE_AGENT_FORBIDDEN':
      return 403;
    case 'ENTERPRISE_MCP_TOKEN_NOT_FOUND':
    case 'ENTERPRISE_MCP_UPSTREAM_NOT_FOUND':
      return 404;
    case 'ENTERPRISE_RATE_LIMITED':
      return 429;
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return 503;
    case 'ENTERPRISE_PROTOCOL_ERROR':
      return 502;
    default:
      return 500;
  }
}
