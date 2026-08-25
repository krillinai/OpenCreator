import type {
  CodexAccountReadResponse,
  CodexAccountState,
  CodexLoginCancelRequest,
  CodexLoginCancelResponse,
  CodexLoginStartRequest,
  CodexLoginStartResponse,
  CodexLogoutResponse,
  CodexRuntimeComponentReadiness,
  CodexRuntimeMode,
  CodexRuntimeReadiness,
  RuntimeErrorCode
} from '@opencreator/protocol';
import type {
  CancelLoginAccountParams,
  CancelLoginAccountResponse,
  GetAccountParams,
  GetAccountResponse,
  LoginAccountParams,
  LoginAccountResponse,
  LogoutAccountResponse,
  ModelListParams,
  ModelListResponse,
  SkillsListParams,
  SkillsListResponse
} from './generated/v0_149_0/index.js';
import {
  CodexAppServerResponseError,
  type CodexAppServerRequestClient
} from './app-server-client.js';

export type CodexRuntimeReadinessService = ReturnType<typeof createCodexRuntimeReadiness>;

export function createCodexRuntimeReadiness(input: {
  client: CodexAppServerRequestClient;
  mode: CodexRuntimeMode;
  version: string;
  commit: string | null;
  binaryPath: string;
  codexHome: string;
  cwd: string;
  binary?: CodexRuntimeComponentReadiness;
  checkToolServer?(): Promise<CodexRuntimeComponentReadiness> | CodexRuntimeComponentReadiness;
  now?(): string;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  let snapshot = initialSnapshot();
  let refreshWork: Promise<CodexRuntimeReadiness> | undefined;

  function initialSnapshot(): CodexRuntimeReadiness {
    const notChecked = component('not_checked');
    return {
      state: 'degraded',
      mode: input.mode,
      version: input.version,
      commit: input.commit,
      binaryPath: input.binaryPath,
      codexHome: input.codexHome,
      checkedAt: now(),
      binary: input.binary ?? component('ready'),
      protocol: notChecked,
      account: { ...notChecked, accountStatus: 'unavailable' },
      models: notChecked,
      skills: notChecked,
      toolServer: notChecked,
      diagnostics: []
    };
  }

  async function refresh(): Promise<CodexRuntimeReadiness> {
    if (refreshWork !== undefined) return await refreshWork;
    refreshWork = refreshInternal().finally(() => {
      refreshWork = undefined;
    });
    return await refreshWork;
  }

  async function refreshInternal(): Promise<CodexRuntimeReadiness> {
    let protocol = component('ready');
    let models = component('not_checked');
    let skills = component('not_checked');
    let account: CodexAccountState = {
      ...component('not_checked'),
      accountStatus: 'unavailable'
    };

    try {
      const response = await input.client.request<ModelListResponse>(
        'model/list',
        { limit: 1, includeHidden: false } satisfies ModelListParams
      );
      models = Array.isArray(response.data)
        ? component('ready', { count: response.data.length })
        : component('invalid', undefined, 'codex_runtime_protocol_incompatible');
    } catch (error) {
      const failure = requestFailure(error, 'models');
      models = failure.component;
      if (failure.protocolFailure) protocol = failure.component;
    }

    try {
      const response = await input.client.request<SkillsListResponse>(
        'skills/list',
        { cwds: [input.cwd], forceReload: false } satisfies SkillsListParams
      );
      skills = Array.isArray(response.data)
        ? component('ready', { count: response.data.length })
        : component('invalid', undefined, 'codex_runtime_protocol_incompatible');
    } catch (error) {
      const failure = requestFailure(error, 'skills');
      skills = failure.component;
      if (failure.protocolFailure) protocol = failure.component;
    }

    try {
      const response = await input.client.request<GetAccountResponse>(
        'account/read',
        { refreshToken: false } satisfies GetAccountParams
      );
      account = mapAccount(response);
    } catch (error) {
      const failure = requestFailure(error, 'account');
      account = { ...failure.component, accountStatus: 'unavailable' };
      if (failure.protocolFailure) protocol = failure.component;
    }

    const toolServer = input.checkToolServer === undefined
      ? component('not_checked')
      : await Promise.resolve(input.checkToolServer()).catch(error => component(
          'unavailable',
          undefined,
          'creator_agent_unavailable',
          error instanceof Error ? error.message : String(error)
        ));
    const binary = input.binary ?? component('ready');
    const blocking = [binary, protocol, models, skills, toolServer]
      .some(value => value.status === 'missing' || value.status === 'invalid' || value.status === 'unavailable');
    const degraded = account.status !== 'ready'
      || [models, skills, toolServer].some(value => value.status === 'not_checked');
    const diagnostics = [binary, protocol, models, skills, account, toolServer]
      .flatMap(value => value.message === undefined ? [] : [value.message]);
    snapshot = {
      state: blocking ? 'blocked' : degraded ? 'degraded' : 'ready',
      mode: input.mode,
      version: input.version,
      commit: input.commit,
      binaryPath: input.binaryPath,
      codexHome: input.codexHome,
      checkedAt: now(),
      binary,
      protocol,
      account,
      models,
      skills,
      toolServer,
      diagnostics
    };
    return structuredClone(snapshot);
  }

  async function readAccount(refreshToken = false): Promise<CodexAccountReadResponse> {
    const response = await input.client.request<GetAccountResponse>(
      'account/read',
      { refreshToken } satisfies GetAccountParams
    );
    const account = mapAccount(response);
    snapshot = { ...snapshot, account, checkedAt: now() };
    return { account };
  }

  async function startLogin(request: CodexLoginStartRequest): Promise<CodexLoginStartResponse> {
    const params: LoginAccountParams = request.loginType === 'api_key'
      ? { type: 'apiKey', apiKey: request.apiKey }
      : request.loginType === 'device_code'
        ? { type: 'chatgptDeviceCode' }
        : { type: 'chatgpt', codexStreamlinedLogin: true, useHostedLoginSuccessPage: true };
    const response = await input.client.request<LoginAccountResponse>('account/login/start', params);
    if (response.type === 'chatgpt') {
      return { loginId: response.loginId, status: 'pending', authUrl: response.authUrl };
    }
    if (response.type === 'chatgptDeviceCode') {
      return {
        loginId: response.loginId,
        status: 'pending',
        authUrl: response.verificationUrl,
        userCode: response.userCode
      };
    }
    return { loginId: `completed-${Date.now()}`, status: 'pending' };
  }

  async function cancelLogin(request: CodexLoginCancelRequest): Promise<CodexLoginCancelResponse> {
    const response = await input.client.request<CancelLoginAccountResponse>(
      'account/login/cancel',
      { loginId: request.loginId } satisfies CancelLoginAccountParams
    );
    return { loginId: request.loginId, canceled: response.status === 'canceled' };
  }

  async function logout(): Promise<CodexLogoutResponse> {
    await input.client.request<LogoutAccountResponse>('account/logout', undefined);
    const account: CodexAccountState = {
      ...component('not_authenticated'),
      accountStatus: 'signed_out'
    };
    snapshot = { ...snapshot, account, state: 'degraded', checkedAt: now() };
    return { signedOut: true };
  }

  return {
    refresh,
    readAccount,
    startLogin,
    cancelLogin,
    logout,
    getSnapshot(): CodexRuntimeReadiness {
      return structuredClone(snapshot);
    }
  };
}

function mapAccount(response: GetAccountResponse): CodexAccountState {
  if (response.account === null) {
    return {
      ...component('not_authenticated'),
      accountStatus: 'signed_out'
    };
  }
  if (response.account.type === 'chatgpt') {
    return {
      ...component('ready'),
      accountStatus: 'signed_in',
      account: {
        ...(response.account.email === null ? {} : { email: response.account.email }),
        plan: String(response.account.planType)
      }
    };
  }
  return {
    ...component('ready'),
    accountStatus: 'signed_in',
    account: { plan: response.account.type === 'apiKey' ? 'api_key' : 'amazon_bedrock' }
  };
}

function requestFailure(error: unknown, area: string): {
  component: CodexRuntimeComponentReadiness;
  protocolFailure: boolean;
} {
  const protocolFailure = error instanceof CodexAppServerResponseError && error.code === -32601;
  const message = error instanceof Error ? error.message : String(error);
  return {
    component: component(
      protocolFailure ? 'invalid' : 'unavailable',
      undefined,
      protocolFailure ? 'codex_runtime_protocol_incompatible' : undefined,
      `Codex ${area} 检查失败：${message}`
    ),
    protocolFailure
  };
}

function component(
  status: CodexRuntimeComponentReadiness['status'],
  details?: Record<string, unknown>,
  errorCode?: RuntimeErrorCode,
  message?: string
): CodexRuntimeComponentReadiness {
  return {
    status,
    ...(details === undefined ? {} : { details }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(message === undefined ? {} : { message })
  };
}
