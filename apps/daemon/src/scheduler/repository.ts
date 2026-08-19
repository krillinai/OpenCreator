import type {
  ScheduleActorType,
  ScheduleDiagnosticEvent,
  ScheduleDiagnosticEventType,
  ScheduleRunTrace,
  ScheduleTriggerType
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import type {
  InsertScheduleInput,
  InsertScheduleOperationInput,
  ScheduleOperationActor,
  ScheduleOperationRecord,
  ScheduleRecord,
  UpdateScheduleInput
} from './types.js';

type ScheduleRow = {
  id: string;
  thread_id: string | null;
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
  actor_type: string | null;
  actor_run_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

type ScheduleRunTraceRow = {
  operation_id: string;
  schedule_id: string;
  operation: ScheduleTriggerType;
  actor_type: string | null;
  actor_run_id: string | null;
  operation_created_at: string;
  operation_error_code: string | null;
  schedule_thread_id: string | null;
  run_id: string;
  run_thread_id: string | null;
  triggered_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  run_updated_at: string;
  public_status: ScheduleRunTrace['status'];
  queue_state: string;
  run_error_code: string | null;
  approval_requested_at: string | null;
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
  id, thread_id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
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
          id, thread_id, name, cron, timezone, enabled, prompt, prompt_hash, prompt_preview_redacted,
          profile, cwd, canonical_cwd, model, reasoning, sandbox, timeout_ms, concurrency_policy,
          misfire_policy, next_run_at, pending_trigger, created_at, updated_at
        ) VALUES (
          @id, @threadId, @name, @cron, @timezone, @enabled, @prompt, @promptHash, @promptPreviewRedacted,
          @profile, @cwd, @canonicalCwd, @model, @reasoning, @sandbox, @timeoutMs, @concurrencyPolicy,
          @misfirePolicy, @nextRunAt, 0, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id,
        threadId: input.threadId ?? null,
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

  listProfileReferences(profile: string): Array<{ id: string; name: string }> {
    return this.db
      .prepare<string>(
        `
        SELECT id, name
        FROM schedules
        WHERE profile = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC
      `
      )
      .all(profile) as Array<{ id: string; name: string }>;
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

  getNextEnabled(): ScheduleRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT ${scheduleColumns}
        FROM schedules
        WHERE enabled = 1
          AND deleted_at IS NULL
          AND next_run_at IS NOT NULL
        ORDER BY next_run_at ASC, id ASC
        LIMIT 1
      `
      )
      .get() as ScheduleRow | undefined;
    return row === undefined ? null : mapSchedule(row);
  }

  listPendingTriggers(): ScheduleRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT ${scheduleColumns}
        FROM schedules
        WHERE enabled = 1
          AND deleted_at IS NULL
          AND pending_trigger = 1
        ORDER BY updated_at ASC, id ASC
      `
      )
      .all() as ScheduleRow[];
    return rows.map(mapSchedule);
  }

  setPendingTrigger(id: string, pending: boolean): ScheduleRecord | null {
    return this.update(id, { pendingTrigger: pending });
  }

  recordRun(input: {
    id: string;
    runId: string;
    ranAt: string;
    status: ScheduleRecord['lastStatus'];
  }): ScheduleRecord | null {
    return this.update(input.id, {
      lastRunAt: input.ranAt,
      lastRunId: input.runId,
      lastStatus: input.status,
      pendingTrigger: false
    });
  }

  recordSkipped(input: {
    id: string;
    status: Extract<ScheduleRecord['lastStatus'], 'skipped' | 'queued' | 'failed'>;
  }): ScheduleRecord | null {
    return this.update(input.id, { lastStatus: input.status });
  }

  reconcileLastRunStatuses(): number {
    const result = this.db
      .prepare<{ updatedAt: string }>(
        `
        UPDATE schedules
        SET last_status = (
              SELECT runs.public_status
              FROM runs
              WHERE runs.id = schedules.last_run_id
            ),
            updated_at = @updatedAt
        WHERE deleted_at IS NULL
          AND last_run_id IS NOT NULL
          AND last_status IN ('queued', 'running')
          AND EXISTS (
            SELECT 1
            FROM runs
            WHERE runs.id = schedules.last_run_id
              AND runs.created_by = 'schedule'
              AND runs.source_id = schedules.id
              AND runs.public_status IN ('succeeded', 'failed', 'canceled')
          )
      `
      )
      .run({ updatedAt: this.now() });
    return result.changes;
  }

  insertOperation(
    input: InsertScheduleOperationInput,
    actor: ScheduleOperationActor
  ): ScheduleOperationRecord {
    const id = this.operationIdFactory();
    const createdAt = this.now();
    const actorRunId = actor.type === 'agent' ? actor.runId : null;
    this.db
      .prepare(
        `
        INSERT INTO schedule_operations (
          id, schedule_id, operation, status, run_id, actor_type, actor_run_id,
          error_code, error_message, created_at
        ) VALUES (
          @id, @scheduleId, @operation, @status, @runId, @actorType, @actorRunId,
          @errorCode, @errorMessage, @createdAt
        )
      `
      )
      .run({
        id,
        scheduleId: input.scheduleId,
        operation: input.operation,
        status: input.status,
        runId: input.runId ?? null,
        actorType: actor.type,
        actorRunId,
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
      actorType: actor.type,
      actorRunId,
      diagnosticEvent: diagnosticEventForOperation(input.operation),
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      createdAt
    };
  }

  listOperations(scheduleId: string, limit = 50): ScheduleOperationRecord[] {
    const rows = this.db
      .prepare<{ scheduleId: string; limit: number }>(
        `
        SELECT id, schedule_id, operation, status, run_id, actor_type, actor_run_id,
               error_code, error_message, created_at
        FROM schedule_operations
        WHERE schedule_id = @scheduleId
        ORDER BY created_at DESC, rowid DESC
        LIMIT @limit
      `
      )
      .all({ scheduleId, limit }) as ScheduleOperationRow[];
    return rows.map(mapOperation);
  }

  getRunTrace(runId: string): ScheduleRunTrace | undefined {
    const row = this.db
      .prepare<string>(
        `
        SELECT
          operation.id AS operation_id,
          operation.schedule_id,
          operation.operation,
          operation.actor_type,
          operation.actor_run_id,
          operation.created_at AS operation_created_at,
          operation.error_code AS operation_error_code,
          schedule.thread_id AS schedule_thread_id,
          run.id AS run_id,
          run.thread_id AS run_thread_id,
          run.triggered_at,
          run.started_at,
          run.ended_at,
          run.updated_at AS run_updated_at,
          run.public_status,
          run.queue_state,
          run.error_code AS run_error_code,
          (
            SELECT MAX(approval.requested_at)
            FROM approvals approval
            WHERE approval.run_id = run.id
          ) AS approval_requested_at
        FROM schedule_operations operation
        JOIN schedules schedule ON schedule.id = operation.schedule_id
        JOIN runs run ON run.id = operation.run_id
        WHERE operation.run_id = ?
          AND operation.operation IN ('run_now', 'timer_trigger', 'run_queued')
          AND run.created_by = 'schedule'
          AND run.source_id = operation.schedule_id
        ORDER BY operation.created_at DESC, operation.rowid DESC
        LIMIT 1
      `
      )
      .get(runId) as ScheduleRunTraceRow | undefined;
    if (row === undefined) return undefined;

    const threadId = row.run_thread_id ?? row.schedule_thread_id;
    if (threadId === null) return undefined;
    return mapRunTrace(row, threadId);
  }

}

function mapSchedule(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
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
    actorType: parseActorType(row.actor_type),
    actorRunId: row.actor_run_id,
    diagnosticEvent: diagnosticEventForOperation(row.operation),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

function mapRunTrace(row: ScheduleRunTraceRow, threadId: string): ScheduleRunTrace {
  const errorCode = row.run_error_code ?? row.operation_error_code;
  const events: ScheduleDiagnosticEvent[] = [];
  const triggerEvent = diagnosticEventForOperation(row.operation);
  if (triggerEvent !== undefined) {
    events.push({
      type: triggerEvent,
      occurredAt: row.operation_created_at,
      operationId: row.operation_id
    });
  }
  if (row.started_at !== null) {
    events.push({
      type: 'SCHEDULE_RUN_STARTED',
      occurredAt: row.started_at
    });
  }
  if (row.approval_requested_at !== null) {
    events.push({
      type: 'SCHEDULE_RUN_WAITING_APPROVAL',
      occurredAt: row.approval_requested_at
    });
  }
  if (isTerminalRunStatus(row.public_status)) {
    events.push({
      type: 'SCHEDULE_RUN_COMPLETED',
      occurredAt: row.ended_at ?? row.run_updated_at,
      ...(errorCode === null ? {} : { errorCode })
    });
  }
  events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  return {
    scheduleId: row.schedule_id,
    threadId,
    runId: row.run_id,
    triggerType: row.operation,
    actorType: parseActorType(row.actor_type),
    actorRunId: row.actor_run_id,
    scheduledAt: row.triggered_at ?? row.operation_created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.public_status,
    queueReason:
      row.operation === 'run_queued'
      || row.queue_state === 'queued'
      || row.public_status === 'queued'
        ? 'thread_active'
        : null,
    errorCode,
    events
  };
}

function diagnosticEventForOperation(
  operation: ScheduleOperationRecord['operation']
): ScheduleDiagnosticEventType | undefined {
  if (
    operation === 'run_now'
    || operation === 'timer_trigger'
    || operation === 'run_queued'
  ) {
    return 'SCHEDULE_TRIGGERED';
  }
  if (operation === 'queue_trigger') return 'SCHEDULE_TRIGGER_QUEUED';
  if (operation === 'skip_misfire' || operation === 'skip_concurrency') {
    return 'SCHEDULE_TRIGGER_SKIPPED';
  }
  if (operation === 'binding_repair') return 'SCHEDULE_THREAD_REPAIRED';
  if (operation === 'binding_repair_failed') return 'SCHEDULE_THREAD_REPAIR_FAILED';
  return undefined;
}

function parseActorType(value: string | null): ScheduleActorType | null {
  if (value === 'user' || value === 'agent' || value === 'timer' || value === 'migration') {
    return value;
  }
  return null;
}

function isTerminalRunStatus(status: ScheduleRunTrace['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function updateEntries(input: UpdateScheduleInput): Array<[string, string | number | null]> {
  const entries: Array<[string, string | number | null]> = [];
  addIfOwn(entries, input, 'threadId', 'thread_id');
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
  addIfOwn(entries, input, 'lastRunAt', 'last_run_at');
  addIfOwn(entries, input, 'lastRunId', 'last_run_id');
  addIfOwn(entries, input, 'lastStatus', 'last_status');
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
