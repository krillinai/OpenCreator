import type { CodexSkillMarketInstallRecordResponse } from '@clawee/protocol';
import type Database from 'better-sqlite3';

export type SkillMarketRecordRepository = {
  upsertRecord(input: {
    skillId: string;
    repository: string;
    skillPath: string;
    commit: string;
    marketRevision: number;
  }): CodexSkillMarketInstallRecordResponse;
  getRecord(skillId: string): CodexSkillMarketInstallRecordResponse | undefined;
  listRecords(): CodexSkillMarketInstallRecordResponse[];
};

export function createSkillMarketRecordRepository(
  db: Database.Database
): SkillMarketRecordRepository {
  const upsert = db.prepare(`
    INSERT INTO codex_skill_market_installs (
      skill_id, repository, skill_path, commit_sha, market_revision
    ) VALUES (
      @skillId, @repository, @skillPath, @commit, @marketRevision
    )
    ON CONFLICT(skill_id) DO UPDATE SET
      repository = excluded.repository,
      skill_path = excluded.skill_path,
      commit_sha = excluded.commit_sha,
      market_revision = excluded.market_revision,
      updated_at = CURRENT_TIMESTAMP
  `);
  const get = db.prepare<string>(`
    SELECT *
    FROM codex_skill_market_installs
    WHERE skill_id = ?
  `);
  const list = db.prepare(`
    SELECT *
    FROM codex_skill_market_installs
    ORDER BY updated_at DESC, skill_id ASC
  `);

  return {
    upsertRecord(input) {
      upsert.run(input);
      const row = get.get(input.skillId) as SkillMarketInstallRow;
      return mapRow(row);
    },
    getRecord(skillId) {
      const row = get.get(skillId) as SkillMarketInstallRow | undefined;
      return row === undefined ? undefined : mapRow(row);
    },
    listRecords() {
      return (list.all() as SkillMarketInstallRow[]).map(mapRow);
    }
  };
}

type SkillMarketInstallRow = {
  skill_id: string;
  repository: string;
  skill_path: string;
  commit_sha: string;
  market_revision: number;
  installed_at: string;
  updated_at: string;
};

function mapRow(row: SkillMarketInstallRow): CodexSkillMarketInstallRecordResponse {
  return {
    skillId: row.skill_id,
    repository: row.repository,
    skillPath: row.skill_path,
    commit: row.commit_sha,
    marketRevision: row.market_revision,
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  };
}
