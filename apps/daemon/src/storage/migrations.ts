import type Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT,
      codex_thread_id TEXT,
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
      last_error_code TEXT,
      last_error_message TEXT
    );
  `);
}
