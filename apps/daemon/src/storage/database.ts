import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrations.js';

export function openRuntimeDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  migrate(db);
  return db;
}

export function normalizeDatabaseTimestamp(value: string): string {
  const sqliteUtc = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/.exec(
    value
  );
  const input = sqliteUtc === null
    ? value
    : `${sqliteUtc[1]}T${sqliteUtc[2]}${sqliteUtc[3] ?? ''}Z`;
  const timestamp = new Date(input);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Invalid database timestamp: ${value}`);
  }

  if (
    sqliteUtc !== null
    && timestamp.toISOString().slice(0, 19) !== `${sqliteUtc[1]}T${sqliteUtc[2]}`
  ) {
    throw new Error(`Invalid database timestamp: ${value}`);
  }

  return timestamp.toISOString();
}

export function normalizeNullableDatabaseTimestamp(
  value: string | null
): string | null {
  return value === null ? null : normalizeDatabaseTimestamp(value);
}
