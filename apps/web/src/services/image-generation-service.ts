import type {
  CreateImageGenerationRequest,
  ImageGenerationResultResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ImageGenerationClient = Pick<RuntimeClient, 'post' | 'rawGet'>;

export type ImageGenerationService = ReturnType<typeof createImageGenerationService>;

export function createImageGenerationService(client: ImageGenerationClient) {
  return {
    generate(request: CreateImageGenerationRequest): Promise<ImageGenerationResultResponse> {
      return client.post('/image-generation/results', request);
    },
    openContent(id: string, index: number): Promise<Response> {
      return client.rawGet(`/image-generation/results/${encodeURIComponent(id)}/content/${index}`);
    }
  };
}
