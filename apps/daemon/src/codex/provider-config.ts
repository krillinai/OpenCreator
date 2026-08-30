import type {
  CodexProviderAuthentication,
  CodexProviderConfig,
  CodexProviderConfigUpdateRequest
} from '@opencreator/protocol';
import type {
  GetAccountParams,
  GetAccountResponse,
  LoginAccountParams,
  LoginAccountResponse
} from './generated/v0_149_0/index.js';
import type { RestartableCodexAppServerRequestClient } from './app-server-client.js';
import type { CodexRuntimeReadinessService } from './runtime-readiness.js';

export type CodexProviderConfigService = ReturnType<typeof createCodexProviderConfigService>;

type ConfigReadResponse = {
  config: unknown;
  layers: unknown[] | null;
};

type ConfigWriteResponse = {
  status: 'ok' | 'okOverridden';
  version: string;
};

export class CodexProviderConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexProviderConfigValidationError';
  }
}

export function createCodexProviderConfigService(input: {
  client: RestartableCodexAppServerRequestClient;
  readiness: Pick<CodexRuntimeReadinessService, 'refresh'>;
  readStoredApiKey?(provider: {
    baseUrl: string;
    model: string;
  }): Promise<string | undefined> | string | undefined;
  onConfigurationChanged?(): Promise<void> | void;
  onProviderUpdated?(provider: {
    baseUrl: string;
    model: string;
    apiKey?: string;
  }): Promise<void> | void;
}) {
  let updateQueue = Promise.resolve();

  async function read(): Promise<CodexProviderConfig> {
    const state = await readProviderState(input.client);
    const storedApiKey = await readStoredApiKey(input.readStoredApiKey, state);
    return presentProviderConfig(state, storedApiKey !== undefined);
  }

  function update(request: CodexProviderConfigUpdateRequest): Promise<CodexProviderConfig> {
    const work = updateQueue.then(() => updateInternal(request));
    updateQueue = work.then(() => undefined, () => undefined);
    return work;
  }

  async function updateInternal(
    request: CodexProviderConfigUpdateRequest
  ): Promise<CodexProviderConfig> {
    const normalized = normalizeUpdateRequest(request);
    const current = await readProviderState(input.client);
    const storedApiKey = await readStoredApiKey(input.readStoredApiKey, current);
    const targetStoredApiKey = normalized.apiKey === undefined
      ? await readStoredApiKey(input.readStoredApiKey, normalized)
      : undefined;
    const loginApiKey = normalized.apiKey ?? targetStoredApiKey ?? (
      current.authentication === 'none'
      || (
        normalized.baseUrl.length > 0
        && current.authentication !== 'api_key'
      )
        ? storedApiKey
        : undefined
    );

    if (loginApiKey === undefined && current.authentication === 'none') {
      throw new CodexProviderConfigValidationError(
        '请填写 API Key'
      );
    }
    if (
      normalized.baseUrl.length > 0
      && loginApiKey === undefined
      && current.authentication !== 'api_key'
    ) {
      throw new CodexProviderConfigValidationError(
        '自定义 Base URL 需要 API Key 登录'
      );
    }

    const write = await input.client.request<ConfigWriteResponse>('config/batchWrite', {
      edits: [
        { keyPath: 'model', value: normalized.model, mergeStrategy: 'replace' },
        {
          keyPath: 'openai_base_url',
          value: normalized.baseUrl.length === 0 ? null : normalized.baseUrl,
          mergeStrategy: 'replace'
        },
        ...(loginApiKey !== undefined
          ? [{
              keyPath: 'cli_auth_credentials_store',
              value: 'file',
              mergeStrategy: 'replace'
            }]
          : [])
      ],
      filePath: null,
      expectedVersion: current.configVersion ?? null,
      reloadUserConfig: true
    });

    await input.client.restart();
    if (loginApiKey !== undefined) {
      await input.client.request<LoginAccountResponse>(
        'account/login/start',
        { type: 'apiKey', apiKey: loginApiKey } satisfies LoginAccountParams
      );
    }
    await input.onProviderUpdated?.({
      ...normalized,
      ...(loginApiKey === undefined ? {} : { apiKey: loginApiKey })
    });
    await input.onConfigurationChanged?.();
    await input.readiness.refresh();

    const next = await readProviderState(input.client);
    return {
      ...presentProviderConfig(
        next,
        loginApiKey !== undefined || storedApiKey !== undefined
      ),
      configVersion: write.version
    };
  }

  return { read, update };
}

