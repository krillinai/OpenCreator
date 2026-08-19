import type {
  CodexSkillMarketInstallRecordListResponse,
  CodexSkillMarketMutationResponse,
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post'>;

export function createSkillMarketService(client: ClientLike) {
  return {
    listInstallRecords(): Promise<CodexSkillMarketInstallRecordListResponse> {
      return client.get('/codex/skill-market/install-records');
    },
    installSkill(id: string): Promise<CodexSkillMarketMutationResponse> {
      return client.post(
        `/codex/skill-market/${encodeURIComponent(id)}/install`
      );
    },
    updateSkill(id: string): Promise<CodexSkillMarketMutationResponse> {
      return client.post(
        `/codex/skill-market/${encodeURIComponent(id)}/update`
      );
    },
  };
}
