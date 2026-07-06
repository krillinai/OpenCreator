import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  InsertScheduleInput,
  InsertScheduleOperationInput,
  ScheduleOperationRecord,
  ScheduleRecord,
  UpdateScheduleInput
} from './types.js';

type ScheduleRow = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: number;
  prompt: string;
  prompt_hash: string;
  prompt_preview_redacted: string;
  profile: string;
  cwd: string;
  canonical_cwd: string;
  model: string | null;
  reasoning: ScheduleRecord['reasoning'];
  sandbox: ScheduleRecord['sandbox'];
  timeout_ms: number | null;
  concurrency_policy: ScheduleRecord['concurrencyPolicy'];
  misfire_policy: ScheduleRecord['misfirePolicy'];
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_id: string | null;
  last_status: ScheduleRecord['lastStatus'];
  pending_trigger: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type ScheduleOperationRow = {
  id: string;
  schedule_id: string;
  operation: ScheduleOperationRecord['operation'];
  status: ScheduleOperationRecord['status'];
  run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

type ScheduleRepositoryOptions = {
  idFactory?: () => string;
  operationIdFactory?: () => string;
  now?: () => string;
};

type UpdateBinding = {
  id: string;
  [key: string]: string | number | null;
};

const scheduleColumns = `
  id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
  profile, cwd, canonical_cwd, model, reasoning, sandbox, timeout_ms, concurrency_policy,
  misfire_policy, next_run_at, last_run_at, last_run_id, last_status, pending_trigger,
  created_at, updated_at, deleted_at
`;

export class ScheduleRepository {
  private readonly idFactory: () => string;
  private readonly operationIdFactory: () => string;
  private readonly now: () => string;

  constructor(private readonly db: Database.Database, options: ScheduleRepositoryOptions = {}) {
    this.idFactory = options.idFactory ?? (() => `sch_${nanoid()}`);
    this.operationIdFactory = options.operationIdFactory ?? (() => `schop_${nanoid()}`);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  create(input: InsertScheduleInput): ScheduleRecord {
    const id = this.idFactory();
    const now = this.now();
    this.db
      .prepare(
        `
        INSERT INTO schedules (
          id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
          profile, cwd, canonical_cwd, model, reasoning, sandbox, timeout_ms, concurrency_policy,
          misfire_policy, next_run_at, pending_trigger, created_at, updated_at
        ) VALUES (
          @id, @name, @cron, @timezone, @enabled, @prompt, @promptHash, @promptPreviewRedacted,
          @profile, @cwd, @canonicalCwd, @model, @reasoning, @sandbox, @timeoutMs, @concurrencyPolicy,
          @misfirePolicy, @nextRunAt, 0, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id,
        name: input.name,
        cron: input.cron,
        timezone: input.timezone,
        enabled: booleanToInteger(input.enabled),
        prompt: input.prompt,
        promptHash: input.promptHash,
        promptPreviewRedacted: input.promptPreviewRedacted,
        profile: input.profile,
        cwd: input.cwd,
        canonicalCwd: input.canonicalCwd,
        model: input.model ?? null,
        reasoning: input.reasoning ?? null,
        sandbox: input.sandbox,
        timeoutMs: input.timeoutMs ?? null,
        concurrencyPolicy: input.concurrencyPolicy,
        misfirePolicy: input.misfirePolicy,
        nextRunAt: input.nextRunAt ?? null,
        createdAt: now,
        updatedAt: now
      });

    const created = this.getById(id);
    if (created === null) throw new Error(`Created schedule not found: ${id}`);
    return created;
  }

  getById(id: string): ScheduleRecord | null {
    const row = this.db
      .prepare<string>(`SELECT ${scheduleColumns} FROM schedules WHERE id = ? AND deleted_at IS NULL`)
      .get(id) as ScheduleRow | undefined;
    return row === undefined ? null : mapSchedule(row);
  }

  list(): ScheduleRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT ${scheduleColumns}
        FROM schedules
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
      `
      )
      .all() as ScheduleRow[];
    return rows.map(mapSchedule);
  }

  update(id: string, input: UpdateScheduleInput): ScheduleRecord | null {
    const entries = updateEntries(input);
    if (entries.length === 0) return this.getById(id);

    const bindings: UpdateBinding = { id };
    const assignments = entries.map(([column, value], index) => {
      const key = `value${index}`;
      bindings[key] = value;
      return `${column} = @${key}`;
    });
    bindings.updatedAt = this.now();
    assignments.push('updated_at = @updatedAt');

    this.db
      .prepare(
        `
        UPDATE schedules
        SET ${assignments.join(', ')}
        WHERE id = @id AND deleted_at IS NULL
      `
      )
      .run(bindings);

    return this.getById(id);
  }

  softDelete(id: string): boolean {
    const now = this.now();
    const result = this.db
      .prepare(
        `
        UPDATE schedules
        SET deleted_at = @now,
            updated_at = @now
        WHERE id = @id AND deleted_at IS NULL
      `
      )
      .run({ id, now });
    return result.changes > 0;
  }

  listDue(now: string): ScheduleRecord[] {
    const rows = this.db
      .prepare<string>(
        `
        SELECT ${scheduleColumns}
        FROM schedules
        WHERE enabled = 1
          AND deleted_at IS NULL
          AND next_run_at IS NOT NULL
          AND next_run_at <= ?
        ORDER BY next_run_at ASC, id ASC
      `
      )
      .all(now) as ScheduleRow[];
    return rows.map(mapSchedule);
  }

  setPendingTrigger(id: string, pending: boolean): ScheduleRecord | null {
    return this.update(id, { pendingTrigger: pending });
  }

  insertOperation(input: InsertScheduleOperationInput): ScheduleOperationRecord {
    const id = this.operationIdFactory();
    const createdAt = this.now();
    this.db
      .prepare(
        `
        INSERT INTO schedule_operations (
          id, schedule_id, operation, status, run_id, error_code, error_message, created_at
        ) VALUES (
          @id, @scheduleId, @operation, @status, @runId, @errorCode, @errorMessage, @createdAt
        )
      `
      )
      .run({
        id,
        scheduleId: input.scheduleId,
        operation: input.operation,
        status: input.status,
        runId: input.runId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        createdAt
      });

    return {
      id,
      scheduleId: input.scheduleId,
      operation: input.operation,
      status: input.status,
      runId: input.runId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt
    };
  }

  listOperations(scheduleId: string, limit = 50): ScheduleOperationRecord[] {
    const rows = this.db
      .prepare<{ scheduleId: string; limit: number }>(
        `
        SELECT id, schedule_id, operation, status, run_id, error_code, error_message, created_at
        FROM schedule_operations
        WHERE schedule_id = @scheduleId
        ORDER BY created_at DESC, rowid DESC
        LIMIT @limit
      `
      )
      .all({ scheduleId, limit }) as ScheduleOperationRow[];
    return rows.map(mapOperation);
  }

  hasActiveRunForSource(createdBy: 'schedule', sourceId: string): boolean {
    const row = this.db
      .prepare<{ createdBy: 'schedule'; sourceId: string }>(
        `
        SELECT 1 AS active
        FROM runs
        WHERE created_by = @createdBy
          AND source_id = @sourceId
          AND (
            public_status IN ('queued', 'running')
            OR internal_status IN ('queued', 'running', 'canceling')
          )
        LIMIT 1
      `
      )
      .get({ createdBy, sourceId }) as { active: number } | undefined;
    return row !== undefined;
  }
}

function mapSchedule(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled === 1,
    prompt: row.prompt,
    promptHash: row.prompt_hash,
    promptPreviewRedacted: row.prompt_preview_redacted,
    profile: row.profile,
    cwd: row.cwd,
    canonicalCwd: row.canonical_cwd,
    model: row.model,
    reasoning: row.reasoning,
    sandbox: row.sandbox,
    timeoutMs: row.timeout_ms,
    concurrencyPolicy: row.concurrency_policy,
    misfirePolicy: row.misfire_policy,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunId: row.last_run_id,
    lastStatus: row.last_status,
    pendingTrigger: row.pending_trigger === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function mapOperation(row: ScheduleOperationRow): ScheduleOperationRecord {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    operation: row.operation,
    status: row.status,
    runId: row.run_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

function updateEntries(input: UpdateScheduleInput): Array<[string, string | number | null]> {
  const entries: Array<[string, string | number | null]> = [];
  addIfOwn(entries, input, 'name', 'name');
  addIfOwn(entries, input, 'cron', 'cron');
  addIfOwn(entries, input, 'timezone', 'timezone');
  addBooleanIfOwn(entries, input, 'enabled', 'enabled');
  addIfOwn(entries, input, 'prompt', 'prompt');
  addIfOwn(entries, input, 'promptHash', 'prompt_hash');
  addIfOwn(entries, input, 'promptPreviewRedacted', 'prompt_preview_redacted');
  addIfOwn(entries, input, 'profile', 'profile');
  addIfOwn(entries, input, 'cwd', 'cwd');
  addIfOwn(entries, input, 'canonicalCwd', 'canonical_cwd');
  addIfOwn(entries, input, 'model', 'model');
  addIfOwn(entries, input, 'reasoning', 'reasoning');
  addIfOwn(entries, input, 'sandbox', 'sandbox');
  addIfOwn(entries, input, 'timeoutMs', 'timeout_ms');
  addIfOwn(entries, input, 'concurrencyPolicy', 'concurrency_policy');
  addIfOwn(entries, input, 'misfirePolicy', 'misfire_policy');
  addIfOwn(entries, input, 'nextRunAt', 'next_run_at');
  addBooleanIfOwn(entries, input, 'pendingTrigger', 'pending_trigger');
  return entries;
}

function addIfOwn<Key extends keyof UpdateScheduleInput>(
  entries: Array<[string, string | number | null]>,
  input: UpdateScheduleInput,
  key: Key,
  column: string
): void {
  if (Object.prototype.hasOwnProperty.call(input, key)) {
    entries.push([column, input[key] as string | number | null]);
  }
}

function addBooleanIfOwn<Key extends keyof UpdateScheduleInput>(
  entries: Array<[string, string | number | null]>,
  input: UpdateScheduleInput,
  key: Key,
  column: string
): void {
  if (Object.prototype.hasOwnProperty.call(input, key)) {
    entries.push([column, booleanToInteger(input[key] as boolean)]);
  }
}

function booleanToInteger(value: boolean): number {
  return value ? 1 : 0;
}
