import type {
  EnterpriseAccountSummary,
  EnterpriseListMeta,
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  RuntimeErrorCode
} from '@clawee/protocol';
import { createHash } from 'node:crypto';
import { openAsBlob } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { z } from 'zod';
import {
  ENTERPRISE_DOCUMENT_UPLOAD_TIMEOUT_MS,
  ENTERPRISE_DOWNLOAD_TIMEOUT_MS,
  ENTERPRISE_JSON_TIMEOUT_MS,
  ENTERPRISE_PACKAGE_MAX_BYTES,
  ENTERPRISE_SHARED_FILE_MAX_BYTES,
  ENTERPRISE_SHARED_FILE_TRANSFER_TIMEOUT_MS,
  resolveEnterpriseOrigin
} from './config-2026-07-30.js';

const accountSchema = z.object({
  email: z.string().min(1),
  name: z.string(),
  status: z.string()
});
const agentSchema = z.object({
  agent_id: z.string().min(1),
  name: z.string()
});
const loginResponseSchema = z.object({
  data: z.object({
    account: accountSchema,
    agent: agentSchema,
    access_token: z.string().min(1),
    token_type: z.literal('Bearer'),
    expires_at: z.string().datetime({ offset: true })
  })
});
const collectorRegistrationSchema = z.object({
  exists: z.boolean(),
  revoked: z.boolean().optional(),
  install_command: z.string().min(1).optional(),
  install_powershell_command: z.string().min(1).optional()
});
const meResponseSchema = z.object({
  data: z.object({
    account: accountSchema,
    agent: agentSchema,
    collector_registration: collectorRegistrationSchema.optional(),
    applications: z.object({
      frontend: z.boolean()
    })
  })
});
const agentMcpTokenResponseSchema = z.object({
  data: z.object({
    token_id: z.string().min(1),
    agent_id: z.string().min(1),
    token: z.string().min(1),
    token_type: z.literal('Bearer'),
    fingerprint: z.string().min(1),
    status: z.literal('active'),
    expires_at: z.string().datetime({ offset: true }).nullable(),
    scopes: z.array(z.string().min(1)),
    created_at: z.string().datetime({ offset: true })
  })
});
const remoteMcpToolSchema = z.object({
  id: z.string().min(1),
  upstream_name: z.string().min(1),
  name: z.string().min(1),
  exposed_name: z.string().min(1),
  title: z.string(),
  description: z.string(),
  risk_level: z.string().min(1),
  confirm_required: z.boolean(),
  status: z.string().min(1),
  authorized: z.boolean(),
  authorization_expires_at: z.string().datetime({ offset: true }).nullable()
});
const remoteMcpUpstreamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  domain: z.string(),
  mcp_endpoint: z.string().url(),
  upstream_transport: z.string().min(1),
  namespace: z.string().min(1),
  status: z.string().min(1),
  tools: z.array(remoteMcpToolSchema)
});
const mcpCatalogResponseSchema = z.object({
  data: z.object({
    agent_id: z.string().min(1),
    upstreams: z.array(remoteMcpUpstreamSchema)
  })
});
const remoteSkillSchema = z.object({
  skill_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version_id: z.string().min(1),
  version: z.string(),
  package_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  updated_at: z.string().datetime({ offset: true })
});
const skillListResponseSchema = z.object({
  data: z.array(remoteSkillSchema)
});
const skillDetailResponseSchema = z.object({
  data: remoteSkillSchema.extend({
    changelog: z.string().optional()
  })
});
const listMetaSchema = z.object({
  next_cursor: z.string(),
  has_next: z.boolean()
});
const knowledgePermissionsSchema = z.object({
  read: z.boolean(),
  upload: z.boolean(),
  search: z.boolean()
});
const remoteKnowledgeBaseSchema = z.object({
  knowledge_base_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.string(),
  document_count: z.number().int().nonnegative(),
  permissions: knowledgePermissionsSchema
});
const knowledgeBaseListResponseSchema = z.object({
  data: z.array(remoteKnowledgeBaseSchema),
  meta: listMetaSchema
});
const remoteKnowledgeDocumentSchema = z.object({
  document_id: z.string().min(1),
  knowledge_base_id: z.string().min(1),
  name: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  mime_type: z.string(),
  status: z.string(),
  error_message: z.string(),
  uploaded_by: z.string(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true })
});
const knowledgeDocumentListResponseSchema = z.object({
  data: z.array(remoteKnowledgeDocumentSchema),
  meta: listMetaSchema
});
const knowledgeDocumentUploadResponseSchema = z.object({
  data: remoteKnowledgeDocumentSchema
});
const sharedSpacePermissionsSchema = z.object({
  read: z.boolean().optional(),
  write: z.boolean().optional()
});
const remoteSharedSpaceSchema = z.object({
  space_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  updated_at: z.string().datetime({ offset: true }),
  permissions: sharedSpacePermissionsSchema.optional()
});
const sharedSpaceListResponseSchema = z.object({
  data: z.array(remoteSharedSpaceSchema),
  meta: listMetaSchema.extend({
    max_file_size_bytes: z.number().int().nonnegative()
  })
});
const remoteSharedFileSchema = z.object({
  file_id: z.string().min(1),
  space_id: z.string().min(1),
  space_name: z.string(),
  logical_path: z.string().min(1),
  file_name: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  content_type: z.string(),
  revision: z.number().int().positive(),
  updated_by_user_id: z.string(),
  updated_by_agent_id: z.string(),
  updated_at: z.string().datetime({ offset: true })
});
const sharedFileListResponseSchema = z.object({
  data: z.array(remoteSharedFileSchema),
  meta: listMetaSchema
});
const sharedFileDetailResponseSchema = z.object({
  data: remoteSharedFileSchema.extend({
    created_by_user_id: z.string(),
    created_by_agent_id: z.string(),
    created_at: z.string().datetime({ offset: true })
  })
});
const sharedFileMutationResponseSchema = z.object({
  data: z.object({
    file_id: z.string().min(1),
    space_id: z.string().min(1),
    logical_path: z.string().min(1),
    file_name: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    content_type: z.string(),
    revision: z.number().int().positive(),
    created: z.boolean(),
    updated_at: z.string().datetime({ offset: true })
  })
});

