import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoSymlinks,
  deriveSkillId,
  isValidSkillId,
  parseSkillMarkdown
} from '../../src/codex/skills/validator.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex skill validator', () => {
  it('validates skill ids', () => {
    expect(isValidSkillId('brainstorming')).toBe(true);
    expect(isValidSkillId('team.skill_1')).toBe(true);
    expect(isValidSkillId('')).toBe(false);
    expect(isValidSkillId('.')).toBe(false);
    expect(isValidSkillId('..')).toBe(false);
    expect(isValidSkillId('../escape')).toBe(false);
    expect(isValidSkillId('bad/slash')).toBe(false);
    expect(isValidSkillId('bad\\slash')).toBe(false);
  });

  it('derives ids from request or source directory', () => {
    expect(deriveSkillId({ requestedId: 'explicit', sourcePath: '/tmp/source-name' })).toBe('explicit');
    expect(deriveSkillId({ sourcePath: '/tmp/source-name' })).toBe('source-name');
  });

  it('parses valid SKILL.md frontmatter', () => {
    const parsed = parseSkillMarkdown([
      '---',
      'name: brainstorming',
      'description: "Explore requirements"',
      '---',
      '',
      '# Body'
    ].join('\n'));

    expect(parsed).toEqual({
      ok: true,
      metadata: {
        name: 'brainstorming',
        description: 'Explore requirements'
      },
      diagnostics: []
    });
  });

  it('accepts multiline descriptions and additional YAML collections', () => {
    const parsed = parseSkillMarkdown([
      '---',
      'name: humanizer-zh',
      'description: |',
      '  第一行',
      '  第二行',
      'allowed-tools:',
      '  - Read',
      '  - Write',
      '---',
      ''
    ].join('\n'));

    expect(parsed).toMatchObject({
      ok: true,
      metadata: {
        name: 'humanizer-zh',
        description: '第一行\n第二行\n'
      }
    });
  });

  it('returns diagnostics for invalid SKILL.md frontmatter', () => {
    expect(parseSkillMarkdown('# Missing frontmatter')).toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining('frontmatter')]
    });
    expect(parseSkillMarkdown('---\nname:\n---\n')).toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining('name')]
    });
    expect(parseSkillMarkdown('---\nname: test\n---\n')).toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining('description')]
    });
  });

  it('rejects symlinks anywhere in a skill directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-skill-validator-'));
    const skillDir = join(tempDir, 'skill');
    const linkedTarget = join(tempDir, 'linked-target');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(linkedTarget);
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: test\ndescription: test\n---\n');
    symlinkSync(
      linkedTarget,
      join(skillDir, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expect(() => assertNoSymlinks(skillDir)).toThrow(/CODEX_SKILL_INVALID/);
  });
});
