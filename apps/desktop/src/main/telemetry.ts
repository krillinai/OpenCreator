import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DesktopLogger } from './logger.js';
import type { SettingsStore } from './settings-store.js';

const DEFAULT_TELEMETRY_URL = 'https://admin.clawee.work/api/v1/public/desktop-usage';
const ACTIVE_INTERVAL_MS = 60_000;
const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const EVENT_REPORT_INTERVAL_MS = 60_000;
const REPORT_TIMEOUT_MS = 5_000;
const EVENT_BATCH_SIZE = 50;

type TelemetryDay = {
  date: string;
  launchCount: number;
  activeMinutes: number;
};

type TelemetryState = {
  days: TelemetryDay[];
};

export type TelemetryPersistence = {
  read(path: string): string;
  writeAtomic(path: string, contents: string): void;
};

export type DesktopTelemetryController = {
  enable(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  reportNow(): Promise<void>;
  stop(): Promise<void>;
  resume(): void;
  dispose(): void;
};

export function startDesktopTelemetry(input: {
  path: string;
  settings: SettingsStore;
  logger: DesktopLogger;
  appVersion: string;
  isOfficialBuild: boolean;
  isWindowActive(): boolean;
  getDaemonConnection?(): { address: string; token: string } | undefined;
  endpointOverride?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  now?(): Date;
  fetchImpl?: typeof fetch;
  persistence?: TelemetryPersistence;
  activeIntervalMs?: number;
  reportIntervalMs?: number;
  eventReportIntervalMs?: number;
}): DesktopTelemetryController {
  const now = input.now ?? (() => new Date());
  const store = createTelemetryStore(input.path, input.persistence);
  const endpoint = resolveTelemetryEndpoint(input.endpointOverride, input.isOfficialBuild);
  const eventsEndpoint = endpoint === undefined ? undefined : resolveTelemetryEventsEndpoint(endpoint);
  const fetchImpl = input.fetchImpl ?? fetch;
  let launchRecorded = false;
  let stopped = false;
  let reportQueue = Promise.resolve();
  let settingQueue = Promise.resolve();
  let activeReport: AbortController | undefined;
  let activeTimer: NodeJS.Timeout | undefined;
  let reportTimer: NodeJS.Timeout | undefined;
  let eventReportTimer: NodeJS.Timeout | undefined;

  const installId = () => {
    const existing = input.settings.read().telemetryInstallId;
    if (existing !== undefined) return existing;
    const created = randomUUID();
    input.settings.update({ telemetryInstallId: created });
    return created;
  };
  const recordLaunch = () => {
    if (launchRecorded || !input.settings.read().telemetryEnabled) return;
    launchRecorded = true;
    store.incrementLaunch(usageDate(now()));
  };
  const sendReports = async () => {
    if (stopped || !input.settings.read().telemetryEnabled || endpoint === undefined) return;
    const currentInstallId = installId();
    const today = usageDate(now());
    for (const day of store.readDays(today)) {
      if (stopped) return;
      const controller = new AbortController();
      activeReport = controller;
      const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
      timeout.unref();
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            install_id: currentInstallId,
            usage_date: day.date,
            launch_count: day.launchCount,
            active_minutes: day.activeMinutes,
            app_version: input.appVersion,
            operating_system: input.platform ?? process.platform,
            architecture: input.architecture ?? process.arch
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          input.logger.warnRateLimited(
            'desktop-telemetry-report',
            'Desktop telemetry report was rejected',
            { status: response.status },
            REPORT_INTERVAL_MS
          );
          return;
        }
        store.removeReportedHistory(day.date, today);
      } catch (error) {
        if (stopped) return;
        input.logger.warnRateLimited(
          'desktop-telemetry-report',
          'Desktop telemetry report failed',
          { message: error instanceof Error ? error.message : String(error) },
          REPORT_INTERVAL_MS
        );
        return;
      } finally {
        clearTimeout(timeout);
        if (activeReport === controller) activeReport = undefined;
      }
    }
  };
  const sendEventReports = async () => {
    const connection = input.getDaemonConnection?.();
    if (stopped || !input.settings.read().telemetryEnabled || eventsEndpoint === undefined || connection === undefined) return;
    const request = async (url: string, init: RequestInit): Promise<Response> => {
      const controller = new AbortController();
      activeReport = controller;
      const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
      timeout.unref();
      try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
      } finally {
        clearTimeout(timeout);
        if (activeReport === controller) activeReport = undefined;
      }
    };
    try {
      const pulled = await request(`${connection.address.replace(/\/+$/, '')}/telemetry/events?limit=${EVENT_BATCH_SIZE}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${connection.token}` }
      });
      if (!pulled.ok || stopped || !input.settings.read().telemetryEnabled) return;
      const payload = await pulled.json() as unknown;
      if (!isRecord(payload) || !Array.isArray(payload.events)) return;
      const events = payload.events.slice(0, EVENT_BATCH_SIZE).flatMap(event => {
        const sanitized = sanitizeDaemonTelemetryEvent(event, {
          installId: installId(),
          appVersion: input.appVersion,
          platform: input.platform ?? process.platform,
          architecture: input.architecture ?? process.arch
        });
        return sanitized === undefined ? [] : [sanitized];
      });
      if (events.length === 0 || stopped || !input.settings.read().telemetryEnabled) return;
      let sent = await request(eventsEndpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ install_id: installId(), events })
      });
      if (!sent.ok && [400, 413, 422].includes(sent.status) && events.some(event => (
        isRecord(event.failure) && event.failure.diagnostic !== undefined
      ))) {
        const basicEvents = events.map(event => {
          if (!isRecord(event.failure)) return event;
          const { diagnostic: _discarded, ...failure } = event.failure;
          return { ...event, failure };
        });
        sent = await request(eventsEndpoint, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ install_id: installId(), events: basicEvents })
        });
      }
      if (!sent.ok || stopped || !input.settings.read().telemetryEnabled) return;
      const acknowledged = await request(`${connection.address.replace(/\/+$/, '')}/telemetry/events/ack`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ event_ids: events.map(event => event.event_id) })
      });
      if (!acknowledged.ok) {
        input.logger.warnRateLimited(
          'desktop-telemetry-events',
          'Desktop telemetry event acknowledgment was rejected',
          { status: acknowledged.status },
          EVENT_REPORT_INTERVAL_MS
        );
      }
    } catch (error) {
      if (stopped) return;
      input.logger.warnRateLimited(
        'desktop-telemetry-events',
        'Desktop telemetry event delivery failed',
        { message: error instanceof Error ? error.message : String(error) },
        EVENT_REPORT_INTERVAL_MS
      );
    }
  };
  const reportNow = () => {
    const work = reportQueue.then(async () => {
      await sendReports();
      await sendEventReports();
    });
    reportQueue = work.catch(() => undefined);
    return work;
  };
  const reportEventsNow = () => {
    const work = reportQueue.then(sendEventReports);
    reportQueue = work.catch(() => undefined);
    return work;
  };
  const clearTimers = () => {
    clearInterval(activeTimer);
    clearInterval(reportTimer);
    clearInterval(eventReportTimer);
    activeTimer = undefined;
    reportTimer = undefined;
    eventReportTimer = undefined;
  };
  const startTimers = () => {
    activeTimer = setInterval(() => {
      if (!input.settings.read().telemetryEnabled || !input.isWindowActive()) return;
      store.incrementActiveMinute(usageDate(now()));
    }, input.activeIntervalMs ?? ACTIVE_INTERVAL_MS);
    activeTimer.unref();
    reportTimer = setInterval(() => void reportNow(), input.reportIntervalMs ?? REPORT_INTERVAL_MS);
    reportTimer.unref();
    eventReportTimer = setInterval(() => void reportEventsNow(), input.eventReportIntervalMs ?? EVENT_REPORT_INTERVAL_MS);
    eventReportTimer.unref();
  };

  recordLaunch();
  void reportNow();
  startTimers();

  return {
    async enable() {
      recordLaunch();
      await reportNow();
    },
    setEnabled(enabled) {
      if (!enabled) activeReport?.abort();
      const work = settingQueue.then(async () => {
        const connection = input.getDaemonConnection?.();
        if (connection !== undefined) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS);
          timeout.unref();
          try {
            const response = await fetchImpl(`${connection.address.replace(/\/+$/, '')}/telemetry/enabled`, {
              method: 'POST',
              headers: { Accept: 'application/json', Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled }),
              signal: controller.signal
            });
            if (!response.ok) input.logger.warn('Could not synchronize telemetry setting', { status: response.status });
          } catch (error) {
            input.logger.warn('Could not synchronize telemetry setting', { message: error instanceof Error ? error.message : String(error) });
          } finally {
            clearTimeout(timeout);
          }
        }
        if (enabled && input.settings.read().telemetryEnabled) await reportNow();
      });
      settingQueue = work.catch(() => undefined);
      return work;
    },
    reportNow,
    async stop() {
      if (!stopped) {
        stopped = true;
        clearTimers();
        activeReport?.abort();
      }
    },
    resume() {
      if (!stopped) return;
      stopped = false;
      startTimers();
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      clearTimers();
      activeReport?.abort();
    }
  };
}

