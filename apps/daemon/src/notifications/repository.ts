import type {
  NotificationOutboxItem,
  NotificationOutboxKind
} from '@opencreator/protocol';
import type Database from 'better-sqlite3';

type NotificationOutboxRow = {
  sequence: number;
  id: string;
  dedupe_key: string;
  kind: NotificationOutboxKind;
  title: string;
  body: string;
  thread_id: string;
  run_id: string;
  approval_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
};

export type EnqueueNotificationInput = {
  id: string;
  dedupeKey: string;
  kind: NotificationOutboxKind;
  title: string;
  body: string;
  threadId: string;
  runId: string;
  approvalId?: string;
  createdAt: string;
};

export type NotificationRepository = {
  enqueue(input: EnqueueNotificationInput): NotificationOutboxItem;
  listPending(input: { after: number; limit: number }): NotificationOutboxItem[];
  acknowledge(ids: string[], acknowledgedAt: string): number;
};

export function createNotificationRepository(
  db: Database.Database
): NotificationRepository {
  const insert = db.prepare(`
    INSERT INTO notification_outbox (
      id, dedupe_key, kind, title, body, thread_id, run_id, approval_id, created_at
    ) VALUES (
      @id, @dedupeKey, @kind, @title, @body, @threadId, @runId, @approvalId, @createdAt
    )
    ON CONFLICT(dedupe_key) DO NOTHING
  `);
  const getByDedupeKey = db.prepare<string>(`
    SELECT * FROM notification_outbox WHERE dedupe_key = ?
  `);
  const listPending = db.prepare<{ after: number; limit: number }>(`
    SELECT *
    FROM notification_outbox
    WHERE acknowledged_at IS NULL
      AND sequence > @after
    ORDER BY sequence ASC
    LIMIT @limit
  `);

  return {
    enqueue(input) {
      insert.run({
        ...input,
        approvalId: input.approvalId ?? null
      });
      const row = getByDedupeKey.get(input.dedupeKey) as NotificationOutboxRow | undefined;
      if (row === undefined) {
        throw new Error(`Notification outbox insert failed for ${input.dedupeKey}`);
      }
      return mapNotification(row);
    },

    listPending(input) {
      return (listPending.all(input) as NotificationOutboxRow[]).map(mapNotification);
    },

    acknowledge(ids, acknowledgedAt) {
      if (ids.length === 0) return 0;
      const placeholders = ids.map(() => '?').join(', ');
      return db.prepare(`
        UPDATE notification_outbox
        SET acknowledged_at = ?
        WHERE acknowledged_at IS NULL
          AND id IN (${placeholders})
      `).run(acknowledgedAt, ...ids).changes;
    }
  };
}

function mapNotification(row: NotificationOutboxRow): NotificationOutboxItem {
  return {
    id: row.id,
    cursor: String(row.sequence),
    kind: row.kind,
    title: row.title,
    body: row.body,
    threadId: row.thread_id,
    runId: row.run_id,
    ...(row.approval_id === null ? {} : { approvalId: row.approval_id }),
    createdAt: row.created_at
  };
}
