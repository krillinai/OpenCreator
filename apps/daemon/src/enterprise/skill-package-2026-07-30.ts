import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rm
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  openPromise,
  type Entry,
  type ZipFile
} from 'yauzl';
import {
  isValidSkillId,
  parseSkillMarkdown
} from '../codex/skills/validator.js';
import { computeEnterpriseSkillContentDigest } from './skill-content-digest-2026-07-30.js';
import { ENTERPRISE_PACKAGE_MAX_BYTES } from './config-2026-07-30.js';

export const ENTERPRISE_ARCHIVE_MAX_ENTRIES = 2_048;
export const ENTERPRISE_ARCHIVE_MAX_EXPANDED_BYTES = 200 * 1024 * 1024;
export const ENTERPRISE_ARCHIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;

type ArchiveLimits = {
  maxEntries: number;
  maxExpandedBytes: number;
  maxFileBytes: number;
  maxPackageBytes: number;
};

type ArchivePath = {
  canonical: string;
  isDirectory: boolean;
};

export async function extractEnterpriseSkillPackage(input: {
  archivePath: string;
  extractionPath: string;
  expectedName: string;
  limits?: Partial<ArchiveLimits>;
}): Promise<{ sourcePath: string; contentSha256: string }> {
  const limits: ArchiveLimits = {
    maxEntries:
      input.limits?.maxEntries ?? ENTERPRISE_ARCHIVE_MAX_ENTRIES,
    maxExpandedBytes:
      input.limits?.maxExpandedBytes ??
      ENTERPRISE_ARCHIVE_MAX_EXPANDED_BYTES,
    maxFileBytes:
      input.limits?.maxFileBytes ?? ENTERPRISE_ARCHIVE_MAX_FILE_BYTES,
    maxPackageBytes:
      input.limits?.maxPackageBytes ?? ENTERPRISE_PACKAGE_MAX_BYTES
  };
  validateLimits(limits);

  await rm(input.extractionPath, { force: true, recursive: true });
  let zip: ZipFile | undefined;
  try {
    const archiveStat = await lstat(input.archivePath);
    if (
      archiveStat.isSymbolicLink() ||
      !archiveStat.isFile() ||
      archiveStat.size > limits.maxPackageBytes
    ) {
      throw invalidPackage('archive is not a bounded regular file');
    }
    if (!isValidSkillId(input.expectedName)) {
      throw invalidPackage('remote skill name is invalid');
    }

    await mkdir(input.extractionPath, { mode: 0o700, recursive: true });
    zip = await openPromise(input.archivePath, {
      autoClose: true,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true
    });
    if (zip.entryCount > limits.maxEntries) {
      throw invalidPackage('archive contains too many entries');
    }

    const paths = new Map<string, 'file' | 'directory'>();
    const extractedFiles: string[] = [];
    let entryCount = 0;
    let declaredExpandedBytes = 0;
    let actualExpandedBytes = 0;

    for await (const entry of zip.eachEntry()) {
      entryCount += 1;
      if (entryCount > limits.maxEntries) {
        throw invalidPackage('archive contains too many entries');
      }

      const archivePath = validateArchivePath(entry);
      assertEntryType(entry, archivePath.isDirectory);
      assertNoPathConflict(paths, archivePath);
      const targetPath = resolveExtractionTarget(
        input.extractionPath,
        archivePath.canonical
      );

      if (archivePath.isDirectory) {
        await mkdir(targetPath, { mode: 0o700, recursive: true });
        paths.set(archivePath.canonical, 'directory');
        continue;
      }

      if (
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.uncompressedSize > limits.maxFileBytes
      ) {
        throw invalidPackage('archive file exceeds the declared size limit');
      }
      declaredExpandedBytes += entry.uncompressedSize;
      if (declaredExpandedBytes > limits.maxExpandedBytes) {
        throw invalidPackage('archive exceeds the declared expanded size limit');
      }

      await mkdir(dirname(targetPath), { mode: 0o700, recursive: true });
      const written = await extractFileEntry({
        entry,
        maxActualBytes: Math.min(
          limits.maxFileBytes,
          limits.maxExpandedBytes - actualExpandedBytes
        ),
        targetPath,
        zip
      });
      actualExpandedBytes += written;
      if (actualExpandedBytes > limits.maxExpandedBytes) {
        throw invalidPackage('archive exceeds the expanded size limit');
      }
      paths.set(archivePath.canonical, 'file');
      extractedFiles.push(archivePath.canonical);
    }

    const sourcePath = await validateExtractedSkill({
      expectedName: input.expectedName,
      extractedFiles,
      extractionPath: input.extractionPath,
      paths
    });
    return {
      sourcePath,
      contentSha256: await computeEnterpriseSkillContentDigest(sourcePath)
    };
  } catch (error) {
    await rm(input.extractionPath, { force: true, recursive: true })
      .catch(() => undefined);
    if (
      error instanceof Error &&
      error.message.startsWith('ENTERPRISE_SKILL_PACKAGE_INVALID:')
    ) {
      throw error;
    }
    throw invalidPackage('archive could not be safely extracted');
  } finally {
    if (zip?.isOpen) zip.close();
  }
}

