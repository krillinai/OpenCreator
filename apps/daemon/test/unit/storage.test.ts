import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import type { InsertRunInput } from '../../src/storage/repositories.js';
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('runtime storage', () => {
  it('creates schema and persists a run', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runs = createRunRepository(db);

    runs.insertRun({
      id: 'run_1',
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: 'api',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 0.139.0',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const loaded = runs.getRun('run_1');
    expect(loaded?.public_status).toBe('queued');
    expect(loaded?.resume_mode).toBe('independent');
  });

  it('creates tables and enforces unique event sequence per run', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'run_events', 'threads')"
      )
      .all() as Array<{ name: string }>;

    expect(tableRows.map((row) => row.name).sort()).toEqual(['run_events', 'runs', 'threads']);

    const runs = createRunRepository(db);
    runs.insertRun({
      id: 'run_1',
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: 'api',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 0.139.0',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const insertEvent = db.prepare(`
      INSERT INTO run_events (id, run_id, seq, type, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertEvent.run('event_1', 'run_1', 1, 'status', '{}');

    expect(() => insertEvent.run('event_2', 'run_1', 1, 'status', '{}')).toThrow();
  });
});

function createTestDatabase(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  return db;
}

function makeRunInput(overrides: Partial<InsertRunInput> = {}): InsertRunInput {
  return {
    id: 'run_default',
    publicStatus: 'queued',
    internalStatus: 'created',
    createdBy: 'api',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1,
    ...overrides
  };
}

it('persists threads and codex thread binding', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);

  threads.insertThread({
    id: 'thread_1',
    title: 'R2 plan',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    model: 'gpt-5',
    reasoning: 'high',
    status: 'active'
  });

  expect(threads.getThread('thread_1')).toMatchObject({
    id: 'thread_1',
    title: 'R2 plan',
    codex_thread_id: null,
    status: 'active'
  });

  threads.setCodexThreadId('thread_1', '019f-thread');
  expect(threads.getThread('thread_1')?.codex_thread_id).toBe('019f-thread');
});

it('lists thread run history and preserves archived thread data', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);
  const runs = createRunRepository(database);

  threads.insertThread({
    id: 'thread_1',
    title: null,
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    status: 'active'
  });
  runs.insertRun(makeRunInput({ id: 'run_1', threadId: 'thread_1', resumeMode: 'new_thread' }));

  expect(runs.listRunsByThread('thread_1')).toHaveLength(1);

  threads.archiveThread('thread_1');
  expect(threads.getThread('thread_1')).toMatchObject({ status: 'archived' });
  expect(runs.listRunsByThread('thread_1')).toHaveLength(1);

  const firstArchivedAt = threads.getThread('thread_1')?.archived_at;
  threads.archiveThread('thread_1');
  expect(threads.getThread('thread_1')?.archived_at).toBe(firstArchivedAt);
});

it('migrates legacy storage and preserves existing thread operations', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-storage-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
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
  `);
  legacyDb
    .prepare(
      `
      INSERT INTO runs (
        id, thread_id, codex_thread_id, public_status, internal_status, created_by,
        profile, cwd, canonical_cwd, workspace_mode, sandbox, codex_version, codex_bin,
        codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      'legacy_run_1',
      'legacy_thread_1',
      null,
      'queued',
      'created',
      'api',
      'default',
      tempDir,
      tempDir,
      'external',
      'read-only',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );
  legacyDb
    .prepare(
      `
      INSERT INTO threads (
        id, codex_thread_id, cwd, canonical_cwd, workspace_mode, profile, sandbox, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run('legacy_thread_1', null, tempDir, tempDir, 'external', 'default', 'read-only', 'active');
  legacyDb.close();

  db = openRuntimeDatabase(dbPath);
  const runs = createRunRepository(db);
  const threads = createThreadRepository(db);

  expect(columnNames(db, 'runs')).toEqual(expect.arrayContaining(['resume_mode', 'queue_state']));
  expect(columnNames(db, 'threads')).toEqual(expect.arrayContaining(['title', 'archived_at']));
  expect(runs.getRun('legacy_run_1')?.queue_state).toBe('none');

  threads.setCodexThreadId('legacy_thread_1', '019f-legacy-thread');
  expect(threads.getThread('legacy_thread_1')?.codex_thread_id).toBe('019f-legacy-thread');

  threads.archiveThread('legacy_thread_1');
  const archivedAt = threads.getThread('legacy_thread_1')?.archived_at;
  expect(threads.getThread('legacy_thread_1')).toMatchObject({ status: 'archived' });

  threads.archiveThread('legacy_thread_1');
  expect(threads.getThread('legacy_thread_1')?.archived_at).toBe(archivedAt);
});

function columnNames(database: Database.Database, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map(row => row.name);
}
