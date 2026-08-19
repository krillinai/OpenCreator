import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createScheduleCoordinator } from '../src/scheduler/coordinator.js';
import { ScheduleRepository } from '../src/scheduler/repository.js';
import { openRuntimeDatabase } from '../src/storage/database.js';
import { createThreadManager } from '../src/threads/manager.js';

type CountRow = { count: number };

type DatabaseSnapshot = {
  userVersion: number;
  sqliteVersion: string;
  scheduleCount: number;
  activeScheduleCount: number;
  deletedScheduleCount: number;
  threadCount: number;
  scheduleTaskThreadCount: number;
  orphanScheduleRunCount: number;
  scheduleColumns: string[];
  threadColumns: string[];
  scheduleIndexes: string[];
};

type BindingRepairResult = {
  scanned: number;
  repaired: number;
  failed: number;
  unchanged: number;
};

type RehearsalReport = {
  before: DatabaseSnapshot;
  migration: {
    firstBindingRepair: BindingRepairResult;
    secondBindingRepair: BindingRepairResult;
    missingActiveBindings: number;
    duplicateActiveBindings: number;
    configurationMismatches: number;
    parallelPoliciesRemaining: number;
  };
  rollbackCompatibility: {
    legacyScheduleRowsRead: number;
    legacyThreadRowsRead: number;
    legacyRunRowsRead: number;
    orphanScheduleRunsPreserved: number;
  };
  reupgrade: {
    bindingRepair: BindingRepairResult;
    threadCount: number;
  };
  after: DatabaseSnapshot;
};

const LEGACY_SCHEDULE_COLUMNS = `
  id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
  profile, cwd, canonical_cwd, model, reasoning, sandbox, timeout_ms,
  concurrency_policy, misfire_policy, next_run_at, last_run_at, last_run_id,
  last_status, pending_trigger, created_at, updated_at, deleted_at
`;

const LEGACY_THREAD_COLUMNS = `
  id, codex_thread_id, cwd, canonical_cwd, workspace_mode, profile, sandbox,
  model, reasoning, status, created_at, updated_at, last_error_code, last_error_message
`;

const LEGACY_RUN_COLUMNS = `
  id, thread_id, codex_thread_id, public_status, internal_status, created_by,
  source_id, profile, cwd, canonical_cwd, workspace_mode, prompt_hash,
  prompt_preview_redacted, model, reasoning, sandbox, codex_version, codex_bin,
  codex_home, normalizer_version, timeout_ms, inactivity_timeout_ms,
  transcript_reseed_mode, resume_argv_json, usage_source, termination_reason,
  exit_code, signal, started_at, ended_at, created_at, updated_at, error_code,
  error_message
`;

