export type MisfirePolicy = 'skip' | 'run_once';

export type ScheduleRecord = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  misfirePolicy: MisfirePolicy;
  nextRunAt: string;
};
