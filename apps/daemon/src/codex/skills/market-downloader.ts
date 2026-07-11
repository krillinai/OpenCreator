import { createWriteStream, existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { SkillMarketInstallSource } from '@clawee/skill-market';
import * as tar from 'tar';

export const MAX_MARKET_ARCHIVE_BYTES = 100 * 1024 * 1024;

type InstallableMarketSource = Extract<SkillMarketInstallSource, { available: true }>;
type MarketArchiveDownloadInput = Pick<InstallableMarketSource, 'repository' | 'commit'> & {
  workDir: string;
};

export type MarketArchiveDownloader = {
  download(input: MarketArchiveDownloadInput): Promise<string>;
};

export const MarketArchiveDownloader: MarketArchiveDownloader = {
  download
};

async function download(input: MarketArchiveDownloadInput): Promise<string> {
  const workDir = resolve(input.workDir);
  const archivePath = resolve(workDir, 'archive.tar.gz');

  try {
    mkdirSync(workDir, { recursive: true });
    const response = await fetch(`https://codeload.github.com/${input.repository}/tar.gz/${input.commit}`);
    if (!response.ok) {
      throw new Error(`GitHub archive request failed with HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_MARKET_ARCHIVE_BYTES) {
      throw new Error(`GitHub archive exceeds ${MAX_MARKET_ARCHIVE_BYTES} bytes`);
    }
    if (response.body === null) throw new Error('GitHub archive response body is empty');

    await writeLimitedArchive(response.body, archivePath);
    await scanArchive(archivePath);
    await extractArchive(archivePath, workDir);
    return workDir;
  } catch (error) {
    throw wrapMarketDownloadFailed(error);
  } finally {
    rmSync(archivePath, { force: true });
  }
}

export function resolveMarketSkillSource(root: string, skillPath: string): string {
  try {
    const rootPath = resolve(root);
    const target = resolve(rootPath, skillPath);
    assertPathInside(rootPath, target, 'skillPath escapes extracted archive root');
    if (!existsSync(rootPath)) throw new Error(`extracted archive root does not exist: ${root}`);
    const rootStat = lstatSync(rootPath);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error(`extracted archive root must be a real directory: ${root}`);
    }
    if (!existsSync(target)) throw new Error(`skillPath must resolve to a directory: ${skillPath}`);
    const targetStat = lstatSync(target);
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
      throw new Error(`skillPath must resolve to a directory: ${skillPath}`);
    }
    assertPathInside(
      realpathSync(rootPath),
      realpathSync(target),
      'skillPath escapes extracted archive root'
    );
    return target;
  } catch (error) {
    throw wrapMarketDownloadFailed(error);
  }
}

async function writeLimitedArchive(body: ReadableStream<Uint8Array>, archivePath: string): Promise<void> {
  let received = 0;
  const limited = Readable.fromWeb(body as NodeReadableStream<Uint8Array>).map((chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_MARKET_ARCHIVE_BYTES) {
      throw new Error(`GitHub archive exceeds ${MAX_MARKET_ARCHIVE_BYTES} bytes`);
    }
    return buffer;
  });
  await pipeline(limited, createWriteStream(archivePath, { flags: 'wx' }));
}

async function scanArchive(archivePath: string): Promise<void> {
  let validationError: Error | undefined;
  await tar.t({
    file: archivePath,
    gzip: true,
    strict: true,
    filter(path, entry) {
      const entryError = validateArchiveEntry(path, entry);
      validationError ??= entryError;
      return true;
    },
    onReadEntry(entry) {
      validationError ??= validateArchiveEntry(entry.path, entry);
    }
  });
  if (validationError) throw validationError;
}

async function extractArchive(archivePath: string, workDir: string): Promise<void> {
  let validationError: Error | undefined;
  await tar.x({
    file: archivePath,
    cwd: workDir,
    gzip: true,
    strip: 1,
    preservePaths: false,
    strict: true,
    unlink: true,
    filter(path, entry) {
      const entryError = validateArchiveEntry(path, entry);
      validationError ??= entryError;
      if (entryError) return false;
      const strippedPath = stripFirstPathSegment(path);
      if (strippedPath === undefined) return false;
      const outputPath = resolve(workDir, strippedPath);
      try {
        assertPathInside(workDir, outputPath, `archive entry escapes workDir after strip: ${path}`);
      } catch (error) {
        validationError ??= error instanceof Error ? error : new Error(String(error));
        return false;
      }
      return true;
    }
  });
  if (validationError) throw validationError;
}

function validateArchiveEntry(path: string, entry: unknown): Error | undefined {
  if (isAbsolute(path)) return new Error(`archive entry uses an absolute path: ${path}`);
  if (path.split('/').includes('..')) return new Error(`archive entry contains .. path segment: ${path}`);
  const entryType = isObjectWithType(entry) ? entry.type : undefined;
  if (entryType === 'SymbolicLink' || entryType === 'Link') {
    return new Error(`archive entry link type is not allowed: ${path}`);
  }
  return undefined;
}

function isObjectWithType(value: unknown): value is { type: unknown } {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function stripFirstPathSegment(path: string): string | undefined {
  const parts = path.split('/').filter((part) => part.length > 0);
  if (parts.length <= 1) return undefined;
  return parts.slice(1).join('/');
}

function assertPathInside(parent: string, target: string, message: string): void {
  const normalizedParent = resolve(parent);
  const normalizedTarget = resolve(target);
  const parentPrefix = normalizedParent.endsWith(sep) ? normalizedParent : `${normalizedParent}${sep}`;
  if (normalizedTarget === normalizedParent || normalizedTarget.startsWith(parentPrefix)) return;
  throw new Error(message);
}

function wrapMarketDownloadFailed(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith('CODEX_SKILL_MARKET_DOWNLOAD_FAILED:')) return error;
  return new Error('CODEX_SKILL_MARKET_DOWNLOAD_FAILED: failed to download market skill archive', {
    cause: error
  });
}
