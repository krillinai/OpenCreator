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
  resolveEnterpriseOrigin
} from './config-2026-07-30.js';

const accountSchema = z.object({
  account_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
  email: z.string().min(1),
  name: z.string(),
  status: z.string()
}).superRefine((account, context) => {
  if (account.account_id === undefined && account.user_id === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A stable account identifier is required'
    });
  }
  if (
    account.account_id !== undefined
    && account.user_id !== undefined
    && account.account_id !== account.user_id
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Account identifiers do not match'
    });
  }
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
const meResponseSchema = z.object({
  data: z.object({
    account: accountSchema,
    agent: agentSchema,
    applications: z.object({
      frontend: z.boolean()
    })
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
const mcpGrantResponseSchema = z.object({
  data: z.object({
    tools: z.array(z.object({
      name: z.literal('knowledge.search'),
      enabled: z.boolean()
    }))
  })
});
const knowledgeSearchResponseSchema = z.object({
  data: z.object({
    results: z.array(z.object({
      title: z.string(),
      knowledge_base_name: z.string(),
      document_name: z.string(),
      excerpt: z.string()
    }))
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

export type EnterpriseKnowledgeSearchSource = {
  title: string;
  knowledgeBaseName: string;
  documentName: string;
  excerpt: string;
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
};

export type EnterpriseDownloadInput = {
  accessToken: string;
  skillId: string;
  versionId: string;
  expectedSha256: string;
  destinationPath: string;
};

export type EnterpriseHttpClient = {
  register(input: EnterpriseRegisterRequest, agentId: string): Promise<void>;
  login(input: EnterpriseLoginRequest, agentId: string): Promise<EnterpriseLoginResult>;
  getMe(accessToken: string): Promise<EnterpriseMeResult>;
  logout(accessToken: string): Promise<void>;
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
  hasKnowledgeSearchGrant(accessToken: string): Promise<boolean>;
  searchKnowledge(input: {
    accessToken: string;
    query: string;
    limit: number;
  }): Promise<EnterpriseKnowledgeSearchSource[]>;
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
    readonly stage: 'request' | 'response' | 'decode' | 'download',
    readonly statusCode?: number,
    readonly upstreamCode?: string,
    readonly retryAfterMs?: number,
    readonly requestId?: string
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
      return {
        account: accountSummary(response.data.account),
        agentId: response.data.agent.agent_id,
        status: response.data.account.status,
        frontendAllowed: response.data.applications.frontend
      };
    },

    async logout(accessToken) {
      await requestWithoutResult({
        accessToken,
        method: 'POST',
        path: '/api/v1/auth/logout'
      });
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

    async hasKnowledgeSearchGrant(accessToken) {
      const response = await requestJson({
        accessToken,
        method: 'GET',
        path: '/api/v1/app/mcp-grants',
        schema: mcpGrantResponseSchema
      });
      return response.data.tools.some(tool => (
        tool.name === 'knowledge.search' && tool.enabled
      ));
    },

    async searchKnowledge(request) {
      const response = await requestJson({
        accessToken: request.accessToken,
        body: { query: request.query, limit: request.limit },
        domain: 'knowledge',
        method: 'POST',
        path: '/api/v1/app/knowledge/search',
        schema: knowledgeSearchResponseSchema
      });
      return response.data.results.map(result => ({
        title: result.title,
        knowledgeBaseName: result.knowledge_base_name,
        documentName: result.document_name,
        excerpt: result.excerpt
      }));
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
    subjectId: account.account_id ?? account.user_id!,
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

function mapListMeta(meta: z.infer<typeof listMetaSchema>): EnterpriseListMeta {
  return {
    nextCursor: meta.next_cursor,
    hasNext: meta.has_next
  };
}

type EnterpriseHttpDomain = 'general' | 'skill' | 'knowledge';

async function createResponseError(
  response: Response,
  domain: EnterpriseHttpDomain = 'general'
): Promise<EnterpriseHttpError> {
  let upstreamCode: string | undefined;
  let requestId = response.headers.get('x-request-id') ?? undefined;
  try {
    const value: unknown = await response.json();
    if (isPlainObject(value) && isPlainObject(value.error)) {
      if (typeof value.error.code === 'string') upstreamCode = value.error.code;
      if (typeof value.error.request_id === 'string') {
        requestId = value.error.request_id;
      }
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
    requestId
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
  if (statusCode === 403) return 'ENTERPRISE_FORBIDDEN';
  if (statusCode === 404 && domain === 'knowledge') {
    return 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND';
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
  if (statusCode === 409 || upstreamCode === 'version_changed') {
    return 'ENTERPRISE_SKILL_VERSION_CHANGED';
  }
  if (statusCode === 413 && domain === 'knowledge') {
    return 'ENTERPRISE_DOCUMENT_TOO_LARGE';
  }
  if (statusCode === 413) return 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE';
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
  if (statusCode >= 500) return 'ENTERPRISE_SERVICE_UNAVAILABLE';
  return 'ENTERPRISE_PROTOCOL_ERROR';
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
