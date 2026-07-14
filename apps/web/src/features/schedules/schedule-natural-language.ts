import type {
  CreateScheduleRequest,
  ReasoningEffort,
  SandboxMode
} from '@clawee/protocol';

export type NaturalLanguageScheduleContext = {
  cwd?: string;
  profile: string;
  sandbox: SandboxMode;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  timezone: string;
};

export type NaturalLanguageScheduleResult =
  | {
      ok: true;
      request: CreateScheduleRequest;
      description: string;
    }
  | {
      ok: false;
      message: string;
    };

type TimeRange = {
  startHour: number;
  endHour: number;
  label: string;
};

type DailyTime = {
  hour: number;
  minute: number;
  weekdaysOnly: boolean;
};

export function createNaturalLanguageScheduleRequest(
  text: string,
  context: NaturalLanguageScheduleContext
): NaturalLanguageScheduleResult {
  const normalized = normalizeInput(text);
  const reminder = parseReminder(normalized);
  const interval = parseMinuteInterval(normalized);
  const dailyTime = interval === undefined ? parseDailyTime(normalized) : undefined;
  const range = parseTimeRange(normalized);

  if (reminder === undefined) {
    return {
      ok: false,
      message: '我还缺少提醒内容。请像这样描述：每 5 分钟提醒我喝水。'
    };
  }
  if (interval === undefined && dailyTime === undefined) {
    return {
      ok: false,
      message: '我还缺少执行时间。请像这样描述：每 5 分钟、每天 9:00，或工作日 18:00。'
    };
  }

  const cron = interval === undefined
    ? buildDailyCron(dailyTime!)
    : buildMinuteIntervalCron(interval, range);
  const request: CreateScheduleRequest = {
    name: `${reminder.subject}提醒`,
    cron,
    timezone: context.timezone,
    enabled: true,
    prompt: reminder.prompt,
    profile: context.profile,
    sandbox: context.sandbox,
    concurrencyPolicy: 'skip',
    misfirePolicy: 'skip'
  };
  if (context.cwd !== undefined && context.cwd.trim().length > 0) {
    request.cwd = context.cwd.trim();
  }
  if (context.model !== undefined && context.model !== null && context.model.trim().length > 0) {
    request.model = context.model.trim();
  }
  if (context.reasoning !== undefined && context.reasoning !== null) {
    request.reasoning = context.reasoning;
  }

  return {
    ok: true,
    request,
    description: interval === undefined
      ? formatDailyDescription(dailyTime!)
      : range === undefined
        ? `每 ${interval} 分钟提醒`
        : `每 ${interval} 分钟提醒，${range.label}`
  };
}

function buildMinuteIntervalCron(intervalMinutes: number, range: TimeRange | undefined): string {
  const minuteField = intervalMinutes === 1 ? '*' : `*/${intervalMinutes}`;
  const hourField = range === undefined
    ? '*'
    : `${range.startHour}-${Math.max(range.startHour, range.endHour - 1)}`;
  return `${minuteField} ${hourField} * * *`;
}

function buildDailyCron(time: DailyTime): string {
  return `${time.minute} ${time.hour} * * ${time.weekdaysOnly ? '1-5' : '*'}`;
}

function parseMinuteInterval(text: string): number | undefined {
  const match = /(?:每隔|每)?\s*(\d{1,2})\s*(?:分钟|分)\b/.exec(text)
    ?? /(\d{1,2})\s*(?:分钟|分).{0,8}(?:一次|定时|提醒|任务)/.exec(text);
  if (match === null) return undefined;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 59) return undefined;
  return value;
}

function parseDailyTime(text: string): DailyTime | undefined {
  const weekdaysOnly = /(工作日|周一到周五|星期一到星期五)/.test(text);
  const match = /(?:每天|每日|工作日|周一到周五|星期一到星期五).{0,8}?(\d{1,2})(?:[:：点](\d{1,2}))?/.exec(text);
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  if (!isValidHour(hour) || !isValidMinute(minute)) return undefined;
  return { hour, minute, weekdaysOnly };
}

function parseTimeRange(text: string): TimeRange | undefined {
  const match = /(\d{1,2})(?:[:：点](\d{1,2}))?\s*(?:~|〜|-|—|到|至)\s*(\d{1,2})(?:[:：点](\d{1,2}))?/.exec(text);
  if (match === null) return undefined;
  const startHour = Number(match[1]);
  const startMinute = match[2] === undefined ? 0 : Number(match[2]);
  const endHour = Number(match[3]);
  const endMinute = match[4] === undefined ? 0 : Number(match[4]);
  if (!isValidHour(startHour) || !isValidHour(endHour)) return undefined;
  if (!isValidMinute(startMinute) || !isValidMinute(endMinute)) return undefined;
  if (startMinute !== 0 || endMinute !== 0) return undefined;
  if (endHour <= startHour) return undefined;
  return {
    startHour,
    endHour,
    label: `${padTime(startHour)}:00-${padTime(endHour)}:00`
  };
}

function parseReminder(text: string): { subject: string; prompt: string } | undefined {
  const match = /(?:提醒我|提醒|通知我|叫我)\s*([^，。,.；;]+)/.exec(text);
  if (match === null) return undefined;
  const subject = cleanReminderSubject(match[1] ?? '');
  if (subject.length === 0) return undefined;
  return {
    subject,
    prompt: `提醒我${subject}`
  };
}

function cleanReminderSubject(value: string): string {
  return value
    .replace(/^(一下|去|该)/, '')
    .replace(/(一下|一次|这件事|这件事情)$/g, '')
    .replace(/\s+/g, '')
    .slice(0, 40);
}

function normalizeInput(text: string): string {
  return text
    .replace(/\u3000/g, ' ')
    .replace(/[，]/g, '，')
    .trim();
}

function isValidHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

function isValidMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 59;
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDailyDescription(time: DailyTime): string {
  const dayLabel = time.weekdaysOnly ? '工作日' : '每天';
  return `${dayLabel} ${padTime(time.hour)}:${padTime(time.minute)} 提醒`;
}
