import { createWriteStream, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { join, posix, resolve, sep, win32 } from 'node:path';
import { finished } from 'node:stream/promises';
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
  const downloadRoot = createPrivateDownloadRoot(workDir);
  const archivePath = resolve(downloadRoot, 'archive.tar.gz');
  const controller = new AbortController();
  let response: Response | undefined;

  try {
    response = await fetch(`https://codeload.github.com/${input.repository}/tar.gz/${input.commit}`, {
      signal: controller.signal
    });
    if (!response.ok) {
      await cancelResponseBody(response);
      abortQuietly(controller);
      throw new Error(`GitHub archive request failed with HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_MARKET_ARCHIVE_BYTES) {
      await cancelResponseBody(response);
      abortQuietly(controller);
      throw new Error(`GitHub archive exceeds ${MAX_MARKET_ARCHIVE_BYTES} bytes`);
    }
    if (response.body === null) throw new Error('GitHub archive response body is empty');

    await writeLimitedArchive(response.body, archivePath);
    const archiveIdentity = getArchiveIdentity(archivePath);
    await scanArchive(archivePath);
    assertArchiveIdentityUnchanged(archiveIdentity, archivePath);
    await extractArchive(archivePath, downloadRoot);
    return downloadRoot;
  } catch (error) {
    abortQuietly(controller);
    if (response !== undefined) await cancelResponseBody(response);
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

function createPrivateDownloadRoot(workDir: string): string {
  mkdirSync(workDir, { recursive: true });
  const root = mkdtempSync(join(workDir, '.market-download-'));
  chmodSync(root, 0o700);
  return resolve(root);
}

async function writeLimitedArchive(body: ReadableStream<Uint8Array>, archivePath: string): Promise<void> {
  let received = 0;
  const reader = body.getReader();
  const output = createWriteStream(archivePath, { flags: 'wx' });
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      received += chunk.byteLength;
      if (received > MAX_MARKET_ARCHIVE_BYTES) {
        await cancelReaderQuietly(reader);
        throw new Error(`GitHub archive exceeds ${MAX_MARKET_ARCHIVE_BYTES} bytes`);
      }
      await writeChunk(output, Buffer.from(chunk));
    }
    output.end();
    await finished(output);
    completed = true;
  } finally {
    if (!completed) {
      output.destroy();
      await cancelReaderQuietly(reader);
    }
    releaseReaderQuietly(reader);
  }
}

async function writeChunk(output: WriteStream, chunk: Buffer): Promise<void> {
  if (output.write(chunk)) return;
  await new Promise<void>((resolveWrite, rejectWrite) => {
    const cleanup = () => {
      output.off('drain', onDrain);
      output.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolveWrite();
    };
    const onError = (error: Error) => {
      cleanup();
      rejectWrite(error);
    };
    output.once('drain', onDrain);
    output.once('error', onError);
  });
}

async function cancelReaderQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Ignore cancellation failures so the primary error is preserved.
  }
}

function releaseReaderQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // Ignore lock release failures so the primary error is preserved.
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore cancellation failures so the primary error is preserved.
  }
}

function abortQuietly(controller: AbortController): void {
  try {
    if (!controller.signal.aborted) controller.abort();
  } catch {
    // Ignore abort failures so the primary error is preserved.
  }
}

type ArchiveIdentity = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
};

function getArchiveIdentity(archivePath: string): ArchiveIdentity {
  const stat = statSync(archivePath);
  if (!stat.isFile()) throw new Error(`archive path is not a file: ${archivePath}`);
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function assertArchiveIdentityUnchanged(expected: ArchiveIdentity, archivePath: string): void {
  const actual = getArchiveIdentity(archivePath);
  if (
    actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.size !== expected.size
    || actual.mtimeMs !== expected.mtimeMs
  ) {
    throw new Error('archive changed after validation and before extraction');
  }
}

async function scanArchive(archivePath: string): Promise<void> {
  let validationError: Error | undefined;
  await tar.t({
    file: archivePath,
    gzip: true,
    strict: true,
    filter(path, entry) {
      const canonical = canonicalizeArchiveEntry(path, entry);
      validationError ??= canonical instanceof Error ? canonical : undefined;
      return true;
    },
    onReadEntry(entry) {
      const canonical = canonicalizeArchiveEntry(entry.path, entry);
      validationError ??= canonical instanceof Error ? canonical : undefined;
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
      const canonical = canonicalizeArchiveEntry(path, entry);
      if (canonical instanceof Error) {
        validationError ??= canonical;
        return false;
      }
      if (canonical.strippedPath === undefined) return false;
      const outputPath = resolve(workDir, canonical.strippedPath);
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

type CanonicalArchiveEntry = {
  strippedPath: string | undefined;
};

function canonicalizeArchiveEntry(path: string, entry: unknown): CanonicalArchiveEntry | Error {
  const entryType = isObjectWithType(entry) ? entry.type : undefined;
  if (posix.isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
    return new Error(`archive entry uses an absolute path: ${path}`);
  }
  if (entryType === 'SymbolicLink' || entryType === 'Link') {
    return new Error(`archive entry link type is not allowed: ${path}`);
  }

  const segments = splitArchivePathSegments(path);
  if (segments.includes('..')) {
    return new Error(`archive entry contains .. path segment: ${path}`);
  }
  const strippedSegments = segments.slice(1);
  if (strippedSegments.length === 0) {
    if (entryType === 'Directory') return { strippedPath: undefined };
    return new Error(`archive entry has no output path after strip: ${path}`);
  }
  return { strippedPath: strippedSegments.join('/') };
}

function splitArchivePathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part.length > 0);
}

function isObjectWithType(value: unknown): value is { type: unknown } {
  return typeof value === 'object' && value !== null && 'type' in value;
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