function main(): void {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) {
    if (arg !== '--keep') throw new Error(`Unknown argument: ${arg}`);
  }

  const keep = args.has('--keep');
  const tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-upgrade-'));
  const dbPath = join(tempDir, 'app.sqlite');
  let db: Database.Database | undefined;

  try {
    createLegacyDatabase(dbPath, tempDir);
    const legacyDb = new Database(dbPath, { readonly: true });
    const before = readSnapshot(legacyDb);
    legacyDb.close();

    assert.equal(before.scheduleCount, 3);
    assert.equal(before.activeScheduleCount, 2);
    assert.equal(before.deletedScheduleCount, 1);
    assert.equal(before.threadCount, 1);
    assert.equal(before.orphanScheduleRunCount, 1);
    assert.equal(before.scheduleColumns.includes('thread_id'), false);
    assert.equal(before.threadColumns.includes('purpose'), false);

    db = openRuntimeDatabase(dbPath);
    const firstCoordinator = createCoordinator(db, tempDir);
    const firstBindingRepair = firstCoordinator.ensureBindings();
    const threadCountAfterFirstRepair = count(db, 'SELECT COUNT(*) AS count FROM threads');
    const secondBindingRepair = firstCoordinator.ensureBindings();

    assert.deepEqual(firstBindingRepair, {
      scanned: 2,
      repaired: 2,
      failed: 0,
      unchanged: 0
    });
    assert.deepEqual(secondBindingRepair, {
      scanned: 2,
      repaired: 0,
      failed: 0,
      unchanged: 2
    });
    assert.equal(count(db, 'SELECT COUNT(*) AS count FROM threads'), threadCountAfterFirstRepair);

    const missingActiveBindings = count(db, `
      SELECT COUNT(*) AS count
      FROM schedules
      WHERE deleted_at IS NULL AND thread_id IS NULL
    `);
    const duplicateActiveBindings = count(db, `
      SELECT COUNT(*) AS count
      FROM (
        SELECT thread_id
        FROM schedules
        WHERE deleted_at IS NULL
        GROUP BY thread_id
        HAVING COUNT(*) > 1
      )
    `);
    const configurationMismatches = count(db, `
      SELECT COUNT(*) AS count
      FROM schedules AS schedule
      LEFT JOIN threads AS thread ON thread.id = schedule.thread_id
      WHERE schedule.deleted_at IS NULL
        AND (
          thread.id IS NULL
          OR thread.purpose <> 'schedule_task'
          OR thread.status <> 'active'
          OR thread.workspace_mode <> 'external'
          OR thread.title IS NOT schedule.name
          OR thread.cwd IS NOT schedule.cwd
          OR thread.canonical_cwd IS NOT schedule.canonical_cwd
          OR thread.profile IS NOT schedule.profile
          OR thread.model IS NOT schedule.model
          OR thread.reasoning IS NOT schedule.reasoning
          OR thread.sandbox IS NOT schedule.sandbox
        )
    `);
    const parallelPoliciesRemaining = count(db, `
      SELECT COUNT(*) AS count
      FROM schedules
      WHERE concurrency_policy = 'parallel'
    `);

    assert.equal(missingActiveBindings, 0);
    assert.equal(duplicateActiveBindings, 0);
    assert.equal(configurationMismatches, 0);
    assert.equal(parallelPoliciesRemaining, 0);

    const migratedSnapshot = readSnapshot(db);
    assert.equal(migratedSnapshot.scheduleCount, before.scheduleCount);
    assert.equal(migratedSnapshot.deletedScheduleCount, before.deletedScheduleCount);
    assert.equal(migratedSnapshot.orphanScheduleRunCount, before.orphanScheduleRunCount);
    assert.equal(
      migratedSnapshot.threadCount,
      before.threadCount + before.activeScheduleCount
    );
    assert.equal(migratedSnapshot.scheduleTaskThreadCount, before.activeScheduleCount);
    assert.equal(migratedSnapshot.scheduleColumns.includes('thread_id'), true);
    assert.equal(migratedSnapshot.threadColumns.includes('purpose'), true);
    assert.equal(migratedSnapshot.scheduleIndexes.includes('idx_schedules_thread_id'), true);

    db.close();
    db = undefined;

    const rollbackDb = new Database(dbPath, { readonly: true });
    const legacyScheduleRows = rollbackDb
      .prepare(`SELECT ${LEGACY_SCHEDULE_COLUMNS} FROM schedules ORDER BY id`)
      .all();
    const legacyThreadRows = rollbackDb
      .prepare(`SELECT ${LEGACY_THREAD_COLUMNS} FROM threads ORDER BY id`)
      .all();
    const legacyRunRows = rollbackDb
      .prepare(`SELECT ${LEGACY_RUN_COLUMNS} FROM runs ORDER BY id`)
      .all();
    const orphanScheduleRunsPreserved = count(rollbackDb, `
      SELECT COUNT(*) AS count
      FROM runs
      WHERE created_by = 'schedule' AND thread_id IS NULL
    `);
    rollbackDb.close();

    assert.equal(legacyScheduleRows.length, before.scheduleCount);
    assert.equal(legacyThreadRows.length, migratedSnapshot.threadCount);
    assert.equal(legacyRunRows.length, 1);
    assert.equal(orphanScheduleRunsPreserved, before.orphanScheduleRunCount);

    db = openRuntimeDatabase(dbPath);
    const reupgradeBindingRepair = createCoordinator(db, tempDir).ensureBindings();
    const after = readSnapshot(db);

    assert.deepEqual(reupgradeBindingRepair, {
      scanned: 2,
      repaired: 0,
      failed: 0,
      unchanged: 2
    });
    assert.equal(after.threadCount, migratedSnapshot.threadCount);
    assert.equal(after.scheduleCount, before.scheduleCount);
    assert.equal(after.orphanScheduleRunCount, before.orphanScheduleRunCount);

    const report: RehearsalReport = {
      before,
      migration: {
        firstBindingRepair,
        secondBindingRepair,
        missingActiveBindings,
        duplicateActiveBindings,
        configurationMismatches,
        parallelPoliciesRemaining
      },
      rollbackCompatibility: {
        legacyScheduleRowsRead: legacyScheduleRows.length,
        legacyThreadRowsRead: legacyThreadRows.length,
        legacyRunRowsRead: legacyRunRows.length,
        orphanScheduleRunsPreserved
      },
      reupgrade: {
        bindingRepair: reupgradeBindingRepair,
        threadCount: after.threadCount
      },
      after
    };

    console.log(JSON.stringify(report, null, 2));
    console.log('Scheduled task upgrade and rollback rehearsal passed.');
    if (keep) console.log(`Temporary database retained at: ${dbPath}`);
  } finally {
    if (db?.open) db.close();
    if (!keep) rmSync(tempDir, { recursive: true, force: true });
  }
}

