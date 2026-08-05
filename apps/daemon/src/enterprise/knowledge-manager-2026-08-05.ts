import type {
  EnterpriseKnowledgeBaseListResponse,
  EnterpriseKnowledgeDocumentListResponse,
  EnterpriseKnowledgeDocumentUploadResponse,
  RuntimeErrorCode
} from '@clawee/protocol';
import { mkdir, open, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteKnowledgeDocument
} from './http-client-2026-07-30.js';
import { EnterpriseHttpError } from './http-client-2026-07-30.js';
import type { EnterpriseSessionManager } from './session-manager-2026-07-30.js';
import { EnterpriseSessionError } from './session-manager-2026-07-30.js';

export const ENTERPRISE_KNOWLEDGE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.docx',
  '.md',
  '.pdf',
  '.txt',
  '.xlsx'
]);

export type EnterpriseKnowledgeManager = {
  listKnowledgeBases(): Promise<EnterpriseKnowledgeBaseListResponse>;
  listDocuments(
    knowledgeBaseId: string
  ): Promise<EnterpriseKnowledgeDocumentListResponse>;
  uploadDocument(input: {
    knowledgeBaseId: string;
    fileName: string;
    mimeType: string;
    expectedSizeBytes: number;
    content: AsyncIterable<Uint8Array>;
  }): Promise<EnterpriseKnowledgeDocumentUploadResponse>;
};

export class EnterpriseKnowledgeManagerError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly statusCode: number
  ) {
    super(`${code}: enterprise knowledge operation failed`);
    this.name = 'EnterpriseKnowledgeManagerError';
  }
}

