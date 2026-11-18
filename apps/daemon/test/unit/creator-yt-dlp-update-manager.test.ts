import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createYtDlpUpdateManager,
  type YtDlpUpdateManager
} from '../../src/creator/yt-dlp/update-manager.js';
import { createYtDlpRuntimeScope, type YtDlpRuntime } from '../../src/creator/yt-dlp/runtime.js';

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
    bundledRuntime.prefixArgs.push('--plugin-dirs', join(root, 'plugins'));
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
    expect(manager.getRuntime().prefixArgs).toEqual([
      manager.getRuntime().script, '--plugin-dirs', join(root, 'plugins')
    ]);

    const restored = await createManager(updatesRoot, bundledRuntime, fetchImpl);
    expect(restored.status()).toMatchObject({
      source: 'managed',
      currentVersion: LATEST_VERSION,
      installedAt: '2026-08-31T00:00:00.000Z'
    });
    expect(restored.getRuntime().script).toBe(
      join(updatesRoot, 'versions', LATEST_VERSION, 'yt-dlp')
    );
    expect(restored.getRuntime().prefixArgs.slice(1)).toEqual(['--plugin-dirs', join(root, 'plugins')]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not remove the managed script already selected by a task, even after activating another version', async () => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const updatesRoot = join(root, 'updates');
    const bundled = await createBundledRuntime(root);
    const first = releaseFixture(LATEST_VERSION);
    const second = releaseFixture('2026.09.01.120000');
    let upstream = releaseFetch(first);
    const fetchImpl: typeof fetch = (...args) => upstream(...args);
    const manager = await createManager(updatesRoot, bundled, fetchImpl);
    await manager.update();
    const scope = createYtDlpRuntimeScope(() => manager.getRuntime());
    const oldScript = manager.getRuntime().script!;
    upstream = releaseFetch(second);

    await scope.run(async () => {
      const runningTask = scope.getRuntime();
      await manager.update();
      expect(scope.getRuntime()).toBe(runningTask);
      expect(await readFile(oldScript)).toEqual(first.content);
    });

    expect(scope.run(() => scope.getRuntime()?.version)).toBe(second.version);
    manager.close();

    const restarted = await createManager(updatesRoot, bundled, fetchImpl);
    expect(restarted.getRuntime().version).toBe(second.version);
    await expect(stat(oldScript)).rejects.toMatchObject({ code: 'ENOENT' });
    restarted.close();
  });

  it.each([
    {
      bundledVersion: '2026.08.30.000000',
      source: 'managed',
      currentVersion: LATEST_VERSION
    },
    {
      bundledVersion: LATEST_VERSION,
      source: 'bundled',
      currentVersion: LATEST_VERSION
    },
    {
      bundledVersion: '2026.09.01.000000',
      source: 'bundled',
      currentVersion: '2026.09.01.000000'
    }
  ])('selects the newest installed runtime after upgrading the bundle to $bundledVersion', async ({
    bundledVersion,
    source,
    currentVersion
  }) => {
    root = await mkdtemp(join(tmpdir(), 'creator-yt-dlp-update-'));
    const updatesRoot = join(root, 'updates');
    const fetchImpl = releaseFetch(releaseFixture(LATEST_VERSION));
    const original = await createManager(
      updatesRoot,
      await createBundledRuntime(root),
      fetchImpl
    );
    await original.update();
    original.close();

    const bundledRuntime = await createBundledRuntime(root, bundledVersion);
    const manager = await createManager(updatesRoot, bundledRuntime, fetchImpl);
    const expectedStatus = {
      source,
      currentVersion,
      bundledVersion,
      updateAvailable: false,
      installedAt: source === 'managed' ? '2026-08-31T00:00:00.000Z' : null
    };
    const expectedScript = source === 'bundled'
      ? bundledRuntime.script
      : join(updatesRoot, 'versions', LATEST_VERSION, 'yt-dlp');

    expect(manager.status()).toMatchObject(expectedStatus);
    expect(manager.getRuntime()).toMatchObject({
      version: currentVersion,
      script: expectedScript,
      prefixArgs: [expectedScript]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // An older upstream response must not download or activate a downgrade.
    await manager.update();
    expect(manager.status()).toMatchObject(expectedStatus);
    expect(manager.getRuntime().script).toBe(expectedScript);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    manager.close();

    const restarted = await createManager(updatesRoot, bundledRuntime, fetchImpl);
    expect(restarted.status()).toMatchObject(expectedStatus);
    expect(restarted.getRuntime().script).toBe(expectedScript);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    restarted.close();
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

async function createBundledRuntime(
  base: string,
  version = BUNDLED_VERSION
): Promise<YtDlpRuntime> {
  const script = join(base, 'bundled', 'yt-dlp.cjs');
  await mkdir(join(base, 'bundled'), { recursive: true });
  await writeFile(script, versionScript(version));
  return {
    version,
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
