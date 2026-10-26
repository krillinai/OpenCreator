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

function daemonEvent() {
  return {
    event_id: '9d9dd73e-b27f-4f0f-a5ef-0f5763d04c1a',
    event_type: 'task_finished',
    occurred_at: '2026-09-07T02:00:00.000Z',
    task_id: 'creator_job_1',
    attempt_id: 'creator_stage_run_1',
    feature: 'smart-dubbing',
    outcome: 'failed',
    auth_state: 'signed_out',
    recharge_state: 'unknown',
    account_state_observed_at: '2026-09-07T02:00:00.000Z',
    app_version: 'daemon-must-not-win',
    failure: {
      stage: 'tts',
      error_code: 'creator_stage_failed',
      user_message: 'Creator stage failed.',
      technicalDetail: 'must-not-send',
      detail: { prompt: 'must-not-send' }
    }
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

  it('resumes timers after a failed update without counting another launch or reporting on exit', async () => {
    vi.useFakeTimers();
    const telemetryMemory = memoryPersistence();
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.0.1',
      isOfficialBuild: true,
      isWindowActive: () => true,
      now: () => new Date('2026-09-07T02:00:00Z'),
      fetchImpl,
      persistence: telemetryMemory.persistence as TelemetryPersistence,
      activeIntervalMs: 10,
      reportIntervalMs: 100_000
    });
    try {
      await controller.reportNow();
      await vi.advanceTimersByTimeAsync(10);
      fetchImpl.mockClear();

      await controller.stop();
      await controller.reportNow();
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchImpl).not.toHaveBeenCalled();

      controller.resume();
      controller.resume();
      await vi.advanceTimersByTimeAsync(20);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(JSON.parse(telemetryMemory.read())).toEqual({
        days: [{ date: '2026-09-07', launchCount: 1, activeMinutes: 3 }]
      });
    } finally {
      controller.dispose();
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
      }),
      persistence: memoryPersistence().persistence as TelemetryPersistence
    });

    await requestStarted;
    await controller.stop();

    expect(requestSignal?.aborted).toBe(true);
  });

  it('delivers daemon events with desktop metadata and acknowledges only accepted batches', async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    let pending = true;
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.2.9',
      isOfficialBuild: false,
      endpointOverride: 'http://127.0.0.1:8790/api/v1/public/desktop-usage',
      platform: 'darwin',
      architecture: 'arm64',
      getDaemonConnection: () => ({ address: 'http://127.0.0.1:31234', token: 'local-token' }),
      isWindowActive: () => false,
      fetchImpl: async (url, init) => {
        const target = String(url);
        requests.push({
          url: target,
          ...(init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) as Record<string, unknown> })
        });
        if (target.includes('/telemetry/events?')) {
          return Response.json({ events: pending ? [daemonEvent()] : [] });
        }
        if (target.endsWith('/telemetry/events/ack')) {
          pending = false;
          return Response.json({ acknowledged: 1 });
        }
        return Response.json({});
      },
      persistence: memoryPersistence().persistence as TelemetryPersistence
    });

    await controller.reportNow();
    controller.dispose();

    const delivered = requests.find(request => request.url.endsWith('/desktop-usage/events'));
    expect(delivered?.body).toMatchObject({ install_id: expect.any(String) });
    const events = delivered?.body?.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_id: daemonEvent().event_id,
      app_version: '3.2.9',
      operating_system: 'darwin',
      architecture: 'arm64'
    });
    expect(events[0]!.failure).toEqual({
      stage: 'tts', error_code: 'creator_stage_failed', user_message: 'Creator stage failed.'
    });
    expect(JSON.stringify(delivered?.body)).not.toContain('must-not-send');
    expect(requests.some(request => request.url.endsWith('/telemetry/events/ack'))).toBe(true);
  });

  it('retries without ack after a non-2xx event response', async () => {
    let accepted = false;
    let acknowledgments = 0;
    let posts = 0;
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.2.9',
      isOfficialBuild: false,
      endpointOverride: 'http://127.0.0.1:8790/api/v1/public/desktop-usage',
      getDaemonConnection: () => ({ address: 'http://127.0.0.1:31234', token: 'local-token' }),
      isWindowActive: () => false,
      fetchImpl: async url => {
        const target = String(url);
        if (target.includes('/telemetry/events?')) return Response.json({ events: [daemonEvent()] });
        if (target.endsWith('/telemetry/events/ack')) {
          acknowledgments += 1;
          return Response.json({ acknowledged: 1 });
        }
        if (target.endsWith('/desktop-usage/events')) {
          posts += 1;
          return Response.json({}, { status: accepted ? 200 : 503 });
        }
        return Response.json({});
      },
      persistence: memoryPersistence().persistence as TelemetryPersistence
    });

    await controller.reportNow();
    expect(posts).toBeGreaterThan(0);
    expect(acknowledgments).toBe(0);
    accepted = true;
    await controller.reportNow();
    controller.dispose();
    expect(acknowledgments).toBe(1);
  });

  it('does not pull or deliver daemon events while disabled', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings({ telemetryEnabled: false }),
      logger: logger(),
      appVersion: '3.2.9',
      isOfficialBuild: true,
      getDaemonConnection: () => ({ address: 'http://127.0.0.1:31234', token: 'local-token' }),
      isWindowActive: () => false,
      fetchImpl,
      persistence: memoryPersistence().persistence as TelemetryPersistence
    });

    await controller.reportNow();
    controller.dispose();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pulls, delivers and acknowledges events over real local HTTP connections', async () => {
    const delivered: Array<Record<string, unknown>> = [];
    let acknowledged = 0;
    let pending = true;
    const daemon = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        if (request.url?.startsWith('/telemetry/events?')) {
          response.end(JSON.stringify({ events: pending ? [daemonEvent()] : [] }));
        } else {
          acknowledged = (JSON.parse(body) as { event_ids: string[] }).event_ids.length;
          pending = false;
          response.end(JSON.stringify({ acknowledged }));
        }
      });
    });
    const admin = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        if (request.url?.endsWith('/events')) delivered.push(JSON.parse(body) as Record<string, unknown>);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      });
    });
    await Promise.all([daemon, admin].map(server => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    })));
    const daemonPort = (daemon.address() as AddressInfo).port;
    const adminPort = (admin.address() as AddressInfo).port;
    const controller = startDesktopTelemetry({
      path: '/virtual/telemetry.json',
      settings: memorySettings(),
      logger: logger(),
      appVersion: '3.2.9',
      isOfficialBuild: false,
      endpointOverride: `http://127.0.0.1:${adminPort}/api/v1/public/desktop-usage`,
      getDaemonConnection: () => ({ address: `http://127.0.0.1:${daemonPort}`, token: 'local-token' }),
      isWindowActive: () => false,
      persistence: memoryPersistence().persistence as TelemetryPersistence
    });
    try {
      await controller.reportNow();
    } finally {
      controller.dispose();
      await Promise.all([daemon, admin].map(server => new Promise<void>((resolve, reject) => {
        server.close(error => error === undefined ? resolve() : reject(error));
      })));
    }
    expect(delivered).toHaveLength(1);
    expect(acknowledged).toBe(1);
  });
});
