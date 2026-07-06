import { CronExpressionParser } from 'cron-parser';

export type ComputeNextRunAtInput = {
  cron: string;
  timezone: string;
  from: string | Date;
};

export type ValidationResult = { ok: true } | { ok: false; message: string };

export function computeNextRunAt(input: ComputeNextRunAtInput): string {
  const interval = CronExpressionParser.parse(input.cron, {
    currentDate: input.from,
    tz: input.timezone
  });
  const next = interval.next().toISOString();
  if (next === null) {
    throw new Error('cron expression did not produce an ISO timestamp');
  }
  return next;
}

export function validateCronExpression(cron: string): ValidationResult {
  try {
    computeNextRunAt({ cron, timezone: 'UTC', from: new Date('2026-01-01T00:00:00.000Z') });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: formatError(error) };
  }
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone }).format(new Date('2026-01-01T00:00:00.000Z'));
    return true;
  } catch {
    return false;
  }
}

export function getDefaultTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
