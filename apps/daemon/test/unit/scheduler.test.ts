import { describe, expect, it } from 'vitest';
import { shouldRunMissedSchedule } from '../../src/scheduler/scheduler.js';

describe('scheduler semantics', () => {
  it('does not run disabled schedules', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: false,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T01:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(false);
  });

  it('does not run future schedules', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T03:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(false);
  });

  it('skips missed schedule by default', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'skip',
        nextRunAt: '2026-07-04T01:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(false);
  });

  it('runs once when policy is run_once', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T01:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(true);
  });

  it('treats nextRunAt equal to now as due', () => {
    expect(
      shouldRunMissedSchedule({
        enabled: true,
        misfirePolicy: 'run_once',
        nextRunAt: '2026-07-04T02:00:00.000Z',
        now: '2026-07-04T02:00:00.000Z'
      })
    ).toBe(true);
  });
});
