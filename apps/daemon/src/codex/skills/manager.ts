import type Database from 'better-sqlite3';
import { basename, join } from 'node:path';
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

export function createSkillManager(input: {
  codexHome: ResolvedCodexHome;
  db: Database.Database;
}): SkillManager {
  const installer = createSkillInstaller({ codexHome: input.codexHome.path });
  const operations = createSkillOperationRepository(input.db);

  return {
    listSkills() {
      return scanCodexSkills({ codexHome: input.codexHome });
    },
    getSkill(id) {
      return scanCodexSkills({ codexHome: input.codexHome }).skills.find(
        (skill) => skill.id === id
      );
    },
    async installSkill(request) {
      requireWriteConfirmation(input.codexHome, request.confirmWriteToCodexHome === true);
      const skillId = request.id ?? basename(request.sourcePath);
      const requestedOperationType = request.overwrite === true ? 'overwrite' : 'install';
      try {
        const installed = await installer.install(request);
        const skill = scanCodexSkills({ codexHome: input.codexHome }).skills.find(
          (candidate) => candidate.id === installed.id
        );
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
        operations.insertOperation({
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
        throw error;
      }
    },
    async deleteSkill(id, confirmed) {
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
    },
    rollbackSkillInstall(id, backupPath) {
      return installer.rollback({ id, backupPath });
    },
    listOperations(limit) {
      return operations.listOperations(limit);
    }
  };
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
