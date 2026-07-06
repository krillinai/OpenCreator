import type { CleanupDeleteRequest, CleanupDeleteResponse, CleanupPreviewResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post'>;

export function createSettingsService(client: ClientLike) {
  return {
    previewCleanup(olderThanDays: number): Promise<CleanupPreviewResponse> {
      return client.get(`/runtime/cleanup/preview?olderThanDays=${olderThanDays}`);
    },
    deleteCleanup(input: CleanupDeleteRequest): Promise<CleanupDeleteResponse> {
      return client.post('/runtime/cleanup', input);
    }
  };
}
