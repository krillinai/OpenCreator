import {
  createDefaultCreatorServicesConfig,
  type CreatorServicesCapabilitiesResponse,
  type CreatorServicesCredentialField,
  type CreatorTtsProvider
} from '@opencreator/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/dialogs/ConfirmDialogProvider.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { CreatorServicesSettingsView } from './CreatorServicesSettingsView.js';

describe('CreatorServicesSettingsView', () => {
  it('edits the shared model provider used by Agent and text tasks', async () => {
    const user = userEvent.setup();
    const service = createService(['llm.apiKey']);
    const modelService = createModelService();
    render(
      <CreatorServicesSettingsView
        connected
        service={service}
        modelService={modelService}
      />
    );

    expect(await screen.findByRole('heading', { name: 'AI 服务' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '模型服务' })).toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://gateway.example.test/v1');
    expect(screen.getByLabelText('模型')).toHaveValue('gpt-shared');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '已配置，留空则保持');
    expect(screen.getByText('Agent 可用')).toBeInTheDocument();
    expect(screen.getByText('文本任务可用')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('模型'));
    await user.type(screen.getByLabelText('模型'), 'gpt-unified');
    await user.type(screen.getByLabelText('API Key'), 'sk-unified');
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(modelService.updateCodexProvider).toHaveBeenCalledWith({
      baseUrl: 'https://gateway.example.test/v1',
      model: 'gpt-unified',
      apiKey: 'sk-unified'
    }));
    await waitFor(() => expect(service.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(service.saveConfig).mock.calls[0]?.[0].llm).toMatchObject({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: '',
      model: 'gpt-unified',
      source: 'codex'
    });
    expect(screen.getByText('配置已安全保存')).toBeInTheDocument();
  });

  it('shows configured credentials without loading their secret values', async () => {
    render(
      <CreatorServicesSettingsView
        connected
        service={createService(['llm.apiKey'])}
        modelService={createModelService()}
      />
    );

    const apiKey = await screen.findByLabelText('API Key');
    expect(apiKey).toHaveValue('');
    expect(apiKey).toHaveAttribute('placeholder', '已配置，留空则保持');
    expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
  });

  it('shows only the fields required by the selected transcription and voice providers', async () => {
    const user = userEvent.setup();
    render(
      <CreatorServicesSettingsView
        connected
        service={createService()}
        modelService={createModelService()}
      />
    );
    await screen.findByRole('tabpanel');

    await user.click(screen.getByRole('tab', { name: '语音识别' }));
    expect(screen.getByText('macOS · Apple Silicon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '云端 API' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/API Key 可以暂不填写/)).toBeInTheDocument();
    expect(screen.getByText('whisper-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '本地 Whisper' }));
    expect(screen.getByRole('combobox', { name: '语音识别服务' })).toHaveTextContent('WhisperKit');
    expect(screen.getByText('large-v2')).toBeInTheDocument();
    expect(screen.queryByText('FasterWhisper')).not.toBeInTheDocument();
    expect(screen.queryByText('Whisper.cpp')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '云端 API' }));
    await user.click(screen.getByRole('combobox', { name: '语音识别服务' }));
    await user.click(screen.getByRole('option', { name: '阿里云百炼' }));
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

  it('confirms before saving a newly selected local Whisper provider', async () => {
    const user = userEvent.setup();
    const service = createService();
    render(
      <ConfirmDialogProvider>
        <CreatorServicesSettingsView
          connected
          service={service}
          modelService={createModelService()}
        />
      </ConfirmDialogProvider>
    );

    await user.click(await screen.findByRole('tab', { name: '语音识别' }));
    await user.click(screen.getByRole('button', { name: '本地 Whisper' }));
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    expect(await screen.findByRole('heading', { name: '启用本地语音识别' })).toBeInTheDocument();
    expect(screen.getByText(/KrillinAI 下次启动时会检查并按需下载 WhisperKit large-v2/))
      .toBeInTheDocument();
    expect(service.saveConfig).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '保存并启用' }));
    await waitFor(() => expect(service.saveConfig).toHaveBeenCalled());
    expect(vi.mocked(service.saveConfig).mock.calls[0]?.[0].transcription.provider)
      .toBe('whisperkit');
  });

  it('disables local Whisper when the Runtime has no controlled installer', async () => {
    render(
      <CreatorServicesSettingsView
        connected
        service={createService([], runtimeCapabilities('win32', 'x64'))}
        modelService={createModelService()}
      />
    );

    await userEvent.setup().click(await screen.findByRole('tab', { name: '语音识别' }));
    expect(screen.getByText('Windows · x64')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '本地 Whisper' })).toBeDisabled();
    expect(screen.queryByText('WhisperKit')).not.toBeInTheDocument();
    expect(screen.queryByText('FasterWhisper')).not.toBeInTheDocument();
    expect(screen.queryByText('Whisper.cpp')).not.toBeInTheDocument();
  });

  it('requires reselecting a local provider saved on another Runtime', async () => {
    const user = userEvent.setup();
    const service = createService([], runtimeCapabilities('win32', 'x64'));
    const staleConfig = createDefaultCreatorServicesConfig();
    staleConfig.transcription.provider = 'whisperkit';
    vi.mocked(service.getConfig).mockResolvedValue({
      config: staleConfig,
      configuredCredentials: []
    });
    render(
      <CreatorServicesSettingsView
        connected
        service={service}
        modelService={createModelService()}
      />
    );

    await user.click(await screen.findByRole('tab', { name: '语音识别' }));
    expect(screen.getByRole('button', { name: '本地 Whisper' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '当前 Windows · x64 不支持 WhisperKit 的受控安装'
    );

    await user.click(screen.getByRole('button', { name: '保存配置' }));
    expect(service.saveConfig).not.toHaveBeenCalled();
    expect(screen.getByText('当前 Runtime 不支持已选语音识别服务，请重新选择后保存。'))
      .toBeInTheDocument();
  });

  it('localizes the service navigation in English', async () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorServicesSettingsView
          connected
          service={createService()}
          modelService={createModelService()}
        />
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: 'AI Services' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Transcription' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Voice' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Images' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video' })).toBeInTheDocument();
  });

  it('configures image and video generation as separate services', async () => {
    const user = userEvent.setup();
    render(
      <CreatorServicesSettingsView
        connected
        service={createService()}
        modelService={createModelService()}
      />
    );
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

  it('keeps non-model services available when the model provider cannot be read', async () => {
    const modelService = createModelService();
    vi.mocked(modelService.getCodexProvider).mockRejectedValue(
      new Error('model provider unavailable')
    );
    render(
      <CreatorServicesSettingsView
        connected
        service={createService()}
        modelService={modelService}
        initialSection="tts"
      />
    );

    expect(await screen.findByRole('tab', { name: '配音服务' }))
      .toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: '服务商' })).toBeInTheDocument();
    expect(screen.queryByText('配置暂不可用')).not.toBeInTheDocument();
  });

  it('explains that the local Runtime is required when disconnected', () => {
    render(<CreatorServicesSettingsView connected={false} service={null} />);

    expect(screen.getByText('连接本地 Runtime 后即可管理 AI 服务配置。'))
      .toBeInTheDocument();
  });
});

