import type { CodexProviderConfig } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CodexRuntimeSettingsView } from './CodexRuntimeSettingsView.js';

describe('CodexRuntimeSettingsView', () => {
  it('only renders Base URL, Model and API Key configuration', async () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CodexRuntimeSettingsView connected service={createService()} />
      </LanguageProvider>
    );

    expect(await screen.findByLabelText('Base URL')).toHaveValue('https://api.example.test/v1');
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-test');
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    expect(screen.getByText('API Key 已配置')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();

    for (const removed of [
      'Agent 登录',
      'Runtime 版本与隔离',
      '运行就绪状态',
      '外部 Codex（高级）'
    ]) {
      expect(screen.queryByText(removed)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 ChatGPT 登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择外部 Codex…' })).not.toBeInTheDocument();
  });

  it('saves base URL, API key and model without reading the secret back', async () => {
    const service = createService();
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
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(service.updateCodexProvider).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-custom',
      apiKey: 'sk-secret'
    }));
    expect(await screen.findByText('API Key 已配置')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Codex Agent 配置已保存');
  });

  it('shows only the unavailable configuration state when Runtime is disconnected', () => {
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CodexRuntimeSettingsView connected={false} service={null} />
      </LanguageProvider>
    );

    expect(screen.getByRole('status')).toHaveTextContent('无法读取 Codex Agent 配置');
    expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
  });
});

function createService() {
  return {
    getCodexProvider: vi.fn(async () => provider()),
    updateCodexProvider: vi.fn(async input => ({
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyConfigured: input.apiKey !== undefined,
      authentication: input.apiKey === undefined ? 'none' as const : 'api_key' as const,
      configVersion: 'v2'
    }))
  };
}

function provider(): CodexProviderConfig {
  return {
    baseUrl: 'https://api.example.test/v1',
    model: 'gpt-test',
    apiKeyConfigured: true,
    authentication: 'none',
    configVersion: 'v1'
  };
}
