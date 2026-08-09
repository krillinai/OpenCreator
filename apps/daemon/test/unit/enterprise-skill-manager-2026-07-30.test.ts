import type {
  CodexSkillOperationResponse,
  CodexSkillResponse,
  EnterpriseSkillStatus
} from '@clawee/protocol';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  SkillManager,
  SkillWriteTransaction
} from '../../src/codex/skills/manager.js';
import type { SkillMarketRecordRepository } from '../../src/codex/skills/market-records.js';
import type {
  EnterpriseInstallRecordRepository,
  EnterpriseSkillInstallRecord
} from '../../src/enterprise/install-records-2026-07-30.js';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteSkill,
  EnterpriseRemoteSkillDetail
} from '../../src/enterprise/http-client-2026-07-30.js';
import type { EnterpriseSessionManager } from '../../src/enterprise/session-manager-2026-07-30.js';
import {
  computeEnterpriseSkillState,
  createEnterpriseSkillManager
} from '../../src/enterprise/skill-manager-2026-07-30.js';
import { EnterpriseHttpError } from '../../src/enterprise/http-client-2026-07-30.js';

const tempDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('enterprise skill manager', () => {
  it('computes all seven statuses and orthogonal local integrity', () => {
    const cases: Array<{
      expected: EnterpriseSkillStatus;
      input: Parameters<typeof computeEnterpriseSkillState>[0];
      actions: string[];
      integrity: string;
    }> = [
      {
        expected: 'not_installed',
        input: { remote: remoteSkill() },
        actions: ['install'],
        integrity: 'not_applicable'
      },
      {
        expected: 'invalid',
        input: { remote: remoteSkill(), local: localSkill('invalid') },
        actions: [],
        integrity: 'unknown'
      },
      {
        expected: 'installed_unknown_source',
        input: { remote: remoteSkill(), local: localSkill() },
        actions: ['use'],
        integrity: 'unknown'
      },
      {
        expected: 'name_conflict',
        input: {
          remote: remoteSkill(),
          local: localSkill(),
          publicRecordExists: true
        },
        actions: [],
        integrity: 'unknown'
      },
      {
        expected: 'installed',
        input: {
          remote: remoteSkill(),
          local: localSkill(),
          enterpriseRecord: enterpriseRecord(),
          localContentSha256: 'b'.repeat(64)
        },
        actions: ['use'],
        integrity: 'verified'
      },
      {
        expected: 'update_available',
        input: {
          remote: remoteSkill({ packageSha256: 'c'.repeat(64) }),
          local: localSkill(),
          enterpriseRecord: enterpriseRecord(),
          localContentSha256: 'b'.repeat(64)
        },
        actions: ['update', 'use'],
        integrity: 'verified'
      },
      {
        expected: 'unpublished',
        input: {
          local: localSkill(),
          enterpriseRecord: enterpriseRecord(),
          localContentSha256: 'b'.repeat(64)
        },
        actions: ['use'],
        integrity: 'verified'
      }
    ];

    for (const testCase of cases) {
      const state = computeEnterpriseSkillState(testCase.input);
      expect(state.status).toBe(testCase.expected);
      expect(state.actions).toEqual(testCase.actions);
      expect(state.integrity).toBe(testCase.integrity);
    }

    expect(computeEnterpriseSkillState({
      remote: remoteSkill({ packageSha256: 'c'.repeat(64) }),
      local: localSkill(),
      enterpriseRecord: enterpriseRecord(),
      localContentSha256: 'd'.repeat(64)
    })).toMatchObject({
      status: 'update_available',
      integrity: 'local_changed',
      actions: ['use']
    });
  });

  it('retries only readable transient failures with bounded delays', async () => {
    const sleep = vi.fn(async () => undefined);
    const client = createHttpClient();
    vi.mocked(client.listSkills)
      .mockRejectedValueOnce(new EnterpriseHttpError(
        'ENTERPRISE_SERVICE_UNAVAILABLE',
        'request'
      ))
      .mockRejectedValueOnce(new EnterpriseHttpError(
        'ENTERPRISE_SERVICE_UNAVAILABLE',
        'response',
        503
      ))
      .mockResolvedValueOnce([remoteSkill()]);
    const manager = createManager({ client, sleep });

    await expect(manager.listSkills()).resolves.toMatchObject({
      skills: [expect.objectContaining({ skillId: 'skill_1' })]
    });
    expect(client.listSkills).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);

    vi.mocked(client.listSkills).mockReset();
    vi.mocked(client.listSkills).mockRejectedValue(
      new EnterpriseHttpError('ENTERPRISE_FORBIDDEN', 'response', 403)
    );
    await expect(manager.listSkills()).rejects.toMatchObject({
      code: 'ENTERPRISE_FORBIDDEN'
    });
    expect(client.listSkills).toHaveBeenCalledOnce();
  });

  it('rechecks source ownership inside the write lock before installing', async () => {
    const installSkill = vi.fn();
    const transaction = createTransaction({
      getSkill: vi.fn(() => localSkill()),
      installSkill
    });
    const manager = createManager({
      skillManager: createSkillManager(transaction)
    });

    await expect(manager.installSkill('skill_1')).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_SOURCE_CONFLICT'
    });
    expect(installSkill).not.toHaveBeenCalled();
  });

  it('blocks an update when the local tree changed during download', async () => {
    const installSkill = vi.fn();
    const records = createEnterpriseRecords(enterpriseRecord());
    const manager = createManager({
      records,
      digest: vi.fn(async () => 'd'.repeat(64)),
      skillManager: createSkillManager(createTransaction({
        getSkill: vi.fn(() => localSkill()),
        installSkill
      }))
    });

    await expect(manager.updateSkill('skill_1')).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_LOCAL_CHANGED'
    });
    expect(installSkill).not.toHaveBeenCalled();
    expect(records.upsertRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['new install', false],
    ['update', true]
  ])('rolls back %s when the final record commit fails', async (_name, update) => {
    const rollbackSkillInstall = vi.fn(async () => undefined);
    const installSkill = vi.fn(async () => ({
      skill: localSkill(),
      operation: operation(update ? 'overwrite' : 'install')
    }));
    const records = createEnterpriseRecords(
      update ? enterpriseRecord() : undefined
    );
    vi.mocked(records.upsertRecord).mockImplementation(() => {
      throw new Error('record write failed');
    });
    const manager = createManager({
      records,
      digest: vi.fn(async () => 'b'.repeat(64)),
      skillManager: createSkillManager(createTransaction({
        getSkill: vi.fn(() => update ? localSkill() : undefined),
        installSkill,
        rollbackSkillInstall
      }))
    });

    await expect(
      update ? manager.updateSkill('skill_1') : manager.installSkill('skill_1')
    ).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_INSTALL_FAILED'
    });
    expect(rollbackSkillInstall).toHaveBeenCalledWith(
      'code-review',
      update ? '/backup/code-review' : null
    );
  });

  it('does not retry semantic write failures', async () => {
    const client = createHttpClient();
    vi.mocked(client.getSkillDetail).mockRejectedValue(
      new EnterpriseHttpError(
        'ENTERPRISE_SKILL_VERSION_CHANGED',
        'response',
        409
      )
    );
    const manager = createManager({ client });

    await expect(manager.installSkill('skill_1')).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_VERSION_CHANGED'
    });
    expect(client.getSkillDetail).toHaveBeenCalledOnce();
    expect(client.downloadSkillPackage).not.toHaveBeenCalled();
  });
});