function createService(
  configuredCredentials: CreatorServicesCredentialField[] = [],
  capabilities: CreatorServicesCapabilitiesResponse = runtimeCapabilities('darwin', 'arm64')
): CreatorServicesSettingsService {
  const config = createDefaultCreatorServicesConfig();
  config.llm.baseUrl = 'https://gateway.example.test/v1';
  config.llm.model = 'gpt-shared';
  return {
    getCapabilities: vi.fn(async () => structuredClone(capabilities)),
    getConfig: vi.fn(async () => ({ config: structuredClone(config), configuredCredentials })),
    saveConfig: vi.fn(async next => ({ config: structuredClone(next), configuredCredentials })),
    resetConfig: vi.fn(async () => ({ config: createDefaultCreatorServicesConfig(), configuredCredentials: [] })),
    getTtsVoices: vi.fn(async (provider: CreatorTtsProvider) => ({
      provider,
      model: config.tts[provider === 'edge-tts' ? 'openai' : provider].model,
      voices: provider === 'edge-tts'
        ? []
        : [{
            id: config.tts[provider].defaultVoiceId,
            name: config.tts[provider].defaultVoiceId,
            provider,
            kind: 'builtin' as const
          }]
    })),
    previewTtsVoice: vi.fn(async () => new Response(Buffer.from('preview-audio'), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' }
    }))
  };
}

function createModelService(options: {
  authentication?: 'none' | 'chatgpt' | 'api_key';
  apiKeyConfigured?: boolean;
} = {}) {
  const provider = {
    baseUrl: 'https://gateway.example.test/v1',
    model: 'gpt-shared',
    authentication: options.authentication ?? 'api_key' as const,
    apiKeyConfigured: options.apiKeyConfigured ?? true,
    configVersion: 'v1'
  };
  return {
    getCodexProvider: vi.fn(async () => structuredClone(provider)),
    updateCodexProvider: vi.fn(async input => ({
      baseUrl: input.baseUrl,
      model: input.model,
      authentication: input.apiKey === undefined
        ? provider.authentication
        : 'api_key' as const,
      apiKeyConfigured: input.apiKey !== undefined || provider.apiKeyConfigured,
      configVersion: 'v2'
    }))
  };
}

function runtimeCapabilities(
  platform: string,
  arch: string
): CreatorServicesCapabilitiesResponse {
  const whisperKitAvailable = platform === 'darwin' && arch === 'arm64';
  return {
    platform,
    arch,
    transcription: {
      providers: [
        {
          provider: 'openai',
          kind: 'cloud',
          available: true,
          models: ['whisper-1'],
          gpuAcceleration: false
        },
        {
          provider: 'faster-whisper',
          kind: 'local',
          available: false,
          models: ['tiny', 'medium', 'large-v2'],
          gpuAcceleration: true,
          unavailableReason: platform === 'win32' || platform === 'linux'
            ? 'installer_unavailable'
            : 'unsupported_platform'
        },
        {
          provider: 'whisperkit',
          kind: 'local',
          available: whisperKitAvailable,
          models: ['large-v2'],
          gpuAcceleration: false,
          ...(whisperKitAvailable ? {} : { unavailableReason: 'unsupported_platform' as const })
        },
        {
          provider: 'whisper.cpp',
          kind: 'local',
          available: false,
          models: ['tiny', 'medium', 'large-v2'],
          gpuAcceleration: false,
          unavailableReason: platform === 'win32'
            ? 'installer_unavailable'
            : 'unsupported_platform'
        },
        {
          provider: 'aliyun',
          kind: 'cloud',
          available: true,
          models: [],
          gpuAcceleration: false
        }
      ]
    }
  };
}