export type EnterpriseRemoteSkill = {
  skillId: string;
  name: string;
  description?: string;
  versionId: string;
  version: string;
  packageSha256: string;
  updatedAt: string;
};

export type EnterpriseAgentMcpToken = {
  tokenId: string;
  agentId: string;
  token: string;
  tokenType: 'Bearer';
  fingerprint: string;
  expiresAt: string | null;
  scopes: string[];
  createdAt: string;
};

export type EnterpriseRemoteMcpTool = {
  toolId: string;
  upstreamName: string;
  name: string;
  exposedName: string;
  title: string;
  description: string;
  riskLevel: string;
  confirmRequired: boolean;
  status: string;
  authorized: boolean;
  authorizationExpiresAt: string | null;
};

export type EnterpriseRemoteMcpUpstream = {
  upstreamId: string;
  name: string;
  domain: string;
  endpoint: string;
  upstreamTransport: string;
  namespace: string;
  status: string;
  tools: EnterpriseRemoteMcpTool[];
};

export type EnterpriseRemoteMcpCatalog = {
  agentId: string;
  upstreams: EnterpriseRemoteMcpUpstream[];
};

export type EnterpriseRemoteSkillDetail = EnterpriseRemoteSkill & {
  changelog?: string;
};

export type EnterpriseRemoteKnowledgeBase = {
  knowledgeBaseId: string;
  name: string;
  description: string;
  status: string;
  documentCount: number;
  permissions: {
    read: boolean;
    upload: boolean;
    search: boolean;
  };
};

export type EnterpriseRemoteKnowledgeDocument = {
  documentId: string;
  knowledgeBaseId: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  status: string;
  errorMessage: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseRemoteSharedSpace = {
  spaceId: string;
  name: string;
  description: string;
  updatedAt: string;
  permissions: {
    read: boolean;
    write: boolean;
  };
};

export type EnterpriseRemoteSharedFile = {
  fileId: string;
  spaceId: string;
  spaceName: string;
  logicalPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  revision: number;
  createdByUserId?: string;
  createdByAgentId?: string;
  updatedByUserId: string;
  updatedByAgentId: string;
  createdAt?: string;
  updatedAt: string;
};

export type EnterpriseRemoteSharedFileMutation = {
  fileId: string;
  spaceId: string;
  logicalPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  revision: number;
  created: boolean;
  updatedAt: string;
};

export type EnterpriseLoginResult = {
  account: EnterpriseAccountSummary;
  agentId: string;
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
};

export type EnterpriseMeResult = {
  account: EnterpriseAccountSummary;
  agentId: string;
  status: string;
  frontendAllowed: boolean;
  collectorRegistration?: EnterpriseCollectorRegistration;
};

export type EnterpriseCollectorRegistration = {
  installCommand: string;
  installPowershellCommand: string;
};

export type EnterpriseDownloadInput = {
  accessToken: string;
  skillId: string;
  versionId: string;
  expectedSha256: string;
  destinationPath: string;
};

export type EnterpriseSharedFileListInput = {
  accessToken: string;
  spaceId?: string;
  query?: string;
  logicalPathPrefix?: string;
  limit?: number;
  cursor?: string;
};

export type EnterpriseSharedFileDownloadInput = {
  accessToken: string;
  fileId: string;
  destinationPath: string;
};

export type EnterpriseSharedFileUploadInput = {
  accessToken: string;
  spaceId: string;
  logicalPath: string;
  expectedRevision?: number;
  filePath: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
};

export type EnterpriseHttpClient = {
  register(input: EnterpriseRegisterRequest, agentId: string): Promise<void>;
  login(input: EnterpriseLoginRequest, agentId: string): Promise<EnterpriseLoginResult>;
  getMe(accessToken: string): Promise<EnterpriseMeResult>;
  logout(accessToken: string): Promise<void>;
  revealAgentMcpToken(accessToken: string): Promise<EnterpriseAgentMcpToken>;
  getMcpCatalog(accessToken: string): Promise<EnterpriseRemoteMcpCatalog>;
  listKnowledgeBases(accessToken: string): Promise<{
    knowledgeBases: EnterpriseRemoteKnowledgeBase[];
    meta: EnterpriseListMeta;
  }>;
  listKnowledgeDocuments(
    accessToken: string,
    knowledgeBaseId: string
  ): Promise<{
    documents: EnterpriseRemoteKnowledgeDocument[];
    meta: EnterpriseListMeta;
  }>;
  uploadKnowledgeDocument(input: {
    accessToken: string;
    knowledgeBaseId: string;
    filePath: string;
    fileName: string;
    mimeType: string;
  }): Promise<EnterpriseRemoteKnowledgeDocument>;
  listSharedSpaces(
    accessToken: string,
    input?: { limit?: number; cursor?: string }
  ): Promise<{
    spaces: EnterpriseRemoteSharedSpace[];
    meta: EnterpriseListMeta & { maxFileSizeBytes: number };
  }>;
  listSharedFiles(input: EnterpriseSharedFileListInput): Promise<{
    files: EnterpriseRemoteSharedFile[];
    meta: EnterpriseListMeta;
  }>;
  getSharedFileDetail(
    accessToken: string,
    fileId: string
  ): Promise<EnterpriseRemoteSharedFile>;
  downloadSharedFileContent(
    input: EnterpriseSharedFileDownloadInput
  ): Promise<{
    bytes: number;
    sha256: string;
    revision: number;
    contentType: string;
  }>;
  uploadSharedFileContent(
    input: EnterpriseSharedFileUploadInput
  ): Promise<EnterpriseRemoteSharedFileMutation>;
  listSkills(accessToken: string): Promise<EnterpriseRemoteSkill[]>;
  getSkillDetail(
    accessToken: string,
    skillId: string
  ): Promise<EnterpriseRemoteSkillDetail>;
  downloadSkillPackage(
    input: EnterpriseDownloadInput
  ): Promise<{ bytes: number; sha256: string }>;
};

export class EnterpriseHttpError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly stage: 'request' | 'response' | 'decode' | 'download' | 'upload',
    readonly statusCode?: number,
    readonly upstreamCode?: string,
    readonly retryAfterMs?: number,
    readonly requestId?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(`${code}: enterprise HTTP ${stage} failed`);
    this.name = 'EnterpriseHttpError';
  }
}

