import type {
  CodexMcpServerResponse,
  EnterpriseMcpCatalogResponse,
  EnterpriseMcpPreferenceUpdateRequest,
  EnterpriseMcpTokenStatus,
  RuntimeErrorCode
} from '@clawee/protocol';
import { createHash } from 'node:crypto';
import type { AgentToolRunInjection } from '../agent-tools/run-injection.js';
import type { McpManager } from '../codex/mcp/manager.js';
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
  enterpriseOrigin?: string;
  agentIdentityStore: EnterpriseAgentIdentityStore;
  sessionManager: EnterpriseSessionManager;
  httpClient: EnterpriseHttpClient;
  tokenStore: EnterpriseMcpTokenStore;
  mcpManager: Pick<
    McpManager,
    | 'listServers'
    | 'getServer'
    | 'addServer'
    | 'removeServer'
    | 'setServerEnabled'
  >;
  legacyPreferences?: EnterpriseMcpPreferenceRepository;
  onRuntimeConfigurationChanged?(reason: string): void;
  now?: () => Date;
}): EnterpriseMcpManager {
  const now = input.now ?? (() => new Date());
  let cache: CatalogCache | undefined;
  let refreshWork: Promise<CatalogCache> | undefined;
  let legacyMigrationWork: Promise<CodexMcpServerResponse[]> | undefined;
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
    const nativeServers = await listNativeServersWithLegacyMigration(current);
    return {
      agentId,
      tokenStatus: current.tokenStatus,
      upstreams: current.catalog.upstreams.map(upstream => {
        const codexServerName = mcpServerName(upstream.upstreamId);
        const installed = findInstalledServer(
          nativeServers,
          codexServerName,
          upstream.endpoint
        );
        return {
          ...upstream,
          codexServerName,
          ...(installed === undefined
            ? {}
            : { installedServerName: installed.name }),
          installed: installed !== undefined,
          enabled: installed?.enabled ?? false
        };
      }),
      refreshedAt: current.refreshedAt
    } satisfies EnterpriseMcpCatalogResponse;
  }

  async function listNativeServersWithLegacyMigration(
    current: CatalogCache
  ): Promise<CodexMcpServerResponse[]> {
    let nativeServers = await requireNativeServers();
    if (
      input.legacyPreferences === undefined
      || input.enterpriseOrigin === undefined
    ) {
      return nativeServers;
    }

    legacyMigrationWork ??= (async () => {
      const preferences = input.legacyPreferences!.list(
        input.enterpriseOrigin!,
        current.catalog.agentId
      );
      let changed = false;
      for (const preference of preferences) {
        const upstream = current.catalog.upstreams.find(
          candidate => candidate.upstreamId === preference.upstreamId
        );
        if (!preference.installed || upstream === undefined) {
          input.legacyPreferences!.delete(
            input.enterpriseOrigin!,
            current.catalog.agentId,
            preference.upstreamId
          );
          continue;
        }
        const existing = findInstalledServer(
          nativeServers,
          mcpServerName(upstream.upstreamId),
          upstream.endpoint
        );
        if (existing !== undefined) {
          input.legacyPreferences!.delete(
            input.enterpriseOrigin!,
            current.catalog.agentId,
            preference.upstreamId
          );
          continue;
        }
        try {
          const installed = await input.mcpManager.addServer({
            name: mcpServerName(upstream.upstreamId),
            transport: 'http',
            url: upstream.endpoint,
            bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV,
            confirmWriteToCodexHome: true
          });
          const server = installed.server
            ?? await input.mcpManager.getServer(
              mcpServerName(upstream.upstreamId)
            );
          if (server.enabled !== preference.enabled) {
            await input.mcpManager.setServerEnabled(
              server.name,
              preference.enabled,
              true
            );
          }
          input.legacyPreferences!.delete(
            input.enterpriseOrigin!,
            current.catalog.agentId,
            preference.upstreamId
          );
          changed = true;
        } catch (error) {
          throw mapCodexManagerError(error);
        }
      }
      return changed
        ? await requireNativeServers()
        : nativeServers;
    })().finally(() => {
      legacyMigrationWork = undefined;
    });
    nativeServers = await legacyMigrationWork;
    return nativeServers;
  }

  async function requireNativeServers(): Promise<CodexMcpServerResponse[]> {
    let result;
    try {
      result = await input.mcpManager.listServers();
    } catch (error) {
      throw mapCodexManagerError(error);
    }
    if (result.servers.length === 0 && result.diagnostics.length > 0) {
      throw new EnterpriseMcpManagerError(
        'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE',
        503
      );
    }
    return result.servers;
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
      const upstream = current.catalog.upstreams.find(
        candidate => candidate.upstreamId === upstreamId
      );
      if (upstream === undefined) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_MCP_UPSTREAM_NOT_FOUND',
          404
        );
      }
      const confirmation = update.confirmWriteToCodexHome === true;
      const codexServerName = mcpServerName(upstream.upstreamId);
      let installed = findInstalledServer(
        await requireNativeServers(),
        codexServerName,
        upstream.endpoint
      );

      if (
        update.enabled === true
        && installed === undefined
        && update.installed !== true
      ) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_INVALID_REQUEST',
          400
        );
      }

      if (update.installed === true && installed === undefined) {
        try {
          const result = await input.mcpManager.addServer({
            name: codexServerName,
            transport: 'http',
            url: upstream.endpoint,
            bearerTokenEnvVar: ENTERPRISE_MCP_TOKEN_ENV,
            ...(confirmation
              ? { confirmWriteToCodexHome: true }
              : {})
          });
          installed = result.server
            ?? await input.mcpManager.getServer(codexServerName)
            ?? findInstalledServer(
              await requireNativeServers(),
              codexServerName,
              upstream.endpoint
            );
          if (installed === undefined) {
            throw new Error('MCP_SERVER_NOT_FOUND: installed MCP was not found');
          }
          if (update.enabled !== true && installed.enabled) {
            const result = await input.mcpManager.setServerEnabled(
              installed.name,
              false,
              confirmation
            );
            installed = result.server;
          }
        } catch (error) {
          throw mapCodexManagerError(error);
        }
      }

      if (update.installed === false && installed !== undefined) {
        try {
          await input.mcpManager.removeServer(installed.name, confirmation);
          installed = undefined;
        } catch (error) {
          throw mapCodexManagerError(error);
        }
      } else if (
        update.enabled !== undefined
        && installed !== undefined
        && installed.enabled !== update.enabled
      ) {
        try {
          const result = await input.mcpManager.setServerEnabled(
            installed.name,
            update.enabled,
            confirmation
          );
          installed = result.server;
        } catch (error) {
          throw mapCodexManagerError(error);
        }
      }

      if (update.enabled === true && installed === undefined) {
        throw new EnterpriseMcpManagerError(
          'ENTERPRISE_INVALID_REQUEST',
          400
        );
      }
      return responseFrom(current);
    },
    async prepareRuntime(run) {
      void run;
      if (input.sessionManager.getSnapshot().status !== 'signed_in') {
        return undefined;
      }
      const enterpriseServers = (await requireNativeServers())
        .filter(server =>
          server.enabled
          && server.bearerTokenEnvVar === ENTERPRISE_MCP_TOKEN_ENV
        );
      if (enterpriseServers.length === 0) return undefined;

      const agentId = await input.agentIdentityStore.getOrCreate();
      const accessToken = await input.sessionManager.requireAccessToken();
      let token: EnterpriseMcpTokenCredential;
      try {
        token = await readRuntimeToken(agentId, accessToken);
      } catch (error) {
        await handleRemoteFailure(error);
        throw mapManagerError(error);
      }
      return {
        mcpServers: [],
        env: {
          [ENTERPRISE_MCP_TOKEN_ENV]: token.token
        },
        configurationFingerprint: createHash('sha256')
          .update(JSON.stringify({
            agentId,
            servers: enterpriseServers
              .map(server => server.name)
              .sort((left, right) => left.localeCompare(right)),
            tokenFingerprint: token.fingerprint
          }))
          .digest('hex')
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

function findInstalledServer(
  servers: CodexMcpServerResponse[],
  expectedName: string,
  endpoint: string
): CodexMcpServerResponse | undefined {
  return servers.find(server => server.url === endpoint)
    ?? servers.find(server => server.name === expectedName);
}

function mapCodexManagerError(error: unknown): EnterpriseMcpManagerError {
  if (!(error instanceof Error)) {
    return new EnterpriseMcpManagerError(
      'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE',
      503
    );
  }
  const code = error.message.split(':', 1)[0];
  if (code === 'MCP_WRITE_CONFIRMATION_REQUIRED') {
    return new EnterpriseMcpManagerError('MCP_WRITE_CONFIRMATION_REQUIRED', 409);
  }
  if (code === 'MCP_SERVER_NOT_FOUND') {
    return new EnterpriseMcpManagerError(
      'ENTERPRISE_MCP_UPSTREAM_NOT_FOUND',
      404
    );
  }
  if (code === 'CODEX_INCOMPATIBLE') {
    return new EnterpriseMcpManagerError('CODEX_INCOMPATIBLE', 501);
  }
  return new EnterpriseMcpManagerError(
    'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE',
    503
  );
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