function presentProviderConfig(
  state: Awaited<ReturnType<typeof readProviderState>>,
  storedApiKeyConfigured: boolean
): CodexProviderConfig {
  return {
    baseUrl: state.baseUrl,
    model: state.model,
    apiKeyConfigured: state.authentication === 'api_key' || storedApiKeyConfigured,
    authentication: state.authentication,
    ...(state.configVersion === undefined ? {} : { configVersion: state.configVersion })
  };
}

async function readStoredApiKey(
  reader: ((
    provider: { baseUrl: string; model: string }
  ) => Promise<string | undefined> | string | undefined) | undefined,
  provider: { baseUrl: string; model: string }
): Promise<string | undefined> {
  if (reader === undefined) return undefined;
  try {
    const apiKey = (await reader(provider))?.trim();
    return apiKey === undefined || apiKey.length === 0 ? undefined : apiKey;
  } catch {
    return undefined;
  }
}

async function readProviderState(client: RestartableCodexAppServerRequestClient): Promise<{
  baseUrl: string;
  model: string;
  authentication: CodexProviderAuthentication;
  configVersion?: string;
}> {
  const [configResponse, accountResponse] = await Promise.all([
    client.request<ConfigReadResponse>('config/read', { includeLayers: true, cwd: null }),
    client.request<GetAccountResponse>(
      'account/read',
      { refreshToken: false } satisfies GetAccountParams
    )
  ]);
  const config = readRecord(configResponse.config);
  const configVersion = readUserConfigVersion(configResponse.layers);
  return {
    baseUrl: readString(config, 'openai_base_url'),
    model: readString(config, 'model'),
    authentication: authenticationOf(accountResponse),
    ...(configVersion === undefined ? {} : { configVersion })
  };
}

function normalizeUpdateRequest(request: CodexProviderConfigUpdateRequest): {
  baseUrl: string;
  model: string;
  apiKey?: string;
} {
  const baseUrl = request.baseUrl.trim();
  const model = request.model.trim();
  const apiKey = request.apiKey?.trim();
  if (model.length === 0) {
    throw new CodexProviderConfigValidationError('Model 不能为空');
  }
  if (baseUrl.length > 0) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new CodexProviderConfigValidationError('Base URL 必须是有效的 HTTP 或 HTTPS 地址');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new CodexProviderConfigValidationError('Base URL 必须是有效的 HTTP 或 HTTPS 地址');
    }
  }
  if (request.apiKey !== undefined && apiKey?.length === 0) {
    throw new CodexProviderConfigValidationError('API Key 不能为空');
  }
  return {
    baseUrl,
    model,
    ...(apiKey === undefined ? {} : { apiKey })
  };
}

function authenticationOf(response: GetAccountResponse): CodexProviderAuthentication {
  if (response.account === null) return 'none';
  if (response.account.type === 'chatgpt') return 'chatgpt';
  if (response.account.type === 'apiKey') return 'api_key';
  return 'none';
}

function readUserConfigVersion(layers: unknown[] | null): string | undefined {
  if (!Array.isArray(layers)) return undefined;
  for (const candidate of layers) {
    const layer = readRecord(candidate);
    const name = readRecord(layer?.name);
    if (name?.type !== 'user' || name.profile !== null) continue;
    return typeof layer?.version === 'string' ? layer.version : undefined;
  }
  return undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === 'string' ? value : '';
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
