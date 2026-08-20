import type { VideoMetadataResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export type VideoMetadataService = ReturnType<typeof createVideoMetadataService>;

export function createVideoMetadataService(client: RuntimeClient) {
  return {
    getVideoMetadata(url: string): Promise<VideoMetadataResponse> {
      const params = new URLSearchParams({ url });
      return client.get(`/video-metadata?${params.toString()}`);
    }
  };
}