export function createEnterpriseHttpClient(input: {
  origin?: string;
  fetch?: typeof globalThis.fetch;
  jsonTimeoutMs?: number;
  downloadTimeoutMs?: number;
  documentUploadTimeoutMs?: number;
  maxPackageBytes?: number;
  sharedFileTransferTimeoutMs?: number;
  maxSharedFileBytes?: number;
} = {}): EnterpriseHttpClient {
  const { origin } = resolveEnterpriseOrigin(input.origin);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const jsonTimeoutMs = input.jsonTimeoutMs ?? ENTERPRISE_JSON_TIMEOUT_MS;
  const downloadTimeoutMs =
    input.downloadTimeoutMs ?? ENTERPRISE_DOWNLOAD_TIMEOUT_MS;
  const documentUploadTimeoutMs =
    input.documentUploadTimeoutMs ?? ENTERPRISE_DOCUMENT_UPLOAD_TIMEOUT_MS;
  const maxPackageBytes =
    input.maxPackageBytes ?? ENTERPRISE_PACKAGE_MAX_BYTES;
  const sharedFileTransferTimeoutMs =
    input.sharedFileTransferTimeoutMs
    ?? ENTERPRISE_SHARED_FILE_TRANSFER_TIMEOUT_MS;
  const maxSharedFileBytes =
    input.maxSharedFileBytes ?? ENTERPRISE_SHARED_FILE_MAX_BYTES;

  async function requestJson<T>(request: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    accessToken?: string;
    schema: z.ZodType<T>;
    domain?: EnterpriseHttpDomain;
  }): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(request.path, origin), {
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        headers: jsonHeaders(request.accessToken, request.body !== undefined),
        method: request.method,
        signal: AbortSignal.timeout(jsonTimeoutMs)
      });
    } catch {
      throw new EnterpriseHttpError(
        'ENTERPRISE_SERVICE_UNAVAILABLE',
        'request'
      );
    }

    if (!response.ok) {
      throw await createResponseError(response, request.domain);
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new EnterpriseHttpError(
        'ENTERPRISE_PROTOCOL_ERROR',
        'decode',
        response.status
      );
    }

    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      throw new EnterpriseHttpError(
        'ENTERPRISE_PROTOCOL_ERROR',
        'decode',
        response.status
      );
    }
    return parsed.data;
  }

  async function requestWithoutResult(request: {
    method: 'POST';
    path: string;
    body?: unknown;
    accessToken?: string;
    domain?: EnterpriseHttpDomain;
  }): Promise<void> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(request.path, origin), {
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        headers: jsonHeaders(request.accessToken, request.body !== undefined),
        method: request.method,
        signal: AbortSignal.timeout(jsonTimeoutMs)
      });
    } catch {
      throw new EnterpriseHttpError(
        'ENTERPRISE_SERVICE_UNAVAILABLE',
        'request'
      );
    }

    if (!response.ok) {
      throw await createResponseError(response, request.domain);
    }
  }

  return {
    async register(request, agentId) {
      await requestWithoutResult({
        body: {
          email: request.email,
          ...(request.name === undefined ? {} : { name: request.name }),
          password: request.password,
          client_id: 'clawee-agent',
          agent_id: agentId
        },
        method: 'POST',
        path: '/api/v1/auth/register'
      });
    },

    async login(request, agentId) {
      const response = await requestJson({
        body: {
          email: request.email,
          password: request.password,
          client_id: 'clawee-agent',
          agent_id: agentId
        },
        method: 'POST',
        path: '/api/v1/auth/login',
        schema: loginResponseSchema
      });
      return {
        account: accountSummary(response.data.account),
        agentId: response.data.agent.agent_id,
        accessToken: response.data.access_token,
        tokenType: response.data.token_type,
        expiresAt: response.data.expires_at
      };
    },

    async getMe(accessToken) {
      const response = await requestJson({
        accessToken,
        method: 'GET',
        path: '/api/v1/auth/me',
        schema: meResponseSchema
      });
      const collectorRegistration = mapCollectorRegistration(
        response.data.collector_registration
      );
      return {
        account: accountSummary(response.data.account),
        agentId: response.data.agent.agent_id,
        status: response.data.account.status,
        frontendAllowed: response.data.applications.frontend,
        ...(collectorRegistration === undefined
          ? {}
          : { collectorRegistration })
      };
    },

    async logout(accessToken) {
      await requestWithoutResult({
        accessToken,
        method: 'POST',
        path: '/api/v1/auth/logout'
      });
    },

    async revealAgentMcpToken(accessToken) {
      const response = await requestJson({
        accessToken,
        domain: 'mcp-token',
        method: 'POST',
        path: '/api/v1/app/agents/token/reveal',
        schema: agentMcpTokenResponseSchema
      });
      if (!response.data.scopes.includes('mcp:call')) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          200
        );
      }
      return {
        tokenId: response.data.token_id,
        agentId: response.data.agent_id,
        token: response.data.token,
        tokenType: response.data.token_type,
        fingerprint: response.data.fingerprint,
        expiresAt: response.data.expires_at,
        scopes: [...response.data.scopes],
        createdAt: response.data.created_at
      };
    },

    async getMcpCatalog(accessToken) {
      const response = await requestJson({
        accessToken,
        domain: 'mcp',
        method: 'GET',
        path: '/api/v1/app/agents/mcp-catalog',
        schema: mcpCatalogResponseSchema
      });
      return {
        agentId: response.data.agent_id,
        upstreams: response.data.upstreams.map(mapRemoteMcpUpstream)
      };
    },

    async listSkills(accessToken) {
      const response = await requestJson({
        accessToken,
        domain: 'skill',
        method: 'GET',
        path: '/api/v1/app/skills',
        schema: skillListResponseSchema
      });
      return response.data.map(mapRemoteSkill);
    },

    async getSkillDetail(accessToken, skillId) {
      const query = new URLSearchParams({ skill_id: skillId });
      const response = await requestJson({
        accessToken,
        domain: 'skill',
        method: 'GET',
        path: `/api/v1/app/skills/detail?${query.toString()}`,
        schema: skillDetailResponseSchema
      });
      return {
        ...mapRemoteSkill(response.data),
        ...(response.data.changelog === undefined
          ? {}
          : { changelog: response.data.changelog })
      };
    },

    async listKnowledgeBases(accessToken) {
      const response = await requestJson({
        accessToken,
        domain: 'knowledge',
        method: 'GET',
        path: '/api/v1/app/knowledge-bases',
        schema: knowledgeBaseListResponseSchema
      });
      return {
        knowledgeBases: response.data.map(mapRemoteKnowledgeBase),
        meta: mapListMeta(response.meta)
      };
    },

    async listKnowledgeDocuments(accessToken, knowledgeBaseId) {
      const query = new URLSearchParams({
        knowledge_base_id: knowledgeBaseId
      });
      const response = await requestJson({
        accessToken,
        domain: 'knowledge',
        method: 'GET',
        path: `/api/v1/app/knowledge-bases/documents?${query.toString()}`,
        schema: knowledgeDocumentListResponseSchema
      });
      return {
        documents: response.data.map(mapRemoteKnowledgeDocument),
        meta: mapListMeta(response.meta)
      };
    },

    async uploadKnowledgeDocument(request) {
      const file = await openAsBlob(request.filePath, {
        type: request.mimeType
      });
      const form = new FormData();
      form.append('knowledge_base_id', request.knowledgeBaseId);
      form.append('file', file, request.fileName);

      let response: Response;
      try {
        response = await fetchImpl(
          new URL('/api/v1/app/knowledge-bases/documents', origin),
          {
            body: form,
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${request.accessToken}`
            },
            method: 'POST',
            signal: AbortSignal.timeout(documentUploadTimeoutMs)
          }
        );
      } catch {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'request'
        );
      }

      if (!response.ok) {
        throw await createResponseError(response, 'knowledge');
      }

      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          response.status
        );
      }
      const parsed = knowledgeDocumentUploadResponseSchema.safeParse(value);
      if (!parsed.success) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          response.status
        );
      }
      return mapRemoteKnowledgeDocument(parsed.data.data);
    },

    async listSharedSpaces(accessToken, input = {}) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) query.set('limit', String(input.limit));
      if (input.cursor !== undefined) query.set('cursor', input.cursor);
      const suffix = query.size === 0 ? '' : `?${query.toString()}`;
      const response = await requestJson({
        accessToken,
        domain: 'shared-file',
        method: 'GET',
        path: `/api/v1/app/shared-spaces${suffix}`,
        schema: sharedSpaceListResponseSchema
      });
      return {
        spaces: response.data.map(mapRemoteSharedSpace),
        meta: {
          ...mapListMeta(response.meta),
          maxFileSizeBytes: response.meta.max_file_size_bytes
        }
      };
    },

    async listSharedFiles(request) {
      const query = new URLSearchParams();
      if (request.spaceId !== undefined) query.set('space_id', request.spaceId);
      if (request.query !== undefined) query.set('query', request.query);
      if (request.logicalPathPrefix !== undefined) {
        query.set('logical_path_prefix', request.logicalPathPrefix);
      }
      if (request.limit !== undefined) query.set('limit', String(request.limit));
      if (request.cursor !== undefined) query.set('cursor', request.cursor);
      const suffix = query.size === 0 ? '' : `?${query.toString()}`;
      const response = await requestJson({
        accessToken: request.accessToken,
        domain: 'shared-file',
        method: 'GET',
        path: `/api/v1/app/shared-files${suffix}`,
        schema: sharedFileListResponseSchema
      });
      return {
        files: response.data.map(mapRemoteSharedFile),
        meta: mapListMeta(response.meta)
      };
    },

    async getSharedFileDetail(accessToken, fileId) {
      const query = new URLSearchParams({ file_id: fileId });
      const response = await requestJson({
        accessToken,
        domain: 'shared-file',
        method: 'GET',
        path: `/api/v1/app/shared-files/detail?${query.toString()}`,
        schema: sharedFileDetailResponseSchema
      });
      return mapRemoteSharedFile(response.data);
    },

    async downloadSharedFileContent(request) {
      const query = new URLSearchParams({ file_id: request.fileId });
      let response: Response;
      try {
        response = await fetchImpl(
          new URL(`/api/v1/app/shared-files/content?${query.toString()}`, origin),
          {
            headers: {
              Accept: 'application/octet-stream',
              Authorization: `Bearer ${request.accessToken}`
            },
            method: 'GET',
            signal: AbortSignal.timeout(sharedFileTransferTimeoutMs)
          }
        );
      } catch {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'request'
        );
      }

      if (!response.ok) {
        throw await createResponseError(response, 'shared-file');
      }
      const declaredLength = requireContentLength(
        response.headers.get('content-length')
      );
      if (declaredLength > maxSharedFileBytes) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SHARED_FILE_TOO_LARGE',
          'download',
          response.status
        );
      }
      const expectedSha256 = requireSha256Header(
        response.headers.get('x-content-sha256')
      );
      const revision = requirePositiveIntegerHeader(
        response.headers.get('x-file-revision')
      );
      const responseFileId = response.headers.get('x-shared-file-id');
      if (responseFileId !== request.fileId || response.body === null) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'download',
          response.status
        );
      }

      const hash = createHash('sha256');
      const reader = response.body.getReader();
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let bytes = 0;
      try {
        handle = await open(request.destinationPath, 'wx', 0o600);
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > maxSharedFileBytes || bytes > declaredLength) {
            throw new EnterpriseHttpError(
              'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH',
              'download',
              response.status
            );
          }
          hash.update(result.value);
          await writeAll(handle, result.value);
        }
        const sha256 = hash.digest('hex');
        if (bytes !== declaredLength) {
          throw new EnterpriseHttpError(
            'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH',
            'download',
            response.status
          );
        }
        if (sha256 !== expectedSha256) {
          throw new EnterpriseHttpError(
            'ENTERPRISE_SHARED_FILE_DIGEST_MISMATCH',
            'download',
            response.status
          );
        }
        await handle.close();
        handle = undefined;
        return {
          bytes,
          sha256,
          revision,
          contentType:
            response.headers.get('content-type') ?? 'application/octet-stream'
        };
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await rm(request.destinationPath, { force: true }).catch(() => undefined);
        if (error instanceof EnterpriseHttpError) throw error;
        throw new EnterpriseHttpError(
          'ENTERPRISE_SHARED_FILE_STORAGE_UNAVAILABLE',
          'download',
          response.status
        );
      } finally {
        reader.releaseLock();
      }
    },

    async uploadSharedFileContent(request) {
      const file = await openAsBlob(request.filePath, {
        type: request.contentType
      });
      if (file.size !== request.sizeBytes) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH',
          'upload'
        );
      }
      const query = new URLSearchParams({
        space_id: request.spaceId,
        logical_path: request.logicalPath
      });
      if (request.expectedRevision !== undefined) {
        query.set('expected_revision', String(request.expectedRevision));
      }

      let response: Response;
      try {
        response = await fetchImpl(
          new URL(`/api/v1/app/shared-files/content?${query.toString()}`, origin),
          {
            body: file,
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${request.accessToken}`,
              'Content-Length': String(request.sizeBytes),
              'Content-Type': request.contentType,
              'X-Content-SHA256': request.sha256
            },
            method: 'POST',
            signal: AbortSignal.timeout(sharedFileTransferTimeoutMs)
          }
        );
      } catch {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'request'
        );
      }
      if (!response.ok) {
        throw await createResponseError(response, 'shared-file');
      }

      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          response.status
        );
      }
      const parsed = sharedFileMutationResponseSchema.safeParse(value);
      if (!parsed.success) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'decode',
          response.status
        );
      }
      return mapRemoteSharedFileMutation(parsed.data.data);
    },

    async downloadSkillPackage(request) {
      const query = new URLSearchParams({
        skill_id: request.skillId,
        version_id: request.versionId
      });
      let response: Response;
      try {
        response = await fetchImpl(
          new URL(`/api/v1/app/skills/package?${query.toString()}`, origin),
          {
            headers: {
              Accept: 'application/zip',
              Authorization: `Bearer ${request.accessToken}`
            },
            method: 'GET',
            signal: AbortSignal.timeout(downloadTimeoutMs)
          }
        );
      } catch {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'request'
        );
      }

      if (!response.ok) {
        throw await createResponseError(response, 'skill');
      }

      const declaredLength = parseContentLength(response.headers.get('content-length'));
      if (declaredLength !== undefined && declaredLength > maxPackageBytes) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE',
          'download',
          response.status
        );
      }
      if (response.body === null) {
        throw new EnterpriseHttpError(
          'ENTERPRISE_PROTOCOL_ERROR',
          'download',
          response.status
        );
      }

      const hash = createHash('sha256');
      const reader = response.body.getReader();
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      let bytes = 0;
      try {
        handle = await open(request.destinationPath, 'wx', 0o600);
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > maxPackageBytes) {
            throw new EnterpriseHttpError(
              'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE',
              'download',
              response.status
            );
          }
          hash.update(result.value);
          await writeAll(handle, result.value);
        }
        const sha256 = hash.digest('hex');
        if (sha256 !== request.expectedSha256) {
          throw new EnterpriseHttpError(
            'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH',
            'download',
            response.status
          );
        }
        await handle.close();
        handle = undefined;
        return { bytes, sha256 };
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await rm(request.destinationPath, { force: true }).catch(() => undefined);
        if (error instanceof EnterpriseHttpError) throw error;
        throw new EnterpriseHttpError(
          'ENTERPRISE_SERVICE_UNAVAILABLE',
          'download',
          response.status
        );
      } finally {
        reader.releaseLock();
      }
    }
  };
}

