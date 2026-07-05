import type Database from 'better-sqlite3';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';
let db: Database.Database | undefined;

function openTestDatabase(root: string): Database.Database {
  db = openRuntimeDatabase(join(root, 'app.sqlite'));
  return db;
}

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('thread manager', () => {
  it('creates a managed thread with fixed workspace', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const thread = manager.createThread({
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only'
    });
    expect(thread.workspaceMode).toBe('managed');
    expect(thread.id).toMatch(/^thread_/);
    expect(thread.cwd).toContain(join('workspaces', thread.id));
  });

  it('persists managed and external threads', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });

    const managed = manager.createThread({
      title: 'Managed',
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only'
    });
    expect(managed.cwd).toContain(join('workspaces', managed.id));
    expect(manager.getThread(managed.id)).toMatchObject({ id: managed.id, title: 'Managed' });

    const external = manager.createThread({
      title: 'External',
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write'
    });
    expect(external.cwd).toBe(tempDir);
    expect(external.canonicalCwd).toBe(realpathSync(tempDir));
  });

  it('archives active threads and rejects missing threads', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-thread-'));
    const database = openTestDatabase(tempDir);
    const manager = createThreadManager({ db: database, dataDir: tempDir });
    const thread = manager.createThread({ workspaceMode: 'managed' });

    expect(manager.archiveThread(thread.id).status).toBe('archived');
    expect(() => manager.archiveThread('thread_missing')).toThrow(/THREAD_NOT_FOUND/);
  });
});
