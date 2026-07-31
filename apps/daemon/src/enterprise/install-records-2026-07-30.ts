import type Database from 'better-sqlite3';

export type EnterpriseSkillInstallRecord = {
  skillId: string;
  name: string;
  versionId: string;
  version: string;
  packageSha256: string;
  installedContentSha256: string;
  installedAt: string;
  updatedAt: string;
};

export type EnterpriseSkillInstallRecordInput = Omit<
  EnterpriseSkillInstallRecord,
  'installedAt' | 'updatedAt'
>;

export type EnterpriseInstallRecordRepository = {
  getBySkillId(skillId: string): EnterpriseSkillInstallRecord | undefined;
  getByName(name: string): EnterpriseSkillInstallRecord | undefined;
  listRecords(): EnterpriseSkillInstallRecord[];
  upsertRecord(
    input: EnterpriseSkillInstallRecordInput
  ): EnterpriseSkillInstallRecord;
};

type EnterpriseSkillInstallRow = {
  skill_id: string;
  name: string;
  version_id: string;
  version: string;
  package_sha256: string;
  installed_content_sha256: string;
  installed_at: string;
  updated_at: string;
};

export function createEnterpriseInstallRecordRepository(
  db: Database.Database
): EnterpriseInstallRecordRepository {
  const getBySkillId = db.prepare<string>(`
    SELECT *
    FROM enterprise_skill_installs
    WHERE skill_id = ?
  `);
  const getByName = db.prepare<string>(`
    SELECT *
    FROM enterprise_skill_installs
    WHERE name = ?
  `);
  const list = db.prepare(`
    SELECT *
    FROM enterprise_skill_installs
    ORDER BY updated_at DESC, skill_id ASC
  `);
  const upsert = db.prepare(`
    INSERT INTO enterprise_skill_installs (
      skill_id,
      name,
      version_id,
      version,
      package_sha256,
      installed_content_sha256
    ) VALUES (
      @skillId,
      @name,
      @versionId,
      @version,
      @packageSha256,
      @installedContentSha256
    )
    ON CONFLICT(skill_id) DO UPDATE SET
      name = excluded.name,
      version_id = excluded.version_id,
      version = excluded.version,
      package_sha256 = excluded.package_sha256,
      installed_content_sha256 = excluded.installed_content_sha256,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `);
  const upsertAndMap = db.transaction((input: EnterpriseSkillInstallRecordInput) => {
    const row = upsert.get(input) as EnterpriseSkillInstallRow;
    return mapRow(row);
  });

  return {
    getBySkillId(skillId) {
      const row = getBySkillId.get(skillId) as
        | EnterpriseSkillInstallRow
        | undefined;
      return row === undefined ? undefined : mapRow(row);
    },
    getByName(name) {
      const row = getByName.get(name) as
        | EnterpriseSkillInstallRow
        | undefined;
      return row === undefined ? undefined : mapRow(row);
    },
    listRecords() {
      return (list.all() as EnterpriseSkillInstallRow[]).map(mapRow);
    },
    upsertRecord(input) {
      return upsertAndMap(input);
    }
  };
}

function mapRow(row: EnterpriseSkillInstallRow): EnterpriseSkillInstallRecord {
  return {
    skillId: row.skill_id,
    name: row.name,
    versionId: row.version_id,
    version: row.version,
    packageSha256: row.package_sha256,
    installedContentSha256: row.installed_content_sha256,
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

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const timestamp = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  );
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
