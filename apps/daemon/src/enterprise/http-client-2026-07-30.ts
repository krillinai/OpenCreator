import type {
  EnterpriseAccountSummary,
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  RuntimeErrorCode
} from '@clawee/protocol';
import { createHash } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import { z } from 'zod';
import {
  ENTERPRISE_DOWNLOAD_TIMEOUT_MS,
  ENTERPRISE_JSON_TIMEOUT_MS,
  ENTERPRISE_PACKAGE_MAX_BYTES,
  resolveEnterpriseOrigin
} from './config-2026-07-30.js';

const accountSchema = z.object({
  email: z.string().min(1),
  name: z.string(),
  status: z.string()
});
const loginResponseSchema = z.object({
  data: z.object({
    account: accountSchema,
    access_token: z.string().min(1),
    token_type: z.literal('Bearer'),
    expires_at: z.string().datetime({ offset: true })
  })
});
const meResponseSchema = z.object({
  data: z.object({
    account: accountSchema,
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

export type EnterpriseLoginResult = {
  account: EnterpriseAccountSummary;
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: string;
};

export type EnterpriseMeResult = {
  account: EnterpriseAccountSummary;
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
  register(input: EnterpriseRegisterRequest): Promise<void>;
  login(input: EnterpriseLoginRequest): Promise<EnterpriseLoginResult>;
  getMe(accessToken: string): Promise<EnterpriseMeResult>;
  logout(accessToken: string): Promise<void>;
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
  maxPackageBytes?: number;
} = {}): EnterpriseHttpClient {
  const { origin } = resolveEnterpriseOrigin(input.origin);
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const jsonTimeoutMs = input.jsonTimeoutMs ?? ENTERPRISE_JSON_TIMEOUT_MS;
  const downloadTimeoutMs =
    input.downloadTimeoutMs ?? ENTERPRISE_DOWNLOAD_TIMEOUT_MS;
  const maxPackageBytes =
    input.maxPackageBytes ?? ENTERPRISE_PACKAGE_MAX_BYTES;

  async function requestJson<T>(request: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    accessToken?: string;
    schema: z.ZodType<T>;
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

    if (!response.ok) throw await createResponseError(response);

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

    if (!response.ok) throw await createResponseError(response);
  }

  return {
    async register(request) {
      await requestWithoutResult({
        body: {
          email: request.email,
          ...(request.name === undefined ? {} : { name: request.name }),
          password: request.password
        },
        method: 'POST',
        path: '/api/v1/auth/register'
      });
    },

    async login(request) {
      const response = await requestJson({
        body: {
          email: request.email,
          password: request.password,
          client_id: 'clawee-agent'
        },
        method: 'POST',
        path: '/api/v1/auth/login',
        schema: loginResponseSchema
      });
      return {
        account: accountSummary(response.data.account),
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

      if (!response.ok) throw await createResponseError(response);

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

async function createResponseError(response: Response): Promise<EnterpriseHttpError> {
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
    mapResponseCode(response.status, upstreamCode),
    'response',
    response.status,
    upstreamCode,
    parseRetryAfter(response.headers.get('retry-after')),
    requestId
  );
}

function mapResponseCode(
  statusCode: number,
  upstreamCode?: string
): RuntimeErrorCode {
  if (statusCode === 400) return 'ENTERPRISE_INVALID_REQUEST';
  if (statusCode === 401) return 'ENTERPRISE_UNAUTHORIZED';
  if (statusCode === 403) return 'ENTERPRISE_FORBIDDEN';
  if (statusCode === 404) return 'ENTERPRISE_SKILL_NOT_FOUND';
  if (statusCode === 409 || upstreamCode === 'version_changed') {
    return 'ENTERPRISE_SKILL_VERSION_CHANGED';
  }
  if (statusCode === 413) return 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE';
  if (statusCode === 429) return 'ENTERPRISE_RATE_LIMITED';
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
