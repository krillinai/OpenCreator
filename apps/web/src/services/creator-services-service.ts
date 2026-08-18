import type {
  CreatorServicesConfig,
  CreatorServicesConfigResponse
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'patch' | 'delete'>;

export type CreatorServicesSettingsService = ReturnType<typeof createCreatorServicesService>;

export function createCreatorServicesService(client: ClientLike) {
  return {
    getConfig(): Promise<CreatorServicesConfigResponse> {
      return client.get('/creator-services/config');
    },
    saveConfig(config: CreatorServicesConfig): Promise<CreatorServicesConfigResponse> {
      return client.patch('/creator-services/config', config);
    },
    resetConfig(): Promise<CreatorServicesConfigResponse> {
      return client.delete('/creator-services/config');
    }
  };
}
