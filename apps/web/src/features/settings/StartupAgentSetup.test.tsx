import type { CodexProviderConfig, CodexRuntimeReadiness } from '@opencreator/protocol';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import {
  availableAgentMode, confirmAgentSetup, isAgentSetupConfirmed,
  StartupAgentSetup, type AgentSetupService, type AgentSetupSnapshot
} from './StartupAgentSetup.js';

function readiness(accountStatus: 'signed_out' | 'signed_in' | 'expired', state: 'ready' | 'degraded' | 'blocked' = 'ready'): CodexRuntimeReadiness {
  return {
    state,
    mode: 'bundled', version: 'test', commit: null, binaryPath: '/codex',
    codexHome: '/tmp/codex', checkedAt: new Date(0).toISOString(),
    account: { status: accountStatus === 'signed_in' ? 'ready' : 'not_authenticated', accountStatus },
    binary: { status: 'ready' }, protocol: { status: 'ready' }, models: { status: 'ready' },
    skills: { status: 'ready' }, toolServer: { status: 'ready' }, diagnostics: []
  };
}

function createService(): AgentSetupService {
  let provider: CodexProviderConfig = { baseUrl: '', model: '', apiKeyConfigured: false, authentication: 'none' };
  let accountStatus: 'signed_in' | 'signed_out' = 'signed_out';
  return {
    getCodexReadiness: vi.fn(async () => readiness(accountStatus)),
    getCodexProvider: vi.fn(async () => provider),
    updateCodexProvider: vi.fn(async input => {
      accountStatus = 'signed_in';
      provider = { baseUrl: input.baseUrl, model: input.model, apiKeyConfigured: true, authentication: 'api_key' };
      return provider;
    })
  };
}

function mount(service: AgentSetupService, initialSnapshot?: AgentSetupSnapshot) {
  const onReady = vi.fn();
  const onSkip = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN">
    <StartupAgentSetup service={service} initialSnapshot={initialSnapshot} onReady={onReady} onSkip={onSkip} />
  </LanguageProvider>);
  return { onReady, onSkip };
}

