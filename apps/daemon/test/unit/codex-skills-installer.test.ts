import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkillInstaller } from '../../src/codex/skills/installer.js';

let tempDir = '';

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.resetModules();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skills installer', () => {
  it('installs a local skill directory into CODEX_HOME skills', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    const result = await installer.install({ sourcePath: source, id: 'writer' });

    expect(result.backupPath).toBeNull();
    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('first');
  });

  it('rejects duplicates unless overwrite is true', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-install-'));
    const first = createSourceSkill('writer-first', 'first');
    const second = createSourceSkill('writer-second', 'second');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    await installer.install({ sourcePath: first, id: 'writer' });
    await expect(installer.install({ sourcePath: second, id: 'writer' })).rejects.toThrow(/CODEX_SKILL_EXISTS/);

    const overwritten = await installer.install({ sourcePath: second, id: 'writer', overwrite: true });
    expect(overwritten.backupPath).toEqual(expect.stringContaining('backups'));
    expect(existsSync(overwritten.backupPath ?? '')).toBe(true);
    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('second');
  });

  it('deletes a skill after backing it up', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    await installer.install({ sourcePath: source, id: 'writer' });
    const deleted = await installer.delete('writer');

    expect(deleted.backupPath).toEqual(expect.stringContaining('backups'));
    expect(existsSync(deleted.backupPath ?? '')).toBe(true);
    expect(existsSync(join(codexHome, 'skills', 'writer'))).toBe(false);
  });

  it('rolls back a fresh install or restores an overwritten backup', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-rollback-'));
    const first = createSourceSkill('writer-first', 'first');
    const second = createSourceSkill('writer-second', 'second');
    const freshSource = createSourceSkill('fresh-source', 'fresh');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    const fresh = await installer.install({ sourcePath: freshSource, id: 'fresh' });
    await installer.rollback({ id: 'fresh', backupPath: fresh.backupPath });
    expect(existsSync(join(codexHome, 'skills', 'fresh'))).toBe(false);

    await installer.install({ sourcePath: first, id: 'writer' });
    const overwritten = await installer.install({
      sourcePath: second,
      id: 'writer',
      overwrite: true
    });
    await installer.rollback({
      id: 'writer',
      backupPath: overwritten.backupPath
    });

    expect(
      readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')
    ).toContain('first');
  });

  it('keeps the current skill when rollback backup is missing', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-rollback-'));
    const current = createSourceSkill('writer-current', 'current');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    await installer.install({ sourcePath: current, id: 'writer' });
    await expect(installer.rollback({
      id: 'writer',
      backupPath: join(tempDir, 'missing-backup')
    })).rejects.toThrow(/CODEX_SKILL_WRITE_FAILED/);

    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('current');
  });

  it('keeps the current skill when rollback backup contains a symlink', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-rollback-'));
    const current = createSourceSkill('writer-current', 'current');
    const backup = createSourceSkill('writer-backup', 'backup');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });
    const linkedDirectory = join(backup, 'linked');
    symlinkSync(
      backup,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await installer.install({ sourcePath: current, id: 'writer' });
    await expect(installer.rollback({
      id: 'writer',
      backupPath: backup
    })).rejects.toThrow(/CODEX_SKILL_WRITE_FAILED/);

    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('current');
  });

  it('restores the current skill when applying a prepared rollback backup fails', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-rollback-'));
    const current = createSourceSkill('writer-current', 'current');
    const backup = createSourceSkill('writer-backup', 'backup');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });
    await installer.install({ sourcePath: current, id: 'writer' });

    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      let currentSnapshotCreated = false;
      return {
        ...actual,
        renameSync(source: string, target: string) {
          if (String(target).includes('.tmp-rollback-current-')) {
            currentSnapshotCreated = true;
            return actual.renameSync(source, target);
          }
          if (
            currentSnapshotCreated
            && String(source).includes('.tmp-rollback-')
            && !String(source).includes('.tmp-rollback-current-')
          ) {
            throw new Error('simulated rollback apply rename failure');
          }
          return actual.renameSync(source, target);
        }
      };
    });
    const { createSkillInstaller: createMockedSkillInstaller } = await import('../../src/codex/skills/installer.js');
    const mockedInstaller = createMockedSkillInstaller({ codexHome });

    await expect(mockedInstaller.rollback({
      id: 'writer',
      backupPath: backup
    })).rejects.toThrow(/CODEX_SKILL_WRITE_FAILED/);

    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('current');
  });

  it('rejects a sourcePath directory that is a symlink', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const linkedSource = join(tempDir, 'linked-writer');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });
    symlinkSync(
      source,
      linkedSource,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(installer.install({ sourcePath: linkedSource, id: 'writer' })).rejects.toThrow(/CODEX_SKILL_INVALID/);
  });
});

function createSourceSkill(id: string, marker: string): string {
  const source = join(tempDir, id);
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'SKILL.md'), [
    '---',
    `name: ${id}`,
    `description: "${marker}"`,
    '---',
    '',
    marker
  ].join('\n'));
  return source;
}