export function resolveTelemetryEndpoint(
  override: string | undefined,
  isOfficialBuild: boolean
): string | undefined {
  const value = override?.trim() || (isOfficialBuild ? DEFAULT_TELEMETRY_URL : '');
  if (value === '') return undefined;
  try {
    const url = new URL(value);
    const localDevelopment = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    if (url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function resolveTelemetryEventsEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/events`;
  return url.toString();
}

export function createTelemetryStore(
  path: string,
  persistence: TelemetryPersistence = fileTelemetryPersistence
) {
  let state = readTelemetryState(path, persistence);
  const write = () => persistence.writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`);
  const updateDay = (
    date: string,
    update: (value: TelemetryDay) => TelemetryDay
  ) => {
    const existing = state.days.find(item => item.date === date);
    const updated = update(existing ?? { date, launchCount: 0, activeMinutes: 0 });
    state = {
      days: existing === undefined
        ? [...state.days, updated]
        : state.days.map(item => item.date === date ? updated : item)
    };
  };
  const prune = (today: string) => {
    const minimum = new Date(`${today}T00:00:00Z`);
    minimum.setUTCDate(minimum.getUTCDate() - 31);
    const minimumDate = minimum.toISOString().slice(0, 10);
    state = {
      days: state.days.filter(item => item.date >= minimumDate && item.date <= today)
    };
  };
  return {
    incrementLaunch(date: string) {
      updateDay(date, value => ({
        ...value,
        launchCount: value.launchCount + 1
      }));
      prune(date);
      write();
    },
    incrementActiveMinute(date: string) {
      updateDay(date, value => ({
        ...value,
        activeMinutes: Math.min(1440, value.activeMinutes + 1)
      }));
      prune(date);
      write();
    },
    readDays(today: string): TelemetryDay[] {
      prune(today);
      return state.days
        .filter(item => item.launchCount > 0)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(item => ({ ...item }));
    },
    removeReportedHistory(date: string, today: string) {
      if (date >= today) return;
      const remaining = state.days.filter(item => item.date !== date);
      if (remaining.length === state.days.length) return;
      state = { days: remaining };
      write();
    }
  };
}

function usageDate(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function readTelemetryState(
  path: string,
  persistence: TelemetryPersistence
): TelemetryState {
  try {
    const value = JSON.parse(persistence.read(path)) as unknown;
    if (!isRecord(value) || !Array.isArray(value.days)) return { days: [] };
    return {
      days: value.days.flatMap(item => {
        if (
          !isRecord(item)
          || typeof item.date !== 'string'
          || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
          || !Number.isInteger(item.launchCount)
          || (item.launchCount as number) < 0
          || !Number.isInteger(item.activeMinutes)
          || (item.activeMinutes as number) < 0
        ) {
          return [];
        }
        return [{
          date: item.date,
          launchCount: Math.min(10_000, item.launchCount as number),
          activeMinutes: Math.min(1440, item.activeMinutes as number)
        }];
      })
    };
  } catch {
    return { days: [] };
  }
}

function sanitizeDaemonTelemetryEvent(
  value: unknown,
  metadata: { installId: string; appVersion: string; platform: string; architecture: string }
): (Record<string, unknown> & { event_id: string }) | undefined {
  if (!isRecord(value)
    || typeof value.event_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.event_id)
    || (value.event_type !== 'task_started' && value.event_type !== 'task_finished')
    || !validIso(value.occurred_at)
    || !safeEventText(value.task_id, 256)
    || !safeEventText(value.attempt_id, 256)
    || !safeEventText(value.feature, 128)
    || !['signed_in', 'signed_out', 'unknown'].includes(String(value.auth_state))
    || !['recharged', 'not_recharged', 'pending', 'unknown'].includes(String(value.recharge_state))
    || !validIso(value.account_state_observed_at)) return undefined;
  if (value.outcome !== undefined && ![
    'succeeded', 'partial_success', 'failed', 'needs_input', 'canceled', 'interrupted', 'unknown'
  ].includes(String(value.outcome))) return undefined;
  const event: Record<string, unknown> & { event_id: string } = {
    event_id: value.event_id,
    event_type: value.event_type,
    occurred_at: value.occurred_at,
    task_id: value.task_id,
    attempt_id: value.attempt_id,
    feature: value.feature,
    ...(safeEventText(value.user_id, 128) && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(String(value.user_id))
      ? { user_id: value.user_id } : {}),
    ...(value.outcome === undefined ? {} : { outcome: value.outcome }),
    auth_state: value.auth_state,
    recharge_state: value.recharge_state,
    account_state_observed_at: value.account_state_observed_at,
    app_version: metadata.appVersion,
    operating_system: metadata.platform,
    architecture: metadata.architecture
  };
  if (safeNonNegativeInteger(value.duration_ms) !== undefined) event.duration_ms = value.duration_ms;
  if (isRecord(value.failure)) event.failure = sanitizeDaemonFailure(value.failure);
  return event;
}

function sanitizeDaemonFailure(value: Record<string, unknown>): Record<string, unknown> {
  const failure: Record<string, unknown> = {};
  const diagnostic = sanitizeDaemonDiagnostic(value.diagnostic);
  if (diagnostic !== undefined) failure.diagnostic = diagnostic;
  if (typeof value.request_id === 'string' && /^ocreq_[0-9a-f]{48}$/.test(value.request_id)) failure.request_id = value.request_id;
  for (const key of ['stage', 'executor', 'category', 'error_code', 'provider', 'upstream_code'] as const) {
    if (safeEventText(value[key], 128)) failure[key] = value[key];
  }
  if (typeof value.http_status === 'number' && Number.isInteger(value.http_status)
    && value.http_status >= 100 && value.http_status <= 599) failure.http_status = value.http_status;
  for (const key of ['retryable', 'artifact_delivered'] as const) {
    if (typeof value[key] === 'boolean') failure[key] = value[key];
  }
  for (const key of ['retry_count', 'expected_count', 'succeeded_count', 'failed_count'] as const) {
    if (safeNonNegativeInteger(value[key])) failure[key] = value[key];
  }
  if (typeof value.progress_percent === 'number' && Number.isFinite(value.progress_percent)
    && value.progress_percent >= 0 && value.progress_percent <= 100) failure.progress_percent = Math.round(value.progress_percent);
  if (typeof value.user_message === 'string' && value.user_message.trim()) {
    failure.user_message = value.user_message.trim().slice(0, 500);
  }
  return failure;
}

function sanitizeDaemonDiagnostic(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.version !== 1 || !safeDiagnosticId(value.operation) || !Array.isArray(value.causes)) return undefined;
  const causes = value.causes.slice(0, 3).flatMap(item => {
    if (!isRecord(item) || !safeDiagnosticId(item.name)) return [];
    return [{ name: item.name, ...(safeDiagnosticId(item.code) ? { code: item.code } : {}) }];
  });
  const steps = Array.isArray(value.steps) ? value.steps.slice(0, 4).flatMap(item => (
    isRecord(item) && safeDiagnosticId(item.operation) && safeDiagnosticId(item.code)
      && (item.result === 'fallback' || item.result === 'failed')
      ? [{ operation: item.operation, code: item.code, result: item.result }] : []
  )) : [];
  const process = isRecord(value.process) && safeDiagnosticId(value.process.tool) ? {
    tool: value.process.tool,
    ...(safeDiagnosticId(value.process.version) ? { version: value.process.version } : {}),
    ...(typeof value.process.exit_code === 'number' && Number.isInteger(value.process.exit_code)
      && value.process.exit_code >= -255 && value.process.exit_code <= 255 ? { exit_code: value.process.exit_code } : {})
  } : undefined;
  const network = isRecord(value.network) && ['direct', 'proxy', 'unknown'].includes(String(value.network.route))
    && ['proxy', 'platform', 'gateway', 'unknown'].includes(String(value.network.peer)) ? {
      route: value.network.route, peer: value.network.peer,
      ...(safeDiagnosticId(value.network.platform) ? { platform: value.network.platform } : {}),
      ...(['loopback', 'private', 'public', 'unknown'].includes(String(value.network.proxy_scope))
        ? { proxy_scope: value.network.proxy_scope } : {}),
      ...(typeof value.network.proxy_port === 'number' && Number.isInteger(value.network.proxy_port)
        && value.network.proxy_port > 0 && value.network.proxy_port <= 65535 ? { proxy_port: value.network.proxy_port } : {}),
      ...(safeDiagnosticId(value.network.reason) ? { reason: value.network.reason } : {})
    } : undefined;
  const evidence = Array.isArray(value.evidence) ? value.evidence.slice(0, 12).filter(item => typeof item === 'string'
    && /^(?:api_page_failed|connection_refused|connection_reset|dns_failed|timeout|tls_failed|proxy_failed|network_unreachable|format_unavailable|login_required|disk_full|extractor_failed|http_[1-5][0-9]{2}|internal_attempts_[1-9][0-9]{0,2})$/.test(item)) : [];
  const frames = Array.isArray(value.frames) ? value.frames.slice(0, 3).filter(item => typeof item === 'string'
    && /^(?:apps\/daemon\/src|packages\/protocol\/src)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|js):\d{1,6}$/.test(item)) : [];
  const missing = Array.isArray(value.missing) ? value.missing.slice(0, 3).filter(item =>
    ['process_output_unrecognized', 'network_peer_unknown', 'stack_unavailable'].includes(String(item))) : [];
  const diagnostic = { version: 1, operation: value.operation, causes,
    ...(steps.length ? { steps } : {}), ...(process ? { process } : {}), ...(network ? { network } : {}),
    ...(evidence.length ? { evidence } : {}), ...(frames.length ? { frames } : {}), ...(missing.length ? { missing } : {}) };
  return Buffer.byteLength(JSON.stringify(diagnostic), 'utf8') <= 4_096 ? diagnostic : undefined;
}

function safeDiagnosticId(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
    && !value.split(/[._:-]/).some(part => part.length >= 32)
    && !/^(?:sk[-_]|AIza|AKIA|ASIA|gh[pousr]_|github_pat_|eyJ)/i.test(value);
}

function safeEventText(value: unknown, maximum: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validIso(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function safeNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

const fileTelemetryPersistence: TelemetryPersistence = {
  read: path => readFileSync(path, 'utf8'),
  writeAtomic(path, contents) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, path);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