function jsonHeaders(
  accessToken: string | undefined,
  hasBody: boolean
): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(accessToken === undefined
      ? {}
      : { Authorization: `Bearer ${accessToken}` })
  };
}

function accountSummary(account: z.infer<typeof accountSchema>): EnterpriseAccountSummary {
  return {
    email: account.email,
    name: account.name
  };
}

function mapRemoteSkill(
  skill: z.infer<typeof remoteSkillSchema>
): EnterpriseRemoteSkill {
  return {
    skillId: skill.skill_id,
    name: skill.name,
    ...(skill.description === undefined
      ? {}
      : { description: skill.description }),
    versionId: skill.version_id,
    version: skill.version,
    packageSha256: skill.package_sha256,
    updatedAt: skill.updated_at
  };
}

function mapRemoteMcpUpstream(
  upstream: z.infer<typeof remoteMcpUpstreamSchema>
): EnterpriseRemoteMcpUpstream {
  return {
    upstreamId: upstream.id,
    name: upstream.name,
    domain: upstream.domain,
    endpoint: upstream.mcp_endpoint,
    upstreamTransport: upstream.upstream_transport,
    namespace: upstream.namespace,
    status: upstream.status,
    tools: upstream.tools.map(tool => ({
      toolId: tool.id,
      upstreamName: tool.upstream_name,
      name: tool.name,
      exposedName: tool.exposed_name,
      title: tool.title,
      description: tool.description,
      riskLevel: tool.risk_level,
      confirmRequired: tool.confirm_required,
      status: tool.status,
      authorized: tool.authorized,
      authorizationExpiresAt: tool.authorization_expires_at
    }))
  };
}

