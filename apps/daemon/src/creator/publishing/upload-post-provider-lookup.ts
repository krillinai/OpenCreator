import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorProviderCapabilities } from '../provider-requests.js';
import { confirmationIdFromRequestKey } from '../stickman/social-publish.js';
import { createUploadPostClient, type UploadPostClient } from './upload-post-client.js';

/**
 * Lets provider-request recovery ask Upload-Post what happened to an interrupted
 * publish (the request id is chosen before the upload, so it is always known).
 */
export function createUploadPostProviderCapabilities(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  createClient?: (config: { apiKey: string; proxy: string }) => UploadPostClient;
}): CreatorProviderCapabilities {
  return {
    lookupByRequestKey: true,
    async lookup(request) {
      if (request.provider !== 'upload-post') return { status: 'not_found' };
      const requestId = request.remoteTaskId ?? confirmationIdFromRequestKey(request.requestKey);
      if (requestId === undefined) return { status: 'not_found' };
      const config = await input.configStore.read();
      const { apiKey } = config.publishing.uploadPost;
      if (apiKey.trim().length === 0) return { status: 'not_found' };
      const client = (input.createClient ?? createUploadPostClient)({ apiKey, proxy: config.proxy });
      const status = await client.getStatus(requestId, AbortSignal.timeout(30_000));
      if (status.status === 'not_found') return { status: 'not_found' };
      if (status.status === 'completed' || status.status === 'failed') {
        return { status: 'succeeded', remoteTaskId: requestId };
      }
      return { status: 'waiting_remote', remoteTaskId: requestId };
    }
  };
}
