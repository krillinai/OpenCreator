import { describe, expect, it } from 'vitest';
import {
  computeNextRunAt,
  getDefaultTimezone,
  isValidTimezone,
  validateCronExpression
} from '../../src/scheduler/cron.js';

describe('scheduler cron adapter', () => {
  it('computes the next run after the provided date', () => {
    expect(
      computeNextRunAt({
        cron: '0 9 * * *',
        timezone: 'UTC',
        from: '2026-07-06T08:59:00.000Z'
      })
    ).toBe('2026-07-06T09:00:00.000Z');
  });

  it('uses fixed timezone semantics', () => {
    const utc = computeNextRunAt({
      cron: '0 9 * * *',
      timezone: 'UTC',
      from: '2026-07-06T00:00:00.000Z'
    });
    const shanghai = computeNextRunAt({
      cron: '0 9 * * *',
      timezone: 'Asia/Shanghai',
      from: '2026-07-06T00:00:00.000Z'
    });
    expect(utc).toBe('2026-07-06T09:00:00.000Z');
    expect(shanghai).toBe('2026-07-06T01:00:00.000Z');
  });

  it('returns deterministic DST behavior for New York spring forward', () => {
    const next = computeNextRunAt({
      cron: '30 2 * * *',
      timezone: 'America/New_York',
      from: '2026-03-08T06:00:00.000Z'
    });
    expect(next).toBe('2026-03-08T07:30:00.000Z');
  });

  it('validates cron and timezone inputs', () => {
    expect(validateCronExpression('0 9 * * *').ok).toBe(true);
    expect(validateCronExpression('not a cron').ok).toBe(false);
    expect(isValidTimezone('Asia/Shanghai')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(getDefaultTimezone().length).toBeGreaterThan(0);
  });
});
