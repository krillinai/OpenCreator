import type { CodexModelListResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get'>;

export function createModelService(client: ClientLike) {
  return {
    listModels(): Promise<CodexModelListResponse> {
      return client.get('/codex/models');
    }
  };
}
