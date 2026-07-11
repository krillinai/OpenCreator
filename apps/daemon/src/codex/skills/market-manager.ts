import type {
  CodexSkillMarketInstallRecordResponse,
  CodexSkillMarketMutationResponse
} from '@clawee/protocol';
import { getSkillMarketEntry } from '@clawee/skill-market';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillManager } from './manager.js';
import { type MarketArchiveDownloader, resolveMarketSkillSource } from './market-downloader.js';
import type { SkillMarketRecordRepository } from './market-records.js';

export type SkillMarketManager = {
  listInstallRecords(): CodexSkillMarketInstallRecordResponse[];
  installSkill(id: string): Promise<CodexSkillMarketMutationResponse>;
  updateSkill(id: string): Promise<CodexSkillMarketMutationResponse>;
};

export function createSkillMarketManager(input: {
  dataDir: string;
  skillManager: SkillManager;
  records: SkillMarketRecordRepository;
  downloader: MarketArchiveDownloader;
  cleanupWorkDir?: (workDir: string) => void;
}): SkillMarketManager {
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
  input: {
    dataDir: string;
    skillManager: SkillManager;
    records: SkillMarketRecordRepository;
    downloader: MarketArchiveDownloader;
    cleanupWorkDir?: (workDir: string) => void;
  },
  id: string,
  overwrite: boolean
): Promise<CodexSkillMarketMutationResponse> {
  const entry = getSkillMarketEntry(id);
  if (entry === undefined) {
    throw new Error(`CODEX_SKILL_MARKET_ENTRY_NOT_FOUND: ${id}`);
  }
  if (!entry.install.available) {
    throw new Error(`CODEX_SKILL_MARKET_NOT_INSTALLABLE: ${id}`);
  }
  if (overwrite && input.skillManager.getSkill(id) === undefined) {
    throw new Error(`CODEX_SKILL_NOT_FOUND: ${id}`);
  }

  const downloadParent = join(input.dataDir, 'skill-market-downloads');
  mkdirSync(downloadParent, { recursive: true });
  const workDir = mkdtempSync(join(downloadParent, 'mutation-'));
  let workDirCleaned = false;

  try {
    const archiveRoot = await input.downloader.download({
      repository: entry.install.repository,
      commit: entry.install.commit,
      workDir
    });
    const sourcePath = resolveMarketSkillSource(archiveRoot, entry.install.skillPath);
    const result = await input.skillManager.installSkill({
      id,
      sourcePath,
      ...(overwrite ? { overwrite: true } : {}),
      confirmWriteToCodexHome: true
    });

    if (overwrite && result.operation.operation !== 'overwrite') {
      throw await rollbackAndCreateError(
        input.skillManager,
        id,
        result.operation.backupPath ?? null,
        new Error(`CODEX_SKILL_NOT_FOUND: ${id}`)
      );
    }

    try {
      cleanupWorkDir(input, workDir);
      workDirCleaned = true;
    } catch (cleanupError) {
      throw await rollbackAndCreateError(
        input.skillManager,
        id,
        result.operation.backupPath ?? null,
        wrapSkillWriteFailed(
          cleanupError,
          `market download workDir cleanup failed after install: ${workDir}; ${getErrorMessage(cleanupError)}`
        )
      );
    }

    try {
      const record = input.records.upsertRecord({
        skillId: id,
        repository: entry.install.repository,
        skillPath: entry.install.skillPath,
        commit: entry.install.commit,
        marketRevision: entry.install.marketRevision
      });
      return { ...result, record };
    } catch (recordError) {
      throw await rollbackAndCreateError(
        input.skillManager,
        id,
        result.operation.backupPath ?? null,
        recordError
      );
    }
  } finally {
    if (!workDirCleaned) {
      try {
        cleanupWorkDir(input, workDir);
      } catch {
        // Preserve the primary error. Post-install cleanup is handled explicitly above.
      }
    }
  }
}

async function rollbackAndCreateError(
  skillManager: SkillManager,
  id: string,
  backupPath: string | null,
  error: unknown
): Promise<unknown> {
  try {
    await skillManager.rollbackSkillInstall(id, backupPath);
    return error;
  } catch (rollbackError) {
    return new AggregateError(
      [error, rollbackError],
      `${getErrorMessage(error)}; rollback failed (${getErrorMessage(rollbackError)})`
    );
  }
}

function cleanupWorkDir(
  input: { cleanupWorkDir?: (workDir: string) => void },
  workDir: string
): void {
  if (input.cleanupWorkDir) {
    input.cleanupWorkDir(workDir);
    return;
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
