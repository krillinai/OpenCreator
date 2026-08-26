import type { CodexProviderConfig } from '@opencreator/protocol';
import { KeyRound, LoaderCircle, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { ConnectionService } from '../../services/connection-service.js';

export type CodexRuntimeSettingsService = Pick<ConnectionService,
  | 'getCodexProvider'
  | 'updateCodexProvider'>;

export function CodexRuntimeSettingsView(props: {
  connected: boolean;
  service: CodexRuntimeSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const [provider, setProvider] = useState<CodexProviderConfig>();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let canceled = false;
    if (!props.connected || props.service === null) {
      setProvider(undefined);
      setLoading(false);
      return () => { canceled = true; };
    }

    setLoading(true);
    setError(undefined);
    void props.service.getCodexProvider()
      .then(next => {
        if (canceled) return;
        setProvider(next);
        setBaseUrl(next.baseUrl);
        setModel(next.model);
        setApiKey('');
      })
      .catch(cause => {
        if (!canceled) setError(messageOf(cause));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => { canceled = true; };
  }, [props.connected, props.service]);

  async function saveProvider() {
    if (props.service === null) return;
    setBusy(true);
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
      setNotice(l(
        'Codex Agent 配置已保存。',
        'Codex Agent configuration saved.'
      ));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!props.connected || props.service === null) {
    return (
      <section className="settings-section settings-management codex-runtime-settings" aria-labelledby="settings-codex-title">
        <header className="settings-management__header">
          <div>
            <h1 id="settings-codex-title">Codex Agent</h1>
            <p>{l(
              '配置 OpenCreator Agent 使用的模型服务。',
              'Configure the model provider used by OpenCreator Agent.'
            )}</p>
          </div>
        </header>
        <div className="settings-state" role="status">
          {l(
            '本地 Runtime 未连接，无法读取 Codex Agent 配置。',
            'The local Runtime is disconnected, so Codex Agent configuration is unavailable.'
          )}
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
            '配置 OpenCreator Agent 使用的模型服务。',
            'Configure the model provider used by OpenCreator Agent.'
          )}</p>
        </div>
      </header>

      {loading ? (
        <div className="settings-state" role="status">
          <LoaderCircle className="settings-spinner" size={16} aria-hidden="true" />
          {l('正在读取 Codex Agent 配置', 'Loading Codex Agent configuration')}
        </div>
      ) : provider === undefined ? null : (
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
              <small>{l(
                '留空使用 OpenAI 默认地址。',
                'Leave blank to use the default OpenAI endpoint.'
              )}</small>
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
                placeholder={provider.apiKeyConfigured
                  ? l('已配置，留空则不修改', 'Configured; leave blank to keep it')
                  : 'sk-...'}
                onChange={event => setApiKey(event.target.value)}
              />
            </label>
          </div>
          <footer className="codex-runtime-provider-footer">
            <span>{provider.apiKeyConfigured
              ? l('API Key 已配置', 'API Key configured')
              : l('尚未配置 API Key', 'API Key not configured')}</span>
            <button
              className="settings-primary-button"
              type="submit"
              disabled={busy || model.trim().length === 0}
            >
              <Save size={14} aria-hidden="true" />
              {l('保存', 'Save')}
            </button>
          </footer>
        </form>
      )}

      {notice === undefined ? null : <p className="settings-notice" role="status">{notice}</p>}
      {error === undefined ? null : <p className="settings-error" role="alert">{error}</p>}
    </section>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
