export type OmniVoiceComponentStatus = {
  state: 'ready' | 'missing' | 'preparing' | 'failed';
  path?: string | null;
  error?: string;
};
import type { CreatorRuntimeComponent, CreatorRuntimeComponentsResponse, CreatorYtDlpStatusResponse } from '@opencreator/protocol';

type ClientLike = {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
};

export function createRuntimeDependencyService(client: ClientLike) {
  return {
    getComponentsStatus(): Promise<CreatorRuntimeComponentsResponse> {
      return client.get('/creator/components/status') as Promise<CreatorRuntimeComponentsResponse>;
    },
    downloadComponents(componentId?: CreatorRuntimeComponent['id']): Promise<CreatorRuntimeComponentsResponse> {
      return client.post('/creator/components/download', componentId === undefined ? undefined : { componentId }) as Promise<CreatorRuntimeComponentsResponse>;
    },
    getOmniVoiceComponent(): Promise<OmniVoiceComponentStatus> {
      return client.get('/creator/models/omnivoice') as Promise<OmniVoiceComponentStatus>;
    },
    downloadOmniVoiceComponent(): Promise<OmniVoiceComponentStatus> {
      return client.post('/creator/models/omnivoice/install') as Promise<OmniVoiceComponentStatus>;
    },
    getYtDlpStatus(): Promise<CreatorYtDlpStatusResponse> {
      return client.get('/creator/yt-dlp/status') as Promise<CreatorYtDlpStatusResponse>;
    },
    checkYtDlpUpdate(force = true): Promise<CreatorYtDlpStatusResponse> {
      return client.post(
        '/creator/yt-dlp/check',
        { force }
      ) as Promise<CreatorYtDlpStatusResponse>;
    },
    updateYtDlp(): Promise<CreatorYtDlpStatusResponse> {
      return client.post('/creator/yt-dlp/update') as Promise<CreatorYtDlpStatusResponse>;
    }
  };
}

export type RuntimeDependencyService = ReturnType<typeof createRuntimeDependencyService>;
