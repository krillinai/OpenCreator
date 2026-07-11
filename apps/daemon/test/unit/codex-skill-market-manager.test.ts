import type {
  CodexSkillMarketInstallRecordResponse,
  CodexSkillOperationResponse,
  CodexSkillResponse
} from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkillManager, type SkillManager } from '../../src/codex/skills/manager.js';
import { createSkillMarketManager } from '../../src/codex/skills/market-manager.js';
import type { MarketArchiveDownloader } from '../../src/codex/skills/market-downloader.js';
import type { SkillMarketRecordRepository } from '../../src/codex/skills/market-records.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
const dbs: Database.Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) db.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill market manager', () => {
  it('rejects unknown market ids', async () => {
    const { manager } = createManagerFixture();

    await expect(manager.installSkill('missing-market-skill')).rejects.toThrow(
      /CODEX_SKILL_MARKET_ENTRY_NOT_FOUND/
    );
  });

  it('rejects market entries that are not installable', async () => {
    const { manager } = createManagerFixture();

    await expect(manager.installSkill('garrytan-gstack')).rejects.toThrow(
      /CODEX_SKILL_MARKET_NOT_INSTALLABLE/
    );
  });

  it('installs market skills with the fixed catalog source and global write confirmation', async () => {
    const { manager, skillManager, downloader, records } = createManagerFixture();

    const result = await manager.installSkill('frontend-slides');

    expect(downloader.download).toHaveBeenCalledWith({
      repository: 'zarazhangrui/frontend-slides',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      workDir: expect.stringContaining(join(tempDir, 'data', 'skill-market-downloads'))
    });
    expect(skillManager.installSkill).toHaveBeenCalledWith({
      id: 'frontend-slides',
      sourcePath: expect.stringContaining('market-archive-root'),
      confirmWriteToCodexHome: true
    });
    expect(records.upsertRecord).toHaveBeenCalledWith({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1
    });
    expect(result.record).toMatchObject({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1
    });
  });

  it('updates market skills with overwrite enabled', async () => {
    const { manager, skillManager } = createManagerFixture({
      existingSkill: makeSkill('frontend-slides', 'old')
    });

    await manager.updateSkill('frontend-slides');

    expect(skillManager.installSkill).toHaveBeenCalledWith({
      id: 'frontend-slides',
      sourcePath: expect.stringContaining('market-archive-root'),
      overwrite: true,
      confirmWriteToCodexHome: true
    });
  });

  it('rejects updates when the target skill is missing', async () => {
    const { manager, downloader, skillManager } = createManagerFixture();

    await expect(manager.updateSkill('frontend-slides')).rejects.toThrow(/CODEX_SKILL_NOT_FOUND/);
    expect(downloader.download).not.toHaveBeenCalled();
    expect(skillManager.installSkill).not.toHaveBeenCalled();
  });

  it('rolls back fresh installs when record writes fail', async () => {
    const { manager, skillManager, codexHome } = createRealManagerFixture({ failRecordWrite: true });

    await expect(manager.installSkill('frontend-slides')).rejects.toThrow(/market record write failed/);

    expect(existsSync(join(codexHome, 'skills', 'frontend-slides'))).toBe(false);
    expect(skillManager.getSkill('frontend-slides')).toBeUndefined();
  });

  it('restores overwritten skills when update record writes fail', async () => {
    const { manager, skillManager, codexHome } = createRealManagerFixture({ failRecordWrite: true });
    const first = join(tempDir, 'first-source');
    writeSkill(first, 'frontend-slides', 'old');
    await skillManager.installSkill({
      id: 'frontend-slides',
      sourcePath: first,
      confirmWriteToCodexHome: true
    });

    await expect(manager.updateSkill('frontend-slides')).rejects.toThrow(/market record write failed/);

    expect(readFileSync(join(codexHome, 'skills', 'frontend-slides', 'SKILL.md'), 'utf8')).toContain(
      'old'
    );
  });

  it('preserves record write and rollback failure context when rollback fails', async () => {
    const { manager } = createManagerFixture({
      recordWriteError: new Error('market record write failed'),
      rollbackError: new Error('rollback denied')
    });

    let error: unknown;
    try {
      await manager.installSkill('frontend-slides');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain('market record write failed');
    expect((error as Error).message).toContain('rollback denied');
  });

  it('cleans up the outer download work directory after success, failure, and rollback failure', async () => {
    const success = createManagerFixture();
    await success.manager.installSkill('frontend-slides');
    expect(readdirSync(join(tempDir, 'data', 'skill-market-downloads'))).toEqual([]);

    const failure = createManagerFixture({
      recordWriteError: new Error('market record write failed'),
      tempRootName: 'record-failure-root'
    });
    await expect(failure.manager.installSkill('frontend-slides')).rejects.toThrow(
      /market record write failed/
    );
    expect(readdirSync(join(tempDir, 'data', 'skill-market-downloads'))).toEqual([]);

    const rollbackFailure = createManagerFixture({
      recordWriteError: new Error('market record write failed'),
      rollbackError: new Error('rollback denied'),
      tempRootName: 'rollback-failure-root'
    });
    await expect(rollbackFailure.manager.installSkill('frontend-slides')).rejects.toThrow(
      /rollback denied/
    );
    expect(readdirSync(join(tempDir, 'data', 'skill-market-downloads'))).toEqual([]);
  });

  it('lists install records from the repository', () => {
    const record = makeRecord('frontend-slides');
    const { manager } = createManagerFixture({ listRecords: [record] });

    expect(manager.listInstallRecords()).toEqual([record]);
  });
});

