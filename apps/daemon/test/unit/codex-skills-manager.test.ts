import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillManager } from '../../src/codex/skills/manager.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill manager', () => {
  it('removes a newly installed skill when the operation log write fails', async () => {
    const fixture = createFixture();
    const sourcePath = join(tempDir, 'new-source');
    writeSkill(sourcePath, 'test-skill', 'new');
    failOperationLogWrites(fixture.db);

    await expect(
      fixture.manager.installSkill({
        id: 'test-skill',
        sourcePath,
        confirmWriteToCodexHome: true
      })
    ).rejects.toThrow(/operation log write failed/);

    expect(existsSync(join(fixture.codexHome, 'skills', 'test-skill'))).toBe(false);
  });

  it('restores an overwritten skill when the operation log write fails', async () => {
    const fixture = createFixture();
    const oldSourcePath = join(tempDir, 'old-source');
    const newSourcePath = join(tempDir, 'new-source');
    writeSkill(oldSourcePath, 'test-skill', 'old');
    writeSkill(newSourcePath, 'test-skill', 'new');
    await fixture.manager.installSkill({
      id: 'test-skill',
      sourcePath: oldSourcePath,
      confirmWriteToCodexHome: true
    });
    failOperationLogWrites(fixture.db);

    await expect(
      fixture.manager.installSkill({
        id: 'test-skill',
        sourcePath: newSourcePath,
        overwrite: true,
        confirmWriteToCodexHome: true
      })
    ).rejects.toThrow(/operation log write failed/);

    expect(
      readFileSync(join(fixture.codexHome, 'skills', 'test-skill', 'SKILL.md'), 'utf8')
    ).toContain('old');
  });

  it('preserves operation log and rollback errors when both fail', async () => {
    const fixture = createFixture();
    const oldSourcePath = join(tempDir, 'old-source');
    const newSourcePath = join(tempDir, 'new-source');
    writeSkill(oldSourcePath, 'test-skill', 'old');
    writeSkill(newSourcePath, 'test-skill', 'new');
    await fixture.manager.installSkill({
      id: 'test-skill',
      sourcePath: oldSourcePath,
      confirmWriteToCodexHome: true
    });
    fixture.db.function('remove_skill_backups', () => {
      rmSync(join(fixture.codexHome, 'backups', 'skills'), { recursive: true, force: true });
      return null;
    });
    fixture.db.exec(`
      CREATE TRIGGER fail_skill_operation_insert
      BEFORE INSERT ON codex_skill_operations
      BEGIN
        SELECT remove_skill_backups();
        SELECT RAISE(ABORT, 'operation log write failed');
      END;
    `);

    let error: unknown;
    try {
      await fixture.manager.installSkill({
        id: 'test-skill',
        sourcePath: newSourcePath,
        overwrite: true,
        confirmWriteToCodexHome: true
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain('operation log write failed');
    expect((error as Error).message).toContain('rollback failed');
    expect((error as AggregateError).errors).toHaveLength(2);
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-manager-'));
  const codexHome = join(tempDir, 'codex-home');
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const manager = createSkillManager({
    codexHome: { path: codexHome, mode: 'global', source: 'default', writable: false },
    db
  });
  return { codexHome, db, manager };
}

function failOperationLogWrites(database: Database.Database): void {
  database.exec(`
    CREATE TRIGGER fail_skill_operation_insert
    BEFORE INSERT ON codex_skill_operations
    BEGIN
      SELECT RAISE(ABORT, 'operation log write failed');
    END;
  `);
}

function writeSkill(dir: string, id: string, marker: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    ['---', `name: ${id}`, `description: "${marker}"`, '---', '', marker].join('\n')
  );
}
