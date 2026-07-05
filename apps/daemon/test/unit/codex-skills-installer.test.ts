import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillInstaller } from '../../src/codex/skills/installer.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skills installer', () => {
  it('installs a local skill directory into CODEX_HOME skills', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    const result = await installer.install({ sourcePath: source, id: 'writer' });

    expect(result.backupPath).toBeNull();
    expect(readFileSync(join(codexHome, 'skills', 'writer', 'SKILL.md'), 'utf8')).toContain('first');
  });

  it('rejects duplicates unless overwrite is true', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
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
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });

    await installer.install({ sourcePath: source, id: 'writer' });
    const deleted = await installer.delete('writer');

    expect(deleted.backupPath).toEqual(expect.stringContaining('backups'));
    expect(existsSync(deleted.backupPath ?? '')).toBe(true);
    expect(existsSync(join(codexHome, 'skills', 'writer'))).toBe(false);
  });

  it('rejects a sourcePath directory that is a symlink', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-skills-install-'));
    const source = createSourceSkill('writer', 'first');
    const linkedSource = join(tempDir, 'linked-writer');
    const codexHome = join(tempDir, 'codex-home');
    const installer = createSkillInstaller({ codexHome });
    symlinkSync(source, linkedSource);

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
