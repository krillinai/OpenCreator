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
  EnterpriseHttpClient,
  EnterpriseMeResult
} from '../../src/enterprise/http-client-2026-07-30.js';
import type {
  EnterpriseSkillManager
} from '../../src/enterprise/skill-manager-2026-07-30.js';

let server: FastifyInstance | undefined;
let tempDir = '';

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

  it('returns session responses without token fields and validates credentials locally', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const client = createClient();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
      enterpriseCredentialStore: createStore(),
      enterpriseHttpClient: client,
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
  });

  it('exposes enterprise skill list detail install and update routes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-api-'));
    const enterpriseSkillManager = createEnterpriseSkillManager();
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      codexHome: join(tempDir, 'codex-home'),
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

  async function authRequest(
    method: 'GET' | 'POST',
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
      accessToken: 'enterprise-token',
      tokenType: 'Bearer' as const,
      expiresAt: '2026-07-31T10:00:00Z'
    })),
    getMe: vi.fn(async () => ({
      account: { email: 'user@example.com', name: 'User' },
      status: 'active',
      frontendAllowed: true
    })),
    logout: vi.fn(async () => undefined),
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
