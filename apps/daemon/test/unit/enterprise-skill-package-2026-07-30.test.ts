import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractEnterpriseSkillPackage
} from '../../src/enterprise/skill-package-2026-07-30.js';

const tempDirectories: string[] = [];
const skillMarkdown = [
  '---',
  'name: code-review',
  'description: Enterprise code review',
  '---',
  '',
  '# Code Review',
  ''
].join('\n');

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('enterprise skill package', () => {
  it.each([
    ['absolute path', [{ name: '/SKILL.md', data: skillMarkdown }]],
    ['windows drive path', [{ name: 'C:/SKILL.md', data: skillMarkdown }]],
    ['parent traversal', [{ name: '../SKILL.md', data: skillMarkdown }]],
    ['backslash path', [{ name: 'code-review\\SKILL.md', data: skillMarkdown }]],
    ['duplicate path', [
      { name: 'SKILL.md', data: skillMarkdown },
      { name: 'SKILL.md', data: skillMarkdown }
    ]],
    ['symlink', [
      { name: 'SKILL.md', data: skillMarkdown },
      { name: 'link', data: 'SKILL.md', mode: 0o120777 }
    ]],
    ['special file', [
      { name: 'SKILL.md', data: skillMarkdown },
      { name: 'pipe', data: '', mode: 0o010644 }
    ]],
    ['missing skill file', [{ name: 'README.md', data: 'missing' }]],
    ['multiple skill roots', [
      { name: 'a/SKILL.md', data: skillMarkdown },
      { name: 'b/SKILL.md', data: skillMarkdown }
    ]],
    ['metadata name mismatch', [{
      name: 'SKILL.md',
      data: skillMarkdown.replace('name: code-review', 'name: other-skill')
    }]],
    ['crc mismatch', [{
      name: 'SKILL.md',
      data: skillMarkdown,
      crc32: 0
    }]]
  ])('rejects unsafe archive: %s', async (_name, entries) => {
    const { archivePath, extractionPath } = createPackage(entries);

    await expect(extractEnterpriseSkillPackage({
      archivePath,
      expectedName: 'code-review',
      extractionPath
    })).rejects.toThrow('ENTERPRISE_SKILL_PACKAGE_INVALID');
    expect(existsSync(extractionPath)).toBe(false);
  });

  it('rejects entry and expanded size limits before install can begin', async () => {
    const tooMany = createPackage([
      { name: 'SKILL.md', data: skillMarkdown },
      { name: 'extra.txt', data: 'extra' }
    ]);
    await expect(extractEnterpriseSkillPackage({
      archivePath: tooMany.archivePath,
      expectedName: 'code-review',
      extractionPath: tooMany.extractionPath,
      limits: { maxEntries: 1 }
    })).rejects.toThrow('ENTERPRISE_SKILL_PACKAGE_INVALID');
    expect(existsSync(tooMany.extractionPath)).toBe(false);

    const tooLarge = createPackage([
      { name: 'SKILL.md', data: skillMarkdown }
    ]);
    await expect(extractEnterpriseSkillPackage({
      archivePath: tooLarge.archivePath,
      expectedName: 'code-review',
      extractionPath: tooLarge.extractionPath,
      limits: {
        maxExpandedBytes: 8,
        maxFileBytes: 8
      }
    })).rejects.toThrow('ENTERPRISE_SKILL_PACKAGE_INVALID');
    expect(existsSync(tooLarge.extractionPath)).toBe(false);
  });

  it('rejects a truncated archive and removes partial output', async () => {
    const input = createPackage([{ name: 'SKILL.md', data: skillMarkdown }]);
    const archive = readFileSync(input.archivePath);
    writeFileSync(input.archivePath, archive.subarray(0, archive.length - 12));

    await expect(extractEnterpriseSkillPackage({
      archivePath: input.archivePath,
      expectedName: 'code-review',
      extractionPath: input.extractionPath
    })).rejects.toThrow('ENTERPRISE_SKILL_PACKAGE_INVALID');
    expect(existsSync(input.extractionPath)).toBe(false);
  });

  it.each([
    ['root layout', [
      { name: 'SKILL.md', data: skillMarkdown },
      { name: 'scripts/run.ts', data: 'export const run = true;\n' }
    ]],
    ['single directory layout', [
      { name: 'code-review/', data: '', mode: 0o040755 },
      { name: 'code-review/SKILL.md', data: skillMarkdown },
      { name: 'code-review/scripts/run.ts', data: 'export const run = true;\n' }
    ]]
  ])('extracts a valid %s package', async (_name, entries) => {
    const input = createPackage(entries);

    const result = await extractEnterpriseSkillPackage({
      archivePath: input.archivePath,
      expectedName: 'code-review',
      extractionPath: input.extractionPath
    });

    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(result.sourcePath, 'SKILL.md'), 'utf8')).toBe(
      skillMarkdown
    );
  });
});

type ZipEntryInput = {
  name: string;
  data: string;
  mode?: number;
  crc32?: number;
};

function createPackage(entries: ZipEntryInput[]) {
  const directory = mkdtempSync(join(tmpdir(), 'opencreator-enterprise-package-'));
  tempDirectories.push(directory);
  const archivePath = join(directory, 'skill.zip');
  const extractionPath = join(directory, 'extracted');
  writeFileSync(archivePath, createZip(entries));
  return { archivePath, extractionPath };
}

function createZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.data, 'utf8');
    const checksum = entry.crc32 ?? crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(
      ((entry.mode ?? 0o100644) * 0x10000) >>> 0,
      38
    );
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}
