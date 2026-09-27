import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DesktopLogger } from '../src/main/logger.js';
import type { SettingsStore } from '../src/main/settings-store.js';
import {
  createTelemetryStore,
  resolveTelemetryEndpoint,
  startDesktopTelemetry,
  type TelemetryPersistence
} from '../src/main/telemetry.js';
import type { DesktopSettings } from '../src/shared/types.js';

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

function memorySettings(
  initial: Partial<DesktopSettings> = {}
): SettingsStore {
  let settings: DesktopSettings = {
    closeBehavior: 'hide',
    notificationsEnabled: true,
    telemetryEnabled: true,
    ...initial
  };
  return {
    read: () => structuredClone(settings),
    update: patch => {
      settings = { ...settings, ...patch };
      return structuredClone(settings);
    },
    flush: () => undefined
  };
}

function logger(): DesktopLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    warnRateLimited: vi.fn(),
    flush: vi.fn(async () => undefined)
  };
}

describe('desktop telemetry', () => {
  it('keeps daily launch and active-minute counters', () => {
    const memory = memoryPersistence();
    const store = createTelemetryStore(
      '/virtual/telemetry.json',
      memory.persistence as TelemetryPersistence
    );

    store.incrementLaunch('2026-09-07');
    store.incrementActiveMinute('2026-09-07');
    store.incrementActiveMinute('2026-09-07');

    expect(JSON.parse(memory.read())).toEqual({
      days: [{ date: '2026-09-07', launchCount: 1, activeMinutes: 2 }]
    });
  });

  it('reports only the anonymous daily usage contract', async () => {
    const telemetryMemory = memoryPersistence();
    const settings = memorySettings();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>
      });
      return new Response('{}', { status: 200 });
    };
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings,
      logger: logger(),
      appVersion: '3.0.1',
      isOfficialBuild: false,
      endpointOverride: 'http://127.0.0.1:8790/api/v1/public/desktop-usage',
      platform: 'darwin',
      architecture: 'arm64',
      now: () => new Date('2026-09-07T02:00:00Z'),
      isWindowActive: () => false,
      fetchImpl,
      persistence: telemetryMemory.persistence as TelemetryPersistence
    });

    await controller.reportNow();
    controller.dispose();

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.at(-1)?.url).toBe(
      'http://127.0.0.1:8790/api/v1/public/desktop-usage'
    );
    expect(requests.at(-1)?.body).toMatchObject({
      usage_date: '2026-09-07',
      launch_count: 1,
      active_minutes: 0,
      app_version: '3.0.1',
      operating_system: 'darwin',
      architecture: 'arm64'
    });
    expect(requests.at(-1)?.body.install_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requests.at(-1)?.body).not.toHaveProperty('source_ip');
    expect(requests.at(-1)?.body).not.toHaveProperty('project');
    expect(requests.at(-1)?.body).not.toHaveProperty('conversation');
  });

  it('uses the production endpoint only for official builds', () => {
    expect(resolveTelemetryEndpoint('https://admin.example.com/report', false))
      .toBe('https://admin.example.com/report');
    expect(resolveTelemetryEndpoint('http://127.0.0.1:8790/report', false))
      .toBe('http://127.0.0.1:8790/report');
    expect(resolveTelemetryEndpoint('http://public.example.com/report', false))
      .toBeUndefined();
    expect(resolveTelemetryEndpoint(undefined, false)).toBeUndefined();
    expect(resolveTelemetryEndpoint(undefined, true))
      .toBe('https://admin.clawee.work/api/v1/public/desktop-usage');
  });

  it('sends the report through a real local HTTP connection', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const server = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => {
        body += chunk;
      });
      request.on('end', () => {
        bodies.push(JSON.parse(body) as Record<string, unknown>);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"accepted":true}');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const telemetryMemory = memoryPersistence();
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.0.1',
      isOfficialBuild: false,
      endpointOverride: `http://127.0.0.1:${address.port}/api/v1/public/desktop-usage`,
      now: () => new Date('2026-09-07T02:00:00Z'),
      isWindowActive: () => false,
      persistence: telemetryMemory.persistence as TelemetryPersistence
    });

    try {
      await controller.reportNow();
    } finally {
      controller.dispose();
      await new Promise<void>((resolve, reject) => {
        server.close(error => error === undefined ? resolve() : reject(error));
      });
    }

    expect(bodies.at(-1)).toMatchObject({
      usage_date: '2026-09-07',
      launch_count: 1,
      active_minutes: 0,
      app_version: '3.0.1'
    });
  });

  it('does not create an identifier or send while telemetry is disabled', async () => {
    const telemetryMemory = memoryPersistence();
    const settings = memorySettings({ telemetryEnabled: false });
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings,
      logger: logger(),
      appVersion: '3.0.1',
        isOfficialBuild: true,
      isWindowActive: () => true,
      fetchImpl,
      persistence: telemetryMemory.persistence as TelemetryPersistence
    });

    await controller.reportNow();
    controller.dispose();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(settings.read().telemetryInstallId).toBeUndefined();
    expect(telemetryMemory.read()).toBe('');
  });

  it('removes reported history while retaining the current daily counters', async () => {
    const telemetryMemory = memoryPersistence(JSON.stringify({
      days: [
        { date: '2026-09-06', launchCount: 1, activeMinutes: 20 },
        { date: '2026-09-07', launchCount: 1, activeMinutes: 5 }
      ]
    }));
    const reportedDates: string[] = [];
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.0.1',
      isOfficialBuild: true,
      now: () => new Date('2026-09-07T02:00:00Z'),
      isWindowActive: () => false,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { usage_date: string };
        reportedDates.push(body.usage_date);
        return new Response('{}', { status: 200 });
      },
      persistence: telemetryMemory.persistence as TelemetryPersistence
    });

    await controller.reportNow();
    controller.dispose();

    expect(reportedDates).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-07'
    ]);
    expect(JSON.parse(telemetryMemory.read())).toEqual({
      days: [{ date: '2026-09-07', launchCount: 2, activeMinutes: 5 }]
    });
  });

  it('persists active minutes without reporting again while stopping', async () => {
    vi.useFakeTimers();
    try {
      const telemetryMemory = memoryPersistence();
      const requests: Array<Record<string, unknown>> = [];
      const controller = startDesktopTelemetry({
        path: '/virtual/telemetry.json',
        settings: memorySettings(),
        logger: logger(),
        appVersion: '3.0.1',
      isOfficialBuild: true,
        isWindowActive: () => true,
        now: () => new Date('2026-09-07T02:00:00Z'),
        fetchImpl: async (_url, init) => {
          requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return new Response('{}', { status: 200 });
        },
        persistence: telemetryMemory.persistence as TelemetryPersistence,
        activeIntervalMs: 10,
        reportIntervalMs: 100_000
      });
      await controller.reportNow();
      requests.length = 0;

      await vi.advanceTimersByTimeAsync(10);
      await controller.stop();

      expect(requests).toHaveLength(0);
      expect(JSON.parse(telemetryMemory.read())).toEqual({
        days: [{ date: '2026-09-07', launchCount: 1, activeMinutes: 1 }]
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an in-flight report without waiting for the network while stopping', async () => {
    let requestSignal: AbortSignal | undefined;
    let markRequestStarted: () => void = () => undefined;
    const requestStarted = new Promise<void>(resolve => {
      markRequestStarted = resolve;
    });
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.0.1',
      isOfficialBuild: true,
      now: () => new Date('2026-09-07T02:00:00Z'),
      isWindowActive: () => false,
      fetchImpl: vi.fn(async (_url, init) => {
        requestSignal = init?.signal ?? undefined;
        markRequestStarted();
        return await new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      })
    });

    await requestStarted;
    await controller.stop();

    expect(requestSignal?.aborted).toBe(true);
  });
});
