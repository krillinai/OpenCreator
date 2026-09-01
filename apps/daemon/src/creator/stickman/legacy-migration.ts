import type Database from 'better-sqlite3';
import { rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const migrationKey = 'purge-stickman-video-v1';

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
