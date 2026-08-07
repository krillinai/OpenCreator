import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type {
  EnterpriseCredential,
  EnterpriseCredentialStore
} from '../../src/enterprise/credential-store-2026-07-30.js';
import type {
  EnterpriseAgentIdentityStore
} from '../../src/enterprise/agent-identity-2026-08-02.js';
import type {
  EnterpriseHttpClient,
  EnterpriseMeResult
} from '../../src/enterprise/http-client-2026-07-30.js';
import type {
  EnterpriseKnowledgeManager
} from '../../src/enterprise/knowledge-manager-2026-08-05.js';
import type {
  EnterpriseMcpManager
} from '../../src/enterprise/mcp-manager-2026-08-07.js';
import type {
  EnterpriseSharedDriveManager
} from '../../src/enterprise/shared-drive-manager-2026-08-06.js';
import type {
  EnterpriseSkillManager
} from '../../src/enterprise/skill-manager-2026-07-30.js';

let server: FastifyInstance | undefined;
let tempDir = '';
const agentId = 'clawee_550e8400-e29b-41d4-a716-446655440000';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tempDir) rmSync(tempDir, { force: true, recursive: true });
  tempDir = '';
});

describe('enterprise runtime API', () => {
  it('restores valid sessions without blocking local server startup', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const me = deferred<EnterpriseMeResult>();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore({
        accessToken: 'enterprise-token',
        expiresAt: '2026-07-31T10:00:00Z'
      }),
      enterpriseHttpClient: createClient({
        getMe: vi.fn(async () => me.promise)
      }),
      enterpriseOrigin: 'https://enterprise.example'
    });

    expect((await server.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await authRequest('GET', '/enterprise/session')).json()).toEqual({
      status: 'checking',
      transportSecurity: 'secure_https'
    });

    me.resolve({
      account: { email: 'user@example.com', name: 'User' },
      agentId,
      status: 'active',
      frontendAllowed: true
    });
    await vi.waitFor(async () => {
      expect((await authRequest('GET', '/enterprise/session')).json()).toMatchObject({
        status: 'signed_in',
        account: { email: 'user@example.com', name: 'User' }
      });
    });
  });

  it('cleans up MCP runtime state when startup restore finds no session', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseMcpManager = createMcpManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseMcpManager,
      enterpriseOrigin: 'https://enterprise.example'
    });

    await vi.waitFor(() => {
      expect(enterpriseMcpManager.handleSessionSignedOut).toHaveBeenCalled();
    });
  });

  it('returns session responses without token fields and validates credentials locally', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const client = createClient();
    const enterpriseMcpManager = createMcpManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: client,
      enterpriseMcpManager,
      enterpriseOrigin: 'http://127.0.0.1:1904'
    });

    const invalid = await authRequest('POST', '/enterprise/login', {
      email: 'not-an-email',
      password: 'short'
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' }
    });
    expect(client.login).not.toHaveBeenCalled();

    const loggedIn = await authRequest('POST', '/enterprise/login', {
      email: 'user@example.com',
      password: 'password-123'
    });
    expect(loggedIn.statusCode).toBe(200);
    const payload = loggedIn.json();
    expect(payload).toMatchObject({
      status: 'signed_in',
      transportSecurity: 'insecure_http'
    });
    expect(JSON.stringify(payload)).not.toContain('enterprise-token');
    expect(JSON.stringify(payload)).not.toContain('accessToken');
    expect(enterpriseMcpManager.handleSessionAuthenticated)
      .toHaveBeenCalledOnce();

    vi.mocked(enterpriseMcpManager.handleSessionAuthenticated).mockClear();
    const refreshed = await authRequest('POST', '/enterprise/session/refresh');
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toMatchObject({ status: 'signed_in' });
    expect(enterpriseMcpManager.handleSessionAuthenticated)
      .not.toHaveBeenCalled();
  });

  it('exposes enterprise skill list detail install and update routes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseSkillManager = createEnterpriseSkillManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseOrigin: 'https://enterprise.example',
      enterpriseSkillManager
    });

    const list = await authRequest('GET', '/enterprise/skills');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual({
      skills: [],
      refreshedAt: '2026-07-30T10:00:00.000Z'
    });

    const detail = await authRequest('GET', '/enterprise/skills/skill_1');
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      skillId: 'skill_1',
      name: 'code-review'
    });

    expect(
      (await authRequest('POST', '/enterprise/skills/skill_1/install')).statusCode
    ).toBe(201);
    expect(
      (await authRequest('POST', '/enterprise/skills/skill_1/update')).statusCode
    ).toBe(200);
    expect(enterpriseSkillManager.installSkill).toHaveBeenCalledWith('skill_1');
    expect(enterpriseSkillManager.updateSkill).toHaveBeenCalledWith('skill_1');
  });

  it('exposes MCP catalog refresh and local preference routes without token fields', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseMcpManager = createMcpManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseMcpManager,
      enterpriseOrigin: 'https://enterprise.example'
    });

    const list = await authRequest('GET', '/enterprise/mcp');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      tokenStatus: 'ready',
      upstreams: [{
        upstreamId: 'crm-main',
        installed: false,
        enabled: false
      }]
    });
    expect(JSON.stringify(list.json())).not.toContain('agent-mcp-secret');

    expect(
      (await authRequest('POST', '/enterprise/mcp/refresh')).statusCode
    ).toBe(200);
    const updated = await authRequest(
      'PATCH',
      '/enterprise/mcp/upstreams/crm-main/preference',
      { installed: true, enabled: false }
    );
    expect(updated.statusCode).toBe(200);
    expect(enterpriseMcpManager.updatePreference).toHaveBeenCalledWith(
      'crm-main',
      { installed: true, enabled: false }
    );
  });

  it('exposes knowledge list, document list, and binary upload routes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseKnowledgeManager = createKnowledgeManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseKnowledgeManager,
      enterpriseOrigin: 'https://enterprise.example'
    });

    const list = await authRequest('GET', '/enterprise/knowledge-bases');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      knowledgeBases: [{
        knowledgeBaseId: 'kb_123',
        permissions: { read: true, upload: true }
      }]
    });

    const documents = await authRequest(
      'GET',
      '/enterprise/knowledge-bases/kb_123/documents'
    );
    expect(documents.statusCode).toBe(200);
    expect(documents.json()).toMatchObject({
      documents: [{
        documentId: 'doc_123',
        knowledgeBaseId: 'kb_123'
      }]
    });

    const content = Buffer.from('enterprise manual');
    const query = new URLSearchParams({
      fileName: '员工手册.pdf',
      mimeType: 'application/pdf',
      sizeBytes: String(content.byteLength)
    });
    const upload = await server.inject({
      method: 'POST',
      url: `/enterprise/knowledge-bases/kb_123/documents?${query.toString()}`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.clawee.knowledge-document'
      },
      payload: content
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({
      document: {
        documentId: 'doc_upload',
        knowledgeBaseId: 'kb_123',
        status: 'processing'
      }
    });
    expect(enterpriseKnowledgeManager.uploadDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: 'kb_123',
        fileName: '员工手册.pdf',
        mimeType: 'application/pdf',
        expectedSizeBytes: content.byteLength
      })
    );
    const uploadInput = vi.mocked(
      enterpriseKnowledgeManager.uploadDocument
    ).mock.calls[0]?.[0];
    const chunks: Buffer[] = [];
    for await (const chunk of uploadInput!.content) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(content);
  });

  it('returns a knowledge-specific error when the binary body is too large', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseKnowledgeManager = createKnowledgeManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseKnowledgeDocumentMaxBytes: 8,
      enterpriseKnowledgeManager,
      enterpriseOrigin: 'https://enterprise.example'
    });

    const content = Buffer.from('123456789');
    const query = new URLSearchParams({
      fileName: 'large.pdf',
      mimeType: 'application/pdf',
      sizeBytes: String(content.byteLength)
    });
    const response = await server.inject({
      method: 'POST',
      url: `/enterprise/knowledge-bases/kb_123/documents?${query.toString()}`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.clawee.knowledge-document'
      },
      payload: content
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: 'ENTERPRISE_DOCUMENT_TOO_LARGE' }
    });
    expect(enterpriseKnowledgeManager.uploadDocument).not.toHaveBeenCalled();
  });

  it('exposes shared drive list, detail, raw upload, and project download routes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseSharedDriveManager = createSharedDriveManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseSharedDriveManager,
      enterpriseOrigin: 'https://enterprise.example'
    });

    const spaces = await authRequest(
      'GET',
      '/enterprise/shared-spaces?limit=50&cursor=space-cursor'
    );
    expect(spaces.statusCode).toBe(200);
    expect(spaces.json()).toMatchObject({
      spaces: [{
        spaceId: 'space_1',
        permissions: { read: true, write: false }
      }],
      meta: { maxFileSizeBytes: 1073741824 }
    });
    expect(enterpriseSharedDriveManager.listSpaces).toHaveBeenCalledWith({
      limit: 50,
      cursor: 'space-cursor'
    });

    const files = await authRequest(
      'GET',
      '/enterprise/shared-files?spaceId=space_1&query=design&logicalPathPrefix=docs%2F&limit=100'
    );
    expect(files.statusCode).toBe(200);
    expect(files.json()).toMatchObject({
      files: [{
        fileId: 'file_1',
        logicalPath: 'docs/design.md',
        revision: 3
      }]
    });
    expect(enterpriseSharedDriveManager.listFiles).toHaveBeenCalledWith({
      spaceId: 'space_1',
      query: 'design',
      logicalPathPrefix: 'docs/',
      limit: 100
    });

    const detail = await authRequest(
      'GET',
      '/enterprise/shared-files/file%2Fdesign'
    );
    expect(detail.statusCode).toBe(200);
    expect(enterpriseSharedDriveManager.getFileDetail)
      .toHaveBeenCalledWith('file/design');

    const content = Buffer.from('shared design');
    const uploadQuery = new URLSearchParams({
      logicalPath: 'docs/design.md',
      contentType: 'text/markdown',
      sizeBytes: String(content.byteLength),
      expectedRevision: '3'
    });
    const upload = await server.inject({
      method: 'POST',
      url: `/enterprise/shared-spaces/space%2Fdesign/files?${uploadQuery.toString()}`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.clawee.shared-file'
      },
      payload: content
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json()).toMatchObject({
      fileId: 'file_1',
      logicalPath: 'docs/design.md',
      revision: 4,
      created: false
    });
    expect(enterpriseSharedDriveManager.uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space/design',
        logicalPath: 'docs/design.md',
        expectedRevision: 3,
        contentType: 'text/markdown',
        expectedSizeBytes: content.byteLength
      })
    );

    const download = await authRequest(
      'POST',
      '/enterprise/shared-files/file%2Fdesign/download',
      { projectId: 'project_1', overwrite: true }
    );
    expect(download.statusCode).toBe(200);
    expect(download.json()).toMatchObject({
      fileId: 'file/design',
      projectId: 'project_1',
      relativePath: 'docs/design.md',
      overwritten: true
    });
    expect(enterpriseSharedDriveManager.downloadToProject).toHaveBeenCalledWith({
      fileId: 'file/design',
      projectId: 'project_1',
      overwrite: true
    });
  });

  it('returns a shared-file-specific error when the raw body is too large', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseSharedDriveManager = createSharedDriveManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseAgentIdentityStore: createAgentIdentityStore(),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: createClient(),
      enterpriseSharedDriveManager,
      enterpriseSharedFileMaxBytes: 8,
      enterpriseOrigin: 'https://enterprise.example'
    });

    const content = Buffer.from('123456789');
    const query = new URLSearchParams({
      logicalPath: 'large.bin',
      contentType: 'application/octet-stream',
      sizeBytes: String(content.byteLength)
    });
    const response = await server.inject({
      method: 'POST',
      url: `/enterprise/shared-spaces/space_1/files?${query.toString()}`,
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/vnd.clawee.shared-file'
      },
      payload: content
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: 'ENTERPRISE_SHARED_FILE_TOO_LARGE' }
    });
    expect(enterpriseSharedDriveManager.uploadFile).not.toHaveBeenCalled();
  });

  async function authRequest(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: object
  ) {
    return server!.inject({
      method,
      url,
      headers: { authorization: 'Bearer secret' },
      ...(payload === undefined ? {} : { payload })
    });
  }
});

