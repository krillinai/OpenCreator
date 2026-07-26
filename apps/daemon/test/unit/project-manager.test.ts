import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectManager } from '../../src/projects/manager.js';
import { ProjectManagerError } from '../../src/projects/types.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('project manager', () => {
  it('creates named projects inside the managed Clawee directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-managed-project-'));
    const managedProjectRoot = join(tempDir, 'Documents', 'Clawee');
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createProjectManager({
      db,
      homeDir: tempDir,
      idFactory: () => 'project_managed'
    });

    const created = manager.createManagedProject({ name: ' 产品官网 ' });

    expect(created).toMatchObject({
      id: 'project_managed',
      name: '产品官网',
      cwd: join(managedProjectRoot, '产品官网'),
      directoryState: 'available'
    });
    expect(existsSync(join(managedProjectRoot, '产品官网'))).toBe(true);
  });

  it('removes a newly created empty directory when registration fails', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-managed-project-'));
    const projectDir = join(tempDir, 'Documents', 'Clawee', '未注册项目');
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createProjectManager({
      db,
      homeDir: tempDir,
      idFactory: () => ''
    });

    expect(() => manager.createManagedProject({ name: '未注册项目' }))
      .toThrow('Unable to allocate a unique project id');
    expect(existsSync(projectDir)).toBe(false);
  });

  it('rejects invalid or duplicate managed project names', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-managed-project-'));
    const managedProjectRoot = join(tempDir, 'Documents', 'Clawee');
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createProjectManager({ db, managedProjectRoot });

    for (const name of ['', '   ', '.', '..', 'nested/project', 'nested\\project']) {
      expect(() => manager.createManagedProject({ name })).toThrowError(
        expect.objectContaining({ code: 'PROJECT_NAME_INVALID' })
      );
    }

    manager.createManagedProject({ name: '重复项目' });
    expect(() => manager.createManagedProject({ name: '重复项目' })).toThrowError(
      expect.objectContaining({ code: 'PROJECT_DIRECTORY_CONFLICT' })
    );
  });

  it('persists projects and preserves a missing migrated directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-project-'));
    const projectDir = join(tempDir, 'workspace');
    mkdirSync(projectDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createProjectManager({
      db,
      homeDir: tempDir,
      idFactory: () => 'project_generated'
    });

    const created = manager.createProject({
      cwd: projectDir,
      name: 'Workspace'
    });
    const missing = manager.createMigratedProject({
      preferredId: 'legacy_missing',
      cwd: join(tempDir, 'missing'),
      name: 'Missing'
    });

    expect(created).toMatchObject({
      id: 'project_generated',
      cwd: projectDir,
      canonicalCwd: realpathSync(projectDir),
      directoryState: 'available',
      profile: 'default',
      sandbox: 'follow-global',
      status: 'active'
    });
    expect(missing).toMatchObject({
      id: 'legacy_missing',
      canonicalCwd: null,
      directoryState: 'missing'
    });

    db.close();
    db = undefined;
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const reopened = createProjectManager({ db, homeDir: tempDir });
    expect(reopened.getProject(created.id)).toMatchObject({
      id: created.id,
      name: 'Workspace',
      directoryState: 'available'
    });
    expect(reopened.getProject(missing.id)).toMatchObject({
      id: missing.id,
      directoryState: 'missing'
    });
  });

  it('rejects duplicate active canonical directories and detects a removed directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-project-'));
    const projectDir = join(tempDir, 'workspace');
    mkdirSync(projectDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    let nextId = 0;
    const manager = createProjectManager({
      db,
      idFactory: () => `project_${++nextId}`
    });

    const created = manager.createProject({ cwd: projectDir });
    let duplicateError: unknown;
    try {
      manager.createProject({ cwd: projectDir });
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toBeInstanceOf(ProjectManagerError);
    expect((duplicateError as ProjectManagerError).code).toBe('PROJECT_DIRECTORY_CONFLICT');

    rmSync(projectDir, { recursive: true });
    expect(manager.getProject(created.id)?.directoryState).toBe('missing');
  });

  it('returns SQLite UTC timestamps as timezone-qualified ISO values', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-project-timestamp-'));
    const projectDir = join(tempDir, 'workspace');
    mkdirSync(projectDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createProjectManager({
      db,
      idFactory: () => 'project_timestamp'
    });
    const project = manager.createProject({ cwd: projectDir });

    db.prepare(`
      UPDATE projects
      SET created_at = ?, updated_at = ?, archived_at = ?
      WHERE id = ?
    `).run(
      '2026-07-21 07:00:00',
      '2026-07-21 07:00:30',
      '2026-07-21 07:01:00',
      project.id
    );

    expect(manager.getProject(project.id)).toMatchObject({
      createdAt: '2026-07-21T07:00:00.000Z',
      updatedAt: '2026-07-21T07:00:30.000Z',
      archivedAt: '2026-07-21T07:01:00.000Z'
    });
  });
});
