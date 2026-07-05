import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  CodexSkillOperationResponse,
  CodexSkillOperationStatus,
  CodexSkillOperationType
} from './types.js';

export type InsertSkillOperationInput = {
  operation: CodexSkillOperationType;
  skillId: string;
  codexHome: string;
  skillsPath: string;
  sourcePath?: string | null;
  targetPath: string;
  backupPath?: string | null;
  status: CodexSkillOperationStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type SkillOperationRepository = {
  insertOperation(input: InsertSkillOperationInput): CodexSkillOperationResponse;
  listOperations(limit?: number): CodexSkillOperationResponse[];
};

export function createSkillOperationRepository(db: Database.Database): SkillOperationRepository {
  const insert = db.prepare(`
    INSERT INTO codex_skill_operations (
      id, operation, skill_id, codex_home, skills_path, source_path,
      target_path, backup_path, status, error_code, error_message
    ) VALUES (
      @id, @operation, @skillId, @codexHome, @skillsPath, @sourcePath,
      @targetPath, @backupPath, @status, @errorCode, @errorMessage
    )
  `);
  const get = db.prepare<string>('SELECT * FROM codex_skill_operations WHERE id = ?');
  const list = db.prepare<{ limit: number }>(`
    SELECT *
    FROM codex_skill_operations
    ORDER BY rowid DESC
    LIMIT @limit
  `);

  return {
    insertOperation(input): CodexSkillOperationResponse {
      const id = `skillop_${nanoid()}`;
      insert.run({
        id,
        sourcePath: null,
        backupPath: null,
        errorCode: null,
        errorMessage: null,
        ...input
      });
      const row = get.get(id) as SkillOperationRow;
      return mapRow(row);
    },
    listOperations(limit = 50): CodexSkillOperationResponse[] {
      const normalizedLimit = Math.max(1, Math.min(limit, 200));
      return (list.all({ limit: normalizedLimit }) as SkillOperationRow[]).map(mapRow);
    }
  };
}

type SkillOperationRow = {
  id: string;
  operation: CodexSkillOperationType;
  skill_id: string;
  codex_home: string;
  skills_path: string;
  source_path: string | null;
  target_path: string;
  backup_path: string | null;
  status: CodexSkillOperationStatus;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

function mapRow(row: SkillOperationRow): CodexSkillOperationResponse {
  return {
    id: row.id,
    operation: row.operation,
    skillId: row.skill_id,
    codexHome: row.codex_home,
    skillsPath: row.skills_path,
    sourcePath: row.source_path,
    targetPath: row.target_path,
    backupPath: row.backup_path,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}
