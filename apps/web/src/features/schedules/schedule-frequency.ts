export type ScheduleRepeat =
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'custom'
  | 'advanced';

export type ScheduleFrequency = {
  repeat: ScheduleRepeat;
  time: string;
  days: number[];
  legacyCron?: string;
};

export const defaultScheduleFrequency: ScheduleFrequency = {
  repeat: 'daily',
  time: '09:00',
  days: [],
};

export const scheduleRepeatOptions: Array<{ value: ScheduleRepeat; label: string }> = [
  { value: 'hourly', label: '每小时' },
  { value: 'daily', label: '每天' },
  { value: 'weekdays', label: '工作日' },
  { value: 'weekly', label: '每周' },
  { value: 'custom', label: '自定义' },
];

export const scheduleWeekdays = [
  { value: 1, shortLabel: '一', label: '周一' },
  { value: 2, shortLabel: '二', label: '周二' },
  { value: 3, shortLabel: '三', label: '周三' },
  { value: 4, shortLabel: '四', label: '周四' },
  { value: 5, shortLabel: '五', label: '周五' },
  { value: 6, shortLabel: '六', label: '周六' },
  { value: 0, shortLabel: '日', label: '周日' },
] as const;

export function scheduleFrequencyToCron(frequency: ScheduleFrequency): string {
  if (frequency.repeat === 'advanced') {
    const legacyCron = frequency.legacyCron?.trim();
    if (legacyCron === undefined || legacyCron.length === 0) {
      throw new Error('高级计划缺少原始表达式');
    }
    return legacyCron;
  }

  const { hour, minute } = parseTime(frequency.time);
  if (frequency.repeat === 'hourly') return `${minute} * * * *`;
  if (frequency.repeat === 'daily') return `${minute} ${hour} * * *`;
  if (frequency.repeat === 'weekdays') return `${minute} ${hour} * * 1-5`;

  const days = normalizeDays(frequency.days);
  if (days.length === 0) throw new Error('请至少选择一天');
  if (frequency.repeat === 'weekly') {
    return `${minute} ${hour} * * ${days[0]}`;
  }
  return `${minute} ${hour} * * ${days.join(',')}`;
}

export function cronToScheduleFrequency(cron: string): ScheduleFrequency {
  const normalized = cron.trim().replace(/\s+/g, ' ');
  const fields = normalized.split(' ');
  if (fields.length !== 5) return advancedFrequency(normalized);
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = fields;
  const minute = parseCronNumber(minuteField, 0, 59);
  if (minute === undefined || dayOfMonth !== '*' || month !== '*') {
    return advancedFrequency(normalized);
  }

  if (hourField === '*' && dayOfWeek === '*') {
    return {
      repeat: 'hourly',
      time: `00:${padTime(minute)}`,
      days: [],
    };
  }

  const hour = parseCronNumber(hourField, 0, 23);
  if (hour === undefined) return advancedFrequency(normalized);
  const time = `${padTime(hour)}:${padTime(minute)}`;

  if (dayOfWeek === '*') return { repeat: 'daily', time, days: [] };
  if (dayOfWeek === '1-5') return { repeat: 'weekdays', time, days: [] };

  if (dayOfWeek === undefined) return advancedFrequency(normalized);
  const days = parseCronDays(dayOfWeek);
  if (days === undefined || days.length === 0) return advancedFrequency(normalized);
  return {
    repeat: days.length === 1 ? 'weekly' : 'custom',
    time,
    days,
  };
}

export function formatScheduleFrequency(cron: string): string {
  const frequency = cronToScheduleFrequency(cron);
  switch (frequency.repeat) {
    case 'hourly':
      return `每小时第 ${Number(frequency.time.slice(3, 5))} 分钟`;
    case 'daily':
      return `每天 ${frequency.time}`;
    case 'weekdays':
      return `工作日 ${frequency.time}`;
    case 'weekly':
    case 'custom':
      return `每${frequency.days.map(day => weekdayLabel(day)).join('、')} ${frequency.time}`;
    case 'advanced':
      return '自定义计划';
  }
}

export function formatScheduleNextRun(
  value: string | null | undefined,
  timezone: string
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) throw new Error('请选择有效时间');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('请选择有效时间');
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('请选择有效时间');
  }
  return { hour, minute };
}

function parseCronNumber(
  value: string | undefined,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number >= minimum && number <= maximum ? number : undefined;
}

function parseCronDays(value: string): number[] | undefined {
  const fields = value.split(',');
  const days: number[] = [];
  for (const field of fields) {
    const day = parseCronNumber(field, 0, 7);
    if (day === undefined) return undefined;
    days.push(day === 7 ? 0 : day);
  }
  return normalizeDays(days);
}

function normalizeDays(days: readonly number[]): number[] {
  return Array.from(
    new Set(days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))
  ).sort((left, right) => {
    const leftOrder = left === 0 ? 7 : left;
    const rightOrder = right === 0 ? 7 : right;
    return leftOrder - rightOrder;
  });
}

function advancedFrequency(cron: string): ScheduleFrequency {
  return {
    repeat: 'advanced',
    time: '09:00',
    days: [],
    legacyCron: cron,
  };
}

function weekdayLabel(day: number): string {
  return scheduleWeekdays.find(option => option.value === day)?.label ?? '周一';
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}
