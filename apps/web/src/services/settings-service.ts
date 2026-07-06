import type { CleanupDeleteResponse, CleanupPreviewResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createSettingsService(client: RuntimeClient) {
  return {
    previewCleanup(olderThanDays: number): Promise<CleanupPreviewResponse> {
      return client.get(`/runtime/cleanup/preview?olderThanDays=${olderThanDays}`);
    },
    deleteCleanup(olderThanDays: number): Promise<CleanupDeleteResponse> {
      return client.post('/runtime/cleanup', { olderThanDays, confirm: true });
    }
  };
}
