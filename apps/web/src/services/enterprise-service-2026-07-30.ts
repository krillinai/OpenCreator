import type {
  EnterpriseKnowledgeBaseListResponse,
  EnterpriseKnowledgeDocumentListResponse,
  EnterpriseKnowledgeDocumentUploadResponse,
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  EnterpriseSessionResponse,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillListResponse,
  EnterpriseSkillMutationResponse
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post' | 'postBinary'>;

const KNOWLEDGE_DOCUMENT_CONTENT_TYPE =
  'application/vnd.clawee.knowledge-document';

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
    listKnowledgeBases(): Promise<EnterpriseKnowledgeBaseListResponse> {
      return client.get('/enterprise/knowledge-bases');
    },
    listKnowledgeDocuments(
      knowledgeBaseId: string
    ): Promise<EnterpriseKnowledgeDocumentListResponse> {
      return client.get(
        `/enterprise/knowledge-bases/${encodeURIComponent(knowledgeBaseId)}/documents`
      );
    },
    uploadKnowledgeDocument(input: {
      knowledgeBaseId: string;
      file: File;
    }): Promise<EnterpriseKnowledgeDocumentUploadResponse> {
      const query = new URLSearchParams({
        fileName: input.file.name,
        mimeType: input.file.type || 'application/octet-stream',
        sizeBytes: String(input.file.size)
      });
      return client.postBinary(
        `/enterprise/knowledge-bases/${encodeURIComponent(input.knowledgeBaseId)}/documents?${query.toString()}`,
        input.file,
        KNOWLEDGE_DOCUMENT_CONTENT_TYPE
      );
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
