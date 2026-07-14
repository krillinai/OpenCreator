import type {
  PublicRunStatus,
  TaskItem,
  TaskListQuery,
  TaskListResponse,
  TaskStatusFilter
} from '@clawee/protocol';
import type Database from 'better-sqlite3';
import type { ApprovalManager } from '../approvals/manager.js';
import type { RunManager } from '../runs/manager.js';
import type { RunRow } from '../storage/repositories.js';

type TaskRow = RunRow & {
  thread_title: string | null;
  schedule_name: string | null;
};

type TaskCursor = {
  version: 1;
  createdAt: string;
  id: string;
};

const TASK_STATUSES: ReadonlySet<string> = new Set([
  'all',
  'active',
  'terminal',
  'waiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled'
]);

export class TaskCursorError extends Error {
  constructor(message = 'Invalid task cursor') {
    super(message);
    this.name = 'TaskCursorError';
  }
}

export type TaskService = {
  list(query?: TaskListQuery): TaskListResponse;
};

export function createTaskService(options: {
  db: Database.Database;
  approvals: ApprovalManager;
  runs: Pick<RunManager, 'getRun'>;
}): TaskService {
  const listTasks = options.db.prepare<{
    status: TaskStatusFilter;
    cursorCreatedAt: string | null;
    cursorId: string | null;
    limit: number;
  }>(`
    SELECT r.*, t.title AS thread_title, s.name AS schedule_name
    FROM runs r
    LEFT JOIN threads t ON t.id = r.thread_id
    LEFT JOIN schedules s
      ON r.created_by = 'schedule' AND s.id = r.source_id
    WHERE (
      @cursorCreatedAt IS NULL
      OR r.created_at < @cursorCreatedAt
      OR (r.created_at = @cursorCreatedAt AND r.id < @cursorId)
    )
      AND (
        @status = 'all'
        OR (@status = 'active' AND r.public_status IN ('queued', 'running'))
        OR (@status = 'terminal' AND r.public_status IN ('succeeded', 'failed', 'canceled'))
        OR (
          @status = 'waiting_approval'
          AND EXISTS (
            SELECT 1 FROM approvals a
            WHERE a.run_id = r.id AND a.status = 'pending'
          )
        )
        OR (
          @status = 'running'
          AND r.public_status = 'running'
          AND NOT EXISTS (
            SELECT 1 FROM approvals a
            WHERE a.run_id = r.id AND a.status = 'pending'
          )
        )
        OR (@status = 'queued' AND r.public_status = 'queued')
        OR (@status = 'succeeded' AND r.public_status = 'succeeded')
        OR (@status = 'failed' AND r.public_status = 'failed')
        OR (@status = 'canceled' AND r.public_status = 'canceled')
      )
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT @limit
  `);

  return {
    list(query = {}) {
      const status = query.status ?? 'all';
      if (!TASK_STATUSES.has(status)) throw new TaskCursorError('Invalid task status');
      const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
      const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const rows = listTasks.all({
        status,
        cursorCreatedAt: cursor?.createdAt ?? null,
        cursorId: cursor?.id ?? null,
        limit: limit + 1
      }) as TaskRow[];
      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);
      const tasks = pageRows.map(row => mapTask(row, options));
      const last = pageRows.at(-1);
      return {
        tasks,
        hasMore,
        ...(hasMore && last !== undefined
          ? { nextCursor: encodeCursor({ version: 1, createdAt: last.created_at, id: last.id }) }
          : {})
      };
    }
  };
}

function mapTask(
  row: TaskRow,
  options: {
    approvals: ApprovalManager;
    runs: Pick<RunManager, 'getRun'>;
  }
): TaskItem {
  const pendingApproval = options.approvals.list({
    runId: row.id,
    status: 'pending',
    limit: 1
  })[0];
  const runtimeRun = options.runs.getRun(row.id);
  const runStatus = row.public_status as PublicRunStatus;
  return {
    id: row.id,
    runId: row.id,
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    title: row.thread_title
      ?? row.schedule_name
      ?? row.prompt_preview_redacted
      ?? `Run ${row.id}`,
    status: pendingApproval === undefined ? runStatus : 'waiting_approval',
    runStatus,
    cwd: row.cwd,
    profile: row.profile,
    createdBy: row.created_by,
    submissionMode: row.submission_mode,
    ...(runtimeRun?.queuePosition === undefined
      ? {}
      : { queuePosition: runtimeRun.queuePosition }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ...(row.termination_reason === null ? {} : { terminationReason: row.termination_reason }),
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    ...(pendingApproval === undefined ? {} : { pendingApproval })
  };
}

function encodeCursor(cursor: TaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): TaskCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object'
      || parsed === null
      || Array.isArray(parsed)
    ) {
      throw new TaskCursorError();
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.version !== 1
      || typeof record.createdAt !== 'string'
      || record.createdAt.length === 0
      || typeof record.id !== 'string'
      || record.id.length === 0
    ) {
      throw new TaskCursorError();
    }
    return {
      version: 1,
      createdAt: record.createdAt,
      id: record.id
    };
  } catch (error) {
    if (error instanceof TaskCursorError) throw error;
    throw new TaskCursorError();
  }
}