function createCoordinator(db: Database.Database, dataDir: string) {
  return createScheduleCoordinator({
    db,
    repository: new ScheduleRepository(db),
    threadManager: createThreadManager({ db, dataDir }),
    runManager: {
      hasActiveRunForThread: () => false
    },
    defaultCwd: dataDir,
    profileValidator: {
      validateProfileForRun: () => ({ ok: true as const })
    },
    clock: {
      now: () => new Date('2026-07-15T00:00:00.000Z')
    }
  });
}

function createLegacyDatabase(dbPath: string, dataDir: string): void {
  const db = new Database(dbPath);
  const canonicalCwd = realpathSync(dataDir);
  const createdAt = '2026-07-14T00:00:00.000Z';

  try {
    db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT,
        codex_thread_id TEXT,
        public_status TEXT NOT NULL,
        internal_status TEXT NOT NULL,
        created_by TEXT NOT NULL,
        source_id TEXT,
        profile TEXT NOT NULL,
        cwd TEXT NOT NULL,
        canonical_cwd TEXT NOT NULL,
        workspace_mode TEXT NOT NULL,
        prompt_hash TEXT,
        prompt_preview_redacted TEXT,
        model TEXT,
        reasoning TEXT,
        sandbox TEXT NOT NULL,
        codex_version TEXT NOT NULL,
        codex_bin TEXT NOT NULL,
        codex_home TEXT NOT NULL,
        normalizer_version INTEGER NOT NULL,
        timeout_ms INTEGER,
        inactivity_timeout_ms INTEGER,
        transcript_reseed_mode TEXT,
        resume_argv_json TEXT,
        usage_source TEXT,
        termination_reason TEXT,
        exit_code INTEGER,
        signal TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        error_code TEXT,
        error_message TEXT
      );

      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        codex_thread_id TEXT,
        cwd TEXT NOT NULL,
        canonical_cwd TEXT NOT NULL,
        workspace_mode TEXT NOT NULL,
        profile TEXT NOT NULL,
        sandbox TEXT NOT NULL,
        model TEXT,
        reasoning TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_error_code TEXT,
        last_error_message TEXT
      );

      CREATE TABLE schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        timezone TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        prompt TEXT NOT NULL,
        prompt_hash TEXT NOT NULL,
        prompt_preview_redacted TEXT NOT NULL,
        profile TEXT NOT NULL,
        cwd TEXT NOT NULL,
        canonical_cwd TEXT NOT NULL,
        model TEXT,
        reasoning TEXT,
        sandbox TEXT NOT NULL,
        timeout_ms INTEGER,
        concurrency_policy TEXT NOT NULL,
        misfire_policy TEXT NOT NULL,
        next_run_at TEXT,
        last_run_at TEXT,
        last_run_id TEXT,
        last_status TEXT,
        pending_trigger INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );

      CREATE TABLE schedule_operations (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const insertSchedule = db.prepare(`
      INSERT INTO schedules (
        id, name, cron, timezone, enabled, prompt, prompt_hash,
        prompt_preview_redacted, profile, cwd, canonical_cwd, model, reasoning,
        sandbox, timeout_ms, concurrency_policy, misfire_policy, next_run_at,
        last_run_at, last_run_id, last_status, pending_trigger, created_at,
        updated_at, deleted_at
      ) VALUES (
        @id, @name, @cron, @timezone, @enabled, @prompt, @promptHash,
        @promptPreviewRedacted, @profile, @cwd, @canonicalCwd, @model,
        @reasoning, @sandbox, @timeoutMs, @concurrencyPolicy, @misfirePolicy,
        @nextRunAt, @lastRunAt, @lastRunId, @lastStatus, @pendingTrigger,
        @createdAt, @updatedAt, @deletedAt
      )
    `);

    insertSchedule.run({
      id: 'sch_legacy_parallel',
      name: 'Legacy parallel task',
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      enabled: 1,
      prompt: 'Generate the daily project summary',
      promptHash: 'hash-parallel',
      promptPreviewRedacted: 'Generate the daily project summary',
      profile: 'default',
      cwd: dataDir,
      canonicalCwd,
      model: 'gpt-5',
      reasoning: 'high',
      sandbox: 'workspace-write',
      timeoutMs: 600_000,
      concurrencyPolicy: 'parallel',
      misfirePolicy: 'skip',
      nextRunAt: '2026-07-15T01:00:00.000Z',
      lastRunAt: createdAt,
      lastRunId: 'run_legacy_orphan',
      lastStatus: 'succeeded',
      pendingTrigger: 0,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null
    });
    insertSchedule.run({
      id: 'sch_legacy_queue',
      name: 'Legacy queue task',
      cron: '30 9 * * *',
      timezone: 'UTC',
      enabled: 1,
      prompt: 'Review open work items',
      promptHash: 'hash-queue',
      promptPreviewRedacted: 'Review open work items',
      profile: 'default',
      cwd: dataDir,
      canonicalCwd,
      model: null,
      reasoning: null,
      sandbox: 'read-only',
      timeoutMs: null,
      concurrencyPolicy: 'queue',
      misfirePolicy: 'skip',
      nextRunAt: '2026-07-15T09:30:00.000Z',
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      pendingTrigger: 0,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null
    });
    insertSchedule.run({
      id: 'sch_legacy_deleted',
      name: 'Deleted legacy task',
      cron: '0 10 * * *',
      timezone: 'UTC',
      enabled: 0,
      prompt: 'Deleted task input',
      promptHash: 'hash-deleted',
      promptPreviewRedacted: 'Deleted task input',
      profile: 'default',
      cwd: dataDir,
      canonicalCwd,
      model: null,
      reasoning: null,
      sandbox: 'read-only',
      timeoutMs: null,
      concurrencyPolicy: 'queue',
      misfirePolicy: 'skip',
      nextRunAt: null,
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      pendingTrigger: 0,
      createdAt,
      updatedAt: createdAt,
      deletedAt: '2026-07-14T01:00:00.000Z'
    });

    db.prepare(`
      INSERT INTO threads (
        id, codex_thread_id, cwd, canonical_cwd, workspace_mode, profile,
        sandbox, model, reasoning, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'thread_existing_conversation',
      'codex-existing-conversation',
      dataDir,
      canonicalCwd,
      'external',
      'default',
      'read-only',
      null,
      null,
      'active',
      createdAt,
      createdAt
    );

    db.prepare(`
      INSERT INTO runs (
        id, thread_id, codex_thread_id, public_status, internal_status,
        created_by, source_id, profile, cwd, canonical_cwd, workspace_mode,
        sandbox, codex_version, codex_bin, codex_home, normalizer_version,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'run_legacy_orphan',
      null,
      'codex-legacy-orphan',
      'succeeded',
      'exited',
      'schedule',
      'sch_legacy_parallel',
      'default',
      dataDir,
      canonicalCwd,
      'external',
      'workspace-write',
      'codex-cli 0.139.0',
      'codex',
      join(dataDir, 'codex-home'),
      1,
      createdAt,
      createdAt
    );

    db.prepare(`
      INSERT INTO schedule_operations (
        id, schedule_id, operation, status, run_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'schop_legacy_run',
      'sch_legacy_parallel',
      'run_now',
      'succeeded',
      'run_legacy_orphan',
      createdAt
    );
  } finally {
    db.close();
  }
}

function readSnapshot(db: Database.Database): DatabaseSnapshot {
  const sqliteVersion = db
    .prepare('SELECT sqlite_version() AS version')
    .get() as { version: string };
  const userVersion = db.pragma('user_version', { simple: true }) as number;

  return {
    userVersion,
    sqliteVersion: sqliteVersion.version,
    scheduleCount: count(db, 'SELECT COUNT(*) AS count FROM schedules'),
    activeScheduleCount: count(
      db,
      'SELECT COUNT(*) AS count FROM schedules WHERE deleted_at IS NULL'
    ),
    deletedScheduleCount: count(
      db,
      'SELECT COUNT(*) AS count FROM schedules WHERE deleted_at IS NOT NULL'
    ),
    threadCount: count(db, 'SELECT COUNT(*) AS count FROM threads'),
    scheduleTaskThreadCount: hasColumn(db, 'threads', 'purpose')
      ? count(db, "SELECT COUNT(*) AS count FROM threads WHERE purpose = 'schedule_task'")
      : 0,
    orphanScheduleRunCount: count(db, `
      SELECT COUNT(*) AS count
      FROM runs
      WHERE created_by = 'schedule' AND thread_id IS NULL
    `),
    scheduleColumns: columnNames(db, 'schedules'),
    threadColumns: columnNames(db, 'threads'),
    scheduleIndexes: db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND tbl_name = 'schedules'
        ORDER BY name
      `)
      .all()
      .map(row => (row as { name: string }).name)
  };
}

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as CountRow).count;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map(row => row.name);
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return columnNames(db, table).includes(column);
}

main();
