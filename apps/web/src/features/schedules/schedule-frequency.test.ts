import { describe, expect, it } from 'vitest';
import {
  cronToScheduleFrequency,
  formatScheduleFrequency,
  scheduleFrequencyToCron,
} from './schedule-frequency.js';

describe('schedule frequency', () => {
  it('converts friendly repeat options to cron without exposing cron to the form', () => {
    expect(scheduleFrequencyToCron({ repeat: 'hourly', time: '00:15', days: [] }))
      .toBe('15 * * * *');
    expect(scheduleFrequencyToCron({ repeat: 'daily', time: '08:00', days: [] }))
      .toBe('0 8 * * *');
    expect(scheduleFrequencyToCron({ repeat: 'weekdays', time: '09:30', days: [] }))
      .toBe('30 9 * * 1-5');
    expect(scheduleFrequencyToCron({ repeat: 'weekly', time: '16:00', days: [5] }))
      .toBe('0 16 * * 5');
    expect(scheduleFrequencyToCron({ repeat: 'custom', time: '10:05', days: [1, 3, 5] }))
      .toBe('5 10 * * 1,3,5');
  });

  it('recognizes existing schedules and preserves unsupported legacy cron expressions', () => {
    expect(cronToScheduleFrequency('0 8 * * *')).toEqual({
      repeat: 'daily',
      time: '08:00',
      days: [],
    });
    expect(cronToScheduleFrequency('30 9 * * 1-5')).toEqual({
      repeat: 'weekdays',
      time: '09:30',
      days: [],
    });
    expect(cronToScheduleFrequency('0 16 * * 5')).toEqual({
      repeat: 'weekly',
      time: '16:00',
      days: [5],
    });
    expect(cronToScheduleFrequency('0 9 1 * *')).toEqual({
      repeat: 'advanced',
      time: '09:00',
      days: [],
      legacyCron: '0 9 1 * *',
    });
  });

  it('formats schedules in language ordinary users can understand', () => {
    expect(formatScheduleFrequency('15 * * * *')).toBe('每小时第 15 分钟');
    expect(formatScheduleFrequency('0 8 * * 1-5')).toBe('工作日 08:00');
    expect(formatScheduleFrequency('0 16 * * 5')).toBe('每周五 16:00');
    expect(formatScheduleFrequency('0 10 * * 1,3,5')).toBe('每周一、周三、周五 10:00');
    expect(formatScheduleFrequency('0 9 1 * *')).toBe('自定义计划');
  });
});