async function extractFileEntry(input: {
  entry: Entry;
  maxActualBytes: number;
  targetPath: string;
  zip: ZipFile;
}): Promise<number> {
  const stream = await input.zip.openReadStreamPromise(input.entry);
  const handle = await open(input.targetPath, 'wx', 0o600);
  let bytes = 0;
  let crc = 0xffffffff;
  try {
    for await (const chunk of stream) {
      const value = chunk as Buffer;
      bytes += value.byteLength;
      if (
        bytes > input.maxActualBytes ||
        bytes > input.entry.uncompressedSize
      ) {
        throw invalidPackage('archive file exceeds the actual size limit');
      }
      crc = updateCrc32(crc, value);
      await writeAll(handle, value);
    }
    if (
      bytes !== input.entry.uncompressedSize ||
      finalizeCrc32(crc) !== input.entry.crc32
    ) {
      throw invalidPackage('archive file integrity check failed');
    }
    return bytes;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function validateArchivePath(entry: Entry): ArchivePath {
  const name = entry.fileName;
  if (
    name.length === 0 ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    name.startsWith('//') ||
    /^[A-Za-z]:\//.test(name)
  ) {
    throw invalidPackage('archive entry path is unsafe');
  }

  const isDirectory = name.endsWith('/');
  const withoutTrailingSlash = isDirectory ? name.slice(0, -1) : name;
  const parts = withoutTrailingSlash.split('/');
  if (
    withoutTrailingSlash.length === 0 ||
    parts.some(part => part.length === 0 || part === '.' || part === '..')
  ) {
    throw invalidPackage('archive entry path is unsafe');
  }
  return {
    canonical: parts.join('/'),
    isDirectory
  };
}

function assertEntryType(entry: Entry, isDirectory: boolean): void {
  const platform = (entry.versionMadeBy >>> 8) & 0xff;
  const mode = platform === 3 ? (entry.externalFileAttributes >>> 16) : 0;
  const type = mode & 0o170000;
  if (isDirectory) {
    if (type !== 0 && type !== 0o040000) {
      throw invalidPackage('archive directory has an unsafe file type');
    }
    return;
  }
  if (type !== 0 && type !== 0o100000) {
    throw invalidPackage('archive entry is not a regular file');
  }
}

function assertNoPathConflict(
  paths: Map<string, 'file' | 'directory'>,
  path: ArchivePath
): void {
  if (paths.has(path.canonical)) {
    throw invalidPackage('archive contains a duplicate path');
  }
  const parts = path.canonical.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const parent = parts.slice(0, index).join('/');
    if (paths.get(parent) === 'file') {
      throw invalidPackage('archive path descends from a file');
    }
  }
  if (
    !path.isDirectory &&
    [...paths.keys()].some(existing => existing.startsWith(`${path.canonical}/`))
  ) {
    throw invalidPackage('archive file conflicts with a directory');
  }
}

function resolveExtractionTarget(root: string, canonical: string): string {
  const normalizedRoot = resolve(root);
  const target = resolve(root, ...canonical.split('/'));
  if (target === normalizedRoot || target.startsWith(`${normalizedRoot}${sep}`)) {
    return target;
  }
  throw invalidPackage('archive entry escapes the extraction directory');
}

async function validateExtractedSkill(input: {
  expectedName: string;
  extractedFiles: string[];
  extractionPath: string;
  paths: Map<string, 'file' | 'directory'>;
}): Promise<string> {
  const skillFiles = input.extractedFiles.filter(
    path => path === 'SKILL.md' || path.endsWith('/SKILL.md')
  );
  if (skillFiles.length !== 1) {
    throw invalidPackage('archive must contain exactly one SKILL.md');
  }

  const skillFile = skillFiles[0]!;
  let sourcePath: string;
  if (skillFile === 'SKILL.md') {
    sourcePath = input.extractionPath;
  } else {
    const parts = skillFile.split('/');
    if (parts.length !== 2 || parts[1] !== 'SKILL.md') {
      throw invalidPackage('archive has an invalid skill root');
    }
    const rootName = parts[0]!;
    if (
      rootName !== input.expectedName ||
      [...input.paths.keys()].some(
        path => path !== rootName && !path.startsWith(`${rootName}/`)
      )
    ) {
      throw invalidPackage('archive has multiple or mismatched roots');
    }
    sourcePath = join(input.extractionPath, rootName);
  }

  let parsed;
  try {
    parsed = parseSkillMarkdown(
      await readFile(join(sourcePath, 'SKILL.md'), 'utf8')
    );
  } catch {
    throw invalidPackage('SKILL.md could not be read');
  }
  if (!parsed.ok || parsed.metadata.name !== input.expectedName) {
    throw invalidPackage('SKILL.md metadata does not match the remote skill');
  }
  return sourcePath;
}

function validateLimits(limits: ArchiveLimits): void {
  if (
    !Number.isSafeInteger(limits.maxEntries) ||
    !Number.isSafeInteger(limits.maxExpandedBytes) ||
    !Number.isSafeInteger(limits.maxFileBytes) ||
    !Number.isSafeInteger(limits.maxPackageBytes) ||
    limits.maxEntries <= 0 ||
    limits.maxExpandedBytes <= 0 ||
    limits.maxFileBytes <= 0 ||
    limits.maxPackageBytes <= 0
  ) {
    throw invalidPackage('archive limits are invalid');
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  value: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const result = await handle.write(
      value,
      offset,
      value.byteLength - offset
    );
    offset += result.bytesWritten;
  }
}

function updateCrc32(current: number, buffer: Buffer): number {
  let value = current;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return value >>> 0;
}

function finalizeCrc32(value: number): number {
  return (value ^ 0xffffffff) >>> 0;
}

function invalidPackage(message: string): Error {
  return new Error(`ENTERPRISE_SKILL_PACKAGE_INVALID: ${message}`);
}
