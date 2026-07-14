import type {
  ReasoningEffort,
  SandboxMode,
  ScheduleConcurrencyPolicy,
  ScheduleLastStatus,
  ScheduleMisfirePolicy,
  ScheduleOperationStatus,
  ScheduleOperationType
} from '@clawee/protocol';

export type LegacyMisfirePolicy = ScheduleMisfirePolicy | 'run_once';

export type SchedulerClock = {
  now(): Date;
};

export type ScheduleRecord = {
  id: string;
  threadId: string | null;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  prompt: string;
  promptHash: string;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: ScheduleMisfirePolicy;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: ScheduleLastStatus | null;
  pendingTrigger: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type InsertScheduleInput = Omit<
  ScheduleRecord,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'deletedAt'
  | 'lastRunAt'
  | 'lastRunId'
  | 'lastStatus'
  | 'pendingTrigger'
  | 'threadId'
> & {
  threadId?: string | null;
};

export type UpdateScheduleInput = Partial<
  Pick<
    ScheduleRecord,
    | 'threadId'
    | 'name'
    | 'cron'
    | 'timezone'
    | 'enabled'
    | 'prompt'
    | 'promptHash'
    | 'promptPreviewRedacted'
    | 'profile'
    | 'cwd'
    | 'canonicalCwd'
    | 'model'
    | 'reasoning'
    | 'sandbox'
    | 'timeoutMs'
    | 'concurrencyPolicy'
    | 'misfirePolicy'
    | 'nextRunAt'
    | 'lastRunAt'
    | 'lastRunId'
    | 'lastStatus'
    | 'pendingTrigger'
  >
>;

export type ScheduleOperationRecord = {
  id: string;
  operation: ScheduleOperationType;
  scheduleId: string;
  status: ScheduleOperationStatus;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type InsertScheduleOperationInput = {
  operation: ScheduleOperationType;
  scheduleId: string;
  status: ScheduleOperationStatus;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ProfileValidator = {
  validateProfileForRun(name: string): { ok: true } | { ok: false; code: string; message: string };
};
