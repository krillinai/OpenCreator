import type {
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  EnterpriseSessionResponse,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillListResponse,
  EnterpriseSkillMutationResponse
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post'>;

export function createEnterpriseService(client: ClientLike) {
  return {
    getSession(): Promise<EnterpriseSessionResponse> {
      return client.get('/enterprise/session');
    },
    refreshSession(): Promise<EnterpriseSessionResponse> {
      return client.post('/enterprise/session/refresh');
    },
    login(input: EnterpriseLoginRequest): Promise<EnterpriseSessionResponse> {
      return client.post('/enterprise/login', input);
    },
    register(input: EnterpriseRegisterRequest): Promise<EnterpriseSessionResponse> {
      return client.post('/enterprise/register', input);
    },
    logout(): Promise<EnterpriseSessionResponse> {
      return client.post('/enterprise/logout');
    },
    listSkills(): Promise<EnterpriseSkillListResponse> {
      return client.get('/enterprise/skills');
    },
    getSkillDetail(skillId: string): Promise<EnterpriseSkillDetailResponse> {
      return client.get(`/enterprise/skills/${encodeURIComponent(skillId)}`);
    },
    installSkill(skillId: string): Promise<EnterpriseSkillMutationResponse> {
      return client.post(
        `/enterprise/skills/${encodeURIComponent(skillId)}/install`
      );
    },
    updateSkill(skillId: string): Promise<EnterpriseSkillMutationResponse> {
      return client.post(
        `/enterprise/skills/${encodeURIComponent(skillId)}/update`
      );
    }
  };
}