function mapRemoteKnowledgeBase(
  knowledgeBase: z.infer<typeof remoteKnowledgeBaseSchema>
): EnterpriseRemoteKnowledgeBase {
  return {
    knowledgeBaseId: knowledgeBase.knowledge_base_id,
    name: knowledgeBase.name,
    description: knowledgeBase.description,
    status: knowledgeBase.status,
    documentCount: knowledgeBase.document_count,
    permissions: {
      read: knowledgeBase.permissions.read,
      upload: knowledgeBase.permissions.upload,
      search: knowledgeBase.permissions.search
    }
  };
}

function mapRemoteKnowledgeDocument(
  document: z.infer<typeof remoteKnowledgeDocumentSchema>
): EnterpriseRemoteKnowledgeDocument {
  return {
    documentId: document.document_id,
    knowledgeBaseId: document.knowledge_base_id,
    name: document.name,
    sizeBytes: document.size_bytes,
    mimeType: document.mime_type,
    status: document.status,
    errorMessage: document.error_message,
    uploadedBy: document.uploaded_by,
    createdAt: document.created_at,
    updatedAt: document.updated_at
  };
}

function mapRemoteSharedSpace(
  space: z.infer<typeof remoteSharedSpaceSchema>
): EnterpriseRemoteSharedSpace {
  return {
    spaceId: space.space_id,
    name: space.name,
    description: space.description,
    updatedAt: space.updated_at,
    permissions: {
      read: space.permissions?.read ?? true,
      write: space.permissions?.write ?? false
    }
  };
}

