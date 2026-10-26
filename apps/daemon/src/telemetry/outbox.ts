import type Database from 'better-sqlite3';
import {
  sanitizeCreatorTelemetryEvent,
  type CreatorTelemetryEvent
} from './events.js';

export const CREATOR_TELEMETRY_BATCH_SIZE = 50;
export const DEFAULT_CREATOR_TELEMETRY_OUTBOX_LIMIT = 10_000;

export type CreatorTelemetryOutbox = ReturnType<typeof createCreatorTelemetryOutbox>;

export function createCreatorTelemetryOutbox(
  db: Database.Database,
  options: { maxPendingEvents?: number } = {}
) {
  const maxPendingEvents = Math.max(
    CREATOR_TELEMETRY_BATCH_SIZE,
    options.maxPendingEvents ?? DEFAULT_CREATOR_TELEMETRY_OUTBOX_LIMIT
  );

  return {
    enqueue(event: CreatorTelemetryEvent, dedupeKey: string): void {
      const sanitized = sanitizeCreatorTelemetryEvent(event);
      db.transaction(() => {
        db.prepare(`
          INSERT INTO telemetry_outbox (event_id, dedupe_key, event_json, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(dedupe_key) DO NOTHING
        `).run(
          sanitized.event_id,
          dedupeKey,
          JSON.stringify(sanitized),
          sanitized.occurred_at
        );
        db.prepare(`
          DELETE FROM telemetry_outbox
          WHERE rowid IN (
            SELECT rowid FROM telemetry_outbox
            ORDER BY rowid DESC
            LIMIT -1 OFFSET ?
          )
        `).run(maxPendingEvents);
      })();
    },
    list(limit = CREATOR_TELEMETRY_BATCH_SIZE): CreatorTelemetryEvent[] {
      const boundedLimit = Math.min(
        CREATOR_TELEMETRY_BATCH_SIZE,
        Math.max(1, Math.floor(limit))
      );
      const rows = db.prepare(`
        SELECT event_json FROM telemetry_outbox
        ORDER BY rowid ASC
        LIMIT ?
      `).all(boundedLimit) as Array<{ event_json: string }>;
      return rows.flatMap(row => {
        try {
          return [sanitizeCreatorTelemetryEvent(JSON.parse(row.event_json) as CreatorTelemetryEvent)];
        } catch {
          return [];
        }
      });
    },
    ack(eventIds: string[]): number {
      const ids = [...new Set(eventIds)].slice(0, CREATOR_TELEMETRY_BATCH_SIZE);
      if (ids.length === 0) return 0;
      const remove = db.prepare('DELETE FROM telemetry_outbox WHERE event_id = ?');
      return db.transaction(() => ids.reduce(
        (count, id) => count + remove.run(id).changes,
        0
      ))();
    },
    count(): number {
      return (db.prepare('SELECT COUNT(*) AS count FROM telemetry_outbox').get() as { count: number }).count;
    }
  };
}
