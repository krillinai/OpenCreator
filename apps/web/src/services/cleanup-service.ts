import type {
  CleanupDeleteRequest,
  CleanupDeleteResponse,
  CleanupPreviewResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post'>;

export function createCleanupService(client: ClientLike) {
  return {
    previewCleanup(olderThanDays: number): Promise<CleanupPreviewResponse> {
      const retention = encodeURIComponent(String(olderThanDays));
      return client.get(`/runtime/cleanup/preview?olderThanDays=${retention}`);
    },
    deleteCleanup(input: CleanupDeleteRequest): Promise<CleanupDeleteResponse> {
      return client.post('/runtime/cleanup', input);
    }
  };
}
