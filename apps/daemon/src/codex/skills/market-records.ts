import type { CodexSkillMarketInstallRecordResponse } from '@opencreator/protocol';
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
  const upsertAndMap = db.transaction(
    (input: Parameters<SkillMarketRecordRepository['upsertRecord']>[0]) => {
      upsert.run(input);
      const row = get.get(input.skillId) as SkillMarketInstallRow;
      return mapRow(row);
    }
  );

  return {
    upsertRecord(input) {
      return upsertAndMap(input);
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
    installedAt: parseSqliteUtcTimestamp(row.installed_at),
    updatedAt: parseSqliteUtcTimestamp(row.updated_at)
  };
}

function parseSqliteUtcTimestamp(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    throw new Error(`Invalid SQLite UTC timestamp: ${value}`);
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() !== month - 1 ||
    timestamp.getUTCDate() !== day ||
    timestamp.getUTCHours() !== hour ||
    timestamp.getUTCMinutes() !== minute ||
    timestamp.getUTCSeconds() !== second
  ) {
    throw new Error(`Invalid SQLite UTC timestamp: ${value}`);
  }

  return timestamp.toISOString();
}
