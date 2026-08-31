import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  CreatorYtDlpStatus,
  RuntimeErrorCode
} from '@opencreator/protocol';
import {
  readPrivateJsonFile,
  writePrivateJsonFile
} from '../../config/private-json-file.js';
import { fetchCreatorService } from '../../creator-services/upstream-fetch.js';
import type { YtDlpRuntime } from './runtime.js';

const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;
const CHECK_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_RELEASE_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_YT_DLP_BYTES = 16 * 1024 * 1024;
const NIGHTLY_RELEASE_URL =
  'https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest';
const NIGHTLY_ASSET_PATH =
  /^\/yt-dlp\/yt-dlp-nightly-builds\/releases\/download\/[^/]+\/yt-dlp$/;
const NIGHTLY_VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d{6}$/;
const SHA256 = /^[a-f0-9]{64}$/;

type ReleaseDescriptor = {
  version: string;
  sha256: string;
  url: string;
  publishedAt: string;
};

type ActiveRuntimeRecord = ReleaseDescriptor & {
  installedAt: string;
};

type UpdateState = {
  version: 1;
  active?: ActiveRuntimeRecord;
  latest?: ReleaseDescriptor;
  lastCheckedAt?: string;
  lastCheckAttemptAt?: string;
};

export type YtDlpUpdateManager = {
  getRuntime(): YtDlpRuntime;
  status(): CreatorYtDlpStatus;
  check(input?: { force?: boolean }): Promise<CreatorYtDlpStatus>;
  update(): Promise<CreatorYtDlpStatus>;
};

export class YtDlpUpdateError extends Error {
  constructor(
    readonly code: Extract<
      RuntimeErrorCode,
      | 'creator_yt_dlp_update_check_failed'
      | 'creator_yt_dlp_update_download_failed'
      | 'creator_yt_dlp_update_verification_failed'
      | 'creator_yt_dlp_update_storage_failed'
    >,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'YtDlpUpdateError';
  }
}

export async function createYtDlpUpdateManager(input: {
  root: string;
  bundledRuntime: YtDlpRuntime;
  readProxy(): Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  checkIntervalMs?: number;
}): Promise<YtDlpUpdateManager> {
  if (input.bundledRuntime.script === undefined) {
    throw new Error('yt-dlp updates require the portable Python runtime');
  }
  const manager = new DefaultYtDlpUpdateManager(input);
  await manager.initialize();
  return manager;
}

class DefaultYtDlpUpdateManager implements YtDlpUpdateManager {
  private readonly root: string;
  private readonly statePath: string;
  private readonly versionsRoot: string;
  private readonly now: () => Date;
  private readonly checkIntervalMs: number;
  private state: UpdateState = { version: 1 };
  private activeRuntime: YtDlpRuntime | undefined;
  private checkPending: Promise<CreatorYtDlpStatus> | undefined;
  private updatePending: Promise<CreatorYtDlpStatus> | undefined;

  constructor(private readonly input: {
    root: string;
    bundledRuntime: YtDlpRuntime;
    readProxy(): Promise<string>;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    checkIntervalMs?: number;
  }) {
    this.root = resolve(input.root);
    this.statePath = join(this.root, 'state.json');
    this.versionsRoot = join(this.root, 'versions');
    this.now = input.now ?? (() => new Date());
    this.checkIntervalMs = input.checkIntervalMs ?? CHECK_INTERVAL_MS;
  }

  async initialize(): Promise<void> {
    this.state = parseState(await readPrivateJsonFile(this.statePath).catch(() => undefined));
    const active = this.state.active;
    if (active === undefined) return;
    const path = this.versionPath(active.version);
    try {
      if (await hashFile(path) !== active.sha256) {
        throw new Error('managed yt-dlp hash mismatch');
      }
      const runtime = runtimeWithScript(this.input.bundledRuntime, path, active.version);
      await verifyRuntime(runtime, active.version);
      this.activeRuntime = runtime;
    } catch {
      this.state = { ...this.state, active: undefined };
      await this.persistState().catch(() => undefined);
    }
  }

  getRuntime(): YtDlpRuntime {
    return this.activeRuntime ?? this.input.bundledRuntime;
  }

