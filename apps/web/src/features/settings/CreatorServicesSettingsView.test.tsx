import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { CreatorServicesSettingsView } from './CreatorServicesSettingsView.js';

describe('CreatorServicesSettingsView', () => {
  it('shows the shared Codex Agent text model and saves Creator-specific options', async () => {
    const user = userEvent.setup();
    const service = createService(['llm.apiKey']);
    render(<CreatorServicesSettingsView connected service={service} />);

    expect(await screen.findByRole('heading', { name: 'AI 服务' })).toBeInTheDocument();
    expect(screen.getByText('https://gateway.example.test/v1')).toBeInTheDocument();
    expect(screen.getByText('gpt-shared')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.getByText(/请在“Codex Agent”中修改/)).toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /JSON 输出模式/ }));
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(service.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(service.saveConfig).mock.calls[0]?.[0].llm).toMatchObject({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-shared',
      jsonMode: true
    });
    expect(screen.getByText('配置已安全保存')).toBeInTheDocument();
  });

  it('shows configured credentials without loading their secret values', async () => {
    render(<CreatorServicesSettingsView connected service={createService(['llm.apiKey'])} />);

    expect(await screen.findByText('API Key')).toBeInTheDocument();
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it('shows only the fields required by the selected transcription and voice providers', async () => {
    const user = userEvent.setup();
    render(<CreatorServicesSettingsView connected service={createService()} />);
    await screen.findByRole('tabpanel');

    await user.click(screen.getByRole('tab', { name: '语音识别' }));
    await user.click(screen.getByRole('combobox', { name: '优先服务' }));
    await user.click(screen.getByRole('option', { name: 'Whisper.cpp' }));
    expect(screen.getByRole('combobox', { name: '本地模型' })).toHaveTextContent('tiny');

    await user.click(screen.getByRole('combobox', { name: '优先服务' }));
    await user.click(screen.getByRole('option', { name: '阿里云语音' }));
    expect(screen.getByText('OSS 存储')).toBeInTheDocument();
    expect(screen.getByText('语音服务')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Access Key Secret')).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: '配音服务' }));
    await user.click(screen.getByRole('combobox', { name: '服务商' }));
    await user.click(screen.getByRole('option', { name: 'Edge TTS' }));
    expect(screen.getByText('无需填写凭据。运行时会使用本地 Edge TTS 服务。'))
      .toBeInTheDocument();
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  });

  it('localizes the service navigation in English', async () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorServicesSettingsView connected service={createService()} />
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: 'AI Services' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Text' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transcription' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Voice' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Images' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video' })).toBeInTheDocument();
  });

  it('configures image and video generation as separate services', async () => {
    const user = userEvent.setup();
    render(<CreatorServicesSettingsView connected service={createService()} />);
    await screen.findByRole('tabpanel');

    await user.click(screen.getByRole('tab', { name: '图像生成' }));
    expect(screen.getByRole('combobox', { name: '服务商' })).toHaveTextContent('GPT Image');
    expect(screen.getByLabelText('模型')).toHaveValue('gpt-image-1');
    await user.click(screen.getByRole('combobox', { name: '服务商' }));
    await user.click(screen.getByRole('option', { name: '可灵' }));
    expect(screen.getByLabelText('Access Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Secret Key')).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('tab', { name: '视频生成' }));
    expect(screen.getByRole('combobox', { name: '服务商' })).toHaveTextContent('Seedance');
    expect(screen.getByLabelText('模型')).toHaveValue('doubao-seedance-1-0-pro-250528');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('combobox', { name: '服务商' }));
    await user.click(screen.getByRole('option', { name: 'Veo' }));
    expect(screen.getByLabelText('模型')).toHaveValue('veo-3.1-generate-preview');
  });

  it('explains that the local Runtime is required when disconnected', () => {
    render(<CreatorServicesSettingsView connected={false} service={null} />);

    expect(screen.getByText('连接本地 Runtime 后即可管理 AI 服务配置。'))
      .toBeInTheDocument();
  });
});

function createService(configuredCredentials: Array<'llm.apiKey'> = []): CreatorServicesSettingsService {
  const config = createDefaultCreatorServicesConfig();
  config.llm.baseUrl = 'https://gateway.example.test/v1';
  config.llm.model = 'gpt-shared';
  return {
    getConfig: vi.fn(async () => ({ config: structuredClone(config), configuredCredentials })),
    saveConfig: vi.fn(async next => ({ config: structuredClone(next), configuredCredentials })),
    resetConfig: vi.fn(async () => ({ config: createDefaultCreatorServicesConfig(), configuredCredentials: [] }))
  };
}
