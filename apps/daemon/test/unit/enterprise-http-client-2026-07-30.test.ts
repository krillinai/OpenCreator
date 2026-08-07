import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseHttpClient,
  EnterpriseHttpError
} from '../../src/enterprise/http-client-2026-07-30.js';

const ORIGIN = 'https://enterprise.example';
const AGENT_ID = 'clawee_550e8400-e29b-41d4-a716-446655440000';
const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('enterprise HTTP client', () => {
  it('register sends the fixed client and stable agent identity', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'user@example.com',
        name: 'User',
        password: 'password-123',
        client_id: 'clawee-agent',
        agent_id: AGENT_ID
      });
      return new Response(JSON.stringify({
        data: {
          account: {
            user_id: 'usr_1',
            email: 'user@example.com',
            name: 'User',
            status: 'active'
          }
        }
      }), {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'enterprise_session=must-not-escape'
        },
        status: 200
      });
    });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.register({
      email: 'user@example.com',
      name: 'User',
      password: 'password-123'
    }, AGENT_ID)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ORIGIN}/api/v1/auth/register`);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });
  });

  it('logs in with the fixed client id and parses only the public account summary', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'user@example.com',
        password: 'password-123',
        client_id: 'clawee-agent',
        agent_id: AGENT_ID
      });
      return jsonResponse({
        data: {
          account: {
            user_id: 'usr_secret',
            email: 'user@example.com',
            name: 'User',
            status: 'active'
          },
          agent: {
            agent_id: AGENT_ID,
            name: 'User'
          },
          access_token: 'enterprise-access-token',
          token_type: 'Bearer',
          expires_at: '2026-07-31T10:00:00Z'
        }
      });
    });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.login({
      email: 'user@example.com',
      password: 'password-123'
    }, AGENT_ID)).resolves.toEqual({
      account: {
        email: 'user@example.com',
        name: 'User'
      },
      agentId: AGENT_ID,
      accessToken: 'enterprise-access-token',
      tokenType: 'Bearer',
      expiresAt: '2026-07-31T10:00:00Z'
    });
  });

  it('requires the authenticated agent identity from the current account response', async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => (
        jsonResponse({
          data: {
            account: {
              user_id: 'usr_secret',
              email: 'user@example.com',
              name: 'User',
              status: 'active'
            },
            agent: {
              agent_id: AGENT_ID,
              name: 'User'
            },
            collector_registration: {
              exists: true,
              revoked: false,
              install_command: "curl -fsSL 'http://enterprise/install.sh?code=secret' | sh",
              install_powershell_command:
                "irm 'http://enterprise/install.ps1?code=secret' | iex"
            },
            applications: {
              frontend: true
            }
          }
        })
      )
    );
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.getMe('enterprise-access-token')).resolves.toEqual({
      account: {
        email: 'user@example.com',
        name: 'User'
      },
      agentId: AGENT_ID,
      status: 'active',
      frontendAllowed: true,
      collectorRegistration: {
        installCommand:
          "curl -fsSL 'http://enterprise/install.sh?code=secret' | sh",
        installPowershellCommand:
          "irm 'http://enterprise/install.ps1?code=secret' | iex"
      }
    });

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer enterprise-access-token'
      },
      method: 'GET'
    });
  });

  it('reveals the Agent MCP token and maps the governed MCP catalog', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          token_id: 'token_1',
          agent_id: AGENT_ID,
          token: 'agent-mcp-secret',
          token_type: 'Bearer',
          fingerprint: 'fingerprint-1',
          status: 'active',
          expires_at: null,
          scopes: ['mcp:call'],
          created_at: '2026-08-07T00:00:00Z'
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          agent_id: AGENT_ID,
          upstreams: [{
            id: 'crm-main',
            name: 'CRM',
            domain: 'sales',
            mcp_endpoint:
              'https://enterprise.example/mcp/servers/crm-main',
            upstream_transport: 'streamable_http',
            namespace: 'crm',
            status: 'active',
            tools: [{
              id: 'cap_search',
              upstream_name: 'customer.search',
              name: 'customer.search',
              exposed_name: 'crm.customer.search',
              title: '查询客户',
              description: '查询客户资料',
              risk_level: 'low',
              confirm_required: false,
              status: 'active',
              authorized: false,
              authorization_expires_at: null
            }]
          }]
        }
      }));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(
      client.revealAgentMcpToken('enterprise-access-token')
    ).resolves.toMatchObject({
      agentId: AGENT_ID,
      token: 'agent-mcp-secret',
      scopes: ['mcp:call']
    });
    await expect(
      client.getMcpCatalog('enterprise-access-token')
    ).resolves.toMatchObject({
      agentId: AGENT_ID,
      upstreams: [{
        upstreamId: 'crm-main',
        endpoint: 'https://enterprise.example/mcp/servers/crm-main',
        tools: [{
          toolId: 'cap_search',
          authorized: false
        }]
      }]
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/agents/token/reveal`
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/agents/mcp-catalog`
    );
  });

  it('maps authorized knowledge bases and document list fields', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          knowledge_base_id: 'kb_123',
          name: '公司制度',
          description: '公司制度和员工手册',
          status: 'active',
          document_count: 12,
          permissions: {
            read: true,
            upload: true,
            search: false
          }
        }],
        meta: {
          next_cursor: 'kb_cursor',
          has_next: true
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          document_id: 'doc_123',
          knowledge_base_id: 'kb_123',
          name: '员工手册.pdf',
          size_bytes: 102400,
          mime_type: 'application/pdf',
          status: 'ready',
          error_message: '',
          uploaded_by: 'usr_123',
          created_at: '2026-08-04T08:00:00Z',
          updated_at: '2026-08-04T08:01:00Z'
        }],
        meta: {
          next_cursor: '',
          has_next: false
        }
      }));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.listKnowledgeBases('enterprise-access-token')).resolves.toEqual({
      knowledgeBases: [{
        knowledgeBaseId: 'kb_123',
        name: '公司制度',
        description: '公司制度和员工手册',
        status: 'active',
        documentCount: 12,
        permissions: {
          read: true,
          upload: true,
          search: false
        }
      }],
      meta: {
        nextCursor: 'kb_cursor',
        hasNext: true
      }
    });
    await expect(
      client.listKnowledgeDocuments('enterprise-access-token', 'kb_123')
    ).resolves.toEqual({
      documents: [{
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
      }],
      meta: {
        nextCursor: '',
        hasNext: false
      }
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/knowledge-bases`
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/knowledge-bases/documents?knowledge_base_id=kb_123`
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer enterprise-access-token'
      },
      method: 'GET'
    });
  });

  it('uploads knowledge documents with authorization before file content', async () => {
    const directory = createTempDirectory();
    const filePath = join(directory, 'manual.pdf');
    writeFileSync(filePath, 'enterprise manual');
    const fetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      expect(String(url)).toBe(
        `${ORIGIN}/api/v1/app/knowledge-bases/documents`
      );
      expect(init).toMatchObject({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer enterprise-access-token'
        },
        method: 'POST'
      });
      expect(init?.headers).not.toHaveProperty('Content-Type');
      expect(init?.body).toBeInstanceOf(FormData);
      const entries = Array.from((init!.body as FormData).entries());
      expect(entries.map(([name]) => name)).toEqual([
        'knowledge_base_id',
        'file'
      ]);
      expect(entries[0]?.[1]).toBe('kb_123');
      const file = entries[1]?.[1];
      expect(file).toBeInstanceOf(Blob);
      expect((file as File).name).toBe('员工手册.pdf');
      expect((file as Blob).type).toBe('application/pdf');
      expect(await (file as Blob).text()).toBe('enterprise manual');
      return jsonResponse({
        data: {
          document_id: 'doc_456',
          knowledge_base_id: 'kb_123',
          name: '员工手册.pdf',
          size_bytes: 17,
          mime_type: 'application/pdf',
          status: 'processing',
          error_message: '',
          uploaded_by: 'usr_123',
          created_at: '2026-08-05T08:00:00Z',
          updated_at: '2026-08-05T08:00:00Z'
        }
      }, 201);
    });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.uploadKnowledgeDocument({
      accessToken: 'enterprise-access-token',
      knowledgeBaseId: 'kb_123',
      filePath,
      fileName: '员工手册.pdf',
      mimeType: 'application/pdf'
    })).resolves.toMatchObject({
      documentId: 'doc_456',
      knowledgeBaseId: 'kb_123',
      status: 'processing'
    });
  });

  it('maps shared spaces, files, details, and conservative write permissions', async () => {
    const remoteFile = {
      file_id: 'file_1',
      space_id: 'space_1',
      space_name: '设计资料',
      logical_path: 'docs/design.md',
      file_name: 'design.md',
      size_bytes: 13,
      sha256: 'a'.repeat(64),
      content_type: 'text/markdown',
      revision: 3,
      updated_by_user_id: 'usr_1',
      updated_by_agent_id: 'agent_1',
      updated_at: '2026-08-06T08:00:00Z'
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            space_id: 'space_1',
            name: '设计资料',
            description: '团队设计文件',
            updated_at: '2026-08-06T07:30:00Z'
          },
          {
            space_id: 'space_2',
            name: '发布资料',
            description: '',
            updated_at: '2026-08-06T07:20:00Z',
            permissions: { read: true }
          }
        ],
        meta: {
          next_cursor: 'space-next',
          has_next: true,
          max_file_size_bytes: 1073741824
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [remoteFile],
        meta: { next_cursor: '', has_next: false }
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          ...remoteFile,
          created_by_user_id: 'usr_creator',
          created_by_agent_id: 'agent_creator',
          created_at: '2026-08-05T08:00:00Z'
        }
      }));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.listSharedSpaces('enterprise-access-token', {
      limit: 50,
      cursor: 'space cursor'
    })).resolves.toEqual({
      spaces: [
        {
          spaceId: 'space_1',
          name: '设计资料',
          description: '团队设计文件',
          updatedAt: '2026-08-06T07:30:00Z',
          permissions: { read: true, write: false }
        },
        {
          spaceId: 'space_2',
          name: '发布资料',
          description: '',
          updatedAt: '2026-08-06T07:20:00Z',
          permissions: { read: true, write: false }
        }
      ],
      meta: {
        nextCursor: 'space-next',
        hasNext: true,
        maxFileSizeBytes: 1073741824
      }
    });
    await expect(client.listSharedFiles({
      accessToken: 'enterprise-access-token',
      spaceId: 'space_1',
      query: 'design',
      logicalPathPrefix: 'docs/',
      limit: 100,
      cursor: 'file cursor'
    })).resolves.toMatchObject({
      files: [{
        fileId: 'file_1',
        logicalPath: 'docs/design.md',
        revision: 3
      }],
      meta: { nextCursor: '', hasNext: false }
    });
    await expect(
      client.getSharedFileDetail('enterprise-access-token', 'file/中文')
    ).resolves.toMatchObject({
      fileId: 'file_1',
      createdByUserId: 'usr_creator',
      createdByAgentId: 'agent_creator',
      createdAt: '2026-08-05T08:00:00Z'
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/shared-spaces?limit=50&cursor=space+cursor`
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/shared-files?space_id=space_1&query=design&logical_path_prefix=docs%2F&limit=100&cursor=file+cursor`
    );
    expect(String(fetch.mock.calls[2]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/shared-files/detail?file_id=file%2F%E4%B8%AD%E6%96%87`
    );
  });

  it('streams shared downloads and removes files when integrity checks fail', async () => {
    const directory = createTempDirectory();
    const content = Buffer.from('shared design');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const headers = {
      'content-length': String(content.byteLength),
      'content-type': 'text/markdown',
      'x-content-sha256': sha256,
      'x-file-revision': '3',
      'x-shared-file-id': 'file_1'
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(binaryResponse([
        content.subarray(0, 5),
        content.subarray(5)
      ], headers))
      .mockResolvedValueOnce(binaryResponse([content], {
        ...headers,
        'x-content-sha256': 'f'.repeat(64)
      }));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });
    const validPath = join(directory, 'valid.md');
    const invalidPath = join(directory, 'invalid.md');

    await expect(client.downloadSharedFileContent({
      accessToken: 'enterprise-access-token',
      fileId: 'file_1',
      destinationPath: validPath
    })).resolves.toEqual({
      bytes: content.byteLength,
      sha256,
      revision: 3,
      contentType: 'text/markdown'
    });
    expect(readFileSync(validPath)).toEqual(content);

    await expect(client.downloadSharedFileContent({
      accessToken: 'enterprise-access-token',
      fileId: 'file_1',
      destinationPath: invalidPath
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SHARED_FILE_DIGEST_MISMATCH',
      stage: 'download'
    });
    expect(existsSync(invalidPath)).toBe(false);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${ORIGIN}/api/v1/app/shared-files/content?file_id=file_1`
    );
  });

  it('uploads shared files as the raw body with length, digest, and revision', async () => {
    const directory = createTempDirectory();
    const filePath = join(directory, 'design.md');
    const content = Buffer.from('shared design');
    const sha256 = createHash('sha256').update(content).digest('hex');
    writeFileSync(filePath, content);
    const fetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit
    ) => {
      expect(String(url)).toBe(
        `${ORIGIN}/api/v1/app/shared-files/content?space_id=space_1&logical_path=docs%2Fdesign.md&expected_revision=3`
      );
      expect(init).toMatchObject({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer enterprise-access-token',
          'Content-Length': String(content.byteLength),
          'Content-Type': 'text/markdown',
          'X-Content-SHA256': sha256
        },
        method: 'POST'
      });
      expect(init?.body).toBeInstanceOf(Blob);
      expect(await (init!.body as Blob).arrayBuffer())
        .toEqual(content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength
        ));
      return jsonResponse({
        data: {
          file_id: 'file_1',
          space_id: 'space_1',
          logical_path: 'docs/design.md',
          file_name: 'design.md',
          size_bytes: content.byteLength,
          sha256,
          content_type: 'text/markdown',
          revision: 4,
          created: false,
          updated_at: '2026-08-06T08:00:00Z'
        }
      });
    });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.uploadSharedFileContent({
      accessToken: 'enterprise-access-token',
      spaceId: 'space_1',
      logicalPath: 'docs/design.md',
      expectedRevision: 3,
      filePath,
      sizeBytes: content.byteLength,
      sha256,
      contentType: 'text/markdown'
    })).resolves.toMatchObject({
      fileId: 'file_1',
      revision: 4,
      created: false
    });
  });

  it('normalizes revision conflict details for the Runtime API', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      error: {
        code: 'revision_conflict',
        details: [{
          field: 'expected_revision',
          current_revision: 4
        }]
      }
    }, 409));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.listSharedFiles({
      accessToken: 'enterprise-access-token'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SHARED_FILE_REVISION_CONFLICT',
      statusCode: 409,
      upstreamCode: 'revision_conflict',
      details: { currentRevision: 4 }
    });
  });

  it.each([
    [403, 'document_upload_forbidden', 'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN'],
    [404, 'knowledge_base_not_found', 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND'],
    [409, 'conflict', 'ENTERPRISE_KNOWLEDGE_CONFLICT'],
    [413, 'document_too_large', 'ENTERPRISE_DOCUMENT_TOO_LARGE'],
    [415, 'document_type_unsupported', 'ENTERPRISE_DOCUMENT_TYPE_UNSUPPORTED'],
    [502, 'knowledge_provider_error', 'ENTERPRISE_KNOWLEDGE_PROVIDER_ERROR']
  ])('maps knowledge error %s %s to %s', async (
    status,
    upstreamCode,
    code
  ) => {
    const fetch = vi.fn(async () => jsonResponse({
      error: { code: upstreamCode }
    }, status));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(
      client.listKnowledgeDocuments('enterprise-access-token', 'kb_123')
    ).rejects.toMatchObject({
      code,
      statusCode: status,
      upstreamCode
    });
  });

  it.each([
    {
      status: 403,
      upstreamCode: 'agent_forbidden',
      code: 'ENTERPRISE_AGENT_FORBIDDEN'
    },
    {
      status: 409,
      upstreamCode: 'agent_id_conflict',
      code: 'ENTERPRISE_AGENT_ID_CONFLICT'
    }
  ])('maps $upstreamCode authentication failures', async ({
    status,
    upstreamCode,
    code
  }) => {
    const fetch = vi.fn(async () => jsonResponse({
      error: {
        code: upstreamCode
      }
    }, status));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.login({
      email: 'user@example.com',
      password: 'password-123'
    }, AGENT_ID)).rejects.toMatchObject({
      code,
      statusCode: status,
      upstreamCode
    });
  });

  it('streams a bounded package and deletes it on sha256 mismatch', async () => {
    const directory = createTempDirectory();
    const content = Buffer.from('bounded enterprise package');
    const expectedSha256 = createHash('sha256').update(content).digest('hex');
    const fetch = vi.fn()
      .mockResolvedValueOnce(binaryResponse([
        content.subarray(0, 8),
        content.subarray(8)
      ]))
      .mockResolvedValueOnce(binaryResponse([content]));
    const client = createEnterpriseHttpClient({
      fetch,
      maxPackageBytes: 1024,
      origin: ORIGIN
    });
    const validPath = join(directory, 'valid.zip');
    const invalidPath = join(directory, 'invalid.zip');

    await expect(client.downloadSkillPackage({
      accessToken: 'enterprise-access-token',
      destinationPath: validPath,
      expectedSha256,
      skillId: 'skill_1',
      versionId: 'version_1'
    })).resolves.toEqual({
      bytes: content.length,
      sha256: expectedSha256
    });
    expect(readFileSync(validPath)).toEqual(content);

    await expect(client.downloadSkillPackage({
      accessToken: 'enterprise-access-token',
      destinationPath: invalidPath,
      expectedSha256: '0'.repeat(64),
      skillId: 'skill_1',
      versionId: 'version_1'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH'
    });
    expect(existsSync(invalidPath)).toBe(false);
  });

  it('rejects declared and streamed package sizes over the configured limit', async () => {
    const directory = createTempDirectory();
    const destinationPath = join(directory, 'oversized.zip');
    const fetch = vi.fn(async () => binaryResponse(
      [Buffer.from('12345'), Buffer.from('67890')],
      { 'content-length': '10' }
    ));
    const client = createEnterpriseHttpClient({
      fetch,
      maxPackageBytes: 8,
      origin: ORIGIN
    });

    await expect(client.downloadSkillPackage({
      accessToken: 'enterprise-access-token',
      destinationPath,
      expectedSha256: '0'.repeat(64),
      skillId: 'skill_1',
      versionId: 'version_1'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE'
    });
    expect(existsSync(destinationPath)).toBe(false);
  });

  it('keeps upstream bodies and credentials out of public errors', async () => {
    const token = 'enterprise-access-token';
    const fetch = vi.fn(async () => jsonResponse({
      error: {
        code: 'internal_error',
        message: `failed with ${token}`,
        request_id: 'req_123'
      }
    }, 503));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    let error: unknown;
    try {
      await client.getMe(token);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnterpriseHttpError);
    expect(error).toMatchObject({
      code: 'ENTERPRISE_SERVICE_UNAVAILABLE',
      requestId: 'req_123',
      stage: 'response',
      statusCode: 503
    });
    expect(String(error)).not.toContain(token);
  });
});

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'clawee-enterprise-http-'));
  createdDirectories.push(directory);
  return directory;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status
  });
}

function binaryResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {}
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/zip',
      ...headers
    },
    status: 200
  });
}
