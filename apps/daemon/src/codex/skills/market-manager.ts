import type {
  CodexSkillMarketInstallRecordResponse,
  CodexSkillMarketMutationResponse
} from '@opencreator/protocol';
import { getSkillMarketEntry } from '@opencreator/skill-market';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillManager, SkillWriteTransaction } from './manager.js';
import type { SkillMarketRecordRepository } from './market-records.js';
import type { CodexSkillSourceInstaller } from './source-installer.js';

export type SkillMarketManager = {
  listInstallRecords(): CodexSkillMarketInstallRecordResponse[];
  installSkill(id: string): Promise<CodexSkillMarketMutationResponse>;
  updateSkill(id: string): Promise<CodexSkillMarketMutationResponse>;
};

type SkillMarketManagerInput = {
  dataDir: string;
  skillManager: SkillManager;
  records: SkillMarketRecordRepository;
  sourceInstaller: CodexSkillSourceInstaller;
  cleanupWorkDir?: (workDir: string) => void | Promise<void>;
  resolveMarketEntry?: typeof getSkillMarketEntry;
};

export function createSkillMarketManager(input: SkillMarketManagerInput): SkillMarketManager {
  return {
    listInstallRecords() {
      return input.records.listRecords();
    },
    installSkill(id) {
      return mutateSkill(input, id, false);
    },
    updateSkill(id) {
      return mutateSkill(input, id, true);
    }
  };
}

async function mutateSkill(
  input: SkillMarketManagerInput,
  id: string,
  overwrite: boolean
): Promise<CodexSkillMarketMutationResponse> {
  const entry = (input.resolveMarketEntry ?? getSkillMarketEntry)(id);
  if (entry === undefined) {
    throw new Error(`CODEX_SKILL_MARKET_ENTRY_NOT_FOUND: ${id}`);
  }
  const installSource = entry.install;
  if (overwrite && input.skillManager.getSkill(id) === undefined) {
    throw new Error(`CODEX_SKILL_NOT_FOUND: ${id}`);
  }

  const installParent = join(input.dataDir, 'skill-market-installs');
  mkdirSync(installParent, { recursive: true });
  const workDir = mkdtempSync(join(installParent, 'mutation-'));
  let workDirCleaned = false;

  try {
    const sourcePath = await input.sourceInstaller.install({
      repository: installSource.repository,
      skillPath: installSource.skillPath,
      ref: installSource.ref,
      skillId: id,
      workDir
    });
    return await input.skillManager.withWriteTransaction(async (transaction) => {
      if (overwrite && transaction.getSkill(id) === undefined) {
        throw new Error(`CODEX_SKILL_NOT_FOUND: ${id}`);
      }

      const result = await transaction.installSkill({
        id,
        sourcePath,
        ...(overwrite ? { overwrite: true } : {}),
        confirmWriteToCodexHome: true
      });

      if (overwrite && result.operation.operation !== 'overwrite') {
        throw await rollbackAndCreateError(
          transaction,
          id,
          result.operation.backupPath ?? null,
          new Error(`CODEX_SKILL_NOT_FOUND: ${id}`)
        );
      }

      try {
        await cleanupWorkDir(input, workDir);
        workDirCleaned = true;
      } catch (cleanupError) {
        throw await rollbackAndCreateError(
          transaction,
          id,
          result.operation.backupPath ?? null,
          wrapSkillWriteFailed(
            cleanupError,
            `market installer workDir cleanup failed after install: ${workDir}; ${getErrorMessage(cleanupError)}`
          )
        );
      }

      try {
        const record = input.records.upsertRecord({
          skillId: id,
          repository: installSource.repository,
          skillPath: installSource.skillPath,
          commit: installSource.ref,
          marketRevision: installSource.marketRevision
        });
        return { ...result, record };
      } catch (recordError) {
        throw await rollbackAndCreateError(
          transaction,
          id,
          result.operation.backupPath ?? null,
          recordError
        );
      }
    });
  } finally {
    if (!workDirCleaned) {
      try {
        await cleanupWorkDir(input, workDir);
      } catch {
        // Preserve the primary error. Post-install cleanup is handled explicitly above.
      }
    }
  }
}

async function rollbackAndCreateError(
  transaction: SkillWriteTransaction,
  id: string,
  backupPath: string | null,
  error: unknown
): Promise<unknown> {
  try {
    await transaction.rollbackSkillInstall(id, backupPath);
    return error;
  } catch (rollbackError) {
    return new AggregateError(
      [error, rollbackError],
      `${getErrorMessage(error)}; rollback failed (${getErrorMessage(rollbackError)})`
    );
  }
}

function cleanupWorkDir(
  input: { cleanupWorkDir?: (workDir: string) => void | Promise<void> },
  workDir: string
): void | Promise<void> {
  if (input.cleanupWorkDir) {
    return input.cleanupWorkDir(workDir);
  }
  rmSync(workDir, { recursive: true, force: true });
}

function wrapSkillWriteFailed(error: unknown, message: string): Error {
  if (error instanceof Error && error.message.startsWith('CODEX_SKILL_WRITE_FAILED:')) {
    return error;
  }
  return new Error(`CODEX_SKILL_WRITE_FAILED: ${message}`, { cause: error });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
