import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCodexSkills } from '../../src/codex/skills/scanner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skills scanner', () => {
  it('returns an empty list when skills directory does not exist', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-scan-'));
    const codexHome = join(tempDir, 'codex-home');

    expect(scanCodexSkills({
      codexHome: { path: codexHome, mode: 'isolated', source: 'isolated', writable: true }
    })).toMatchObject({
      codexHome,
      codexHomeMode: 'isolated',
      skillsPath: join(codexHome, 'skills'),
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: [],
      diagnostics: []
    });
  });

  it('scans valid and invalid skills without crashing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skills-scan-'));
    const codexHome = join(tempDir, 'codex-home');
    const validDir = join(codexHome, 'skills', 'valid-skill');
    const invalidDir = join(codexHome, 'skills', 'invalid-skill');
    mkdirSync(validDir, { recursive: true });
    mkdirSync(invalidDir, { recursive: true });
    writeFileSync(join(validDir, 'SKILL.md'), [
      '---',
      'name: valid-skill',
      'description: "A valid skill"',
      '---',
      ''
    ].join('\n'));
    writeFileSync(join(invalidDir, 'SKILL.md'), '# missing frontmatter');

    const result = scanCodexSkills({
      codexHome: { path: codexHome, mode: 'global', source: 'default', writable: false }
    });

    expect(result.skillsWritable).toBe(true);
    expect(result.requiresWriteConfirmation).toBe(true);
    expect(result.skills).toEqual([
      expect.objectContaining({
        id: 'invalid-skill',
        status: 'invalid',
        diagnostics: [expect.stringContaining('frontmatter')]
      }),
      expect.objectContaining({
        id: 'valid-skill',
        name: 'valid-skill',
        description: 'A valid skill',
        status: 'valid',
        diagnostics: []
      })
    ]);
  });
});
