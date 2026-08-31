import Fastify, { type FastifyInstance } from 'fastify';
import type { CreatorYtDlpStatus } from '@opencreator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerCreatorRuntimeRoutes } from '../../src/api/routes.creator-runtime.js';
import {
  YtDlpUpdateError,
  type YtDlpUpdateManager
} from '../../src/creator/yt-dlp/update-manager.js';

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('creator yt-dlp runtime routes', () => {
  it('exposes status, periodic checks, and manual updates', async () => {
    const current = status();
    const checked = status({
      latestVersion: '2026.08.31.120000',
      updateAvailable: true
    });
    const updated = status({
      source: 'managed',
      currentVersion: '2026.08.31.120000',
      latestVersion: '2026.08.31.120000',
      installedAt: '2026-08-31T00:00:00.000Z'
    });
    const manager = managerFixture({
      status: vi.fn(() => current),
      check: vi.fn(async () => checked),
      update: vi.fn(async () => updated)
    });
    server = Fastify();
    await registerCreatorRuntimeRoutes(server, manager);

    const statusResponse = await server.inject({
      method: 'GET',
      url: '/creator/yt-dlp/status'
    });
    const checkResponse = await server.inject({
      method: 'POST',
      url: '/creator/yt-dlp/check',
      payload: { force: false }
    });
    const updateResponse = await server.inject({
      method: 'POST',
      url: '/creator/yt-dlp/update'
    });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({ ytDlp: current });
    expect(checkResponse.statusCode).toBe(200);
    expect(checkResponse.json()).toEqual({ ytDlp: checked });
    expect(manager.check).toHaveBeenCalledWith({ force: false });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toEqual({ ytDlp: updated });
    expect(manager.update).toHaveBeenCalledOnce();
  });

  it('returns stable API errors for invalid input and update failures', async () => {
    const manager = managerFixture({
      check: vi.fn(async () => {
        throw new YtDlpUpdateError(
          'creator_yt_dlp_update_check_failed',
          'release lookup failed',
          502
        );
      })
    });
    server = Fastify();
    await registerCreatorRuntimeRoutes(server, manager);

    const invalid = await server.inject({
      method: 'POST',
      url: '/creator/yt-dlp/check',
      payload: { force: 'yes' }
    });
    const failed = await server.inject({
      method: 'POST',
      url: '/creator/yt-dlp/check',
      payload: { force: true }
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: 'creator_yt_dlp_update_check_failed' }
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({
      error: {
        code: 'creator_yt_dlp_update_check_failed',
        message: 'release lookup failed'
      }
    });
  });

  it('reports when the packaged runtime cannot support managed updates', async () => {
    server = Fastify();
    await registerCreatorRuntimeRoutes(server, undefined);

    const response = await server.inject({
      method: 'GET',
      url: '/creator/yt-dlp/status'
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'creator_yt_dlp_update_unavailable' }
    });
  });
});

function managerFixture(
  patch: Partial<YtDlpUpdateManager> = {}
): YtDlpUpdateManager {
  return {
    getRuntime: vi.fn(() => ({
      version: '2026.08.29.232711',
      executable: process.execPath,
      prefixArgs: [],
      env: {}
    })),
    status: vi.fn(() => status()),
    check: vi.fn(async () => status()),
    update: vi.fn(async () => status()),
    ...patch
  };
}

function status(
  patch: Partial<CreatorYtDlpStatus> = {}
): CreatorYtDlpStatus {
  return {
    channel: 'nightly',
    source: 'bundled',
    currentVersion: '2026.08.29.232711',
    bundledVersion: '2026.08.29.232711',
    latestVersion: null,
    updateAvailable: false,
    checkDue: false,
    lastCheckedAt: null,
    lastCheckAttemptAt: null,
    installedAt: null,
    ...patch
  };
}
