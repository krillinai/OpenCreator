import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteKnowledgeDocument
} from '../../src/enterprise/http-client-2026-07-30.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';
import {
  createEnterpriseKnowledgeManager
} from '../../src/enterprise/knowledge-manager-2026-08-05.js';
import type {
  EnterpriseSessionManager
} from '../../src/enterprise/session-manager-2026-07-30.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = '';
});

describe('enterprise knowledge manager', () => {
  it('returns authorized knowledge bases and documents with refresh metadata', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-knowledge-manager-'));
    const manager = createEnterpriseKnowledgeManager({
      dataDir: tempDir,
      sessionManager: createSessionManager(),
      httpClient: createHttpClient({
        listKnowledgeBases: vi.fn(async () => ({
          knowledgeBases: [knowledgeBase()],
          meta: { nextCursor: '', hasNext: false }
        })),
        listKnowledgeDocuments: vi.fn(async () => ({
          documents: [knowledgeDocument()],
          meta: { nextCursor: 'next', hasNext: true }
        }))
      }),
      now: () => new Date('2026-08-05T04:00:00.000Z')
    });

    await expect(manager.listKnowledgeBases()).resolves.toEqual({
      knowledgeBases: [knowledgeBase()],
      meta: { nextCursor: '', hasNext: false },
      refreshedAt: '2026-08-05T04:00:00.000Z'
    });
    await expect(manager.listDocuments('kb_1')).resolves.toEqual({
      documents: [knowledgeDocument()],
      meta: { nextCursor: 'next', hasNext: true },
      refreshedAt: '2026-08-05T04:00:00.000Z'
    });
  });

  it('checks upload permission before reading content and stages files privately', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-knowledge-manager-'));
    const uploadKnowledgeDocument = vi.fn(async (input: {
      filePath: string;
    }) => {
      expect(readFileSync(input.filePath, 'utf8')).toBe('policy');
      return knowledgeDocument({ status: 'processing' });
    });
    const manager = createEnterpriseKnowledgeManager({
      dataDir: tempDir,
      sessionManager: createSessionManager(),
      httpClient: createHttpClient({ uploadKnowledgeDocument })
    });

    await expect(manager.uploadDocument({
      knowledgeBaseId: 'kb_1',
      fileName: 'policy.md',
      mimeType: 'text/markdown',
      expectedSizeBytes: 6,
      content: chunks('policy')
    })).resolves.toEqual({
      document: knowledgeDocument({ status: 'processing' })
    });
    expect(uploadKnowledgeDocument).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'enterprise-token',
      knowledgeBaseId: 'kb_1',
      fileName: 'policy.md',
      mimeType: 'text/markdown'
    }));
    expect(
      readdirSync(join(tempDir, 'enterprise-knowledge', '.tmp'))
    ).toEqual([]);
  });

  it('rejects missing upload permission before consuming the file stream', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-knowledge-manager-'));
    let consumed = false;
    const manager = createEnterpriseKnowledgeManager({
      dataDir: tempDir,
      sessionManager: createSessionManager(),
      httpClient: createHttpClient({
        listKnowledgeBases: vi.fn(async () => ({
          knowledgeBases: [
            knowledgeBase({
              permissions: { read: true, upload: false, search: false }
            })
          ],
          meta: { nextCursor: '', hasNext: false }
        }))
      })
    });

    await expect(manager.uploadDocument({
      knowledgeBaseId: 'kb_1',
      fileName: 'policy.md',
      mimeType: 'text/markdown',
      expectedSizeBytes: 6,
      content: (async function* () {
        consumed = true;
        yield Buffer.from('policy');
      })()
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN',
      statusCode: 403
    });
    expect(consumed).toBe(false);
  });

  it('enforces document extension, declared size and streamed size', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-knowledge-manager-'));
    const manager = createEnterpriseKnowledgeManager({
      dataDir: tempDir,
      sessionManager: createSessionManager(),
      httpClient: createHttpClient(),
      maxDocumentBytes: 8
    });

    await expect(manager.uploadDocument({
      knowledgeBaseId: 'kb_1',
      fileName: 'policy.exe',
      mimeType: 'application/octet-stream',
      expectedSizeBytes: 2,
      content: chunks('ok')
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_DOCUMENT_TYPE_UNSUPPORTED'
    });
    await expect(manager.uploadDocument({
      knowledgeBaseId: 'kb_1',
      fileName: 'policy.md',
      mimeType: 'text/markdown',
      expectedSizeBytes: 9,
      content: chunks('123456789')
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_DOCUMENT_TOO_LARGE'
    });
    await expect(manager.uploadDocument({
      knowledgeBaseId: 'kb_1',
      fileName: 'policy.md',
      mimeType: 'text/markdown',
      expectedSizeBytes: 5,
      content: chunks('four')
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_INVALID_REQUEST'
    });
  });

  it('invalidates the enterprise session on upstream unauthorized responses', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-knowledge-manager-'));
    const sessionManager = createSessionManager();
    const manager = createEnterpriseKnowledgeManager({
      dataDir: tempDir,
      sessionManager,
      httpClient: createHttpClient({
        listKnowledgeBases: vi.fn(async () => {
          throw new EnterpriseHttpError(
            'ENTERPRISE_UNAUTHORIZED',
            'response',
            401
          );
        })
      })
    });

    await expect(manager.listKnowledgeBases()).rejects.toMatchObject({
      code: 'ENTERPRISE_SESSION_EXPIRED',
      statusCode: 401
    });
    expect(sessionManager.invalidateUnauthorized).toHaveBeenCalledOnce();
  });
});