  status(): CreatorYtDlpStatus {
    const current = this.getRuntime();
    return {
      channel: 'nightly',
      source: this.activeRuntime === undefined ? 'bundled' : 'managed',
      currentVersion: current.version,
      bundledVersion: this.input.bundledRuntime.version,
      latestVersion: this.state.latest?.version ?? null,
      updateAvailable: this.state.latest !== undefined
        && compareVersions(this.state.latest.version, current.version) > 0,
      checkDue: isCheckDue(
        this.state.lastCheckAttemptAt,
        this.now(),
        this.checkIntervalMs
      ),
      lastCheckedAt: this.state.lastCheckedAt ?? null,
      lastCheckAttemptAt: this.state.lastCheckAttemptAt ?? null,
      installedAt: this.state.active?.installedAt ?? null
    };
  }

  check(input: { force?: boolean } = {}): Promise<CreatorYtDlpStatus> {
    if (!input.force && !this.status().checkDue) {
      return Promise.resolve(this.status());
    }
    this.checkPending ??= this.performCheck().finally(() => {
      this.checkPending = undefined;
    });
    return this.checkPending;
  }

  update(): Promise<CreatorYtDlpStatus> {
    this.updatePending ??= this.performUpdate().finally(() => {
      this.updatePending = undefined;
    });
    return this.updatePending;
  }

  private async performCheck(): Promise<CreatorYtDlpStatus> {
    const attemptedAt = this.now().toISOString();
    try {
      const latest = await this.fetchLatestRelease();
      const nextState = {
        ...this.state,
        latest,
        lastCheckAttemptAt: attemptedAt,
        lastCheckedAt: attemptedAt
      };
      await this.persistState(nextState);
      this.state = nextState;
      return this.status();
    } catch (error) {
      const failedState = { ...this.state, lastCheckAttemptAt: attemptedAt };
      try {
        await this.persistState(failedState);
        this.state = failedState;
      } catch {
        // Keep the last durable state when the failed check cannot be recorded.
      }
      if (error instanceof YtDlpUpdateError) throw error;
      throw new YtDlpUpdateError(
        'creator_yt_dlp_update_check_failed',
        `Unable to check the latest yt-dlp nightly release: ${errorMessage(error)}`,
        502
      );
    }
  }

