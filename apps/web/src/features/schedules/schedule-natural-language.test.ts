import { describe, expect, it } from 'vitest';
import { createNaturalLanguageScheduleRequest } from './schedule-natural-language.js';

describe('schedule natural language', () => {
  it('creates a schedule request for a common reminder with working hours', () => {
    const result = createNaturalLanguageScheduleRequest(
      '设置一个5分钟的定时任务，提醒我喝水，工作时间8:00~18:00',
      {
        cwd: '~/develop/content-design',
        profile: 'default',
        sandbox: 'danger-full-access',
        timezone: 'Asia/Shanghai'
      }
    );

    expect(result).toEqual({
      ok: true,
      request: {
        name: '喝水提醒',
        cron: '*/5 8-17 * * *',
        timezone: 'Asia/Shanghai',
        enabled: true,
        prompt: '提醒我喝水',
        profile: 'default',
        cwd: '~/develop/content-design',
        sandbox: 'danger-full-access',
        concurrencyPolicy: 'skip',
        misfirePolicy: 'skip'
      },
      description: '每 5 分钟提醒，08:00-18:00'
    });
  });

  it('asks for missing schedule details instead of guessing', () => {
    const result = createNaturalLanguageScheduleRequest(
      '帮我安排一下',
      {
        profile: 'default',
        sandbox: 'read-only',
        timezone: 'Asia/Shanghai'
      }
    );

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('提醒内容')
    });
  });

  it('creates a simple weekdays reminder from a daily time', () => {
    const result = createNaturalLanguageScheduleRequest(
      '工作日 18:30 提醒我写日报',
      {
        profile: 'review',
        sandbox: 'workspace-write',
        timezone: 'Asia/Shanghai'
      }
    );

    expect(result).toMatchObject({
      ok: true,
      request: {
        name: '写日报提醒',
        cron: '30 18 * * 1-5',
        prompt: '提醒我写日报',
        profile: 'review',
        sandbox: 'workspace-write'
      },
      description: '工作日 18:30 提醒'
    });
  });
});