function createManager(overrides: {
  client?: EnterpriseHttpClient;
  records?: EnterpriseInstallRecordRepository;
  skillManager?: SkillManager;
  sleep?: (milliseconds: number) => Promise<void>;
  digest?: (path: string) => Promise<string>;
} = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'clawee-enterprise-manager-'));
  tempDirectories.push(dataDir);
  return createEnterpriseSkillManager({
    dataDir,
    sessionManager: createSessionManager(),
    httpClient: overrides.client ?? createHttpClient(),
    skillManager:
      overrides.skillManager ??
      createSkillManager(createTransaction()),
    publicRecords: createPublicRecords(),
    records: overrides.records ?? createEnterpriseRecords(),
    sleep: overrides.sleep,
    computeContentDigest: overrides.digest ?? vi.fn(async () => 'b'.repeat(64)),
    extractPackage: vi.fn(async input => ({
      sourcePath: input.extractionPath,
      contentSha256: 'b'.repeat(64)
    })),
    cleanupWorkDir: vi.fn(async () => undefined),
    now: () => new Date('2026-07-30T10:00:00Z')
  });
}

function createSessionManager(): EnterpriseSessionManager {
  return {
    startRestore() {},
    getSnapshot: () => ({
      status: 'signed_in',
      account: {
        subjectId: 'acct_01JZ8W6A2M4S',
        email: 'user@example.com',
        name: 'User'
      },
      expiresAt: '2026-07-31T10:00:00Z',
      transportSecurity: 'secure_https'
    }),
    refresh: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    requireAccessToken: vi.fn(async () => 'enterprise-token'),
    invalidateUnauthorized: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined)
  };
}

