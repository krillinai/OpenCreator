import type {
  CreateVideoGenerationRequest,
  VideoGenerationResultResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type VideoGenerationClient = Pick<RuntimeClient, 'post' | 'get' | 'rawGet'>;

export type VideoGenerationService = ReturnType<typeof createVideoGenerationService>;

export function createVideoGenerationService(client: VideoGenerationClient) {
  return {
    generate(request: CreateVideoGenerationRequest): Promise<VideoGenerationResultResponse> {
      return client.post('/video-generation/results', request);
    },
    get(id: string): Promise<VideoGenerationResultResponse> {
      return client.get(`/video-generation/results/${encodeURIComponent(id)}`);
    },
    openContent(id: string): Promise<Response> {
      return client.rawGet(`/video-generation/results/${encodeURIComponent(id)}/content`);
    }
  };
}
