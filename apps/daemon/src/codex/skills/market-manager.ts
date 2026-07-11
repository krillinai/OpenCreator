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
  let primaryError: unknown;

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
      try {
        await input.skillManager.rollbackSkillInstall(id, result.operation.backupPath ?? null);
      } catch (rollbackError) {
        throw createRecordRollbackError(recordError, rollbackError);
      }
      throw recordError;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError !== undefined) {
        throw createCleanupError(primaryError, cleanupError);
      }
    }
  }
}

function createRecordRollbackError(recordError: unknown, rollbackError: unknown): AggregateError {
  return new AggregateError(
    [recordError, rollbackError],
    `CODEX_SKILL_WRITE_FAILED: market record write failed (${getErrorMessage(recordError)}); rollback failed (${getErrorMessage(rollbackError)})`
  );
}

function createCleanupError(primaryError: unknown, cleanupError: unknown): AggregateError {
  return new AggregateError(
    [primaryError, cleanupError],
    getErrorMessage(primaryError)
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
