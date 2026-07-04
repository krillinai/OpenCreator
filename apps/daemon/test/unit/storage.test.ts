import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository } from '../../src/storage/repositories.js';

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
