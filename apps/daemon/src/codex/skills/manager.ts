import type Database from 'better-sqlite3';
import { basename, join, resolve } from 'node:path';
import type { ResolvedCodexHome } from '../home.js';
import { createSkillInstaller } from './installer.js';
import { createSkillOperationRepository } from './operations.js';
import { scanCodexSkills, skillsPathForCodexHome } from './scanner.js';
import type {
  CodexSkillOperationResponse,
  CodexSkillResponse,
  InstallSkillInput,
  SkillScanResult
} from './types.js';

export type SkillManager = {
  listSkills(): SkillScanResult;
  getSkill(id: string): CodexSkillResponse | undefined;
  withWriteTransaction<T>(
    operation: (transaction: SkillWriteTransaction) => T | Promise<T>
  ): Promise<T>;
  installSkill(
    input: InstallSkillInput
  ): Promise<{ skill: CodexSkillResponse; operation: CodexSkillOperationResponse }>;
  deleteSkill(
    id: string,
    confirmed: boolean
  ): Promise<{ deleted: true; backupPath: string | null; operation: CodexSkillOperationResponse }>;
  rollbackSkillInstall(id: string, backupPath: string | null): Promise<void>;
  listOperations(limit?: number): CodexSkillOperationResponse[];
};

export type SkillWriteTransaction = {
  getSkill(id: string): CodexSkillResponse | undefined;
  installSkill(
    input: InstallSkillInput
  ): Promise<{ skill: CodexSkillResponse; operation: CodexSkillOperationResponse }>;
  deleteSkill(
    id: string,
    confirmed: boolean
  ): Promise<{ deleted: true; backupPath: string | null; operation: CodexSkillOperationResponse }>;
  rollbackSkillInstall(id: string, backupPath: string | null): Promise<void>;
};

const writeLocks = new Map<string, Promise<void>>();

