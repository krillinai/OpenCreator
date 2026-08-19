import type {
  CodexProfileDeleteResponse,
  CodexProfileDetailResponse,
  CodexProfileListResponse,
  CodexProfileMutationResponse,
  CreateCodexProfileRequest,
  UpdateCodexProfileRequest
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createProfileService(client: RuntimeClient) {
  return {
    listProfiles(): Promise<CodexProfileListResponse> {
      return client.get('/codex/profiles');
    },
    getProfile(name: string): Promise<CodexProfileDetailResponse> {
      return client.get(`/codex/profiles/${encodeURIComponent(name)}`);
    },
    createProfile(input: CreateCodexProfileRequest): Promise<CodexProfileMutationResponse> {
      return client.post('/codex/profiles', input);
    },
    updateProfile(
      name: string,
      input: UpdateCodexProfileRequest
    ): Promise<CodexProfileMutationResponse> {
      return client.patch(`/codex/profiles/${encodeURIComponent(name)}`, input);
    },
    deleteProfile(name: string): Promise<CodexProfileDeleteResponse> {
      return client.delete(`/codex/profiles/${encodeURIComponent(name)}`);
    }
  };
}
