import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      codex_thread_id TEXT,
      resume_mode TEXT,
      queue_state TEXT NOT NULL DEFAULT 'none',
      public_status TEXT NOT NULL,
      internal_status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      source_id TEXT,
      profile TEXT NOT NULL,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      prompt_hash TEXT,
      prompt_preview_redacted TEXT,
      model TEXT,
      reasoning TEXT,
      sandbox TEXT NOT NULL,
      codex_version TEXT NOT NULL,
      codex_bin TEXT NOT NULL,
      codex_home TEXT NOT NULL,
      normalizer_version INTEGER NOT NULL,
      timeout_ms INTEGER,
      inactivity_timeout_ms INTEGER,
      transcript_reseed_mode TEXT,
      resume_argv_json TEXT,
      usage_source TEXT,
      termination_reason TEXT,
      exit_code INTEGER,
      signal TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      error_code TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      raw_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      UNIQUE(run_id, seq)
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      codex_thread_id TEXT,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      profile TEXT NOT NULL,
      sandbox TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS codex_skill_operations (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      codex_home TEXT NOT NULL,
      skills_path TEXT NOT NULL,
      source_path TEXT,
      target_path TEXT NOT NULL,
      backup_path TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
    CREATE INDEX IF NOT EXISTS idx_threads_codex_thread_id ON threads(codex_thread_id);
    CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
    CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_runs_codex_thread_id ON runs(codex_thread_id);
    CREATE INDEX IF NOT EXISTS idx_runs_thread_created_at ON runs(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_thread_public_status ON runs(thread_id, public_status);
    CREATE INDEX IF NOT EXISTS idx_codex_skill_operations_created_at
      ON codex_skill_operations(created_at DESC, id DESC);
  `);

  ensureColumn(db, 'threads', 'title', 'title TEXT');
  ensureColumn(db, 'threads', 'archived_at', 'archived_at TEXT');
  ensureColumn(db, 'runs', 'resume_mode', 'resume_mode TEXT');
  ensureColumn(db, 'runs', 'queue_state', "queue_state TEXT NOT NULL DEFAULT 'none'");
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
