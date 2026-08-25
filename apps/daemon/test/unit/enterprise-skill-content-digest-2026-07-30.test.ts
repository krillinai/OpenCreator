import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computeEnterpriseSkillContentDigest
} from '../../src/enterprise/skill-content-digest-2026-07-30.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('enterprise skill content digest', () => {
  it('hashes canonical file trees independent of creation order', async () => {
    const first = createDirectory();
    const second = createDirectory();
    writeTree(first, [
      ['SKILL.md', 'skill definition'],
      ['scripts/run.ts', 'export const run = true;\n'],
      ['assets/config.json', '{"enabled":true}\n']
    ]);
    writeTree(second, [
      ['assets/config.json', '{"enabled":true}\n'],
      ['scripts/run.ts', 'export const run = true;\n'],
      ['SKILL.md', 'skill definition']
    ]);

    const firstDigest = await computeEnterpriseSkillContentDigest(first);
    const secondDigest = await computeEnterpriseSkillContentDigest(second);

    expect(firstDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(secondDigest).toBe(firstDigest);
  });

  it('changes when path length or content changes', async () => {
    const base = createDirectory();
    const changedContent = createDirectory();
    const changedPath = createDirectory();
    writeTree(base, [['a.txt', 'same']]);
    writeTree(changedContent, [['a.txt', 'different']]);
    writeTree(changedPath, [['longer-name.txt', 'same']]);

    const digests = await Promise.all([
      computeEnterpriseSkillContentDigest(base),
      computeEnterpriseSkillContentDigest(changedContent),
      computeEnterpriseSkillContentDigest(changedPath)
    ]);

    expect(new Set(digests).size).toBe(3);
  });

  it('rejects symlinks and non-directory roots', async () => {
    const directory = createDirectory();
    const targetDirectory = join(directory, 'target');
    mkdirSync(targetDirectory);
    writeFileSync(join(targetDirectory, 'target.txt'), 'target');
    symlinkSync(
      targetDirectory,
      join(directory, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(
      computeEnterpriseSkillContentDigest(directory)
    ).rejects.toThrow('ENTERPRISE_SKILL_PACKAGE_INVALID');
    await expect(
      computeEnterpriseSkillContentDigest(join(directory, 'target.txt'))
    ).rejects.toThrow('ENTERPRISE_SKILL_PACKAGE_INVALID');
  });
});

function createDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'opencreator-enterprise-digest-'));
  directories.push(directory);
  return directory;
}

function writeTree(root: string, files: Array<[string, string]>): void {
  for (const [relativePath, content] of files) {
    const path = join(root, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
}
