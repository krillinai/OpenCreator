import { creatorProviderCatalogById, type CodexProviderConfig, type CodexRuntimeReadiness } from '@opencreator/protocol';
import { useEffect, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { ConnectionService } from '../../services/connection-service.js';
import { readJsonFromStorage, writeJsonToStorage } from '../../storage/browser-storage.js';
import { inferLlmProviderId, llmProviderOptions } from './llm-provider-selection.js';
import './startup-agent-setup.css';

export type AgentSetupSnapshot = { readiness: CodexRuntimeReadiness; provider: CodexProviderConfig };
type AgentSetupMode = 'codex' | 'custom';
const confirmationKey = 'opencreator.agent-setup-confirmed.v1';

export type AgentSetupService = Pick<ConnectionService,
  | 'getCodexReadiness'
  | 'getCodexProvider'
  | 'updateCodexProvider'>;

export function needsAgentSetup(readiness: CodexRuntimeReadiness): boolean {
  return readiness.account.accountStatus === 'signed_out'
    || readiness.account.accountStatus === 'expired'
    || readiness.account.status === 'not_authenticated';
}

export function availableAgentMode({ readiness, provider }: AgentSetupSnapshot): 'chatgpt' | 'api_key' | null {
  if (readiness.binary.status !== 'ready' || readiness.protocol.status !== 'ready'
    || readiness.models.status !== 'ready' || readiness.state === 'blocked') return null;
  if (provider.authentication === 'chatgpt' && provider.baseUrl.length === 0
    && !needsAgentSetup(readiness) && readiness.account.status === 'ready') return 'chatgpt';
  if (provider.authentication === 'api_key' && provider.apiKeyConfigured && provider.model.trim().length > 0
    && (readiness.account.status === 'ready' && readiness.account.accountStatus === 'signed_in'
      || readiness.account.status === 'not_authenticated' && readiness.account.accountStatus === 'signed_out'
        && provider.baseUrl.trim().length > 0)) return 'api_key';
  return null;
}

function confirmationValue(snapshot: AgentSetupSnapshot): string {
  const { readiness, provider } = snapshot;
  return JSON.stringify([
    readiness.codexHome, availableAgentMode(snapshot), provider.authentication,
    provider.baseUrl, provider.model, provider.apiKeyConfigured
  ]);
}

export function isAgentSetupConfirmed(snapshot: AgentSetupSnapshot): boolean {
  return availableAgentMode(snapshot) !== null
    && readJsonFromStorage<string>(confirmationKey) === confirmationValue(snapshot);
}

export function confirmAgentSetup(snapshot: AgentSetupSnapshot): void {
  try {
    writeJsonToStorage(confirmationKey, confirmationValue(snapshot));
  } catch {}
}

export function StartupAgentSetup(props: {
  service: AgentSetupService;
  initialSnapshot?: AgentSetupSnapshot;
  onReady(snapshot: AgentSetupSnapshot): void;
  onSkip(): void;
}) {
  const l = useLocalizedCopy();
  const activeRef = useRef(true);
  const [snapshot, setSnapshot] = useState(props.initialSnapshot);
  const [mode, setMode] = useState<AgentSetupMode>(
    props.initialSnapshot !== undefined && availableAgentMode(props.initialSnapshot) !== null ? 'codex' : 'custom'
  );
  const [providerId, setProviderId] = useState(() => props.initialSnapshot?.provider.baseUrl
    ? inferLlmProviderId(props.initialSnapshot.provider.baseUrl, props.initialSnapshot.provider.model)
    : 'openai');
  const [baseUrl, setBaseUrl] = useState(props.initialSnapshot?.provider.baseUrl || creatorProviderCatalogById.llm.openai?.defaultBaseUrl || '');
  const [model, setModel] = useState(props.initialSnapshot?.provider.model || creatorProviderCatalogById.llm.openai?.models[0]?.id || '');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(props.initialSnapshot === undefined);
  const [retryCount, setRetryCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  useEffect(() => {
    if (props.initialSnapshot !== undefined) return;
    let canceled = false;
    void Promise.all([props.service.getCodexReadiness(), props.service.getCodexProvider()])
      .then(([readiness, provider]) => {
        if (canceled) return;
        const next = { readiness, provider };
        setSnapshot(next);
        setMode(availableAgentMode(next) === null ? 'custom' : 'codex');
        setProviderId(provider.baseUrl ? inferLlmProviderId(provider.baseUrl, provider.model) : 'openai');
        setBaseUrl(provider.baseUrl || creatorProviderCatalogById.llm.openai?.defaultBaseUrl || '');
        setModel(provider.model || creatorProviderCatalogById.llm.openai?.models[0]?.id || '');
      })
      .catch(cause => { if (!canceled) setError(messageOf(cause)); })
      .finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [props.initialSnapshot, props.service, retryCount]);

  const existingMode = snapshot === undefined ? null : availableAgentMode(snapshot);
  const reusableKey = snapshot?.provider.authentication === 'api_key'
    && snapshot.provider.apiKeyConfigured && baseUrl.trim() === snapshot.provider.baseUrl
    && model.trim() === snapshot.provider.model;

  async function saveProvider() {
    setBusy(true);
    setError(undefined);
    try {
      if (reusableKey && apiKey.trim().length === 0 && snapshot !== undefined && existingMode !== null) {
        props.onReady(snapshot);
        return;
      }
      if (!reusableKey || apiKey.trim().length > 0) {
        await props.service.updateCodexProvider({
          baseUrl, model, ...(apiKey.trim().length === 0 ? {} : { apiKey })
        });
      }
      const [readiness, provider] = await Promise.all([
        props.service.getCodexReadiness(), props.service.getCodexProvider()
      ]);
      if (!activeRef.current) return;
      const next = { readiness, provider };
      if (availableAgentMode(next) !== 'api_key') {
        throw new Error(readiness.diagnostics.join('；') || l('模型服务尚未就绪，请检查配置。', 'The model service is not ready. Check your settings.'));
      }
      setApiKey('');
      props.onReady(next);
    } catch (cause) {
      if (activeRef.current) setError(messageOf(cause));
    } finally {
      if (activeRef.current) setBusy(false);
    }
  }

  function selectProvider(id: string) {
    const preset = creatorProviderCatalogById.llm[id];
    if (preset === undefined) return;
    setProviderId(id);
    setBaseUrl(preset.defaultBaseUrl ?? '');
    setModel(preset.models[0]?.id ?? '');
    setApiKey('');
    setError(undefined);
  }

  function skip() {
    activeRef.current = false;
    props.onSkip();
  }

  return (
    <main className="startup-agent-setup">
      <section className="startup-agent-setup__card" aria-labelledby="startup-agent-title">
        <span className="startup-agent-setup__eyebrow">OpenCreator · Agent</span>
        <h1 id="startup-agent-title">{l('开始使用 Agent', 'Get started with Agent')}</h1>
        {loading ? <p role="status">{l('正在检查本机 Codex…', 'Checking local Codex…')}</p> : null}
        {!loading && existingMode !== null ? (
          <>
            <p>{l('本机 Codex 已有可用配置，可直接用于 OpenCreator。', 'Your local Codex is ready to use with OpenCreator.')}</p>
            <div className="startup-agent-setup__detected" role="status">
              <strong>{l('已找到本机 Codex', 'Local Codex found')}</strong>
              <span>{existingMode === 'chatgpt'
                ? l('ChatGPT 登录', 'ChatGPT sign-in')
                : l('API Key 已配置', 'API key configured')}
                {snapshot?.provider.model ? ` · ${snapshot.provider.model}` : ''}</span>
            </div>
            <div className="startup-agent-setup__choices" role="group" aria-label={l('模型服务来源', 'Model source')}>
              <button type="button" disabled={busy} aria-pressed={mode === 'codex'} onClick={() => { setMode('codex'); setError(undefined); }}>
                {l('使用本机 Codex', 'Use local Codex')}
              </button>
              <button type="button" disabled={busy} aria-pressed={mode === 'custom'} onClick={() => { setMode('custom'); setError(undefined); }}>
                {l('自定义模型服务', 'Custom model service')}
              </button>
            </div>
          </>
        ) : !loading && snapshot !== undefined ? (
          <p>{l('配置模型服务后即可开始使用 Agent。', 'Set up a model provider to start using Agent.')}</p>
        ) : null}
        {!loading && mode === 'codex' && existingMode !== null && snapshot !== undefined ? (
          <button type="button" className="startup-agent-setup__primary" onClick={() => props.onReady(snapshot)}>
            {l('使用本机 Codex，继续', 'Use local Codex and continue')}
          </button>
        ) : !loading && snapshot !== undefined ? (
          <form className="startup-agent-setup__form" onSubmit={event => { event.preventDefault(); void saveProvider(); }}>
            <label>{l('供应商', 'Provider')}
              <select value={providerId} onChange={event => selectProvider(event.target.value)}>
                {llmProviderOptions.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
              </select>
            </label>
            <label>{l('模型名称', 'Model name')}
              <input required list="startup-agent-models" value={model} onChange={event => setModel(event.target.value)} placeholder="gpt-5.6-sol" />
            </label>
            <datalist id="startup-agent-models">
              {creatorProviderCatalogById.llm[providerId]?.models.map(option => (
                <option key={option.id} value={option.id} />
              ))}
            </datalist>
            <label>Base URL
              <input required={providerId !== 'openai'} type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" />
            </label>
            <label>API Key
              <input required={!reusableKey} type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} />
            </label>
            {reusableKey ? <small>{l('现有配置未变，留空可复用 API Key。', 'Leave blank to reuse the existing key when settings are unchanged.')}</small> : null}
            <button className="startup-agent-setup__primary" type="submit" disabled={busy || model.trim().length === 0
              || (providerId !== 'openai' && baseUrl.trim().length === 0) || (apiKey.trim().length === 0 && !reusableKey)}>
              {busy ? l('正在保存…', 'Saving…') : l('保存并开始使用', 'Save and continue')}
            </button>
          </form>
        ) : null}
        {error === undefined ? null : <p className="startup-agent-setup__error" role="alert">{error}</p>}
        {error !== undefined && snapshot === undefined && !loading ? (
          <button type="button" onClick={() => { setLoading(true); setError(undefined); setRetryCount(count => count + 1); }}>
            {l('重新检测', 'Retry detection')}
          </button>
        ) : null}
        <button className="startup-agent-setup__skip" type="button" onClick={skip}>
          {l('暂时跳过', 'Skip for now')}
        </button>
      </section>
    </main>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