function createManagerFixture(options: {
  existingSkill?: CodexSkillResponse;
  recordWriteError?: Error;
  rollbackError?: Error;
  listRecords?: CodexSkillMarketInstallRecordResponse[];
  tempRootName?: string;
} = {}) {
  tempDir ||= mkdtempSync(join(tmpdir(), 'clawee-skill-market-manager-'));
  const dataDir = join(tempDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const skillManager = makeFakeSkillManager(options);
  const records = makeFakeRecords(options);
  const downloader = makeFakeDownloader(options.tempRootName ?? 'market-archive-root');
  const manager = createSkillMarketManager({
    dataDir,
    skillManager,
    records,
    downloader
  });

  return { manager, skillManager, records, downloader };
}

function createRealManagerFixture(options: { failRecordWrite: boolean }) {
  tempDir ||= mkdtempSync(join(tmpdir(), 'clawee-skill-market-manager-'));
  const dataDir = join(tempDir, 'data');
  const codexHome = join(tempDir, 'codex-home');
  mkdirSync(dataDir, { recursive: true });
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  dbs.push(db);
  const skillManager = createSkillManager({
    codexHome: { path: codexHome, mode: 'global', source: 'default', writable: false },
    db
  });
  const records = makeFakeRecords({
    recordWriteError: options.failRecordWrite ? new Error('market record write failed') : undefined
  });
  const downloader = makeFakeDownloader('real-market-archive-root', 'new');
  const manager = createSkillMarketManager({ dataDir, skillManager, records, downloader });

  return { manager, skillManager, codexHome };
}

function makeFakeSkillManager(options: {
  existingSkill?: CodexSkillResponse;
  rollbackError?: Error;
}): SkillManager {
  const skill = makeSkill('frontend-slides', 'new');
  const operation = makeOperation('frontend-slides');
  return {
    listSkills: vi.fn(() => ({
      codexHome: '/codex-home',
      codexHomeMode: 'global' as const,
      skillsPath: '/codex-home/skills',
      skillsWritable: true,
      requiresWriteConfirmation: true,
      skills: options.existingSkill === undefined ? [] : [options.existingSkill],
      diagnostics: []
    })),
    getSkill: vi.fn((id) => (id === options.existingSkill?.id ? options.existingSkill : undefined)),
    installSkill: vi.fn(async () => ({ skill, operation })),
    deleteSkill: vi.fn(async () => ({ deleted: true as const, backupPath: null, operation })),
    rollbackSkillInstall: vi.fn(async () => {
      if (options.rollbackError) throw options.rollbackError;
    }),
    listOperations: vi.fn(() => [])
  };
}

function makeFakeRecords(options: {
  recordWriteError?: Error;
  listRecords?: CodexSkillMarketInstallRecordResponse[];
}): SkillMarketRecordRepository {
  return {
    upsertRecord: vi.fn((input) => {
      if (options.recordWriteError) throw options.recordWriteError;
      return makeRecord(input.skillId, {
        repository: input.repository,
        skillPath: input.skillPath,
        commit: input.commit,
        marketRevision: input.marketRevision
      });
    }),
    getRecord: vi.fn(() => undefined),
    listRecords: vi.fn(() => options.listRecords ?? [])
  };
}

function makeFakeDownloader(rootName: string, marker = 'new'): MarketArchiveDownloader {
  return {
    download: vi.fn(async ({ workDir }) => {
      const root = join(workDir, rootName);
      writeSkill(root, 'frontend-slides', marker);
      return root;
    })
  };
}

function writeSkill(dir: string, id: string, marker: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), [
    '---',
    `name: ${id}`,
    `description: "${marker}"`,
    '---',
    '',
    marker
  ].join('\n'));
}

function makeSkill(id: string, description: string): CodexSkillResponse {
  return {
    id,
    name: id,
    description,
    status: 'valid',
    diagnostics: [],
    codexHome: '/codex-home',
    codexHomeMode: 'global',
    skillsPath: '/codex-home/skills',
    skillPath: `/codex-home/skills/${id}`,
    skillFilePath: `/codex-home/skills/${id}/SKILL.md`
  };
}

function makeOperation(skillId: string): CodexSkillOperationResponse {
  return {
    id: `op_${skillId}`,
    operation: 'install',
    skillId,
    codexHome: '/codex-home',
    skillsPath: '/codex-home/skills',
    sourcePath: '/source',
    targetPath: `/codex-home/skills/${skillId}`,
    backupPath: null,
    status: 'succeeded',
    createdAt: '2026-07-11T00:00:00.000Z'
  };
}

function makeRecord(
  skillId: string,
  overrides: Partial<CodexSkillMarketInstallRecordResponse> = {}
): CodexSkillMarketInstallRecordResponse {
  return {
    skillId,
    repository: 'zarazhangrui/frontend-slides',
    skillPath: '.',
    commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
    marketRevision: 1,
    installedAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides
  };
}
