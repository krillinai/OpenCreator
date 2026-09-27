import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createYtDlpUpdateManager,
  type YtDlpUpdateManager
} from '../../src/creator/yt-dlp/update-manager.js';
import type { YtDlpRuntime } from '../../src/creator/yt-dlp/runtime.js';

const BUNDLED_VERSION = '2026.08.29.232711';
const LATEST_VERSION = '2026.08.31.120000';
let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('yt-dlp update manager', () => {
  it('uses the bundled runtime and checks at most once per interval', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    const release = releaseFixture(LATEST_VERSION);
    const fetchImpl = releaseFetch(release);
    let now = new Date('2026-08-31T00:00:00.000Z');
    const manager = await createYtDlpUpdateManager({
      root: join(root, 'updates'),
      bundledRuntime,
      readProxy: async () => '',
      fetchImpl,
      now: () => now
    });

    expect(manager.status()).toMatchObject({
      source: 'bundled',
      currentVersion: BUNDLED_VERSION,
      bundledVersion: BUNDLED_VERSION,
      latestVersion: null,
      updateAvailable: false,
      checkDue: true
    });

    await manager.check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(manager.status()).toMatchObject({
      latestVersion: LATEST_VERSION,
      updateAvailable: true,
      checkDue: false,
      lastCheckedAt: '2026-08-31T00:00:00.000Z'
    });

    await manager.check();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now = new Date('2026-09-07T00:00:00.000Z');
    await manager.check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('verifies, activates, and restores a managed runtime without restarting', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    const release = releaseFixture(LATEST_VERSION);
    const fetchImpl = releaseFetch(release);
    const updatesRoot = join(root, 'updates');
    const manager = await createManager(updatesRoot, bundledRuntime, fetchImpl);

    await manager.update();

    expect(manager.status()).toMatchObject({
      source: 'managed',
      currentVersion: LATEST_VERSION,
      bundledVersion: BUNDLED_VERSION,
      latestVersion: LATEST_VERSION,
      updateAvailable: false,
      installedAt: '2026-08-31T00:00:00.000Z'
    });
    expect(manager.getRuntime()).toMatchObject({
      version: LATEST_VERSION,
      executable: process.execPath,
      script: join(updatesRoot, 'versions', LATEST_VERSION, 'yt-dlp')
    });
    expect(manager.getRuntime().script).not.toBe(bundledRuntime.script);

    const restored = await createManager(updatesRoot, bundledRuntime, fetchImpl);
    expect(restored.status()).toMatchObject({
      source: 'managed',
      currentVersion: LATEST_VERSION,
      installedAt: '2026-08-31T00:00:00.000Z'
    });
    expect(restored.getRuntime().script).toBe(
      join(updatesRoot, 'versions', LATEST_VERSION, 'yt-dlp')
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('follows trusted GitHub asset redirects before verifying the download', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    const release = releaseFixture(LATEST_VERSION);
    const redirectedUrl =
      `https://release-assets.githubusercontent.com/download/${LATEST_VERSION}/yt-dlp`;
    const fetchImpl = redirectingReleaseFetch(release, redirectedUrl);
    const manager = await createManager(
      join(root, 'updates'),
      bundledRuntime,
      fetchImpl
    );

    await manager.update();

    expect(manager.status()).toMatchObject({
      source: 'managed',
      currentVersion: LATEST_VERSION,
      updateAvailable: false
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects update redirects outside trusted GitHub asset hosts', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    const release = releaseFixture(LATEST_VERSION);
    const manager = await createManager(
      join(root, 'updates'),
      bundledRuntime,
      redirectingReleaseFetch(release, 'https://example.com/yt-dlp')
    );

    await expect(manager.update()).rejects.toMatchObject({
      code: 'creator_yt_dlp_update_download_failed'
    });
    expect(manager.status()).toMatchObject({
      source: 'bundled',
      currentVersion: BUNDLED_VERSION,
      updateAvailable: true
    });
  });

  it('keeps the bundled runtime when the downloaded digest does not match', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    const release = {
      ...releaseFixture(LATEST_VERSION),
      sha256: '0'.repeat(64)
    };
    const updatesRoot = join(root, 'updates');
    const manager = await createManager(
      updatesRoot,
      bundledRuntime,
      releaseFetch(release)
    );

    await expect(manager.update()).rejects.toMatchObject({
      code: 'creator_yt_dlp_update_verification_failed'
    });
    expect(manager.status()).toMatchObject({
      source: 'bundled',
      currentVersion: BUNDLED_VERSION,
      latestVersion: LATEST_VERSION,
      updateAvailable: true,
      installedAt: null
    });
    await expect(stat(
      join(updatesRoot, 'versions', LATEST_VERSION, 'yt-dlp')
    )).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('falls back to the bundled runtime when a managed script is modified', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    const release = releaseFixture(LATEST_VERSION);
    const updatesRoot = join(root, 'updates');
    const fetchImpl = releaseFetch(release);
    const manager = await createManager(updatesRoot, bundledRuntime, fetchImpl);
    await manager.update();

    await writeFile(manager.getRuntime().script!, 'modified');
    const restored = await createManager(updatesRoot, bundledRuntime, fetchImpl);

    expect(restored.status()).toMatchObject({
      source: 'bundled',
      currentVersion: BUNDLED_VERSION,
      latestVersion: LATEST_VERSION,
      updateAvailable: true,
      installedAt: null
    });
    expect(restored.getRuntime()).toBe(bundledRuntime);
  });

  it('aborts an in-flight release check when the manager closes', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const bundledRuntime = await createBundledRuntime(root);
    let observedSignal: AbortSignal | undefined;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>(resolve => {
      markFetchStarted = resolve;
    });
    const fetchImpl = vi.fn((
      _input: string | URL | Request,
      init?: RequestInit
    ) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) {
        reject(new Error('expected an abort signal'));
        return;
      }
      observedSignal = signal;
      markFetchStarted();
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true
      });
    })) as unknown as typeof fetch;
    const manager = await createManager(
      join(root, 'updates'),
      bundledRuntime,
      fetchImpl
    );
    const result = manager.check({ force: true }).then(
      () => undefined,
      (error: unknown) => error
    );
    await fetchStarted;

    manager.close();

    expect(observedSignal?.aborted).toBe(true);
    await expect(result).resolves.toMatchObject({
      code: 'creator_yt_dlp_update_check_failed'
    });
  });
});

