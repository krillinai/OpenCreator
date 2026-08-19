import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { CreatorServicesSettingsView } from './CreatorServicesSettingsView.js';

describe('CreatorServicesSettingsView', () => {
  it('loads and saves text model credentials through the Runtime service', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(<CreatorServicesSettingsView connected service={service} />);

    expect(await screen.findByRole('heading', { name: 'AI 服务' })).toBeInTheDocument();
    const apiKey = await screen.findByLabelText('API Key');
    expect(apiKey).toHaveAttribute('type', 'password');
    await user.type(apiKey, 'sk-opencreator');
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(service.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(service.saveConfig).mock.calls[0]?.[0].llm.apiKey)
      .toBe('sk-opencreator');
    expect(screen.getByText('配置已安全保存')).toBeInTheDocument();
  });

  it('shows only the fields required by the selected transcription and voice providers', async () => {
    const user = userEvent.setup();
    render(<CreatorServicesSettingsView connected service={createService()} />);
    await screen.findByRole('tabpanel');

    await user.click(screen.getByRole('tab', { name: '语音识别' }));
    await user.click(screen.getByRole('combobox', { name: '服务商' }));
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
    expect(screen.getByLabelText('模型')).toHaveValue('gpt-image-1');

    await user.click(screen.getByRole('tab', { name: '视频生成' }));
    expect(screen.getByLabelText('模型')).toHaveValue('sora-2');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
  });

  it('explains that the local Runtime is required when disconnected', () => {
    render(<CreatorServicesSettingsView connected={false} service={null} />);

    expect(screen.getByText('连接本地 Runtime 后即可管理 AI 服务配置。'))
      .toBeInTheDocument();
  });
});

function createService(): CreatorServicesSettingsService {
  const config = createDefaultCreatorServicesConfig();
  return {
    getConfig: vi.fn(async () => ({ config: structuredClone(config) })),
    saveConfig: vi.fn(async next => ({ config: structuredClone(next) })),
    resetConfig: vi.fn(async () => ({ config: createDefaultCreatorServicesConfig() }))
  };
}
