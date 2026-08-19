import type {
  NotificationAcknowledgeResponse,
  NotificationOutboxItem,
  NotificationOutboxListResponse
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { redactText } from '../security/redaction.js';
import { createNotificationRepository } from './repository.js';

type ScheduleRunNotificationRow = {
  run_id: string;
  thread_id: string;
  public_status: 'succeeded' | 'failed' | 'canceled';
  schedule_name: string;
  result_event_payload_json: string | null;
};

type ScheduleApprovalNotificationRow = {
  approval_id: string;
  run_id: string;
  thread_id: string;
  schedule_name: string;
  summary: string;
};

export type NotificationService = {
  enqueueRunTerminal(runId: string): NotificationOutboxItem | undefined;
  enqueueApproval(approvalId: string): NotificationOutboxItem | undefined;
  listPending(input?: { after?: number; limit?: number }): NotificationOutboxListResponse;
  acknowledge(ids: string[]): NotificationAcknowledgeResponse;
};

const TITLE_LIMIT = 80;
const BODY_LIMIT = 120;
const INTERNAL_SCHEDULE_PROMPT_MARKERS = [
  '这是 OpenCreator 已经触发的一次计划任务执行。',
  '执行规则：'
] as const;

export function createNotificationService(input: {
  db: Database.Database;
  idFactory?: () => string;
  now?: () => string;
}): NotificationService {
  const repository = createNotificationRepository(input.db);
  const idFactory = input.idFactory ?? (() => `notification_${nanoid(12)}`);
  const now = input.now ?? (() => new Date().toISOString());
  const getScheduleRun = input.db.prepare<string>(`
    SELECT
      r.id AS run_id,
      r.thread_id,
      r.public_status,
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
    JOIN schedules s ON s.id = r.source_id
    WHERE r.id = ?
      AND r.created_by = 'schedule'
      AND r.thread_id IS NOT NULL
      AND r.public_status IN ('succeeded', 'failed', 'canceled')
  `);
  const getScheduleApproval = input.db.prepare<string>(`
    SELECT
      a.id AS approval_id,
      a.run_id,
      r.thread_id,
      s.name AS schedule_name,
      a.summary
    FROM approvals a
    JOIN runs r ON r.id = a.run_id
    JOIN schedules s ON s.id = r.source_id
    WHERE a.id = ?
      AND a.status = 'pending'
      AND r.created_by = 'schedule'
      AND r.thread_id IS NOT NULL
  `);

  return {
    enqueueRunTerminal(runId) {
      const row = getScheduleRun.get(runId) as ScheduleRunNotificationRow | undefined;
      if (row === undefined) return undefined;
      const title = safeText(row.schedule_name, TITLE_LIMIT, '已安排任务');
      const notification = terminalCopy(row, title);
      return repository.enqueue({
        id: idFactory(),
        dedupeKey: `run:${row.run_id}:${row.public_status}`,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        threadId: row.thread_id,
        runId: row.run_id,
        createdAt: now()
      });
    },

    enqueueApproval(approvalId) {
      const row = getScheduleApproval.get(approvalId) as
        | ScheduleApprovalNotificationRow
        | undefined;
      if (row === undefined) return undefined;
      const title = safeText(row.schedule_name, TITLE_LIMIT, '已安排任务');
      return repository.enqueue({
        id: idFactory(),
        dedupeKey: `approval:${row.approval_id}:pending`,
        kind: 'schedule_waiting_approval',
        title: `${title}等待审批`,
        body: safeText(row.summary, BODY_LIMIT, '需要你的审批。'),
        threadId: row.thread_id,
        runId: row.run_id,
        approvalId: row.approval_id,
        createdAt: now()
      });
    },

    listPending(options = {}) {
      const after = options.after ?? 0;
      const notifications = repository.listPending({
        after,
        limit: options.limit ?? 50
      });
      return {
        notifications,
        nextCursor: notifications.at(-1)?.cursor ?? String(after)
      };
    },

    acknowledge(ids) {
      return {
        acknowledged: repository.acknowledge([...new Set(ids)], now())
      };
    }
  };
}

function terminalCopy(
  row: ScheduleRunNotificationRow,
  title: string
): {
  kind: 'schedule_succeeded' | 'schedule_failed' | 'schedule_canceled';
  title: string;
  body: string;
} {
  if (row.public_status === 'succeeded') {
    return {
      kind: 'schedule_succeeded',
      title,
      body: resultSummary(row.result_event_payload_json) ?? '任务已完成。'
    };
  }
  if (row.public_status === 'canceled') {
    return {
      kind: 'schedule_canceled',
      title: `${title}已取消`,
      body: '本次任务已取消。'
    };
  }
  return {
    kind: 'schedule_failed',
    title: `${title}失败`,
    body: '任务未完成，请打开会话查看详情。'
  };
}

function resultSummary(payloadJson: string | null): string | undefined {
  if (payloadJson === null) return undefined;
  try {
    const payload = JSON.parse(payloadJson) as unknown;
    if (!isRecord(payload) || payload.type !== 'assistant_message') return undefined;
    if (typeof payload.text !== 'string') return undefined;
    const summary = normalizeText(payload.text);
    if (
      summary.length === 0
      || INTERNAL_SCHEDULE_PROMPT_MARKERS.some(marker => summary.includes(marker))
    ) {
      return undefined;
    }
    return truncateText(summary, BODY_LIMIT);
  } catch {
    return undefined;
  }
}

function safeText(value: string, limit: number, fallback: string): string {
  const normalized = normalizeText(value);
  if (normalized.length === 0) return fallback;
  return truncateText(normalized, limit);
}

function normalizeText(value: string): string {
  return redactText(value).replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