describe('StartupAgentSetup', () => {
  afterEach(() => { cleanup(); window.localStorage.clear(); });

  it('only offers reuse for a ready Codex with usable credentials', () => {
    const provider: CodexProviderConfig = { baseUrl: 'https://gateway.example.test/v1', model: 'model-1', apiKeyConfigured: true, authentication: 'api_key' };
    expect(availableAgentMode({ readiness: readiness('signed_out', 'degraded'), provider })).toBe('api_key');
    expect(availableAgentMode({ readiness: readiness('signed_out', 'degraded'), provider: { ...provider, model: '' } })).toBeNull();
    expect(availableAgentMode({ readiness: readiness('signed_out', 'degraded'), provider: { ...provider, apiKeyConfigured: false } })).toBeNull();
    expect(availableAgentMode({ readiness: readiness('signed_out', 'degraded'), provider: { ...provider, baseUrl: '' } })).toBeNull();
    expect(availableAgentMode({ readiness: readiness('signed_out', 'blocked'), provider })).toBeNull();
    expect(availableAgentMode({ readiness: readiness('expired', 'degraded'), provider: {
      ...provider, baseUrl: '', apiKeyConfigured: false, authentication: 'chatgpt'
    } })).toBeNull();
  });

  it('confirms an existing ChatGPT sign-in without a second detection or a key form', async () => {
    const service = createService();
    const provider: CodexProviderConfig = { baseUrl: '', model: 'gpt-test', apiKeyConfigured: false, authentication: 'chatgpt' };
    const snapshot = { readiness: readiness('signed_in'), provider };
    const { onReady } = mount(service, snapshot);
    expect(isAgentSetupConfirmed(snapshot)).toBe(false);
    expect(screen.getByText('已找到本机 Codex')).toBeInTheDocument();
    expect(screen.getByText(/ChatGPT 登录 · gpt-test/)).toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '使用本机 Codex，继续' }));
    expect(onReady).toHaveBeenCalledWith(snapshot);
    expect(service.getCodexReadiness).not.toHaveBeenCalled();
    expect(service.getCodexProvider).not.toHaveBeenCalled();
    expect(service.updateCodexProvider).not.toHaveBeenCalled();
  });

  it('lets users choose a different provider even when local Codex is available', async () => {
    const service = createService();
    const snapshot: AgentSetupSnapshot = { readiness: readiness('signed_in'), provider: {
      baseUrl: '', model: 'gpt-test', apiKeyConfigured: false, authentication: 'chatgpt'
    } };
    const { onReady } = mount(service, snapshot);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '自定义模型服务' }));
    expect(screen.getByRole('combobox', { name: '供应商' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: '供应商' }), 'deepseek');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.deepseek.com');
    expect(screen.getByLabelText('模型名称')).toHaveValue('deepseek-v4-pro');
    await user.type(screen.getByLabelText('API Key'), 'custom-key');
    await user.click(screen.getByRole('button', { name: '保存并开始使用' }));
    expect(service.updateCodexProvider).toHaveBeenCalledWith({
      baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKey: 'custom-key'
    });
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });

  it('reuses a custom provider token without ChatGPT login or a second request', async () => {
    const service = createService();
    const provider: CodexProviderConfig = { baseUrl: 'https://gateway.example.test/v1', model: 'model-1', apiKeyConfigured: true, authentication: 'api_key' };
    const snapshot = { readiness: readiness('signed_out', 'degraded'), provider };
    const { onReady } = mount(service, snapshot);
    expect(screen.getByText(/API Key 已配置 · model-1/)).toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '使用本机 Codex，继续' }));
    expect(onReady).toHaveBeenCalledWith(snapshot);
    expect(service.getCodexReadiness).not.toHaveBeenCalled();
    expect(service.getCodexProvider).not.toHaveBeenCalled();
    expect(service.updateCodexProvider).not.toHaveBeenCalled();
    confirmAgentSetup(snapshot);
    expect(isAgentSetupConfirmed(snapshot)).toBe(true);
    expect(isAgentSetupConfirmed({ ...snapshot, provider: { ...provider, apiKeyConfigured: false } })).toBe(false);
  });

  it('shows provider and API key fields immediately without credentials, never a login action', async () => {
    const service = createService();
    const { onReady } = mount(service);
    const user = userEvent.setup();
    const providerSelect = await screen.findByRole('combobox', { name: '供应商' });
    expect(providerSelect).toHaveValue('openai');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.openai.com/v1');
    expect(screen.getByLabelText('模型名称')).toHaveValue('gpt-5.6-sol');
    await user.selectOptions(providerSelect, 'minimax');
    expect(screen.queryByRole('button', { name: '使用 ChatGPT 登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用本机 Codex，继续' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.minimax.io');
    expect(screen.getByLabelText('模型名称')).toHaveValue('MiniMax-M2.7');
    await user.type(screen.getByLabelText('API Key'), 'secret');
    await user.click(screen.getByRole('button', { name: '保存并开始使用' }));
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    expect(service.updateCodexProvider).toHaveBeenCalledWith({ baseUrl: 'https://api.minimax.io', model: 'MiniMax-M2.7', apiKey: 'secret' });
    expect(screen.getByLabelText('API Key')).toHaveValue('');
  });

  it('only reuses a saved key without editing the existing provider', async () => {
    const service = createService();
    const provider: CodexProviderConfig = { baseUrl: 'https://gateway.example.test/v1', model: 'model-1', apiKeyConfigured: true, authentication: 'api_key' };
    const snapshot = { readiness: readiness('signed_out', 'degraded'), provider };
    const { onReady } = mount(service, snapshot);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '自定义模型服务' }));
    await user.clear(screen.getByLabelText('模型名称'));
    await user.type(screen.getByLabelText('模型名称'), 'new-model');
    expect(screen.getByRole('button', { name: '保存并开始使用' })).toBeDisabled();
    await user.clear(screen.getByLabelText('模型名称'));
    await user.type(screen.getByLabelText('模型名称'), 'model-1');
    await user.click(screen.getByRole('button', { name: '保存并开始使用' }));
    expect(onReady).toHaveBeenCalledWith(snapshot);
    expect(service.updateCodexProvider).not.toHaveBeenCalled();
  });

  it('retains the key on a failed save', async () => {
    const service = createService();
    vi.mocked(service.getCodexReadiness).mockResolvedValue(readiness('signed_out', 'blocked'));
    const { onReady } = mount(service);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole('combobox', { name: '供应商' }), 'openai');
    await user.type(screen.getByLabelText('API Key'), 'secret');
    await user.click(screen.getByRole('button', { name: '保存并开始使用' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('模型服务尚未就绪');
    expect(screen.getByLabelText('API Key')).toHaveValue('secret');
    expect(onReady).not.toHaveBeenCalled();
  });

  it('allows the default OpenAI endpoint without a Base URL', async () => {
    const service = createService();
    const { onReady } = mount(service);
    const user = userEvent.setup();
    await screen.findByRole('combobox', { name: '供应商' });
    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('API Key'), 'secret');
    await user.click(screen.getByRole('button', { name: '保存并开始使用' }));
    expect(service.updateCodexProvider).toHaveBeenCalledWith({ baseUrl: '', model: 'gpt-5.6-sol', apiKey: 'secret' });
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });

  it('retries initial detection after a transient error', async () => {
    const service = createService();
    vi.mocked(service.getCodexProvider).mockRejectedValueOnce(new Error('暂时无法读取')).mockResolvedValue({
      baseUrl: 'https://gateway.example.test/v1', model: 'model-1', apiKeyConfigured: true, authentication: 'api_key'
    });
    const { onReady } = mount(service);
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取');
    await userEvent.setup().click(screen.getByRole('button', { name: '重新检测' }));
    expect(await screen.findByText('已找到本机 Codex')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '使用本机 Codex，继续' }));
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('supports skipping without changing local Codex', async () => {
    const service = createService();
    const { onSkip } = mount(service);
    await userEvent.setup().click(screen.getByRole('button', { name: '暂时跳过' }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(service.updateCodexProvider).not.toHaveBeenCalled();
  });
});
