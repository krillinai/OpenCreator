import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DesktopLogger } from './logger.js';
import type { SettingsStore } from './settings-store.js';

const DEFAULT_TELEMETRY_URL = 'https://admin.clawee.work/api/v1/public/desktop-usage';
const ACTIVE_INTERVAL_MS = 60_000;
const REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REPORT_TIMEOUT_MS = 5_000;

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
  reportNow(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
};

export function startDesktopTelemetry(input: {
  path: string;
  settings: SettingsStore;
  logger: DesktopLogger;
  appVersion: string;
  isOfficialBuild: boolean;
  isWindowActive(): boolean;
  endpointOverride?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  now?(): Date;
  fetchImpl?: typeof fetch;
  persistence?: TelemetryPersistence;
  activeIntervalMs?: number;
  reportIntervalMs?: number;
}): DesktopTelemetryController {
  const now = input.now ?? (() => new Date());
  const store = createTelemetryStore(input.path, input.persistence);
  const endpoint = resolveTelemetryEndpoint(input.endpointOverride, input.isOfficialBuild);
  const fetchImpl = input.fetchImpl ?? fetch;
  let launchRecorded = false;
  let stopped = false;
  let reportQueue = Promise.resolve();
  let activeReport: AbortController | undefined;

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
  const reportNow = () => {
    const work = reportQueue.then(sendReports);
    reportQueue = work.catch(() => undefined);
    return work;
  };
  const clearTimers = () => {
    clearInterval(activeTimer);
    clearInterval(reportTimer);
  };

  recordLaunch();
  void reportNow();
  const activeTimer = setInterval(() => {
    if (!input.settings.read().telemetryEnabled || !input.isWindowActive()) return;
    store.incrementActiveMinute(usageDate(now()));
  }, input.activeIntervalMs ?? ACTIVE_INTERVAL_MS);
  activeTimer.unref();
  const reportTimer = setInterval(() => void reportNow(), input.reportIntervalMs ?? REPORT_INTERVAL_MS);
  reportTimer.unref();

  return {
    async enable() {
      recordLaunch();
      await reportNow();
    },
    reportNow,
    async stop() {
      if (!stopped) {
        stopped = true;
        clearTimers();
        activeReport?.abort();
      }
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