async function createBundledRuntime(base: string): Promise<YtDlpRuntime> {
  const script = join(base, 'bundled', 'yt-dlp.cjs');
  await mkdir(join(base, 'bundled'), { recursive: true });
  await writeFile(script, versionScript(BUNDLED_VERSION));
  return {
    version: BUNDLED_VERSION,
    executable: process.execPath,
    prefixArgs: [script],
    env: {},
    script
  };
}

function createManager(
  updatesRoot: string,
  bundledRuntime: YtDlpRuntime,
  fetchImpl: typeof fetch
): Promise<YtDlpUpdateManager> {
  return createYtDlpUpdateManager({
    root: updatesRoot,
    bundledRuntime,
    readProxy: async () => '',
    fetchImpl,
    now: () => new Date('2026-08-31T00:00:00.000Z')
  });
}

function releaseFixture(version: string): {
  version: string;
  content: Buffer;
  sha256: string;
  url: string;
} {
  const content = Buffer.from(versionScript(version));
  return {
    version,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    url: `https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/download/${version}/yt-dlp`
  };
}

function releaseFetch(release: {
  version: string;
  content: Buffer;
  sha256: string;
  url: string;
}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes('/releases/latest')) {
      return new Response(JSON.stringify({
        tag_name: release.version,
        published_at: '2026-08-31T00:00:00.000Z',
        assets: [{
          name: 'yt-dlp',
          digest: `sha256:${release.sha256}`,
          browser_download_url: release.url
        }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url === release.url) {
      return new Response(Uint8Array.from(release.content), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function redirectingReleaseFetch(
  release: {
    version: string;
    content: Buffer;
    sha256: string;
    url: string;
  },
  redirectedUrl: string
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url.includes('/releases/latest')) {
      return new Response(JSON.stringify({
        tag_name: release.version,
        published_at: '2026-08-31T00:00:00.000Z',
        assets: [{
          name: 'yt-dlp',
          digest: `sha256:${release.sha256}`,
          browser_download_url: release.url
        }]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url === release.url) {
      return new Response(null, {
        status: 302,
        headers: { location: redirectedUrl }
      });
    }
    if (url === redirectedUrl) {
      return new Response(Uint8Array.from(release.content), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' }
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function versionScript(version: string): string {
  return `process.stdout.write(${JSON.stringify(`${version}\n`)});\n`;
}
