import type {
  CodexLoginStartResponse,
  CodexProviderConfig,
  CodexRuntimeComponentReadiness,
  CodexRuntimeReadiness
} from '@opencreator/protocol';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Save,
  SquareTerminal
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { HostBridgeResult } from '../../host/bridge.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { ConnectionService } from '../../services/connection-service.js';

export type CodexRuntimeSettingsService = Pick<ConnectionService,
  | 'getCodexReadiness'
  | 'getCodexProvider'
  | 'updateCodexProvider'
  | 'startCodexLogin'
  | 'cancelCodexLogin'
  | 'logoutCodex'>;

export function CodexRuntimeSettingsView(props: {
  connected: boolean;
  service: CodexRuntimeSettingsService | null;
  onOpenExternal?(url: string): Promise<void>;
  onSelectExternalCodex?(): Promise<HostBridgeResult>;
}) {
  const l = useLocalizedCopy();
  const [readiness, setReadiness] = useState<CodexRuntimeReadiness>();
  const [provider, setProvider] = useState<CodexProviderConfig>();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [login, setLogin] = useState<CodexLoginStartResponse>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const refreshReadiness = useCallback(async () => {
    if (!props.connected || props.service === null) return;
    const next = await props.service.getCodexReadiness();
    setReadiness(next);
    if (next.account.accountStatus === 'signed_in') setLogin(undefined);
  }, [props.connected, props.service]);

  const load = useCallback(async () => {
    if (!props.connected || props.service === null) return;
    const [nextReadiness, nextProvider] = await Promise.all([
      props.service.getCodexReadiness(),
      props.service.getCodexProvider()
    ]);
    setReadiness(nextReadiness);
    setProvider(nextProvider);
    setBaseUrl(nextProvider.baseUrl);
    setModel(nextProvider.model);
    setApiKey('');
    if (nextReadiness.account.accountStatus === 'signed_in') setLogin(undefined);
  }, [props.connected, props.service]);

  useEffect(() => {
    let canceled = false;
    if (!props.connected || props.service === null) {
      setReadiness(undefined);
      setProvider(undefined);
      return () => { canceled = true; };
    }
    void Promise.all([
      props.service.getCodexReadiness(),
      props.service.getCodexProvider()
    ])
      .then(([nextReadiness, nextProvider]) => {
        if (canceled) return;
        setReadiness(nextReadiness);
        setProvider(nextProvider);
        setBaseUrl(nextProvider.baseUrl);
        setModel(nextProvider.model);
      })
      .catch(cause => {
        if (!canceled) setError(messageOf(cause));
      });
    return () => { canceled = true; };
  }, [props.connected, props.service]);

  useEffect(() => {
    if (login === undefined || props.service === null) return;
    const timer = window.setInterval(() => {
      void refreshReadiness().catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [login, props.service, refreshReadiness]);

  async function startLogin(loginType: 'chatgpt' | 'device_code') {
    if (props.service === null) return;
    setBusy(`login:${loginType}`);
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await props.service.startCodexLogin({ loginType });
      setLogin(next);
      if (next.authUrl !== undefined && props.onOpenExternal !== undefined) {
        await props.onOpenExternal(next.authUrl);
      }
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function cancelLogin() {
    if (props.service === null || login === undefined) return;
    setBusy('cancel');
    setError(undefined);
    try {
      await props.service.cancelCodexLogin(login.loginId);
      setLogin(undefined);
      await refreshReadiness();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function logout() {
    if (props.service === null) return;
    setBusy('logout');
    setError(undefined);
    try {
      await props.service.logoutCodex();
      setLogin(undefined);
      await refreshReadiness();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function selectExternalCodex() {
    if (props.onSelectExternalCodex === undefined) return;
    setBusy('external');
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await props.onSelectExternalCodex();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotice(l(
        '外部 Codex 已通过路径与兼容性检查，Runtime 已重启。',
        'The external Codex passed path and compatibility checks, and the Runtime restarted.'
      ));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function saveProvider() {
    if (props.service === null) return;
    setBusy('provider');
    setError(undefined);
    setNotice(undefined);
    try {
      const next = await props.service.updateCodexProvider({
        baseUrl,
        model,
        ...(apiKey.trim().length === 0 ? {} : { apiKey })
      });
      setProvider(next);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey('');
      await refreshReadiness();
      setNotice(l(
        'Codex 模型服务已保存，Agent Runtime 已刷新。',
        'The Codex model provider was saved and the Agent Runtime was refreshed.'
      ));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(undefined);
    }
  }

  if (!props.connected || props.service === null) {
    return (
      <section className="settings-section settings-management codex-runtime-settings" aria-labelledby="settings-codex-title">
        <header className="settings-management__header">
          <div>
            <h1 id="settings-codex-title">Codex Agent</h1>
            <p>{l('管理 OpenCreator Agent 的 Codex Runtime 与登录。', 'Manage the Codex Runtime and sign-in used by the OpenCreator Agent.')}</p>
          </div>
        </header>
        <div className="settings-state" role="status">
          {l('本地 Runtime 未连接，无法读取 Codex Agent 状态。', 'The local Runtime is disconnected, so Codex Agent status is unavailable.')}
        </div>
      </section>
    );
  }

  return (
    <section className="settings-section settings-management codex-runtime-settings" aria-labelledby="settings-codex-title">
      <header className="settings-management__header">
        <div>
          <h1 id="settings-codex-title">Codex Agent</h1>
          <p>{l(
            '这里只管理 Agent 登录与运行时；翻译、转录、配音和生图密钥仍在“AI 服务”中配置。',
            'This page manages Agent sign-in and Runtime only. Translation, transcription, voice, and image providers remain under AI Services.'
          )}</p>
        </div>
        <button
          className="settings-secondary-button"
          type="button"
          disabled={busy !== undefined}
          onClick={() => void load().catch(cause => setError(messageOf(cause)))}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {l('刷新', 'Refresh')}
        </button>
      </header>

      {readiness === undefined ? (
        <div className="settings-state" role="status">
          <LoaderCircle className="settings-spinner" size={16} aria-hidden="true" />
          {l('正在读取 Codex Runtime 状态', 'Loading Codex Runtime status')}
        </div>
      ) : (
        <>
          <form
            className="settings-editor codex-runtime-provider"
            aria-labelledby="codex-provider-title"
            onSubmit={event => {
              event.preventDefault();
              void saveProvider();
            }}
          >
            <header>
              <div>
                <h2 id="codex-provider-title">{l('模型服务', 'Model provider')}</h2>
                <p>{l(
                  '供 OpenCreator Agent 使用，与视频处理的“AI 服务”配置相互独立。',
                  'Used by the OpenCreator Agent and separate from video-processing AI Services.'
                )}</p>
              </div>
              <KeyRound size={18} aria-hidden="true" />
            </header>
            <div className="settings-form-grid">
              <label className="settings-form-wide">
                Base URL
                <input
                  aria-label="Base URL"
                  type="url"
                  value={baseUrl}
                  placeholder="https://api.openai.com/v1"
                  onChange={event => setBaseUrl(event.target.value)}
                />
                <small>{l('留空使用 OpenAI 默认地址。', 'Leave blank to use the default OpenAI endpoint.')}</small>
              </label>
              <label>
                Model
                <input
                  aria-label="Model"
                  required
                  type="text"
                  value={model}
                  placeholder="gpt-5.6-codex"
                  onChange={event => setModel(event.target.value)}
                />
              </label>
              <label>
                API Key
                <input
                  aria-label="API Key"
                  type="password"
                  value={apiKey}
                  autoComplete="new-password"
                  placeholder={provider?.apiKeyConfigured
                    ? l('已配置，留空则不修改', 'Configured; leave blank to keep it')
                    : 'sk-...'}
                  onChange={event => setApiKey(event.target.value)}
                />
              </label>
            </div>
            <footer className="codex-runtime-provider-footer">
              <span>{provider?.apiKeyConfigured
                ? l('API Key 已配置', 'API Key configured')
                : l('尚未配置 API Key', 'API Key not configured')}</span>
              <button
                className="settings-primary-button"
                type="submit"
                disabled={busy !== undefined || provider === undefined || model.trim().length === 0}
              >
                <Save size={14} aria-hidden="true" />
                {l('保存并刷新 Agent', 'Save and refresh Agent')}
              </button>
            </footer>
          </form>

          <section className="settings-editor codex-runtime-account" aria-labelledby="codex-account-title">
            <header>
              <div>
                <h2 id="codex-account-title">{l('Agent 登录', 'Agent sign-in')}</h2>
                <p>{accountDescription(readiness, l)}</p>
              </div>
              <span className="codex-runtime-state" data-state={readiness.account.accountStatus}>
                {accountStatusLabel(readiness.account.accountStatus, l)}
              </span>
            </header>
            {readiness.account.accountStatus === 'signed_in' ? (
              <div className="codex-runtime-account-summary">
                <CheckCircle2 size={17} aria-hidden="true" />
                <div>
                  <strong>{readiness.account.account?.email ?? l('Codex 账户', 'Codex account')}</strong>
                  <small>{readiness.account.account?.plan ?? l('已登录', 'Signed in')}</small>
                </div>
                <button className="settings-secondary-button" type="button" disabled={busy !== undefined} onClick={() => void logout()}>
                  <LogOut size={14} aria-hidden="true" />
                  {l('退出登录', 'Sign out')}
                </button>
              </div>
            ) : (
              <div className="codex-runtime-login-actions">
                <button className="settings-primary-button" type="button" disabled={busy !== undefined} onClick={() => void startLogin('chatgpt')}>
                  <ExternalLink size={14} aria-hidden="true" />
                  {l('使用 ChatGPT 登录', 'Sign in with ChatGPT')}
                </button>
                <button className="settings-secondary-button" type="button" disabled={busy !== undefined} onClick={() => void startLogin('device_code')}>
                  {l('使用设备代码', 'Use device code')}
                </button>
              </div>
            )}
            {login !== undefined ? (
              <div className="codex-runtime-login-pending" role="status">
                <div>
                  <strong>{l('等待完成登录', 'Waiting for sign-in')}</strong>
                  {login.userCode === undefined ? null : <code>{login.userCode}</code>}
                  {login.authUrl === undefined ? null : <small>{login.authUrl}</small>}
                </div>
                <button className="settings-secondary-button" type="button" disabled={busy !== undefined} onClick={() => void cancelLogin()}>
                  {l('取消登录', 'Cancel sign-in')}
                </button>
              </div>
            ) : null}
          </section>

          <section className="diagnostics-block" aria-labelledby="codex-runtime-title">
            <h2 id="codex-runtime-title">{l('Runtime 版本与隔离', 'Runtime version and isolation')}</h2>
            <dl>
              <dt>{l('运行模式', 'Runtime mode')}</dt>
              <dd>{readiness.mode === 'bundled' ? l('内置 Codex', 'Bundled Codex') : l('外部 Codex', 'External Codex')}</dd>
              <dt>{l('版本', 'Version')}</dt>
              <dd>{readiness.version ?? l('未知', 'Unknown')}</dd>
              <dt>Commit</dt>
              <dd><code>{readiness.commit ?? l('外部版本未固定', 'External version is not pinned')}</code></dd>
              <dt>SHA-256</dt>
              <dd><code>{detailString(readiness.binary, 'sha256') ?? l('未提供', 'Unavailable')}</code></dd>
              <dt>{l('二进制路径', 'Binary path')}</dt>
              <dd><code>{readiness.binaryPath ?? l('未提供', 'Unavailable')}</code></dd>
              <dt>CODEX_HOME</dt>
              <dd><code>{readiness.codexHome}</code></dd>
              <dt>{l('检查时间', 'Checked at')}</dt>
              <dd>{readiness.checkedAt}</dd>
            </dl>
          </section>

          <section className="codex-runtime-components" aria-labelledby="codex-components-title">
            <h2 id="codex-components-title">{l('运行就绪状态', 'Runtime readiness')}</h2>
            <div>
              <ReadinessItem label={l('二进制', 'Binary')} value={readiness.binary} />
              <ReadinessItem label={l('协议', 'Protocol')} value={readiness.protocol} />
              <ReadinessItem label={l('模型', 'Models')} value={readiness.models} />
              <ReadinessItem label="Skills" value={readiness.skills} />
              <ReadinessItem label={l('工具服务', 'Tool server')} value={readiness.toolServer} />
              <ReadinessItem label={l('账户', 'Account')} value={readiness.account} />
            </div>
          </section>

          <section className="settings-editor codex-runtime-external" aria-labelledby="codex-external-title">
            <header>
              <div>
                <h2 id="codex-external-title">{l('外部 Codex（高级）', 'External Codex (advanced)')}</h2>
                <p>{l(
                  '只接受用户显式选择的 Codex 可执行文件。切换前会校验路径与 app-server 兼容性，失败时不会搜索 PATH 兜底。',
                  'Only an explicitly selected Codex executable is accepted. Its path and app-server compatibility are checked before switching, with no PATH fallback.'
                )}</p>
              </div>
              <SquareTerminal size={18} aria-hidden="true" />
            </header>
            {props.onSelectExternalCodex === undefined ? (
              <p className="settings-notice">{l('浏览器版不能切换本机 Codex 路径。', 'The browser build cannot switch the local Codex path.')}</p>
            ) : (
              <button className="settings-secondary-button" type="button" disabled={busy !== undefined} onClick={() => void selectExternalCodex()}>
                {l('选择外部 Codex…', 'Select external Codex…')}
              </button>
            )}
          </section>
        </>
      )}

      {notice === undefined ? null : <p className="settings-notice" role="status">{notice}</p>}
      {error === undefined ? null : <p className="settings-error" role="alert">{error}</p>}
    </section>
  );
}

function ReadinessItem(props: { label: string; value: CodexRuntimeComponentReadiness }) {
  return (
    <article data-status={props.value.status}>
      <strong>{props.label}</strong>
      <span>{props.value.status}</span>
      {props.value.message === undefined ? null : <small>{props.value.message}</small>}
    </article>
  );
}

function accountStatusLabel(
  status: CodexRuntimeReadiness['account']['accountStatus'],
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (status === 'signed_in') return l('已登录', 'Signed in');
  if (status === 'authenticating') return l('登录中', 'Signing in');
  if (status === 'expired') return l('登录已过期', 'Sign-in expired');
  if (status === 'unavailable') return l('不可用', 'Unavailable');
  return l('未登录', 'Signed out');
}

function accountDescription(
  readiness: CodexRuntimeReadiness,
  l: ReturnType<typeof useLocalizedCopy>
): string {
  if (readiness.account.accountStatus === 'signed_in') {
    return l('OpenCreator Agent 将使用此 Codex 账户运行。', 'The OpenCreator Agent will run with this Codex account.');
  }
  if (readiness.account.accountStatus === 'expired') {
    return l('登录已过期，请重新登录。现有 Creator 历史不会被删除。', 'Sign-in expired. Sign in again; existing Creator history is preserved.');
  }
  return l('无需打开终端，可直接在 OpenCreator 内完成登录。', 'Sign in inside OpenCreator without opening a terminal.');
}

function detailString(value: CodexRuntimeComponentReadiness, key: string): string | undefined {
  const candidate = value.details?.[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