function mapRemoteSharedFile(
  file: z.infer<typeof remoteSharedFileSchema> & {
    created_by_user_id?: string;
    created_by_agent_id?: string;
    created_at?: string;
  }
): EnterpriseRemoteSharedFile {
  return {
    fileId: file.file_id,
    spaceId: file.space_id,
    spaceName: file.space_name,
    logicalPath: file.logical_path,
    fileName: file.file_name,
    sizeBytes: file.size_bytes,
    sha256: file.sha256,
    contentType: file.content_type,
    revision: file.revision,
    ...(file.created_by_user_id === undefined
      ? {}
      : { createdByUserId: file.created_by_user_id }),
    ...(file.created_by_agent_id === undefined
      ? {}
      : { createdByAgentId: file.created_by_agent_id }),
    updatedByUserId: file.updated_by_user_id,
    updatedByAgentId: file.updated_by_agent_id,
    ...(file.created_at === undefined ? {} : { createdAt: file.created_at }),
    updatedAt: file.updated_at
  };
}

function mapRemoteSharedFileMutation(
  file: z.infer<typeof sharedFileMutationResponseSchema>['data']
): EnterpriseRemoteSharedFileMutation {
  return {
    fileId: file.file_id,
    spaceId: file.space_id,
    logicalPath: file.logical_path,
    fileName: file.file_name,
    sizeBytes: file.size_bytes,
    sha256: file.sha256,
    contentType: file.content_type,
    revision: file.revision,
    created: file.created,
    updatedAt: file.updated_at
  };
}

