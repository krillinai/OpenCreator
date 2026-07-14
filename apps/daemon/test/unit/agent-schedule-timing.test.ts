import { describe, expect, it } from 'vitest';
import {
  AgentScheduleTimingError,
  convertAgentScheduleTiming
} from '../../src/agent-tools/schedule-timing.js';

describe('agent schedule timing', () => {
  it('converts interval timing to cron', () => {
    expect(convertAgentScheduleTiming({
      timing: { type: 'interval', everyMinutes: 15 },
      timezone: 'Asia/Shanghai'
    })).toEqual({
      cron: '*/15 * * * *',
      timezone: 'Asia/Shanghai'
    });

    expect(convertAgentScheduleTiming({
      timing: {
        type: 'interval',
        everyMinutes: 30,
        startTime: '09:00',
        endTime: '18:00'
      },
      timezone: 'UTC'
    })).toEqual({
      cron: '0,30 9-17 * * *',
      timezone: 'UTC'
    });
  });

  it('converts daily and weekdays-only timing to cron', () => {
    expect(convertAgentScheduleTiming({
      timing: { type: 'daily', time: '18:30' },
      timezone: 'Asia/Shanghai'
    }).cron).toBe('30 18 * * *');

    expect(convertAgentScheduleTiming({
      timing: { type: 'daily', time: '18:30', weekdaysOnly: true },
      timezone: 'Asia/Shanghai'
    }).cron).toBe('30 18 * * 1-5');
  });

  it('converts weekly timing with normalized weekdays to cron', () => {
    expect(convertAgentScheduleTiming({
      timing: {
        type: 'weekly',
        weekdays: [5, 1, 3, 1],
        time: '09:05'
      },
      timezone: 'America/Los_Angeles'
    })).toEqual({
      cron: '5 9 * * 1,3,5',
      timezone: 'America/Los_Angeles'
    });
  });

  it('keeps valid cron timing and applies a controlled default timezone', () => {
    expect(convertAgentScheduleTiming({
      timing: { type: 'cron', expression: '0 8 * * 1-5' },
      defaultTimezone: 'UTC'
    })).toEqual({
      cron: '0 8 * * 1-5',
      timezone: 'UTC'
    });
  });

  it('rejects invalid timezone, clock values and interval windows', () => {
    expect(() => convertAgentScheduleTiming({
      timing: { type: 'daily', time: '09:00' },
      timezone: 'Mars/Olympus'
    })).toThrowError(AgentScheduleTimingError);

    expect(() => convertAgentScheduleTiming({
      timing: { type: 'daily', time: '24:00' },
      timezone: 'UTC'
    })).toThrow('time must use HH:mm');

    expect(() => convertAgentScheduleTiming({
      timing: {
        type: 'interval',
        everyMinutes: 7,
        startTime: '09:00',
        endTime: '18:00'
      },
      timezone: 'UTC'
    })).toThrow('divide 60');

    expect(() => convertAgentScheduleTiming({
      timing: {
        type: 'interval',
        everyMinutes: 30,
        startTime: '18:00',
        endTime: '09:00'
      },
      timezone: 'UTC'
    })).toThrow('later than startTime');
  });
});
