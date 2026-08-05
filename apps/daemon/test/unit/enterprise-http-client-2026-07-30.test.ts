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
  it('decodes the exact knowledge search grant and forwards only query and limit', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { tools: [{ name: 'knowledge.search', enabled: true }] }
      }))
      .mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({ query: 'leave policy', limit: 5 });
        return jsonResponse({
          data: {
            results: [{
              title: 'Leave policy',
              knowledge_base_name: 'HR',
              document_name: 'Handbook',
              excerpt: 'Annual leave is 12 days.',
              internal_document_id: 'must-be-stripped'
            }]
          }
        });
      });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.hasKnowledgeSearchGrant('enterprise-access-token')).resolves.toBe(true);
    await expect(client.searchKnowledge({
      accessToken: 'enterprise-access-token',
      query: 'leave policy',
      limit: 5
    })).resolves.toEqual([{
      title: 'Leave policy',
      knowledgeBaseName: 'HR',
      documentName: 'Handbook',
      excerpt: 'Annual leave is 12 days.'
    }]);
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual([
      `${ORIGIN}/api/v1/app/mcp-grants`,
      `${ORIGIN}/api/v1/app/knowledge/search`
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer enterprise-access-token'
      })
    });
  });

  it('rejects unknown enterprise MCP grant tool names', async () => {
    const client = createEnterpriseHttpClient({
      origin: ORIGIN,
      fetch: vi.fn(async () => jsonResponse({
        data: { tools: [{ name: 'filesystem.read', enabled: true }] }
      }))
    });

    await expect(
      client.hasKnowledgeSearchGrant('enterprise-access-token')
    ).rejects.toMatchObject({ code: 'ENTERPRISE_PROTOCOL_ERROR' });
  });

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
            account_id: 'acct_01JZ8W6A2M4S',
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
        subjectId: 'acct_01JZ8W6A2M4S',
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
              account_id: 'acct_01JZ8W6A2M4S',
              email: 'user@example.com',
              name: 'User',
              status: 'active'
            },
            agent: {
              agent_id: AGENT_ID,
              name: 'User'
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
        subjectId: 'acct_01JZ8W6A2M4S',
        email: 'user@example.com',
        name: 'User'
      },
      agentId: AGENT_ID,
      status: 'active',
      frontendAllowed: true
    });

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer enterprise-access-token'
      },
      method: 'GET'
    });
  });

  it('accepts the documented user_id as the stable account subject', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      data: {
        account: {
          user_id: 'usr_123',
          email: 'user@example.com',
          name: 'User',
          status: 'active'
        },
        agent: { agent_id: AGENT_ID, name: 'User' },
        access_token: 'enterprise-access-token',
        token_type: 'Bearer',
        expires_at: '2026-07-31T10:00:00Z'
      }
    }));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.login({
      email: 'user@example.com',
      password: 'password-123'
    }, AGENT_ID)).resolves.toMatchObject({
      account: { subjectId: 'usr_123' }
    });
  });

  it('rejects an authenticated account response without a stable account id', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      data: {
        account: {
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
    }));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.login({
      email: 'user@example.com',
      password: 'password-123'
    }, AGENT_ID)).rejects.toMatchObject({
      code: 'ENTERPRISE_PROTOCOL_ERROR'
    });
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