function createSessionManager(): EnterpriseSessionManager {
  return {
    startRestore: vi.fn(),
    getSnapshot: vi.fn(() => ({
      status: 'signed_in' as const,
      account: {
        subjectId: 'acct_01JZ8W6A2M4S',
        email: 'member@example.com',
        name: 'Member'
      },
      transportSecurity: 'secure_https' as const
    })),
    refresh: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    requireAccessToken: vi.fn(async () => 'enterprise-token'),
    invalidateUnauthorized: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  };
}

function createHttpClient(
  overrides: Partial<EnterpriseHttpClient> = {}
): EnterpriseHttpClient {
  return {
    register: vi.fn(),
    login: vi.fn(),
    getMe: vi.fn(),
    logout: vi.fn(),
    listKnowledgeBases: vi.fn(async () => ({
      knowledgeBases: [knowledgeBase()],
      meta: { nextCursor: '', hasNext: false }
    })),
    listKnowledgeDocuments: vi.fn(async () => ({
      documents: [knowledgeDocument()],
      meta: { nextCursor: '', hasNext: false }
    })),
    uploadKnowledgeDocument: vi.fn(async () => knowledgeDocument()),
    listSkills: vi.fn(async () => []),
    getSkillDetail: vi.fn(),
    downloadSkillPackage: vi.fn(),
    ...overrides
  };
}

function knowledgeBase(
  overrides: Partial<Awaited<ReturnType<
    EnterpriseHttpClient['listKnowledgeBases']
  >>['knowledgeBases'][number]> = {}
) {
  return {
    knowledgeBaseId: 'kb_1',
    name: '公司制度',
    description: '公司制度和员工手册',
    status: 'active',
    documentCount: 1,
    permissions: { read: true, upload: true, search: false },
    ...overrides
  };
}

function knowledgeDocument(
  overrides: Partial<EnterpriseRemoteKnowledgeDocument> = {}
): EnterpriseRemoteKnowledgeDocument {
  return {
    documentId: 'doc_1',
    knowledgeBaseId: 'kb_1',
    name: 'policy.md',
    sizeBytes: 6,
    mimeType: 'text/markdown',
    status: 'ready',
    errorMessage: '',
    uploadedBy: 'usr_1',
    createdAt: '2026-08-05T03:00:00Z',
    updatedAt: '2026-08-05T03:01:00Z',
    ...overrides
  };
}

async function* chunks(value: string): AsyncIterable<Uint8Array> {
  yield Buffer.from(value);
}