function createHttpClient(): EnterpriseHttpClient {
  return {
    register: vi.fn(),
    login: vi.fn(),
    getMe: vi.fn(),
    logout: vi.fn(),
    revealAgentMcpToken: vi.fn(),
    getMcpCatalog: vi.fn(),
    listKnowledgeBases: vi.fn(async () => ({
      knowledgeBases: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    listKnowledgeDocuments: vi.fn(async () => ({
      documents: [],
      meta: { nextCursor: '', hasNext: false }
    })),
    uploadKnowledgeDocument: vi.fn(),
    hasKnowledgeSearchGrant: vi.fn(async () => false),
    searchKnowledge: vi.fn(async () => []),
    listSkills: vi.fn(async () => [remoteSkill()]),
    getSkillDetail: vi.fn(async () => remoteDetail()),
    downloadSkillPackage: vi.fn(async () => ({
      bytes: 10,
      sha256: 'a'.repeat(64)
    }))
  };
}

function createSkillManager(transaction: SkillWriteTransaction): SkillManager {
  return {
    listSkills: vi.fn(() => ({
      codexHome: '/codex-home',
      codexHomeMode: 'isolated' as const,
      skillsPath: '/codex-home/skills',
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: [],
      diagnostics: []
    })),
    getSkill: vi.fn(),
    withWriteTransaction: vi.fn(async operationCallback => operationCallback(transaction)),
    installSkill: transaction.installSkill,
    deleteSkill: transaction.deleteSkill,
    rollbackSkillInstall: transaction.rollbackSkillInstall,
    listOperations: vi.fn(() => [])
  };
}

function createTransaction(
  overrides: Partial<SkillWriteTransaction> = {}
): SkillWriteTransaction {
  return {
    getSkill: vi.fn(() => undefined),
    installSkill: vi.fn(async () => ({
      skill: localSkill(),
      operation: operation('install')
    })),
    deleteSkill: vi.fn(),
    rollbackSkillInstall: vi.fn(async () => undefined),
    ...overrides
  };
}

function createPublicRecords(): SkillMarketRecordRepository {
  return {
    upsertRecord: vi.fn(),
    getRecord: vi.fn(() => undefined),
    listRecords: vi.fn(() => [])
  };
}

function createEnterpriseRecords(
  initial?: EnterpriseSkillInstallRecord
): EnterpriseInstallRecordRepository & {
  upsertRecord: ReturnType<typeof vi.fn>;
} {
  let record = initial;
  return {
    getBySkillId: vi.fn(skillId => record?.skillId === skillId ? record : undefined),
    getByName: vi.fn(name => record?.name === name ? record : undefined),
    listRecords: vi.fn(() => record === undefined ? [] : [record]),
    upsertRecord: vi.fn(input => {
      record = {
        ...input,
        installedAt: initial?.installedAt ?? '2026-07-30T10:00:00.000Z',
        updatedAt: '2026-07-30T10:00:00.000Z'
      };
      return record!;
    })
  };
}

function remoteSkill(
  overrides: Partial<EnterpriseRemoteSkill> = {}
): EnterpriseRemoteSkill {
  return {
    skillId: 'skill_1',
    name: 'code-review',
    description: 'Enterprise code review',
    versionId: 'version_1',
    version: '1.0',
    packageSha256: 'a'.repeat(64),
    updatedAt: '2026-07-30T08:00:00Z',
    ...overrides
  };
}

function remoteDetail(): EnterpriseRemoteSkillDetail {
  return {
    ...remoteSkill(),
    changelog: 'Initial release'
  };
}

function enterpriseRecord(): EnterpriseSkillInstallRecord {
  return {
    skillId: 'skill_1',
    name: 'code-review',
    versionId: 'version_1',
    version: '1.0',
    packageSha256: 'a'.repeat(64),
    installedContentSha256: 'b'.repeat(64),
    installedAt: '2026-07-30T09:00:00.000Z',
    updatedAt: '2026-07-30T09:00:00.000Z'
  };
}

function localSkill(status: 'valid' | 'invalid' = 'valid'): CodexSkillResponse {
  return {
    id: 'code-review',
    ...(status === 'valid'
      ? {
          name: 'code-review',
          description: 'Enterprise code review'
        }
      : {}),
    status,
    diagnostics: [],
    codexHome: '/codex-home',
    codexHomeMode: 'isolated',
    skillsPath: '/codex-home/skills',
    skillPath: '/codex-home/skills/code-review',
    skillFilePath: '/codex-home/skills/code-review/SKILL.md'
  };
}

function operation(
  type: 'install' | 'overwrite'
): CodexSkillOperationResponse {
  return {
    id: 'operation_1',
    operation: type,
    skillId: 'code-review',
    codexHome: '/codex-home',
    skillsPath: '/codex-home/skills',
    sourcePath: '/source/code-review',
    targetPath: '/codex-home/skills/code-review',
    backupPath: type === 'overwrite' ? '/backup/code-review' : null,
    status: 'succeeded',
    createdAt: '2026-07-30T10:00:00.000Z'
  };
}
