import type {
  PublicRunStatus,
  TaskFailureKind,
  TaskItem,
  TaskListQuery,
  TaskListResponse,
  TaskStatusFilter
} from '@opencreator/protocol';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type { ApprovalManager } from '../approvals/manager.js';
import type { RunManager } from '../runs/manager.js';
import { redactText } from '../security/redaction.js';
import type { RunRow } from '../storage/repositories.js';

type TaskRow = RunRow & {
  thread_title: string | null;
  schedule_name: string | null;
  result_event_payload_json: string | null;
};

type ScheduleFailureRow = Pick<
  RunRow,
  | 'id'
  | 'source_id'
  | 'public_status'
  | 'error_code'
  | 'error_message'
  | 'termination_reason'
  | 'cwd'
  | 'canonical_cwd'
> & {
  run_position: number;
};

type FailureSummary = {
  kind: TaskFailureKind;
  summary: string;
  consecutiveCount: number;
  suggestPause: boolean;
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
const RESULT_SUMMARY_LIMIT = 120;
const INTERNAL_SCHEDULE_PROMPT_MARKERS = [
  '这是 OpenCreator 已经触发的一次计划任务执行。',
  '执行规则：'
] as const;

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
    SELECT
      r.*,
      t.title AS thread_title,
      s.name AS schedule_name,
      (
        SELECT e.payload_json
        FROM run_events e
        WHERE e.run_id = r.id
          AND e.type = 'assistant_message'
        ORDER BY e.seq DESC
        LIMIT 1
      ) AS result_event_payload_json
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
      const failureSummaries = loadScheduleFailureSummaries(options.db, pageRows);
      const tasks = pageRows.map(row => mapTask(
        row,
        options,
        failureSummaries.get(row.id)
      ));
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
  },
  failure: FailureSummary | undefined
): TaskItem {
  const pendingApproval = options.approvals.list({
    runId: row.id,
    status: 'pending',
    limit: 1
  })[0];
  const runtimeRun = options.runs.getRun(row.id);
  const runStatus = row.public_status as PublicRunStatus;
  const resultSummary = parseResultSummary(row.result_event_payload_json);
  return {
    id: row.id,
    runId: row.id,
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    title: (row.created_by === 'schedule' ? row.schedule_name : null)
      ?? row.thread_title
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
    ...(resultSummary === undefined ? {} : { resultSummary }),
    ...(pendingApproval === undefined ? {} : { pendingApproval }),
    ...(row.created_by !== 'schedule' || row.source_id === null
      ? {}
      : { scheduleId: row.source_id }),
    ...(failure === undefined
      ? {}
      : {
          failureKind: failure.kind,
          failureSummary: failure.summary,
          consecutiveFailureCount: failure.consecutiveCount,
          ...(failure.suggestPause ? { suggestPause: true } : {})
        })
  };
}

