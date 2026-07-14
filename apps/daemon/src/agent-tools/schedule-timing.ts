import {
  getDefaultTimezone,
  isValidTimezone,
  validateCronExpression
} from '../scheduler/cron.js';

export type AgentScheduleTiming =
  | {
      type: 'interval';
      everyMinutes: number;
      startTime?: string;
      endTime?: string;
    }
  | {
      type: 'daily';
      time: string;
      weekdaysOnly?: boolean;
    }
  | {
      type: 'weekly';
      weekdays: number[];
      time: string;
    }
  | {
      type: 'cron';
      expression: string;
    };

export class AgentScheduleTimingError extends Error {
  readonly code = 'SCHEDULE_TIMING_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'AgentScheduleTimingError';
  }
}

export function convertAgentScheduleTiming(input: {
  timing: AgentScheduleTiming;
  timezone?: string;
  defaultTimezone?: string;
}): { cron: string; timezone: string } {
  const timezone = input.timezone ?? input.defaultTimezone ?? getDefaultTimezone();
  if (!isValidTimezone(timezone)) {
    throw new AgentScheduleTimingError('timezone must be a valid IANA timezone');
  }

  const cron = timingToCron(input.timing);
  const validation = validateCronExpression(cron);
  if (!validation.ok) {
    throw new AgentScheduleTimingError(`timing produced invalid cron: ${validation.message}`);
  }
  return { cron, timezone };
}

function timingToCron(timing: AgentScheduleTiming): string {
  switch (timing.type) {
    case 'interval':
      return intervalToCron(timing);
    case 'daily': {
      const { hour, minute } = parseClockTime(timing.time, 'time');
      return `${minute} ${hour} * * ${timing.weekdaysOnly === true ? '1-5' : '*'}`;
    }
    case 'weekly': {
      const { hour, minute } = parseClockTime(timing.time, 'time');
      const weekdays = [...new Set(timing.weekdays)].sort((left, right) => left - right);
      if (
        weekdays.length === 0
        || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
      ) {
        throw new AgentScheduleTimingError(
          'weekdays must contain one or more integers between 0 and 6'
        );
      }
      return `${minute} ${hour} * * ${weekdays.join(',')}`;
    }
    case 'cron': {
      const expression = timing.expression.trim();
      if (expression.length === 0) {
        throw new AgentScheduleTimingError('cron expression must be non-empty');
      }
      return expression;
    }
  }
}

function intervalToCron(
  timing: Extract<AgentScheduleTiming, { type: 'interval' }>
): string {
  const everyMinutes = timing.everyMinutes;
  if (
    !Number.isInteger(everyMinutes)
    || everyMinutes < 1
    || everyMinutes > 60
  ) {
    throw new AgentScheduleTimingError('everyMinutes must be an integer between 1 and 60');
  }

  const hasStart = timing.startTime !== undefined;
  const hasEnd = timing.endTime !== undefined;
  if (hasStart !== hasEnd) {
    throw new AgentScheduleTimingError('startTime and endTime must be provided together');
  }
  if (!hasStart || !hasEnd) {
    return everyMinutes === 60 ? '0 * * * *' : `*/${everyMinutes} * * * *`;
  }
  if (60 % everyMinutes !== 0) {
    throw new AgentScheduleTimingError(
      'windowed everyMinutes must divide 60 exactly'
    );
  }

  const start = parseClockTime(timing.startTime!, 'startTime');
  const end = parseClockTime(timing.endTime!, 'endTime');
  if (start.minute !== 0 || end.minute !== 0) {
    throw new AgentScheduleTimingError(
      'windowed interval startTime and endTime must be on an hour boundary'
    );
  }
  if (end.hour <= start.hour) {
    throw new AgentScheduleTimingError('endTime must be later than startTime');
  }

  const minuteField = everyMinutes === 60
    ? '0'
    : Array.from(
        { length: 60 / everyMinutes },
        (_value, index) => index * everyMinutes
      ).join(',');
  const lastHour = end.hour - 1;
  const hourField = lastHour === start.hour
    ? String(start.hour)
    : `${start.hour}-${lastHour}`;
  return `${minuteField} ${hourField} * * *`;
}

function parseClockTime(
  value: string,
  field: 'time' | 'startTime' | 'endTime'
): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (match === null) {
    throw new AgentScheduleTimingError(`${field} must use HH:mm`);
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}
