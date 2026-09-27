import { createHash } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const CACHE_VERSION = 1;
const HASH_BUFFER_BYTES = 1024 * 1024;

export type IntegrityFile = {
  key: string;
  path: string;
  sha256: string;
  expectedSize?: number;
};

export type FileIntegrityVerificationResult =
  | { verified: true; cacheHit: boolean }
  | {
      verified: false;
      key: string;
      reason: 'missing' | 'invalid' | 'hash_mismatch';
    };

type CachedFileMetadata = {
  key: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

type IntegrityCache = {
  version: number;
  identity: string;
  fingerprint: string;
  files: CachedFileMetadata[];
};

export function verifyFileIntegrityWithCache(input: {
  cachePath?: string;
  identity: string;
  fingerprint: string;
  files: IntegrityFile[];
}): FileIntegrityVerificationResult {
  const metadata = inspectFiles(input.files);
  if (metadata.invalidKey !== undefined) {
    return {
      verified: false,
      key: metadata.invalidKey,
      reason: metadata.invalidReason ?? 'invalid'
    };
  }

  const cached = input.cachePath === undefined
    ? undefined
    : readIntegrityCache(input.cachePath);
  if (
    cached !== undefined
    && cached.version === CACHE_VERSION
    && cached.identity === input.identity
    && cached.fingerprint === input.fingerprint
    && sameMetadata(cached.files, metadata.files)
  ) {
    return { verified: true, cacheHit: true };
  }

  for (const file of input.files) {
    if (hashFile(file.path) !== file.sha256.toLowerCase()) {
      return { verified: false, key: file.key, reason: 'hash_mismatch' };
    }
  }
  if (input.cachePath !== undefined) {
    writeIntegrityCache(input.cachePath, {
      version: CACHE_VERSION,
      identity: input.identity,
      fingerprint: input.fingerprint,
      files: metadata.files
    });
  }
  return { verified: true, cacheHit: false };
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function inspectFiles(files: IntegrityFile[]): {
  files: CachedFileMetadata[];
  invalidKey?: string;
  invalidReason?: 'missing' | 'invalid';
} {
  const metadata: CachedFileMetadata[] = [];
  for (const file of files) {
    try {
      const info = lstatSync(file.path);
      if (
        !info.isFile()
        || info.isSymbolicLink()
        || (file.expectedSize !== undefined && info.size !== file.expectedSize)
      ) {
        return { files: metadata, invalidKey: file.key, invalidReason: 'invalid' };
      }
      metadata.push({
        key: file.key,
        size: info.size,
        mtimeMs: info.mtimeMs,
        ctimeMs: info.ctimeMs
      });
    } catch {
      return { files: metadata, invalidKey: file.key, invalidReason: 'missing' };
    }
  }
  return { files: metadata };
}

function sameMetadata(left: CachedFileMetadata[], right: CachedFileMetadata[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((file, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && file.key === candidate.key
      && file.size === candidate.size
      && file.mtimeMs === candidate.mtimeMs
      && file.ctimeMs === candidate.ctimeMs;
  });
}

function readIntegrityCache(path: string): IntegrityCache | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!isRecord(value) || !Array.isArray(value.files)) return undefined;
    if (
      typeof value.version !== 'number'
      || typeof value.identity !== 'string'
      || typeof value.fingerprint !== 'string'
    ) {
      return undefined;
    }
    const files: CachedFileMetadata[] = [];
    for (const file of value.files) {
      if (
        !isRecord(file)
        || typeof file.key !== 'string'
        || typeof file.size !== 'number'
        || typeof file.mtimeMs !== 'number'
        || typeof file.ctimeMs !== 'number'
      ) {
        return undefined;
      }
      files.push({
        key: file.key,
        size: file.size,
        mtimeMs: file.mtimeMs,
        ctimeMs: file.ctimeMs
      });
    }
    return {
      version: value.version,
      identity: value.identity,
      fingerprint: value.fingerprint,
      files
    };
  } catch {
    return undefined;
  }
}

function writeIntegrityCache(path: string, cache: IntegrityCache): void {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
    rmSync(target, { force: true });
    renameSync(temporary, target);
  } catch {
    rmSync(temporary, { force: true });
  }
}

function hashFile(path: string): string {
  const digest = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  try {
    let bytesRead: number;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return digest.digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