  private async performUpdate(): Promise<CreatorYtDlpStatus> {
    await this.check({ force: true });
    const latest = this.state.latest;
    if (
      latest === undefined
      || compareVersions(latest.version, this.getRuntime().version) <= 0
    ) {
      return this.status();
    }

    const staging = join(this.versionsRoot, `.update-${randomUUID()}`);
    const stagedScript = join(staging, 'yt-dlp');
    let uncommittedVersionRoot: string | undefined;
    try {
      const content = await this.downloadRelease(latest);
      if (sha256(content) !== latest.sha256) {
        throw new YtDlpUpdateError(
          'creator_yt_dlp_update_verification_failed',
          'Downloaded yt-dlp failed SHA-256 verification',
          422
        );
      }
      await mkdir(staging, { recursive: true, mode: 0o700 });
      await writeFile(stagedScript, content, { mode: 0o600 });
      await verifyRuntime(
        runtimeWithScript(this.input.bundledRuntime, stagedScript, latest.version),
        latest.version
      );

      const versionRoot = join(this.versionsRoot, latest.version);
      await rm(versionRoot, { recursive: true, force: true });
      await rename(staging, versionRoot);
      uncommittedVersionRoot = versionRoot;
      const installedAt = this.now().toISOString();
      const nextState = {
        ...this.state,
        active: { ...latest, installedAt }
      };
      await this.persistState(nextState);
      this.state = nextState;
      this.activeRuntime = runtimeWithScript(
        this.input.bundledRuntime,
        this.versionPath(latest.version),
        latest.version
      );
      uncommittedVersionRoot = undefined;
      await this.removeInactiveVersions(latest.version).catch(() => undefined);
      return this.status();
    } catch (error) {
      if (uncommittedVersionRoot !== undefined) {
        await rm(uncommittedVersionRoot, {
          recursive: true,
          force: true
        }).catch(() => undefined);
      }
      if (error instanceof YtDlpUpdateError) throw error;
      if (isFileSystemError(error)) {
        throw new YtDlpUpdateError(
          'creator_yt_dlp_update_storage_failed',
          `Unable to store the yt-dlp update: ${errorMessage(error)}`,
          500
        );
      }
      throw new YtDlpUpdateError(
        'creator_yt_dlp_update_verification_failed',
        `Unable to verify the yt-dlp update: ${errorMessage(error)}`,
        422
      );
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchLatestRelease(): Promise<ReleaseDescriptor> {
    const response = await fetchWithLimit({
      url: NIGHTLY_RELEASE_URL,
      proxy: await this.input.readProxy(),
      timeoutMs: CHECK_TIMEOUT_MS,
      maxBytes: MAX_RELEASE_RESPONSE_BYTES,
      fetchImpl: this.input.fetchImpl,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'OpenCreator-yt-dlp-updater',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub release API returned HTTP ${response.status}`);
    }
    const payload = JSON.parse(response.body.toString('utf8')) as unknown;
    return parseLatestRelease(payload);
  }

  private async downloadRelease(release: ReleaseDescriptor): Promise<Buffer> {
    try {
      const response = await fetchWithLimit({
        url: release.url,
        proxy: await this.input.readProxy(),
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        maxBytes: MAX_YT_DLP_BYTES,
        fetchImpl: this.input.fetchImpl,
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': 'OpenCreator-yt-dlp-updater'
        }
      });
      if (!response.ok) {
        throw new Error(`release asset returned HTTP ${response.status}`);
      }
      return response.body;
    } catch (error) {
      throw new YtDlpUpdateError(
        'creator_yt_dlp_update_download_failed',
        `Unable to download the yt-dlp update: ${errorMessage(error)}`,
        502
      );
    }
  }

  private versionPath(version: string): string {
    return join(this.versionsRoot, version, 'yt-dlp');
  }

  private async persistState(state: UpdateState = this.state): Promise<void> {
    try {
      await writePrivateJsonFile(this.statePath, state);
    } catch (error) {
      throw new YtDlpUpdateError(
        'creator_yt_dlp_update_storage_failed',
        `Unable to save yt-dlp update state: ${errorMessage(error)}`,
        500
      );
    }
  }

  private async removeInactiveVersions(activeVersion: string): Promise<void> {
    const entries = await readdir(this.versionsRoot, { withFileTypes: true })
      .catch(() => []);
    await Promise.all(entries
      .filter(entry => entry.isDirectory() && entry.name !== activeVersion)
      .map(entry => rm(join(this.versionsRoot, entry.name), {
        recursive: true,
        force: true
      })));
  }
}

function runtimeWithScript(
  bundled: YtDlpRuntime,
  script: string,
  version: string
): YtDlpRuntime {
  if (bundled.script === undefined) {
    throw new Error('portable yt-dlp script is unavailable');
  }
  const scriptIndex = bundled.prefixArgs.lastIndexOf(bundled.script);
  if (scriptIndex < 0) {
    throw new Error('portable yt-dlp invocation is invalid');
  }
  const prefixArgs = [...bundled.prefixArgs];
  prefixArgs[scriptIndex] = script;
  return {
    ...bundled,
    version,
    prefixArgs,
    script
  };
}

function verifyRuntime(runtime: YtDlpRuntime, expectedVersion: string): Promise<void> {
  return new Promise((resolveVerification, rejectVerification) => {
    execFile(
      runtime.executable,
      [...runtime.prefixArgs, '--version'],
      {
        env: { ...process.env, ...runtime.env },
        encoding: 'utf8',
        timeout: 20_000,
        windowsHide: true
      },
      (error, stdout) => {
        if (error !== null) {
          rejectVerification(error);
          return;
        }
        const actual = stdout.trim();
        if (actual !== expectedVersion) {
          rejectVerification(new Error(
            `yt-dlp returned ${actual || 'an empty version'} instead of ${expectedVersion}`
          ));
          return;
        }
        resolveVerification();
      }
    );
  });
}

async function fetchWithLimit(input: {
  url: string;
  proxy: string;
  timeoutMs: number;
  maxBytes: number;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; body: Buffer }> {
  const response = await fetchCreatorService({
    endpoint: new URL(input.url),
    method: 'GET',
    headers: input.headers,
    proxy: input.proxy,
    signal: AbortSignal.timeout(input.timeoutMs),
    maxResponseBytes: input.maxBytes,
    fetchImpl: input.fetchImpl
  });
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > input.maxBytes) {
    throw new Error('response is too large');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > input.maxBytes) throw new Error('response is too large');
  return { ok: response.ok, status: response.status, body };
}

function parseLatestRelease(value: unknown): ReleaseDescriptor {
  if (!isRecord(value) || !NIGHTLY_VERSION.test(String(value.tag_name))) {
    throw new YtDlpUpdateError(
      'creator_yt_dlp_update_verification_failed',
      'GitHub returned an invalid yt-dlp nightly release',
      422
    );
  }
  const version = String(value.tag_name);
  const publishedAt = typeof value.published_at === 'string'
    ? value.published_at
    : '';
  const assets = Array.isArray(value.assets) ? value.assets : [];
  const asset = assets.find(candidate => (
    isRecord(candidate) && candidate.name === 'yt-dlp'
  ));
  const digest = isRecord(asset) && typeof asset.digest === 'string'
    ? asset.digest
    : '';
  const url = isRecord(asset) && typeof asset.browser_download_url === 'string'
    ? asset.browser_download_url
    : '';
  const sha = digest.startsWith('sha256:') ? digest.slice(7).toLowerCase() : '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw invalidReleaseAsset();
  }
  if (
    !SHA256.test(sha)
    || parsedUrl.protocol !== 'https:'
    || parsedUrl.hostname !== 'github.com'
    || !NIGHTLY_ASSET_PATH.test(parsedUrl.pathname)
    || !Number.isFinite(Date.parse(publishedAt))
  ) {
    throw invalidReleaseAsset();
  }
  return {
    version,
    sha256: sha,
    url: parsedUrl.toString(),
    publishedAt
  };
}

function invalidReleaseAsset(): YtDlpUpdateError {
  return new YtDlpUpdateError(
    'creator_yt_dlp_update_verification_failed',
    'GitHub returned an invalid yt-dlp nightly asset',
    422
  );
}

function parseState(value: unknown): UpdateState {
  if (!isRecord(value) || value.version !== 1) return { version: 1 };
  return {
    version: 1,
    ...(parseActive(value.active) === undefined
      ? {}
      : { active: parseActive(value.active) }),
    ...(parseRelease(value.latest) === undefined
      ? {}
      : { latest: parseRelease(value.latest) }),
    ...(typeof value.lastCheckedAt === 'string'
      ? { lastCheckedAt: value.lastCheckedAt }
      : {}),
    ...(typeof value.lastCheckAttemptAt === 'string'
      ? { lastCheckAttemptAt: value.lastCheckAttemptAt }
      : {})
  };
}

function parseActive(value: unknown): ActiveRuntimeRecord | undefined {
  const release = parseRelease(value);
  if (
    release === undefined
    || !isRecord(value)
    || typeof value.installedAt !== 'string'
  ) {
    return undefined;
  }
  return { ...release, installedAt: value.installedAt };
}

function parseRelease(value: unknown): ReleaseDescriptor | undefined {
  if (
    !isRecord(value)
    || typeof value.version !== 'string'
    || !NIGHTLY_VERSION.test(value.version)
    || typeof value.sha256 !== 'string'
    || !SHA256.test(value.sha256)
    || typeof value.url !== 'string'
    || typeof value.publishedAt !== 'string'
  ) {
    return undefined;
  }
  return {
    version: value.version,
    sha256: value.sha256,
    url: value.url,
    publishedAt: value.publishedAt
  };
}

function isCheckDue(
  lastAttemptAt: string | undefined,
  now: Date,
  intervalMs: number
): boolean {
  if (lastAttemptAt === undefined) return true;
  const lastAttempt = Date.parse(lastAttemptAt);
  return !Number.isFinite(lastAttempt)
    || now.getTime() - lastAttempt >= intervalMs;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

async function hashFile(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileSystemError(error: unknown): boolean {
  return isRecord(error)
    && typeof error.code === 'string'
    && ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'ENOENT'].includes(error.code);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
