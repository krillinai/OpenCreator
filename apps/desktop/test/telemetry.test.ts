import { describe, expect, it, vi } from 'vitest';
import { createSettingsStore, type SettingsPersistence } from '../src/main/settings-store.js';
import {
  createTelemetryStore,
  resolveTelemetryEndpoint,
  startDesktopTelemetry,
  type TelemetryPersistence
} from '../src/main/telemetry.js';
import type { DesktopLogger } from '../src/main/logger.js';

function memoryPersistence(initial = '') {
  let contents = initial;
  return {
    persistence: {
      read: () => {
        if (contents === '') throw new Error('missing');
        return contents;
      },
      writeAtomic: (_path: string, value: string) => {
        contents = value;
      }
    },
    read: () => contents
  };
}

describe('desktop telemetry', () => {
  it('keeps daily launch and active-minute counters', () => {
    const memory = memoryPersistence();
    const store = createTelemetryStore('/virtual/telemetry.json', memory.persistence as TelemetryPersistence);

    store.incrementLaunch('2026-08-27');
    store.incrementLaunch('2026-08-27');
    store.incrementActiveMinute('2026-08-27');

    expect(store.readDays('2026-08-27')).toEqual([{
      date: '2026-08-27',
      launchCount: 2,
      activeMinutes: 1
    }]);
  });

  it('reports an anonymous daily snapshot without an IP field', async () => {
    const settingsMemory = memoryPersistence();
    const telemetryMemory = memoryPersistence();
    const settings = createSettingsStore('/virtual/settings.json', settingsMemory.persistence as SettingsPersistence);
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 200 });
    };
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), warnRateLimited: vi.fn(), flush: vi.fn(async () => undefined)
    } satisfies DesktopLogger;
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings,
      logger,
      appVersion: '1.2.3',
      isPackaged: false,
      endpointOverride: 'http://127.0.0.1:8790/api/v1/public/desktop-usage',
      platform: 'darwin',
      architecture: 'arm64',
      now: () => new Date('2026-08-27T02:00:00Z'),
      isWindowActive: () => false,
      fetchImpl,
      persistence: telemetryMemory.persistence as TelemetryPersistence
    });

    await controller.reportNow();
    controller.dispose();

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.at(-1)?.body).toMatchObject({
      usage_date: '2026-08-27', launch_count: 1, active_minutes: 0,
      app_version: '1.2.3', operating_system: 'darwin', architecture: 'arm64'
    });
    expect(requests.at(-1)?.body.install_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requests.at(-1)?.body).not.toHaveProperty('source_ip');
  });

  it('only permits HTTPS and local HTTP endpoints', () => {
    expect(resolveTelemetryEndpoint('https://admin.example.com/report', false)).toBe('https://admin.example.com/report');
    expect(resolveTelemetryEndpoint('http://127.0.0.1:8790/report', false)).toBe('http://127.0.0.1:8790/report');
    expect(resolveTelemetryEndpoint('http://public.example.com/report', false)).toBeUndefined();
    expect(resolveTelemetryEndpoint(undefined, false)).toBeUndefined();
  });

  it('removes successfully reported history while keeping the current day', async () => {
    const settingsMemory = memoryPersistence();
    const telemetryMemory = memoryPersistence(JSON.stringify({
      days: [
        { date: '2026-08-26', launchCount: 1, activeMinutes: 20 },
        { date: '2026-08-27', launchCount: 1, activeMinutes: 5 }
      ]
    }));
    const settings = createSettingsStore('/virtual/settings.json', settingsMemory.persistence as SettingsPersistence);
    const requests: string[] = [];
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), warnRateLimited: vi.fn(), flush: vi.fn(async () => undefined)
    } satisfies DesktopLogger;
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings,
      logger,
      appVersion: '1.2.3',
      isPackaged: false,
      endpointOverride: 'http://127.0.0.1:8790/api/v1/public/desktop-usage',
      now: () => new Date('2026-08-27T02:00:00Z'),
      isWindowActive: () => false,
      fetchImpl: async (_url, init) => {
        requests.push((JSON.parse(String(init?.body)) as { usage_date: string }).usage_date);
        return new Response('{}', { status: 200 });
      },
      persistence: telemetryMemory.persistence as TelemetryPersistence
    });

    await vi.waitFor(() => expect(requests).toEqual(['2026-08-26', '2026-08-27']));
    requests.length = 0;
    await controller.reportNow();
    controller.dispose();

    expect(requests).toEqual(['2026-08-27']);
    expect(JSON.parse(telemetryMemory.read())).toMatchObject({
      days: [{ date: '2026-08-27', launchCount: 2, activeMinutes: 5 }]
    });
  });
});
