import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
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
});