export function createEnterpriseKnowledgeManager(input: {
  dataDir: string;
  sessionManager: EnterpriseSessionManager;
  httpClient: EnterpriseHttpClient;
  maxDocumentBytes?: number;
  now?: () => Date;
}): EnterpriseKnowledgeManager {
  const maxDocumentBytes =
    input.maxDocumentBytes ?? ENTERPRISE_KNOWLEDGE_DOCUMENT_MAX_BYTES;
  const now = input.now ?? (() => new Date());
  const tempDir = resolve(input.dataDir, 'enterprise-knowledge', '.tmp');

  async function requireToken(): Promise<string> {
    try {
      return await input.sessionManager.requireAccessToken();
    } catch (error) {
      if (error instanceof EnterpriseSessionError) {
        throw new EnterpriseKnowledgeManagerError(
          error.code,
          error.statusCode
        );
      }
      throw error;
    }
  }

  async function runRemote<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof EnterpriseHttpError)) throw error;
      if (error.code === 'ENTERPRISE_UNAUTHORIZED') {
        await input.sessionManager.invalidateUnauthorized();
        throw new EnterpriseKnowledgeManagerError(
          'ENTERPRISE_SESSION_EXPIRED',
          401
        );
      }
      throw managerErrorFromHttp(error);
    }
  }

  async function listKnowledgeBases(): Promise<EnterpriseKnowledgeBaseListResponse> {
    const accessToken = await requireToken();
    const response = await runRemote(
      () => input.httpClient.listKnowledgeBases(accessToken)
    );
    return {
      knowledgeBases: response.knowledgeBases,
      meta: response.meta,
      refreshedAt: now().toISOString()
    };
  }

  async function listDocuments(
    knowledgeBaseId: string
  ): Promise<EnterpriseKnowledgeDocumentListResponse> {
    validateKnowledgeBaseId(knowledgeBaseId);
    const accessToken = await requireToken();
    const response = await runRemote(
      () => input.httpClient.listKnowledgeDocuments(
        accessToken,
        knowledgeBaseId
      )
    );
    return {
      documents: response.documents,
      meta: response.meta,
      refreshedAt: now().toISOString()
    };
  }

  async function uploadDocument(request: {
    knowledgeBaseId: string;
    fileName: string;
    mimeType: string;
    expectedSizeBytes: number;
    content: AsyncIterable<Uint8Array>;
  }): Promise<EnterpriseKnowledgeDocumentUploadResponse> {
    validateKnowledgeBaseId(request.knowledgeBaseId);
    const fileName = validateFileName(request.fileName);
    const mimeType = validateMimeType(request.mimeType);
    validateExpectedSize(request.expectedSizeBytes, maxDocumentBytes);
    const accessToken = await requireToken();
    await assertUploadAllowed(accessToken, request.knowledgeBaseId);

    await mkdir(tempDir, { recursive: true, mode: 0o700 });
    const temporaryPath = join(tempDir, `${randomUUID()}.upload`);
    try {
      await stageFile({
        content: request.content,
        expectedSizeBytes: request.expectedSizeBytes,
        maxDocumentBytes,
        temporaryPath
      });
      const document = await runRemote(
        () => input.httpClient.uploadKnowledgeDocument({
          accessToken,
          knowledgeBaseId: request.knowledgeBaseId,
          filePath: temporaryPath,
          fileName,
          mimeType
        })
      );
      return { document };
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async function assertUploadAllowed(
    accessToken: string,
    knowledgeBaseId: string
  ): Promise<void> {
    const response = await runRemote(
      () => input.httpClient.listKnowledgeBases(accessToken)
    );
    const knowledgeBase = response.knowledgeBases.find(
      item => item.knowledgeBaseId === knowledgeBaseId
    );
    if (knowledgeBase === undefined || knowledgeBase.permissions.read !== true) {
      throw new EnterpriseKnowledgeManagerError(
        'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND',
        404
      );
    }
    if (knowledgeBase.permissions.upload !== true) {
      throw new EnterpriseKnowledgeManagerError(
        'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN',
        403
      );
    }
  }

  return {
    listKnowledgeBases,
    listDocuments,
    uploadDocument
  };
}

async function stageFile(input: {
  content: AsyncIterable<Uint8Array>;
  expectedSizeBytes: number;
  maxDocumentBytes: number;
  temporaryPath: string;
}): Promise<void> {
  const handle = await open(input.temporaryPath, 'wx', 0o600);
  let bytes = 0;
  try {
    for await (const chunk of input.content) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.byteLength;
      if (bytes > input.maxDocumentBytes) {
        throw new EnterpriseKnowledgeManagerError(
          'ENTERPRISE_DOCUMENT_TOO_LARGE',
          413
        );
      }
      await writeAll(handle, value);
    }
  } finally {
    await handle.close().catch(() => undefined);
  }

  if (bytes !== input.expectedSizeBytes) {
    throw new EnterpriseKnowledgeManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
}

function validateKnowledgeBaseId(value: string): void {
  if (value.trim().length === 0 || value.length > 512) {
    throw new EnterpriseKnowledgeManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
}

function validateFileName(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0
    || normalized.length > 255
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes('\0')
  ) {
    throw new EnterpriseKnowledgeManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  const dotIndex = normalized.lastIndexOf('.');
  const extension =
    dotIndex < 0 ? '' : normalized.slice(dotIndex).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new EnterpriseKnowledgeManagerError(
      'ENTERPRISE_DOCUMENT_TYPE_UNSUPPORTED',
      415
    );
  }
  return normalized;
}

function validateMimeType(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 255) {
    return 'application/octet-stream';
  }
  return normalized;
}

function validateExpectedSize(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EnterpriseKnowledgeManagerError(
      'ENTERPRISE_INVALID_REQUEST',
      400
    );
  }
  if (value > maximum) {
    throw new EnterpriseKnowledgeManagerError(
      'ENTERPRISE_DOCUMENT_TOO_LARGE',
      413
    );
  }
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

function managerErrorFromHttp(
  error: EnterpriseHttpError
): EnterpriseKnowledgeManagerError {
  return new EnterpriseKnowledgeManagerError(
    error.code,
    error.statusCode ?? defaultStatusCode(error.code)
  );
}

function defaultStatusCode(code: RuntimeErrorCode): number {
  switch (code) {
    case 'ENTERPRISE_INVALID_REQUEST':
      return 400;
    case 'ENTERPRISE_UNAUTHORIZED':
    case 'ENTERPRISE_SESSION_EXPIRED':
      return 401;
    case 'ENTERPRISE_AGENT_FORBIDDEN':
    case 'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN':
    case 'ENTERPRISE_FORBIDDEN':
      return 403;
    case 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND':
      return 404;
    case 'ENTERPRISE_KNOWLEDGE_CONFLICT':
      return 409;
    case 'ENTERPRISE_DOCUMENT_TOO_LARGE':
      return 413;
    case 'ENTERPRISE_DOCUMENT_TYPE_UNSUPPORTED':
      return 415;
    case 'ENTERPRISE_KNOWLEDGE_PROVIDER_ERROR':
      return 502;
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}