function createStore(initial?: EnterpriseCredential): EnterpriseCredentialStore {
  let current = initial;
  return {
    async read() {
      return current;
    },
    async write(next) {
      current = next;
    },
    async delete() {
      current = undefined;
    }
  };
}

function createClient(
  overrides: Partial<EnterpriseHttpClient> = {}
): EnterpriseHttpClient {
  return {
    register: vi.fn(async () => undefined),
    login: vi.fn(async () => ({
      account: { email: 'user@example.com', name: 'User' },
      agentId,
      accessToken: 'enterprise-token',
      tokenType: 'Bearer' as const,
      expiresAt: '2026-07-31T10:00:00Z'
    })),
    getMe: vi.fn(async () => ({
      account: { email: 'user@example.com', name: 'User' },
      agentId,
      status: 'active',
      frontendAllowed: true
    })),
    logout: vi.fn(async () => undefined),
    revealAgentMcpToken: vi.fn(async () => ({
      tokenId: 'token_1',
      agentId,
      token: 'agent-mcp-token',
      tokenType: 'Bearer' as const,
      fingerprint: 'fingerprint-1',
      expiresAt: null,
      scopes: ['mcp:call'],
      createdAt: '2026-08-07T00:00:00Z'
    })),
    getMcpCatalog: vi.fn(async () => ({
      agentId,
      upstreams: []
    })),
    listKnowledgeBases: vi.fn(async () => ({
      knowledgeBases: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    listKnowledgeDocuments: vi.fn(async () => ({
      documents: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    uploadKnowledgeDocument: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listSharedSpaces: vi.fn(async () => ({
      spaces: [],
      meta: {
        nextCursor: '',
        hasNext: false,
        maxFileSizeBytes: 1024 * 1024 * 1024
      }
    })),
    listSharedFiles: vi.fn(async () => ({
      files: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    getSharedFileDetail: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    downloadSharedFileContent: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    uploadSharedFileContent: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    listSkills: vi.fn(async () => []),
    getSkillDetail: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    downloadSkillPackage: vi.fn(async () => {
      throw new Error('not implemented');
    }),
    ...overrides
  };
}

function createAgentIdentityStore(): EnterpriseAgentIdentityStore {
  return {
    getOrCreate: vi.fn(async () => agentId)
  };
}

function createMcpManager(): EnterpriseMcpManager {
  const response = {
    agentId,
    tokenStatus: 'ready' as const,
    upstreams: [{
      upstreamId: 'crm-main',
      name: 'CRM',
      domain: 'sales',
      endpoint: 'https://enterprise.example/mcp/servers/crm-main',
      upstreamTransport: 'streamable_http',
      namespace: 'crm',
      status: 'active',
      installed: false,
      enabled: false,
      tools: []
    }],
    refreshedAt: '2026-08-07T10:00:00.000Z'
  };
  return {
    listConnections: vi.fn(async () => response),
    refreshConnections: vi.fn(async () => response),
    updatePreference: vi.fn(async () => response),
    prepareRuntime: vi.fn(async () => undefined),
    handleSessionAuthenticated: vi.fn(),
    handleSessionSignedOut: vi.fn(async () => undefined)
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createEnterpriseSkillManager(): EnterpriseSkillManager {
  const skill = {
    skillId: 'skill_1',
    name: 'code-review',
    version: '1.0',
    status: 'installed' as const,
    integrity: 'verified' as const,
    actions: ['use'] as Array<'use'>
  };
  const localSkill = {
    id: 'code-review',
    name: 'code-review',
    description: 'Enterprise code review',
    status: 'valid' as const,
    diagnostics: [],
    codexHome: '/codex-home',
    codexHomeMode: 'isolated' as const,
    skillsPath: '/codex-home/skills',
    skillPath: '/codex-home/skills/code-review',
    skillFilePath: '/codex-home/skills/code-review/SKILL.md'
  };
  const operation = {
    id: 'operation_1',
    operation: 'install' as const,
    skillId: 'code-review',
    codexHome: '/codex-home',
    skillsPath: '/codex-home/skills',
    targetPath: '/codex-home/skills/code-review',
    status: 'succeeded' as const,
    createdAt: '2026-07-30T10:00:00.000Z'
  };
  return {
    listSkills: vi.fn(async () => ({
      skills: [],
      refreshedAt: '2026-07-30T10:00:00.000Z'
    })),
    getSkillDetail: vi.fn(async () => ({
      ...skill,
      actions: [...skill.actions],
      changelog: 'Initial release'
    })),
    installSkill: vi.fn(async () => ({
      skill: { ...skill, actions: [...skill.actions] },
      localSkill,
      operation
    })),
    updateSkill: vi.fn(async () => ({
      skill: { ...skill, actions: [...skill.actions] },
      localSkill,
      operation: { ...operation, operation: 'overwrite' as const }
    }))
  };
}

function createKnowledgeManager(): EnterpriseKnowledgeManager {
  const knowledgeBase = {
    knowledgeBaseId: 'kb_123',
    name: '公司制度',
    description: '公司制度和员工手册',
    status: 'active',
    documentCount: 1,
    permissions: {
      read: true,
      upload: true,
      search: false
    }
  };
  const document = {
    documentId: 'doc_123',
    knowledgeBaseId: 'kb_123',
    name: '员工手册.pdf',
    sizeBytes: 102400,
    mimeType: 'application/pdf',
    status: 'ready',
    errorMessage: '',
    uploadedBy: 'usr_123',
    createdAt: '2026-08-04T08:00:00Z',
    updatedAt: '2026-08-04T08:01:00Z'
  };
  return {
    listKnowledgeBases: vi.fn(async () => ({
      knowledgeBases: [knowledgeBase],
      meta: { nextCursor: '', hasNext: false },
      refreshedAt: '2026-08-05T08:00:00.000Z'
    })),
    listDocuments: vi.fn(async () => ({
      documents: [document],
      meta: { nextCursor: '', hasNext: false },
      refreshedAt: '2026-08-05T08:00:00.000Z'
    })),
    uploadDocument: vi.fn(async input => ({
      document: {
        ...document,
        documentId: 'doc_upload',
        name: input.fileName,
        sizeBytes: input.expectedSizeBytes,
        mimeType: input.mimeType,
        status: 'processing',
        updatedAt: '2026-08-05T08:00:00Z'
      }
    }))
  };
}

function createSharedDriveManager(): EnterpriseSharedDriveManager {
  const file = {
    fileId: 'file_1',
    spaceId: 'space_1',
    spaceName: '设计资料',
    logicalPath: 'docs/design.md',
    fileName: 'design.md',
    sizeBytes: 13,
    sha256: 'a'.repeat(64),
    contentType: 'text/markdown',
    revision: 3,
    updatedByUserId: 'usr_1',
    updatedByAgentId: 'agent_1',
    updatedAt: '2026-08-06T08:00:00Z'
  };
  return {
    listSpaces: vi.fn(async () => ({
      spaces: [{
        spaceId: 'space_1',
        name: '设计资料',
        description: '团队设计文件',
        updatedAt: '2026-08-06T07:30:00Z',
        permissions: { read: true, write: false }
      }],
      meta: {
        nextCursor: '',
        hasNext: false,
        maxFileSizeBytes: 1073741824
      },
      refreshedAt: '2026-08-06T08:00:00.000Z'
    })),
    listFiles: vi.fn(async () => ({
      files: [file],
      meta: { nextCursor: '', hasNext: false },
      refreshedAt: '2026-08-06T08:00:00.000Z'
    })),
    getFileDetail: vi.fn(async () => ({ file })),
    uploadFile: vi.fn(async input => {
      const chunks: Buffer[] = [];
      for await (const chunk of input.content) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks)).toEqual(Buffer.from('shared design'));
      return {
        fileId: 'file_1',
        spaceId: input.spaceId,
        logicalPath: input.logicalPath,
        fileName: 'design.md',
        sizeBytes: input.expectedSizeBytes,
        sha256: 'b'.repeat(64),
        contentType: input.contentType,
        revision: 4,
        created: false,
        updatedAt: '2026-08-06T08:01:00Z'
      };
    }),
    downloadToProject: vi.fn(async input => ({
      fileId: input.fileId,
      projectId: input.projectId,
      relativePath: 'docs/design.md',
      sizeBytes: 13,
      sha256: 'a'.repeat(64),
      revision: 3,
      overwritten: input.overwrite
    }))
  };
}