function mapListMeta(meta: z.infer<typeof listMetaSchema>): EnterpriseListMeta {
  return {
    nextCursor: meta.next_cursor,
    hasNext: meta.has_next
  };
}

function mapCollectorRegistration(
  registration: z.infer<typeof collectorRegistrationSchema> | undefined
): EnterpriseCollectorRegistration | undefined {
  if (
    registration === undefined
    || !registration.exists
    || registration.revoked === true
    || registration.install_command === undefined
    || registration.install_powershell_command === undefined
  ) {
    return undefined;
  }
  return {
    installCommand: registration.install_command,
    installPowershellCommand: registration.install_powershell_command
  };
}

type EnterpriseHttpDomain =
  | 'general'
  | 'skill'
  | 'knowledge'
  | 'shared-file'
  | 'mcp'
  | 'mcp-token';

async function createResponseError(
  response: Response,
  domain: EnterpriseHttpDomain = 'general'
): Promise<EnterpriseHttpError> {
  let upstreamCode: string | undefined;
  let requestId = response.headers.get('x-request-id') ?? undefined;
  let details: Record<string, unknown> | undefined;
  try {
    const value: unknown = await response.json();
    if (isPlainObject(value) && isPlainObject(value.error)) {
      if (typeof value.error.code === 'string') upstreamCode = value.error.code;
      if (typeof value.error.request_id === 'string') {
        requestId = value.error.request_id;
      }
      details = mapUpstreamErrorDetails(upstreamCode, value.error.details);
    }
  } catch {
    // Error bodies are intentionally discarded.
  }

  return new EnterpriseHttpError(
    mapResponseCode(response.status, upstreamCode, domain),
    'response',
    response.status,
    upstreamCode,
    parseRetryAfter(response.headers.get('retry-after')),
    requestId,
    details
  );
}