export function createSkillManager(input: {
  codexHome: ResolvedCodexHome;
  db: Database.Database;
}): SkillManager {
  const installer = createSkillInstaller({ codexHome: input.codexHome.path });
  const operations = createSkillOperationRepository(input.db);
  const lockKey = resolve(input.codexHome.path);

  function listSkills(): SkillScanResult {
    return scanCodexSkills({ codexHome: input.codexHome });
  }

  function getSkill(id: string): CodexSkillResponse | undefined {
    return listSkills().skills.find((skill) => skill.id === id);
  }

  async function installSkillUnlocked(
    request: InstallSkillInput
  ): Promise<{ skill: CodexSkillResponse; operation: CodexSkillOperationResponse }> {
    requireWriteConfirmation(input.codexHome, request.confirmWriteToCodexHome === true);
    const skillId = request.id ?? basename(request.sourcePath);
    const requestedOperationType = request.overwrite === true ? 'overwrite' : 'install';
    let installed: { id: string; backupPath: string | null } | undefined;
    try {
      installed = await installer.install(request);
      const skill = getSkill(installed.id);
      if (skill === undefined) throw new Error(`CODEX_SKILL_NOT_FOUND: ${installed.id}`);
      const operationType = installed.backupPath === null ? 'install' : 'overwrite';
      const operation = operations.insertOperation({
        operation: operationType,
        skillId: installed.id,
        codexHome: input.codexHome.path,
        skillsPath: skillsPathForCodexHome(input.codexHome.path),
        sourcePath: request.sourcePath,
        targetPath: skill.skillPath,
        backupPath: installed.backupPath,
        status: 'succeeded'
      });
      return { skill, operation };
    } catch (error) {
      if (getCodexErrorCode(error) === 'CODEX_SKILL_EXISTS') throw error;
      let failure = error;
      if (installed !== undefined) {
        try {
          await installer.rollback(installed);
        } catch (rollbackError) {
          failure = new AggregateError(
            [error, rollbackError],
            [
              'CODEX_SKILL_WRITE_FAILED: skill install failed and rollback failed',
              `install error: ${getErrorMessage(error)}`,
              `rollback error: ${getErrorMessage(rollbackError)}`
            ].join('; ')
          );
        }
      }
      tryInsertFailedOperation({
        operation: requestedOperationType,
        skillId,
        codexHome: input.codexHome.path,
        skillsPath: skillsPathForCodexHome(input.codexHome.path),
        sourcePath: request.sourcePath,
        targetPath: join(skillsPathForCodexHome(input.codexHome.path), skillId),
        status: 'failed',
        errorCode: getCodexErrorCode(error) ?? 'CODEX_SKILL_WRITE_FAILED',
        errorMessage: getErrorMessage(error)
      });
      throw failure;
    }
  }

  function tryInsertFailedOperation(
    operation: Parameters<typeof operations.insertOperation>[0]
  ): void {
    try {
      operations.insertOperation(operation);
    } catch {
      // A logging failure must not replace the install or rollback failure.
    }
  }

  async function deleteSkillUnlocked(
    id: string,
    confirmed: boolean
  ): Promise<{ deleted: true; backupPath: string | null; operation: CodexSkillOperationResponse }> {
    requireWriteConfirmation(input.codexHome, confirmed);
    try {
      const deleted = await installer.delete(id);
      const operation = operations.insertOperation({
        operation: 'delete',
        skillId: id,
        codexHome: input.codexHome.path,
        skillsPath: skillsPathForCodexHome(input.codexHome.path),
        targetPath: join(skillsPathForCodexHome(input.codexHome.path), id),
        backupPath: deleted.backupPath,
        status: 'succeeded'
      });
      return { deleted: true, backupPath: deleted.backupPath, operation };
    } catch (error) {
      operations.insertOperation({
        operation: 'delete',
        skillId: id,
        codexHome: input.codexHome.path,
        skillsPath: skillsPathForCodexHome(input.codexHome.path),
        targetPath: join(skillsPathForCodexHome(input.codexHome.path), id),
        status: 'failed',
        errorCode: getCodexErrorCode(error) ?? 'CODEX_SKILL_WRITE_FAILED',
        errorMessage: getErrorMessage(error)
      });
      throw error;
    }
  }

  function rollbackSkillInstallUnlocked(id: string, backupPath: string | null): Promise<void> {
    return installer.rollback({ id, backupPath });
  }

  const transaction: SkillWriteTransaction = {
    getSkill,
    installSkill: installSkillUnlocked,
    deleteSkill: deleteSkillUnlocked,
    rollbackSkillInstall: rollbackSkillInstallUnlocked
  };

  function withWriteTransaction<T>(
    operation: (activeTransaction: SkillWriteTransaction) => T | Promise<T>
  ): Promise<T> {
    return withSkillWriteLock(lockKey, () => operation(transaction));
  }

  return {
    listSkills,
    getSkill,
    withWriteTransaction,
    installSkill(request) {
      return withWriteTransaction(() => installSkillUnlocked(request));
    },
    deleteSkill(id, confirmed) {
      return withWriteTransaction(() => deleteSkillUnlocked(id, confirmed));
    },
    rollbackSkillInstall(id, backupPath) {
      return withWriteTransaction(() => rollbackSkillInstallUnlocked(id, backupPath));
    },
    listOperations(limit) {
      return operations.listOperations(limit);
    }
  };
}

async function withSkillWriteLock<T>(
  lockKey: string,
  operation: () => T | Promise<T>
): Promise<T> {
  const previous = writeLocks.get(lockKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  const chained = previous.then(() => current, () => current);
  writeLocks.set(lockKey, chained);

  try {
    await previous.catch(() => undefined);
    return await operation();
  } finally {
    release();
    if (writeLocks.get(lockKey) === chained) writeLocks.delete(lockKey);
  }
}

function requireWriteConfirmation(codexHome: ResolvedCodexHome, confirmed: boolean): void {
  if (codexHome.mode === 'global' && !confirmed) {
    throw new Error(
      'CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED: global CODEX_HOME skills write requires confirmation'
    );
  }
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
