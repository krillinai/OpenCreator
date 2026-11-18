import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import type { CreatorYtDlpStatus } from '@opencreator/protocol';

it('runs one update per daemon start without blocking HTTP or waiting on shutdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oc-yt-dlp-startup-'));
  const version = '2026.08.29.232711';
  const token = 'local-runtime-token';
  const status: CreatorYtDlpStatus = {
    channel: 'nightly', source: 'bundled', currentVersion: version, bundledVersion: version,
    latestVersion: version, updateAvailable: false, checkDue: false,
    lastCheckedAt: '2026-08-31T00:00:00Z', lastCheckAttemptAt: '2026-08-31T00:00:00Z', installedAt: null
  };
  let rejectUpdate!: (reason: Error) => void;
  const update = vi.fn(() => new Promise<CreatorYtDlpStatus>((_resolve, reject) => { rejectUpdate = reject; }));
  const close = vi.fn(() => rejectUpdate?.(new Error('closed')));
  let server: Awaited<ReturnType<typeof buildServer>> | undefined;
  try {
    server = await buildServer({ token, appHome: root, dataDir: join(root, 'data'), defaultProjectRoot: join(root, 'projects'),
      codexHome: join(root, 'codex'), localCodexHome: join(root, 'codex'), creatorExecutors: [],
      creatorYtDlpUpdateManager: {
        getRuntime: () => ({ executable: process.execPath, prefixArgs: [], env: {}, version }),
        status: () => status, check: vi.fn(), update, close
      }
    });
    expect(update).not.toHaveBeenCalled();
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    expect(await (await fetch(`${address}/healthz`)).json()).toEqual({ ok: true });
    expect(update).toHaveBeenCalledOnce();
    const readStatus = () => fetch(`${address}/creator/yt-dlp/status`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await (await readStatus()).json()).toEqual({ ytDlp: status });
    expect(await (await readStatus()).json()).toEqual({ ytDlp: status });
    expect(update).toHaveBeenCalledOnce();
    await server.close();
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
