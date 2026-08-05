import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { EnterpriseCredentialStore } from '../../src/enterprise/credential-store-2026-07-30.js';
import type { EnterpriseHttpClient } from '../../src/enterprise/http-client-2026-07-30.js';

const agentId = 'clawee_550e8400-e29b-41d4-a716-446655440000';
let server: FastifyInstance | undefined;
let dataDir = '';

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = '';
});

describe('enterprise knowledge conversation API', () => {
  it('derives ownership from the verified session and hides knowledge threads elsewhere', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'clawee-knowledge-conversation-'));
    let subjectId = 'acct_subject_a';
    server = await buildServer({
      token: 'secret',
      dataDir,
      codexHome: join(dataDir, 'codex-home'),
      enterpriseAgentIdentityStore: {
        getOrCreate: vi.fn(async () => agentId)
      },
      enterpriseCredentialStore: credentialStore(),
      enterpriseHttpClient: enterpriseClient(() => subjectId)
    });

    const created = await request('POST', '/enterprise/knowledge-conversations', {});
    expect(created.statusCode).toBe(201);
    expect(created.json().thread).toMatchObject({
      projectId: null,
      purpose: 'knowledge_conversation'
    });
    expect(created.json().thread).not.toHaveProperty('enterpriseSubjectId');
    const threadId = created.json().thread.id as string;
    expect(created.json().thread.cwd).toBe(resolve(
      dataDir,
      'enterprise-knowledge',
      'workspaces',
      createHash('sha256').update('acct_subject_a').digest('hex'),
      threadId
    ));

    const latestForOwner = await request('GET', '/enterprise/knowledge-conversations/latest');
    expect(latestForOwner.statusCode).toBe(200);
    expect(latestForOwner.json().thread.id).toBe(threadId);
    expect(
      (await request('GET', `/enterprise/knowledge-conversations/${threadId}`)).statusCode
    ).toBe(200);
    expect(
      (await request('GET', `/enterprise/knowledge-conversations/${threadId}/runs`)).json()
    ).toEqual({ runs: [] });
    expect(
      (await request('GET', `/enterprise/knowledge-conversations/${threadId}/history`)).json()
    ).toMatchObject({ threadId, items: [] });

    expect((await request('POST', '/enterprise/knowledge-conversations', {
      enterpriseSubjectId: 'acct_subject_b'
    })).statusCode).toBe(400);

    const publicList = await request('GET', '/threads?status=active');
    expect(publicList.statusCode).toBe(200);
    expect(publicList.json().threads).toEqual([]);
    expect((await request('GET', `/threads/${threadId}`)).statusCode).toBe(404);
    expect((await request('GET', `/threads/${threadId}/history`)).statusCode).toBe(404);
    expect((await request('GET', `/threads/${threadId}/runs`)).statusCode).toBe(404);

    const suppliedSubject = await request('POST', '/threads', {
      purpose: 'schedule_draft',
      enterpriseSubjectId: 'acct_subject_a'
    });
    expect(suppliedSubject.statusCode).toBe(400);

    subjectId = 'acct_subject_b';
    expect(
      (await request('GET', '/enterprise/knowledge-conversations/latest')).statusCode
    ).toBe(204);
    expect(
      (await request('GET', `/enterprise/knowledge-conversations/${threadId}`)).statusCode
    ).toBe(404);
    expect(
      (await request('GET', `/enterprise/knowledge-conversations/${threadId}/history`)).statusCode
    ).toBe(404);
    expect(
      (await request('GET', `/enterprise/knowledge-conversations/${threadId}/runs`)).statusCode
    ).toBe(404);
  });
});

async function request(method: 'GET' | 'POST', url: string, payload?: object) {
  return server!.inject({
    method,
    url,
    headers: { authorization: 'Bearer secret' },
    ...(payload === undefined ? {} : { payload })
  });
}

function credentialStore(): EnterpriseCredentialStore {
  return {
    read: vi.fn(async () => ({
      accessToken: 'enterprise-token',
      expiresAt: '2026-08-06T10:00:00Z'
    })),
    write: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined)
  };
}

function enterpriseClient(subject: () => string): EnterpriseHttpClient {
  return {
    register: vi.fn(),
    login: vi.fn(),
    getMe: vi.fn(async () => ({
      account: {
        subjectId: subject(),
        email: `${subject()}@example.com`,
        name: subject()
      },
      agentId,
      status: 'active',
      frontendAllowed: true
    })),
    logout: vi.fn(),
    listKnowledgeBases: vi.fn(),
    listKnowledgeDocuments: vi.fn(),
    uploadKnowledgeDocument: vi.fn(),
    listSkills: vi.fn(),
    getSkillDetail: vi.fn(),
    downloadSkillPackage: vi.fn()
  };
}
