import {
  appendFile,
  mkdir,
  rename,
  rm,
  stat
} from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  redactText,
  redactValue
} from './redaction.js';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export type DesktopLogger = {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
  warnRateLimited(
    key: string,
    message: string,
    details?: Record<string, unknown>,
    intervalMs?: number
  ): void;
  flush(): Promise<void>;
};

type PendingRateLimitedLog = {
  message: string;
  details?: Record<string, unknown>;
  timer?: NodeJS.Timeout;
};

export function createDesktopLogger(path: string): DesktopLogger {
  let queue = Promise.resolve();
  const lastRateLimitedWrite = new Map<string, number>();
  const pendingRateLimited = new Map<string, PendingRateLimitedLog>();

  const enqueue = (
    level: 'info' | 'warn' | 'error',
    message: string,
    details?: Record<string, unknown>
  ) => {
    const entry = {
      at: new Date().toISOString(),
      level,
      message: redactText(message),
      ...(details === undefined ? {} : { details: redactValue(details) })
    };
    queue = queue
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await rotateIfNeeded(path);
        await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      })
      .catch(() => undefined);
  };

  const flushPendingRateLimited = () => {
    for (const [key, pending] of pendingRateLimited) {
      if (pending.timer !== undefined) clearTimeout(pending.timer);
      pendingRateLimited.delete(key);
      lastRateLimitedWrite.set(key, Date.now());
      enqueue('warn', pending.message, pending.details);
    }
  };

  return {
    info: (message, details) => enqueue('info', message, details),
    warn: (message, details) => enqueue('warn', message, details),
    error: (message, details) => enqueue('error', message, details),
    warnRateLimited(key, message, details, intervalMs = 1_000) {
      const now = Date.now();
      const last = lastRateLimitedWrite.get(key) ?? 0;
      if (now - last >= intervalMs && !pendingRateLimited.has(key)) {
        lastRateLimitedWrite.set(key, now);
        enqueue('warn', message, details);
        return;
      }
      const pending = pendingRateLimited.get(key) ?? { message, details };
      pending.message = message;
      pending.details = details;
      if (pending.timer === undefined) {
        pending.timer = setTimeout(() => {
          pendingRateLimited.delete(key);
          lastRateLimitedWrite.set(key, Date.now());
          enqueue('warn', pending.message, pending.details);
        }, Math.max(0, intervalMs - (now - last)));
        pending.timer.unref();
      }
      pendingRateLimited.set(key, pending);
    },
    async flush() {
      flushPendingRateLimited();
      await queue;
    }
  };
}

async function rotateIfNeeded(path: string): Promise<void> {
  try {
    if ((await stat(path)).size < MAX_LOG_BYTES) return;
    await rm(`${path}.1`, { force: true });
    await rename(path, `${path}.1`);
  } catch {
    // Missing files and rotation races do not block logging.
  }
}
