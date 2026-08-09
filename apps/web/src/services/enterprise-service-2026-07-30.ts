import type {
  EnterpriseKnowledgeBaseListResponse,
  EnterpriseKnowledgeDocumentListResponse,
  EnterpriseKnowledgeDocumentUploadResponse,
  EnterpriseLoginRequest,
  EnterpriseMcpCatalogResponse,
  EnterpriseMcpPreferenceUpdateRequest,
  EnterpriseRegisterRequest,
  EnterpriseSessionResponse,
  EnterpriseSharedFileDetailResponse,
  EnterpriseSharedFileDownloadResponse,
  EnterpriseSharedFileListResponse,
  EnterpriseSharedFileMutationResponse,
  EnterpriseSharedSpaceListResponse,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillListResponse,
  EnterpriseSkillMutationResponse
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post' | 'postBinary' | 'patch'>;

const KNOWLEDGE_DOCUMENT_CONTENT_TYPE =
  'application/vnd.clawee.knowledge-document';
const SHARED_FILE_CONTENT_TYPE =
  'application/vnd.clawee.shared-file';

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
    listMcpConnections(): Promise<EnterpriseMcpCatalogResponse> {
      return client.get('/enterprise/mcp');
    },
    refreshMcpConnections(): Promise<EnterpriseMcpCatalogResponse> {
      return client.post('/enterprise/mcp/refresh');
    },
    updateMcpPreference(
      upstreamId: string,
      input: EnterpriseMcpPreferenceUpdateRequest
    ): Promise<EnterpriseMcpCatalogResponse> {
      return client.patch(
        `/enterprise/mcp/upstreams/${encodeURIComponent(upstreamId)}/preference`,
        input
      );
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
    listSharedSpaces(input: {
      limit?: number;
      cursor?: string;
    } = {}): Promise<EnterpriseSharedSpaceListResponse> {
      const query = buildQuery({
        limit: input.limit,
        cursor: input.cursor
      });
      return client.get(`/enterprise/shared-spaces${query}`);
    },
    listSharedFiles(input: {
      spaceId?: string;
      query?: string;
      logicalPathPrefix?: string;
      limit?: number;
      cursor?: string;
    } = {}): Promise<EnterpriseSharedFileListResponse> {
      const query = buildQuery({
        spaceId: input.spaceId,
        query: input.query,
        logicalPathPrefix: input.logicalPathPrefix,
        limit: input.limit,
        cursor: input.cursor
      });
      return client.get(`/enterprise/shared-files${query}`);
    },
    getSharedFileDetail(
      fileId: string
    ): Promise<EnterpriseSharedFileDetailResponse> {
      return client.get(
        `/enterprise/shared-files/${encodeURIComponent(fileId)}`
      );
    },
    uploadSharedFile(input: {
      spaceId: string;
      logicalPath: string;
      expectedRevision?: number;
      file: File;
    }): Promise<EnterpriseSharedFileMutationResponse> {
      const query = new URLSearchParams({
        logicalPath: input.logicalPath,
        contentType: input.file.type || 'application/octet-stream',
        sizeBytes: String(input.file.size)
      });
      if (input.expectedRevision !== undefined) {
        query.set('expectedRevision', String(input.expectedRevision));
      }
      return client.postBinary(
        `/enterprise/shared-spaces/${encodeURIComponent(input.spaceId)}/files?${query.toString()}`,
        input.file,
        SHARED_FILE_CONTENT_TYPE
      );
    },
    downloadSharedFile(input: {
      fileId: string;
      projectId: string;
      overwrite?: boolean;
    }): Promise<EnterpriseSharedFileDownloadResponse> {
      return client.post(
        `/enterprise/shared-files/${encodeURIComponent(input.fileId)}/download`,
        {
          projectId: input.projectId,
          ...(input.overwrite === true ? { overwrite: true } : {})
        }
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

function buildQuery(
  input: Record<string, string | number | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded.length === 0 ? '' : `?${encoded}`;
}
