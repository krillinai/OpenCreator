import type {
  OpenCreatorStorageSettingsResponse,
  UpdateOpenCreatorStorageSettingsRequest,
  OpenCreatorUiSettingsResponse,
  UpdateOpenCreatorUiSettingsRequest
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'patch' | 'post'>;

export function createOpenCreatorSettingsService(client: ClientLike) {
  return {
    claimAgentOnboarding(offer: boolean): Promise<{ show: boolean }> {
      return client.post('/settings/agent-onboarding', { offer });
    },
    getUiSettings(): Promise<OpenCreatorUiSettingsResponse> {
      return client.get('/settings/ui');
    },
    updateUiSettings(
      update: UpdateOpenCreatorUiSettingsRequest
    ): Promise<OpenCreatorUiSettingsResponse> {
      return client.patch('/settings/ui', update);
    },
    getStorageSettings(): Promise<OpenCreatorStorageSettingsResponse> {
      return client.get('/settings/storage');
    },
    updateStorageSettings(
      update: UpdateOpenCreatorStorageSettingsRequest
    ): Promise<OpenCreatorStorageSettingsResponse> {
      return client.patch('/settings/storage', update);
    }
  };
}

export type OpenCreatorSettingsService =
  ReturnType<typeof createOpenCreatorSettingsService>;
