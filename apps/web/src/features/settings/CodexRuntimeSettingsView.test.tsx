import type { CodexProviderConfig, CodexRuntimeReadiness } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CodexRuntimeSettingsView } from './CodexRuntimeSettingsView.js';

describe('CodexRuntimeSettingsView', () => {
  it('keeps Codex Agent login separate from Creator provider configuration', async () => {
    const service = createService(readiness());
    const onOpenExternal = vi.fn(async () => undefined);
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CodexRuntimeSettingsView
          connected
          service={service}
          onOpenExternal={onOpenExternal}
        />
      </LanguageProvider>
    );

    expect(await screen.findByText('内置 Codex')).toBeInTheDocument();
    expect(screen.getByText('0.149.0')).toBeInTheDocument();
    expect(screen.getByText('758ef40f50c1a458425c7cfbf1eb12cbc07af0b0')).toBeInTheDocument();
    expect(screen.getByText('binary-sha')).toBeInTheDocument();
    expect(screen.getByText(/翻译、转录、配音和生图密钥仍在“AI 服务”中配置/)).toBeInTheDocument();
    expect(screen.queryByText(/OpenAI 转录 API Key/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.example.test/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-test');

    fireEvent.click(screen.getByRole('button', { name: '使用 ChatGPT 登录' }));
    await waitFor(() => expect(service.startCodexLogin).toHaveBeenCalledWith({ loginType: 'chatgpt' }));
    expect(onOpenExternal).toHaveBeenCalledWith('https://auth.example.test');
    expect(await screen.findByText('等待完成登录')).toBeInTheDocument();
  });

  it('only switches to an explicitly selected external Codex path', async () => {
    const onSelectExternalCodex = vi.fn(async () => ({ ok: true as const }));
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CodexRuntimeSettingsView
          connected
          service={createService(readiness())}
          onSelectExternalCodex={onSelectExternalCodex}
        />
      </LanguageProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: '选择外部 Codex…' }));
    await waitFor(() => expect(onSelectExternalCodex).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent('Runtime 已重启');
    expect(screen.getByText(/失败时不会搜索 PATH 兜底/)).toBeInTheDocument();
  });

  it('saves base URL, API key and model without reading the secret back', async () => {
    const service = createService(readiness());
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CodexRuntimeSettingsView connected service={service} />
      </LanguageProvider>
    );

    fireEvent.change(await screen.findByLabelText('Base URL'), {
      target: { value: 'https://gateway.example.test/v1' }
    });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'gpt-custom' }
    });
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并刷新 Agent' }));

    await waitFor(() => expect(service.updateCodexProvider).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-custom',
      apiKey: 'sk-secret'
    }));
    expect(await screen.findByText('API Key 已配置')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Agent Runtime 已刷新');
  });
});

function createService(value: CodexRuntimeReadiness) {
  return {
    getCodexReadiness: vi.fn(async () => value),
    getCodexProvider: vi.fn(async () => provider()),
    updateCodexProvider: vi.fn(async input => ({
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyConfigured: input.apiKey !== undefined,
      authentication: input.apiKey === undefined ? 'chatgpt' as const : 'api_key' as const,
      configVersion: 'v2'
    })),
    startCodexLogin: vi.fn(async () => ({
      loginId: 'login_1',
      status: 'pending' as const,
      authUrl: 'https://auth.example.test'
    })),
    cancelCodexLogin: vi.fn(async () => ({ loginId: 'login_1', canceled: true })),
    logoutCodex: vi.fn(async () => ({ signedOut: true }))
  };
}

function provider(): CodexProviderConfig {
  return {
    baseUrl: 'https://api.example.test/v1',
    model: 'gpt-test',
    apiKeyConfigured: false,
    authentication: 'none',
    configVersion: 'v1'
  };
}

function readiness(): CodexRuntimeReadiness {
  const ready = { status: 'ready' as const };
  return {
    state: 'degraded',
    mode: 'bundled',
    version: '0.149.0',
    commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
    binaryPath: 'C:\\OpenCreator\\resources\\codex-runtime\\bin\\codex.exe',
    codexHome: 'C:\\Users\\test\\OpenCreator\\runtime\\codex\\home',
    checkedAt: '2026-08-21T00:00:00.000Z',
    binary: { status: 'ready', details: { sha256: 'binary-sha' } },
    protocol: ready,
    account: { status: 'not_authenticated', accountStatus: 'signed_out' },
    models: ready,
    skills: ready,
    toolServer: ready,
    diagnostics: []
  };
}
