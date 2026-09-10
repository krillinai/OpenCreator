import type Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const migrationKey = 'purge-stickman-video-v1';

const legacyStyleAssets: Record<string, string> = {
  '极简黑白线稿': 'stickman.style.minimal-ink',
  '纸面铅笔手绘': 'stickman.style.paper-pencil',
  '漫画分镜线稿': 'stickman.style.comic-storyboard',
  '白板讲解线稿': 'stickman.style.whiteboard-marker'
};

const legacyCharacterIds = new Set([
  'default',
  'tech-guy',
  'long-hair',
  'short-hair',
  'student',
  'manager',
  'hiphop',
  'elder',
  'chef',
  'fitness'
]);

type MigrationState = {
  pendingJobIds: string[];
  blockedJobIds: string[];
  completed: boolean;
};

export async function purgeLegacyStickmanJobs(input: {
  db: Database.Database;
  jobsRoot: string;
  removeDirectory?(path: string): Promise<void>;
}): Promise<MigrationState> {
  ensureMigrationTable(input.db);
  const state = input.db.transaction(() => {
    const previous = readState(input.db);
    const rows = input.db.prepare(`
      SELECT id
      FROM creator_jobs
      WHERE template_id = 'stickman-video' AND template_version = 1
      ORDER BY id ASC
    `).all() as Array<{ id: string }>;
    const pendingJobIds = [...new Set([
      ...previous.pendingJobIds,
      ...rows.map(row => row.id)
    ])];
    if (rows.length > 0) {
      const removeJob = input.db.prepare('DELETE FROM creator_jobs WHERE id = ?');
      for (const row of rows) removeJob.run(row.id);
    }
    const next: MigrationState = {
      pendingJobIds,
      blockedJobIds: previous.blockedJobIds,
      completed: pendingJobIds.length === 0
    };
    writeState(input.db, next);
    return next;
  })();

  const removeDirectory = input.removeDirectory
    ?? (path => rm(path, { recursive: true, force: true }));
  const root = resolve(input.jobsRoot);
  const pending: string[] = [];
  const blocked = new Set(state.blockedJobIds);
  for (const jobId of state.pendingJobIds) {
    const target = resolve(root, jobId);
    const targetRelative = relative(root, target);
    if (
      targetRelative === ''
      || targetRelative.startsWith('..')
      || isAbsolute(targetRelative)
    ) {
      blocked.add(jobId);
      pending.push(jobId);
      continue;
    }
    try {
      await removeDirectory(target);
    } catch {
      pending.push(jobId);
    }
    writeState(input.db, {
      pendingJobIds: pending.concat(state.pendingJobIds.slice(state.pendingJobIds.indexOf(jobId) + 1)),
      blockedJobIds: [...blocked],
      completed: false
    });
  }
  const result: MigrationState = {
    pendingJobIds: pending,
    blockedJobIds: [...blocked].sort(),
    completed: pending.length === 0
  };
  writeState(input.db, result);
  return result;
}

export function migrateStickmanVisualAssetState(input: {
  db: Database.Database;
}): { migratedJobIds: string[] } {
  const rows = input.db.prepare(`
    SELECT id, state_json
    FROM creator_jobs
    WHERE template_id = 'stickman-video' AND template_version = 2
    ORDER BY id ASC
  `).all() as Array<{ id: string; state_json: string }>;
  const update = input.db.prepare(`
    UPDATE creator_jobs
    SET state_json = ?, updated_at = ?
    WHERE id = ?
  `);
  const migratedJobIds: string[] = [];
  input.db.transaction(() => {
    for (const row of rows) {
      const state = JSON.parse(row.state_json) as Record<string, unknown>;
      const characterAsset = readStoredAssetRef(state.characterAsset)
        ?? {
          assetId: `stickman.character.${readLegacyCharacterId(state.selectedPresetId)}`,
          revision: 1
        };
      const styleAsset = readStoredAssetRef(state.styleAsset)
        ?? {
          assetId: legacyStyleAssets[typeof state.style === 'string' ? state.style : '']
            ?? 'stickman.style.minimal-ink',
          revision: 1
        };
      const next: Record<string, unknown> = { ...state, characterAsset, styleAsset };
      delete next.selectedPresetId;
      delete next.style;
      if (JSON.stringify(next) === row.state_json) continue;
      update.run(JSON.stringify(next), new Date().toISOString(), row.id);
      migratedJobIds.push(row.id);
    }
  })();
  return { migratedJobIds };
}

function readStoredAssetRef(value: unknown): { assetId: string; revision: number } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.assetId !== 'string'
    || !Number.isSafeInteger(record.revision)
    || Number(record.revision) <= 0
  ) return undefined;
  return { assetId: record.assetId, revision: Number(record.revision) };
}

function readLegacyCharacterId(value: unknown): string {
  return typeof value === 'string' && legacyCharacterIds.has(value) ? value : 'default';
}

function ensureMigrationTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_data_migrations (
      key TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function readState(db: Database.Database): MigrationState {
  const row = db.prepare(`
    SELECT state_json
    FROM creator_data_migrations
    WHERE key = ?
  `).get(migrationKey) as { state_json: string } | undefined;
  if (row === undefined) return { pendingJobIds: [], blockedJobIds: [], completed: false };
  const parsed = JSON.parse(row.state_json) as Partial<MigrationState>;
  return {
    pendingJobIds: Array.isArray(parsed.pendingJobIds)
      ? parsed.pendingJobIds.filter(item => typeof item === 'string')
      : [],
    blockedJobIds: Array.isArray(parsed.blockedJobIds)
      ? parsed.blockedJobIds.filter(item => typeof item === 'string')
      : [],
    completed: parsed.completed === true
  };
}

function writeState(db: Database.Database, state: MigrationState): void {
  db.prepare(`
    INSERT INTO creator_data_migrations (key, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).run(migrationKey, JSON.stringify(state), new Date().toISOString());
}