function mapResponseCode(
  statusCode: number,
  upstreamCode: string | undefined,
  domain: EnterpriseHttpDomain
): RuntimeErrorCode {
  if (statusCode === 400) return 'ENTERPRISE_INVALID_REQUEST';
  if (statusCode === 401) return 'ENTERPRISE_UNAUTHORIZED';
  if (statusCode === 403 && upstreamCode === 'agent_forbidden') {
    return 'ENTERPRISE_AGENT_FORBIDDEN';
  }
  if (
    statusCode === 403
    && upstreamCode === 'document_upload_forbidden'
  ) {
    return 'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN';
  }
  if (
    statusCode === 403
    && upstreamCode === 'shared_file_write_forbidden'
  ) {
    return 'ENTERPRISE_SHARED_FILE_WRITE_FORBIDDEN';
  }
  if (statusCode === 403) return 'ENTERPRISE_FORBIDDEN';
  if (statusCode === 404 && domain === 'mcp-token') {
    return 'ENTERPRISE_MCP_TOKEN_NOT_FOUND';
  }
  if (statusCode === 404 && domain === 'mcp') {
    return 'ENTERPRISE_MCP_UPSTREAM_NOT_FOUND';
  }
  if (
    statusCode === 404
    && upstreamCode === 'shared_space_not_found'
  ) {
    return 'ENTERPRISE_SHARED_SPACE_NOT_FOUND';
  }
  if (
    statusCode === 404
    && upstreamCode === 'shared_file_not_found'
  ) {
    return 'ENTERPRISE_SHARED_FILE_NOT_FOUND';
  }
  if (statusCode === 404 && domain === 'knowledge') {
    return 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND';
  }
  if (statusCode === 404 && domain === 'shared-file') {
    return 'ENTERPRISE_SHARED_FILE_NOT_FOUND';
  }
  if (statusCode === 404) return 'ENTERPRISE_SKILL_NOT_FOUND';
  if (statusCode === 409 && upstreamCode === 'agent_id_conflict') {
    return 'ENTERPRISE_AGENT_ID_CONFLICT';
  }
  if (
    statusCode === 409
    && (
      domain === 'knowledge'
      || upstreamCode === 'conflict'
    )
  ) {
    return 'ENTERPRISE_KNOWLEDGE_CONFLICT';
  }
  if (
    statusCode === 409
    && upstreamCode === 'file_already_exists'
  ) {
    return 'ENTERPRISE_SHARED_FILE_ALREADY_EXISTS';
  }
  if (
    statusCode === 409
    && upstreamCode === 'revision_conflict'
  ) {
    return 'ENTERPRISE_SHARED_FILE_REVISION_CONFLICT';
  }
  if (statusCode === 409 && domain === 'shared-file') {
    return 'ENTERPRISE_SHARED_FILE_REVISION_CONFLICT';
  }
  if (statusCode === 409 || upstreamCode === 'version_changed') {
    return 'ENTERPRISE_SKILL_VERSION_CHANGED';
  }
  if (statusCode === 413 && domain === 'shared-file') {
    return 'ENTERPRISE_SHARED_FILE_TOO_LARGE';
  }
  if (statusCode === 413 && domain === 'knowledge') {
    return 'ENTERPRISE_DOCUMENT_TOO_LARGE';
  }
  if (statusCode === 413) return 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE';
  if (
    statusCode === 422
    && upstreamCode === 'content_length_mismatch'
  ) {
    return 'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH';
  }
  if (
    statusCode === 422
    && upstreamCode === 'digest_mismatch'
  ) {
    return 'ENTERPRISE_SHARED_FILE_DIGEST_MISMATCH';
  }
  if (statusCode === 415 && domain === 'knowledge') {
    return 'ENTERPRISE_DOCUMENT_TYPE_UNSUPPORTED';
  }
  if (statusCode === 429) return 'ENTERPRISE_RATE_LIMITED';
  if (
    statusCode === 502
    && (
      domain === 'knowledge'
      || upstreamCode === 'knowledge_provider_error'
    )
  ) {
    return 'ENTERPRISE_KNOWLEDGE_PROVIDER_ERROR';
  }
  if (
    statusCode >= 500
    && upstreamCode === 'storage_unavailable'
  ) {
    return 'ENTERPRISE_SHARED_FILE_STORAGE_UNAVAILABLE';
  }
  if (statusCode >= 500) return 'ENTERPRISE_SERVICE_UNAVAILABLE';
  return 'ENTERPRISE_PROTOCOL_ERROR';
}

function mapUpstreamErrorDetails(
  upstreamCode: string | undefined,
  value: unknown
): Record<string, unknown> | undefined {
  if (upstreamCode !== 'revision_conflict') {
    return isPlainObject(value) ? value : undefined;
  }
  if (isPlainObject(value)) {
    const currentRevision =
      value.currentRevision ?? value.current_revision;
    return isPositiveSafeInteger(currentRevision)
      ? { currentRevision }
      : value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    if (
      isPlainObject(item)
      && item.field === 'expected_revision'
      && isPositiveSafeInteger(item.current_revision)
    ) {
      return { currentRevision: item.current_revision };
    }
  }
  return undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
  );
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new EnterpriseHttpError(
      'ENTERPRISE_PROTOCOL_ERROR',
      'download'
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new EnterpriseHttpError(
      'ENTERPRISE_PROTOCOL_ERROR',
      'download'
    );
  }
  return parsed;
}

function requireContentLength(value: string | null): number {
  const parsed = parseContentLength(value);
  if (parsed === undefined) {
    throw new EnterpriseHttpError(
      'ENTERPRISE_PROTOCOL_ERROR',
      'download'
    );
  }
  return parsed;
}

function requirePositiveIntegerHeader(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    throw new EnterpriseHttpError(
      'ENTERPRISE_PROTOCOL_ERROR',
      'download'
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new EnterpriseHttpError(
      'ENTERPRISE_PROTOCOL_ERROR',
      'download'
    );
  }
  return parsed;
}

function requireSha256Header(value: string | null): string {
  if (value === null || !/^[0-9a-f]{64}$/.test(value)) {
    throw new EnterpriseHttpError(
      'ENTERPRISE_PROTOCOL_ERROR',
      'download'
    );
  }
  return value;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.max(0, timestamp - Date.now())
    : undefined;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  value: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const result = await handle.write(
      value,
      offset,
      value.byteLength - offset
    );
    offset += result.bytesWritten;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
