import {
  chmodSync,
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  rmSync
} from 'node:fs';
import { join, posix, resolve, sep, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';
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
  let downloadRoot: string | undefined;
  let archivePath: string | undefined;
  const controller = new AbortController();
  let response: Response | undefined;
  let archiveFd: number | undefined;
  let succeeded = false;
  let failure: unknown;

  try {
    mkdirSync(workDir, { recursive: true });
    downloadRoot = mkdtempSync(join(workDir, '.market-download-'));
    chmodSync(downloadRoot, 0o700);
    archivePath = resolve(downloadRoot, 'archive.tar.gz');

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
    archiveFd = openSync(archivePath, 'r');
    rmSync(archivePath);
    const archiveIdentity = getArchiveIdentity(archiveFd);
    await scanArchive(archivePath, archiveFd);
    assertArchiveIdentityUnchanged(archiveIdentity, archiveFd);
    await extractArchive(archivePath, archiveFd, downloadRoot);
    succeeded = true;
    return downloadRoot;
  } catch (error) {
    failure = error;
    abortQuietly(controller);
    if (response !== undefined) await cancelResponseBody(response);
  } finally {
    if (archiveFd !== undefined) closeArchiveQuietly(archiveFd);
    let cleanupResult: CleanupResult | undefined;
    if (!succeeded && downloadRoot !== undefined) {
      cleanupResult = cleanupPrivateDownloadRoot(downloadRoot);
    }
    if (failure !== undefined) {
      throw wrapMarketDownloadFailed(failure, cleanupResult);
    }
  }
  throw wrapMarketDownloadFailed(new Error('market archive download ended without a result'));
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
  await pipeline(limitArchiveBytes(body), createWriteStream(archivePath, { flags: 'wx' }));
}

async function* limitArchiveBytes(body: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
  let received = 0;
  const reader = body.getReader();
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
      yield Buffer.from(chunk);
    }
    completed = true;
  } finally {
    if (!completed) await cancelReaderQuietly(reader);
    releaseReaderQuietly(reader);
  }
}

async function cancelReaderQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Ignore cancellation failures so the primary error is preserved.
  }
}

function closeArchiveQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // Ignore close failures so the primary error is preserved.
  }
}

type CleanupResult = {
  error?: unknown;
  residualPath?: string;
};

function cleanupPrivateDownloadRoot(root: string): CleanupResult {
  try {
    preparePathForRemoval(root);
    rmSync(root, { recursive: true, force: true });
    if (existsSync(root)) {
      return {
        error: new Error(`private download directory still exists: ${root}`),
        residualPath: root
      };
    }
    return {};
  } catch (error) {
    return { error, residualPath: root };
  }
}

function preparePathForRemoval(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) {
      preparePathForRemoval(join(path, entry));
    }
    chmodSync(path, 0o700);
    return;
  }
  chmodSync(path, 0o600);
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

function getArchiveIdentity(archiveFd: number): ArchiveIdentity {
  const stat = fstatSync(archiveFd);
  if (!stat.isFile()) throw new Error('archive handle is not a file');
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function assertArchiveIdentityUnchanged(expected: ArchiveIdentity, archiveFd: number): void {
  const actual = getArchiveIdentity(archiveFd);
  if (
    actual.dev !== expected.dev
    || actual.ino !== expected.ino
    || actual.size !== expected.size
    || actual.mtimeMs !== expected.mtimeMs
  ) {
    throw new Error('archive changed after validation and before extraction');
  }
}

async function scanArchive(archivePath: string, archiveFd: number): Promise<void> {
  let validationError: Error | undefined;
  await pipeline(
    createReadStream(archivePath, { fd: archiveFd, start: 0, autoClose: false }),
    tar.t({
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
    })
  );
  if (validationError) throw validationError;
}

async function extractArchive(archivePath: string, archiveFd: number, workDir: string): Promise<void> {
  let validationError: Error | undefined;
  await pipeline(
    createReadStream(archivePath, { fd: archiveFd, start: 0, autoClose: false }),
    tar.x({
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
    })
  );
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

function wrapMarketDownloadFailed(error: unknown, cleanup?: CleanupResult): Error {
  if (error instanceof Error && error.message.startsWith('CODEX_SKILL_MARKET_DOWNLOAD_FAILED:')) return error;
  const cleanupError = cleanup?.error;
  const residualMessage = cleanup?.residualPath ? `; cleanup residual path: ${cleanup.residualPath}` : '';
  return new Error(`CODEX_SKILL_MARKET_DOWNLOAD_FAILED: failed to download market skill archive${residualMessage}`, {
    cause: cleanupError === undefined
      ? error
      : new AggregateError([error, cleanupError], 'market archive download failed and cleanup was incomplete')
  });
}
