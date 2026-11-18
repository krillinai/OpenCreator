import type {
  CodexImageStatus,
  CodexProviderConfig,
  CreatorServicesCapabilitiesResponse,
  CreatorServicesConfig,
  CreatorServicesCredentialField,
  CreatorServicesConfigResponse,
  CreatorTtsPreviewRequest,
  CreatorTtsProvider,
  CreatorTtsVoicesResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post' | 'patch' | 'delete' | 'rawRequest'>;

export type NetworkTestResult =
  | { status: 'not_configured' }
  | { status: 'proxy_unreachable' }
  | { status: 'proxy_auth_required' }
  | { status: 'upstream_unreachable' }
  | { status: 'reachable'; httpStatus: number };

export type CreatorServicesSettingsService = Omit<ReturnType<typeof createCreatorServicesService>, 'getCodexImageStatus' | 'getCodexModelStatus' | 'getNetwork' | 'saveNetwork' | 'testNetwork' | 'getLocalVideoConfig' | 'saveLocalVideoConfig'> & {
  getCodexImageStatus?: () => Promise<CodexImageStatus>;
  getCodexModelStatus?: () => Promise<CodexProviderConfig>;
  getNetwork?: () => Promise<{ proxy: string }>;
  saveNetwork?: (network: { proxy: string }) => Promise<{ proxy: string }>;
  testNetwork?: (network: { proxy: string }) => Promise<NetworkTestResult>;
  getLocalVideoConfig?: () => Promise<CreatorServicesConfigResponse>;
  saveLocalVideoConfig?: (video: CreatorServicesConfig['video'], clearCredentials?: CreatorServicesCredentialField[]) => Promise<CreatorServicesConfigResponse>;
};

export function createCreatorServicesService(client: ClientLike) {
  return {
    getNetwork(): Promise<{ proxy: string }> { return client.get('/creator-services/network'); },
    saveNetwork(network: { proxy: string }): Promise<{ proxy: string }> { return client.patch('/creator-services/network', network); },
    testNetwork(network: { proxy: string }): Promise<NetworkTestResult> { return client.post('/creator-services/network/test', network); },
    getCodexModelStatus(): Promise<CodexProviderConfig> {
      return client.get('/creator-services/model/codex/status');
    },
    getCodexImageStatus(): Promise<CodexImageStatus> {
      return client.get('/creator-services/image/codex/status');
    },
    getCapabilities(): Promise<CreatorServicesCapabilitiesResponse> {
      return client.get('/creator-services/capabilities');
    },
    getConfig(): Promise<CreatorServicesConfigResponse> {
      return client.get('/creator-services/config');
    },
    getLocalVideoConfig(): Promise<CreatorServicesConfigResponse> {
      return client.get('/creator-services/video/local');
    },
    saveLocalVideoConfig(video: CreatorServicesConfig['video'], clearCredentials: CreatorServicesCredentialField[] = []): Promise<CreatorServicesConfigResponse> {
      return client.patch('/creator-services/video/local', { video, clearCredentials });
    },
    saveConfig(
      config: CreatorServicesConfig,
      clearCredentials: CreatorServicesCredentialField[] = []
    ): Promise<CreatorServicesConfigResponse> {
      return client.patch('/creator-services/config', clearCredentials.length === 0
        ? config
        : { config, clearCredentials });
    },
    testTranscriptionConnection(config: CreatorServicesConfig['transcription']['funasr']): Promise<{ connected: boolean; model: string; models: string[]; capabilities: string[] }> { return client.rawRequest('/creator-services/transcription/test', { method: 'POST', body: config }).then(response => response.json()); },
    resetConfig(): Promise<CreatorServicesConfigResponse> {
      return client.delete('/creator-services/config');
    },
    getTtsVoices(
      provider: CreatorTtsProvider,
      model?: string
    ): Promise<CreatorTtsVoicesResponse> {
      const query = new URLSearchParams({ provider });
      if (model?.trim()) query.set('model', model.trim());
      return client.get(`/creator-services/tts/voices?${query.toString()}`);
    },
    previewTtsVoice(request: CreatorTtsPreviewRequest): Promise<Response> {
      return client.rawRequest('/creator-services/tts/preview', {
        method: 'POST',
        body: request
      });
    }
  };
}
