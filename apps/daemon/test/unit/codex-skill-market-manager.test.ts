import type {
  CodexSkillMarketInstallRecordResponse,
  CodexSkillOperationResponse,
  CodexSkillResponse
} from '@opencreator/protocol';
import { skillMarketCandidateCatalog } from '@opencreator/skill-market';
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSkillManager,
  type SkillManager,
  type SkillWriteTransaction
} from '../../src/codex/skills/manager.js';
import { createSkillMarketManager } from '../../src/codex/skills/market-manager.js';
import type { SkillMarketRecordRepository } from '../../src/codex/skills/market-records.js';
import type { CodexSkillSourceInstaller } from '../../src/codex/skills/source-installer.js';
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

  it('attempts installation for every catalog entry through the Codex Skill Installer', async () => {
    const { manager, sourceInstaller } = createManagerFixture();

    await manager.installSkill('garrytan-gstack');

    expect(sourceInstaller.install).toHaveBeenCalledWith({
      repository: 'garrytan/gstack',
      skillPath: '.',
      ref: 'main',
      skillId: 'garrytan-gstack',
      workDir: expect.stringContaining(join(tempDir, 'data', 'skill-market-installs'))
    });
  });

  it('installs market skills with the catalog source and global write confirmation', async () => {
    const { manager, skillManager, sourceInstaller, records } = createManagerFixture();

    const result = await manager.installSkill('frontend-slides');

    expect(sourceInstaller.install).toHaveBeenCalledWith({
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      ref: 'main',
      skillId: 'frontend-slides',
      workDir: expect.stringContaining(join(tempDir, 'data', 'skill-market-installs'))
    });
    expect(skillManager.installSkill).toHaveBeenCalledWith({
      id: 'frontend-slides',
      sourcePath: expect.stringContaining(join('market-source-root', 'frontend-slides')),
      confirmWriteToCodexHome: true
    });
    expect(records.upsertRecord).toHaveBeenCalledWith({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: 'main',
      marketRevision: 1
    });
    expect(result.record).toMatchObject({
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      commit: 'main',
      marketRevision: 1
    });
  });

  it('updates market skills with overwrite enabled', async () => {
    const { manager, skillManager } = createManagerFixture({
      existingSkill: makeSkill('frontend-slides', 'old'),
      installOperation: makeOperation('frontend-slides', 'overwrite')
    });

    await manager.updateSkill('frontend-slides');

    expect(skillManager.installSkill).toHaveBeenCalledWith({
      id: 'frontend-slides',
      sourcePath: expect.stringContaining(join('market-source-root', 'frontend-slides')),
      overwrite: true,
      confirmWriteToCodexHome: true
    });
  });

  it('rejects updates when the target skill is missing', async () => {
    const { manager, sourceInstaller, skillManager } = createManagerFixture();

    await expect(manager.updateSkill('frontend-slides')).rejects.toThrow(/CODEX_SKILL_NOT_FOUND/);
    expect(sourceInstaller.install).not.toHaveBeenCalled();
    expect(skillManager.installSkill).not.toHaveBeenCalled();
  });

  it('rolls back and skips records when post-install cleanup fails', async () => {
    const cleanupError = new Error('cleanup denied');
    const { manager, skillManager, records } = createManagerFixture({
      cleanupError
    });

    await expect(manager.installSkill('frontend-slides')).rejects.toThrow(/CODEX_SKILL_WRITE_FAILED/);

    expect(skillManager.rollbackSkillInstall).toHaveBeenCalledWith('frontend-slides', null);
    expect(records.upsertRecord).not.toHaveBeenCalled();
  });

  it('preserves cleanup and rollback errors when post-install cleanup rollback fails', async () => {
    const { manager } = createManagerFixture({
      cleanupError: new Error('cleanup denied'),
      rollbackError: new Error('rollback denied')
    });

    let error: unknown;
    try {
      await manager.installSkill('frontend-slides');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain('cleanup denied');
    expect((error as Error).message).toContain('rollback denied');
  });

  it('rolls back update installs that race with a deleted target and skips records', async () => {
    const { manager, skillManager, records } = createManagerFixture({
      existingSkill: makeSkill('frontend-slides', 'old'),
      installOperation: makeOperation('frontend-slides', 'install')
    });

    await expect(manager.updateSkill('frontend-slides')).rejects.toThrow(/CODEX_SKILL_NOT_FOUND/);

    expect(skillManager.rollbackSkillInstall).toHaveBeenCalledWith('frontend-slides', null);
    expect(records.upsertRecord).not.toHaveBeenCalled();
  });

  it('preserves update race and rollback errors when update rollback fails', async () => {
    const { manager } = createManagerFixture({
      existingSkill: makeSkill('frontend-slides', 'old'),
      installOperation: makeOperation('frontend-slides', 'install'),
      rollbackError: new Error('rollback denied')
    });

    let error: unknown;
    try {
      await manager.updateSkill('frontend-slides');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain('CODEX_SKILL_NOT_FOUND');
    expect((error as Error).message).toContain('rollback denied');
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

  it('serializes a second market update until the first update finishes rollback', async () => {
    const fixture = createConcurrentRealManagerFixture();
    const first = join(tempDir, 'first-source');
    writeSkill(first, 'frontend-slides', 'old');
    await fixture.skillManager.installSkill({
      id: 'frontend-slides',
      sourcePath: first,
      confirmWriteToCodexHome: true
    });

    const updateA = fixture.managerA.updateSkill('frontend-slides');
    await fixture.cleanupStarted.promise;
    const updateB = fixture.managerB.updateSkill('frontend-slides');
    await new Promise<void>((resolve) => setImmediate(resolve));
    fixture.cleanupRelease.resolve();

    await expect(updateA).rejects.toThrow(/market record write failed/);
    await expect(updateB).resolves.toMatchObject({
      record: { skillId: 'frontend-slides' }
    });
    expect(
      readFileSync(join(fixture.codexHome, 'skills', 'frontend-slides', 'SKILL.md'), 'utf8')
    ).toContain('second-update');
  });

  it('serializes delete until a failed market update finishes rollback', async () => {
    const fixture = createConcurrentRealManagerFixture();
    const first = join(tempDir, 'first-source');
    writeSkill(first, 'frontend-slides', 'old');
    await fixture.skillManager.installSkill({
      id: 'frontend-slides',
      sourcePath: first,
      confirmWriteToCodexHome: true
    });

    const update = fixture.managerA.updateSkill('frontend-slides');
    await fixture.cleanupStarted.promise;
    const deletion = fixture.skillManager.deleteSkill('frontend-slides', true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    fixture.cleanupRelease.resolve();

    await expect(update).rejects.toThrow(/market record write failed/);
    await expect(deletion).resolves.toMatchObject({ deleted: true });
    expect(existsSync(join(fixture.codexHome, 'skills', 'frontend-slides'))).toBe(false);
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

  it('cleans up the outer installer work directory after success, failure, and rollback failure', async () => {
    const success = createManagerFixture();
    await success.manager.installSkill('frontend-slides');
    expect(readdirSync(join(tempDir, 'data', 'skill-market-installs'))).toEqual([]);

    const failure = createManagerFixture({
      recordWriteError: new Error('market record write failed'),
      tempRootName: 'record-failure-root'
    });
    await expect(failure.manager.installSkill('frontend-slides')).rejects.toThrow(
      /market record write failed/
    );
    expect(readdirSync(join(tempDir, 'data', 'skill-market-installs'))).toEqual([]);

    const rollbackFailure = createManagerFixture({
      recordWriteError: new Error('market record write failed'),
      rollbackError: new Error('rollback denied'),
      tempRootName: 'rollback-failure-root'
    });
    await expect(rollbackFailure.manager.installSkill('frontend-slides')).rejects.toThrow(
      /rollback denied/
    );
    expect(readdirSync(join(tempDir, 'data', 'skill-market-installs'))).toEqual([]);
  });

  it('lists install records from the repository', () => {
    const record = makeRecord('frontend-slides');
    const { manager } = createManagerFixture({ listRecords: [record] });

    expect(manager.listInstallRecords()).toEqual([record]);
  });
});

function createManagerFixture(options: {
  existingSkill?: CodexSkillResponse;
  installOperation?: CodexSkillOperationResponse;
  recordWriteError?: Error;
  rollbackError?: Error;
  cleanupError?: Error;
  listRecords?: CodexSkillMarketInstallRecordResponse[];
  tempRootName?: string;
} = {}) {
  tempDir ||= mkdtempSync(join(tmpdir(), 'opencreator-skill-market-manager-'));
  const dataDir = join(tempDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const skillManager = makeFakeSkillManager(options);
  const records = makeFakeRecords(options);
  const sourceInstaller = makeFakeSourceInstaller(options.tempRootName ?? 'market-source-root');
  const manager = createSkillMarketManager({
    dataDir,
    skillManager,
    records,
    sourceInstaller,
    resolveMarketEntry,
    ...(options.cleanupError === undefined
      ? {}
      : {
          cleanupWorkDir() {
            throw options.cleanupError;
          }
      })
  });

  return { manager, skillManager, records, sourceInstaller };
}

function createRealManagerFixture(options: { failRecordWrite: boolean }) {
  tempDir ||= mkdtempSync(join(tmpdir(), 'opencreator-skill-market-manager-'));
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
  const sourceInstaller = makeFakeSourceInstaller('real-market-source-root', 'new');
  const manager = createSkillMarketManager({
    dataDir,
    skillManager,
    records,
    sourceInstaller,
    resolveMarketEntry
  });

  return { manager, skillManager, codexHome };
}

function createConcurrentRealManagerFixture() {
  tempDir ||= mkdtempSync(join(tmpdir(), 'opencreator-skill-market-manager-'));
  const dataDir = join(tempDir, 'data');
  const codexHome = join(tempDir, 'codex-home');
  mkdirSync(dataDir, { recursive: true });
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  dbs.push(db);
  const skillManager = createSkillManager({
    codexHome: { path: codexHome, mode: 'global', source: 'default', writable: false },
    db
  });
  const cleanupStarted = createDeferred<void>();
  const cleanupRelease = createDeferred<void>();
  let cleanupCalls = 0;
  const managerA = createSkillMarketManager({
    dataDir,
    skillManager,
    records: makeFakeRecords({
      recordWriteError: new Error('market record write failed')
    }),
    sourceInstaller: makeFakeSourceInstaller('first-update-root', 'first-update'),
    resolveMarketEntry,
    cleanupWorkDir(workDir) {
      cleanupCalls += 1;
      if (cleanupCalls === 1) {
        cleanupStarted.resolve();
        return cleanupRelease.promise;
      }
      rmSync(workDir, { recursive: true, force: true });
    }
  });
  const managerB = createSkillMarketManager({
    dataDir,
    skillManager,
    records: makeFakeRecords({}),
    sourceInstaller: makeFakeSourceInstaller('second-update-root', 'second-update'),
    resolveMarketEntry
  });

  return {
    codexHome,
    skillManager,
    managerA,
    managerB,
    cleanupStarted,
    cleanupRelease
  };
}

function makeFakeSkillManager(options: {
  existingSkill?: CodexSkillResponse;
  installOperation?: CodexSkillOperationResponse;
  rollbackError?: Error;
}): SkillManager {
  const skill = makeSkill('frontend-slides', 'new');
  const operation = options.installOperation ?? makeOperation('frontend-slides');
  const getSkill = vi.fn((id) => (id === options.existingSkill?.id ? options.existingSkill : undefined));
  const installSkill = vi.fn(async () => ({ skill, operation }));
  const deleteSkill = vi.fn(async () => ({ deleted: true as const, backupPath: null, operation }));
  const rollbackSkillInstall = vi.fn(async () => {
    if (options.rollbackError) throw options.rollbackError;
  });
  const transaction: SkillWriteTransaction = {
    getSkill,
    installSkill,
    deleteSkill,
    rollbackSkillInstall
  };
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
    getSkill,
    withWriteTransaction: vi.fn(async (callback) => callback(transaction)),
    installSkill,
    deleteSkill,
    rollbackSkillInstall,
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

function makeFakeSourceInstaller(
  rootName: string,
  marker = 'new'
): CodexSkillSourceInstaller {
  return {
    install: vi.fn(async ({ workDir, skillId }) => {
      const sourcePath = join(workDir, rootName, skillId);
      writeSkill(sourcePath, skillId, marker);
      return sourcePath;
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

function makeOperation(
  skillId: string,
  operation: CodexSkillOperationResponse['operation'] = 'install'
): CodexSkillOperationResponse {
  return {
    id: `op_${skillId}`,
    operation,
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
    commit: 'main',
    marketRevision: 1,
    installedAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function resolveMarketEntry(id: string) {
  return skillMarketCandidateCatalog.find(entry => entry.id === id);
}
