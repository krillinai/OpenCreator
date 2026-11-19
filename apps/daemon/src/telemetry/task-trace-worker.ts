import { existsSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import type { TaskTraceCommand } from './task-trace-outbox.js';
import type { CreatorTaskTrace } from './task-trace.js';

const path = workerData as string;
let database: Database.Database | undefined;

function store(): Database.Database {
  if (database) return database;
  const db = new Database(path, { timeout: 0 });
  try {
    db.pragma('synchronous = OFF');
    db.exec(`CREATE TABLE IF NOT EXISTS trace_outbox (
      event_id TEXT PRIMARY KEY, priority INTEGER NOT NULL, event_json TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    database = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function execute(command: TaskTraceCommand): boolean | number | CreatorTaskTrace[] {
  if (command.type === 'clear' && !database && !existsSync(path)) return true;
  const db = store();
  switch (command.type) {
    case 'enqueue': {
      const insert = db.prepare(`INSERT INTO trace_outbox (event_id, priority, event_json, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(event_id) DO NOTHING`);
      db.transaction(() => {
        for (const event of command.events) {
          const critical = event.event_type === 'task_started' || event.event_type === 'task_state'
            || event.event_type === 'preflight_rejected' || (event.outcome !== undefined && event.outcome !== 'succeeded');
          insert.run(event.event_id, critical ? 0 : 1, JSON.stringify(event), event.occurred_at);
        }
        db.prepare(`DELETE FROM trace_outbox WHERE rowid IN (
          SELECT rowid FROM trace_outbox ORDER BY priority, rowid DESC LIMIT -1 OFFSET 3000
        )`).run();
      })();
      return true;
    }
    case 'list': {
      db.prepare('DELETE FROM trace_outbox WHERE created_at < ?').run(new Date(Date.now() - 30 * 86400000).toISOString());
      const rows = db.prepare('SELECT event_json FROM trace_outbox ORDER BY rowid ASC LIMIT 50').all() as Array<{ event_json: string }>;
      return rows.flatMap(row => {
        try { return [JSON.parse(row.event_json) as CreatorTaskTrace]; } catch { return []; }
      });
    }
    case 'ack': {
      const remove = db.prepare('DELETE FROM trace_outbox WHERE event_id = ?');
      return db.transaction(() => command.ids.reduce((count, id) => count + remove.run(id).changes, 0))();
    }
    case 'clear':
      db.prepare('DELETE FROM trace_outbox').run();
      return true;
  }
}

parentPort?.on('message', ({ id, command }: { id: number; command: TaskTraceCommand }) => {
  try { parentPort?.postMessage({ id, value: execute(command) }); } catch { parentPort?.postMessage({ id }); }
});