function loadScheduleFailureSummaries(
  db: Database.Database,
  rows: TaskRow[]
): Map<string, FailureSummary> {
  const scheduleIds = [...new Set(rows.flatMap(row => (
    row.created_by === 'schedule'
    && row.source_id !== null
    && row.public_status === 'failed'
      ? [row.source_id]
      : []
  )))];
  if (scheduleIds.length === 0) return new Map();

  const placeholders = scheduleIds.map(() => '?').join(', ');
  const failureRows = db.prepare(`
    SELECT
      id,
      source_id,
      public_status,
      error_code,
      error_message,
      termination_reason,
      cwd,
      canonical_cwd,
      run_position
    FROM (
      SELECT
        id,
        source_id,
        public_status,
        error_code,
        error_message,
        termination_reason,
        cwd,
        canonical_cwd,
        ROW_NUMBER() OVER (
          PARTITION BY source_id
          ORDER BY created_at DESC, id DESC
        ) AS run_position
      FROM runs
      WHERE created_by = 'schedule'
        AND source_id IN (${placeholders})
    )
    WHERE run_position <= 100
    ORDER BY source_id ASC, run_position ASC
  `).all(...scheduleIds) as ScheduleFailureRow[];

  const rowsBySchedule = new Map<string, ScheduleFailureRow[]>();
  for (const row of failureRows) {
    if (row.source_id === null) continue;
    const scheduleRows = rowsBySchedule.get(row.source_id) ?? [];
    scheduleRows.push(row);
    rowsBySchedule.set(row.source_id, scheduleRows);
  }

  const summaries = new Map<string, FailureSummary>();
  for (const scheduleRows of rowsBySchedule.values()) {
    let previousFailureKey: string | undefined;
    let consecutiveCount = 0;
    for (let index = scheduleRows.length - 1; index >= 0; index -= 1) {
      const row = scheduleRows[index];
      if (row === undefined || row.public_status !== 'failed') {
        previousFailureKey = undefined;
        consecutiveCount = 0;
        continue;
      }
      const failure = classifyFailure(row);
      const currentFailureKey = failureKey(failure, row);
      consecutiveCount = currentFailureKey === previousFailureKey
        ? consecutiveCount + 1
        : 1;
      previousFailureKey = currentFailureKey;
      summaries.set(row.id, {
        kind: failure.kind,
        summary: failure.summary,
        consecutiveCount,
        suggestPause: failure.kind === 'project_directory' && consecutiveCount >= 3
      });
    }
  }
  return summaries;
}

function classifyFailure(
  row: Pick<
    RunRow,
    'error_code' | 'error_message' | 'termination_reason' | 'cwd'
  >
): Pick<FailureSummary, 'kind' | 'summary'> {
  const errorText = `${row.error_code ?? ''} ${row.error_message ?? ''}`.toLowerCase();
  const missingCwd = !existsSync(row.cwd);
  const directoryMessage = (
    errorText.includes('cwd must exist')
    || errorText.includes('working directory')
    || errorText.includes('project directory')
    || errorText.includes('chdir')
  ) && (
    errorText.includes('enoent')
    || errorText.includes('not exist')
    || errorText.includes('no such file or directory')
    || errorText.includes('not found')
  );
  if (
    (row.error_code === 'SPAWN_FAILED' && missingCwd)
    || directoryMessage
  ) {
    return {
      kind: 'project_directory',
      summary: '项目目录不存在或无法访问，请编辑项目后重试。'
    };
  }

  switch (row.termination_reason) {
    case 'timeout':
      return { kind: 'other', summary: '任务运行时间过长，已自动停止。' };
    case 'inactivity_timeout':
      return { kind: 'other', summary: '任务长时间没有响应，已自动停止。' };
    case 'daemon_restart':
      return { kind: 'other', summary: '本地服务重启中断了本次任务，可以稍后重试。' };
    case 'spawn_failed':
      return { kind: 'other', summary: '任务无法启动，请检查项目和运行配置。' };
    default:
      return { kind: 'other', summary: '任务未完成，请打开会话查看详情。' };
  }
}

function failureKey(
  failure: Pick<FailureSummary, 'kind'>,
  row: Pick<RunRow, 'canonical_cwd' | 'error_code' | 'termination_reason'>
): string {
  if (failure.kind === 'project_directory') {
    return `${failure.kind}:${row.canonical_cwd}`;
  }
  return `${failure.kind}:${row.error_code ?? row.termination_reason ?? 'unknown'}`;
}

function parseResultSummary(payloadJson: string | null): string | undefined {
  if (payloadJson === null) return undefined;
  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (
      typeof payload !== 'object'
      || payload === null
      || Array.isArray(payload)
    ) {
      return undefined;
    }
    const record = payload as Record<string, unknown>;
    if (
      record.type !== 'assistant_message'
      || typeof record.text !== 'string'
    ) {
      return undefined;
    }
    const normalized = redactText(record.text).replace(/\s+/g, ' ').trim();
    if (
      normalized.length === 0
      || INTERNAL_SCHEDULE_PROMPT_MARKERS.some(marker => normalized.includes(marker))
    ) {
      return undefined;
    }
    return Array.from(normalized).slice(0, RESULT_SUMMARY_LIMIT).join('');
  } catch {
    return undefined;
  }
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
