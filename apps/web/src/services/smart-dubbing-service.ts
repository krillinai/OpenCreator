import type {
  CreateSmartDubbingRequest,
  SmartDubbingResultResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type SmartDubbingClient = Pick<RuntimeClient, 'post' | 'rawGet' | 'rawRequest'>;

export type SmartDubbingService = ReturnType<typeof createSmartDubbingService>;

export function createSmartDubbingService(client: SmartDubbingClient) {
  return {
    preview(request: CreateSmartDubbingRequest): Promise<Response> {
      return client.rawRequest('/smart-dubbing/preview', { method: 'POST', body: request });
    },
    generate(request: CreateSmartDubbingRequest): Promise<SmartDubbingResultResponse> {
      return client.post('/smart-dubbing/results', request);
    },
    openContent(id: string): Promise<Response> {
      return client.rawGet(`/smart-dubbing/results/${encodeURIComponent(id)}/content`);
    }
  };
}
