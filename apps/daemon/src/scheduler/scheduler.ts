import type { LegacyMisfirePolicy } from './types.js';

export type ShouldRunMissedScheduleInput = {
  enabled: boolean;
  misfirePolicy: LegacyMisfirePolicy;
  nextRunAt: string;
  now: string;
};

export function shouldRunMissedSchedule(input: ShouldRunMissedScheduleInput): boolean {
  if (!input.enabled) return false;
  if (new Date(input.nextRunAt).getTime() > new Date(input.now).getTime()) return false;
  return false;
}
