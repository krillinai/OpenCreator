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
      submission_mode TEXT NOT NULL DEFAULT 'enqueue',
      public_status TEXT NOT NULL,
      internal_status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      source_id TEXT,
      public_prompt TEXT,
      triggered_at TEXT,
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

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT,
      profile TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      sandbox TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_migrations (
      migration_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      codex_thread_id TEXT,
      project_id TEXT,
      enterprise_subject_id TEXT,
      origin TEXT NOT NULL DEFAULT 'opencreator_created',
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      workspace_mode TEXT NOT NULL,
      profile TEXT NOT NULL,
      sandbox TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      status TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'conversation',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT,
      pinned_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE RESTRICT
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

    CREATE TABLE IF NOT EXISTS codex_skill_market_installs (
      skill_id TEXT PRIMARY KEY,
      repository TEXT NOT NULL,
      skill_path TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      market_revision INTEGER NOT NULL,
      installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enterprise_skill_installs (
      skill_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      version_id TEXT NOT NULL,
      version TEXT NOT NULL,
      package_sha256 TEXT NOT NULL,
      installed_content_sha256 TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enterprise_mcp_preferences (
      enterprise_origin TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      upstream_id TEXT NOT NULL,
      installed INTEGER NOT NULL DEFAULT 0 CHECK(installed IN (0, 1)),
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (enterprise_origin, agent_id, upstream_id),
      CHECK(enabled = 0 OR installed = 1)
    );

    CREATE TABLE IF NOT EXISTS codex_mcp_operations (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      server_name TEXT,
      codex_home TEXT NOT NULL,
      command_json TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      timed_out INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      prompt TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      prompt_preview_redacted TEXT NOT NULL,
      profile TEXT NOT NULL,
      cwd TEXT NOT NULL,
      canonical_cwd TEXT NOT NULL,
      model TEXT,
      reasoning TEXT,
      sandbox TEXT NOT NULL,
      timeout_ms INTEGER,
      concurrency_policy TEXT NOT NULL,
      misfire_policy TEXT NOT NULL,
      next_run_at TEXT,
      last_run_at TEXT,
      last_run_id TEXT,
      last_status TEXT,
      pending_trigger INTEGER NOT NULL DEFAULT 0,
      thread_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schedule_operations (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      run_id TEXT,
      actor_type TEXT,
      actor_run_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      storage_path TEXT NOT NULL UNIQUE,
      draft_id TEXT,
      thread_id TEXT,
      run_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      thread_id TEXT,
      codex_thread_id TEXT,
      turn_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      risk TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      details_json TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      UNIQUE(run_id, request_id)
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      dedupe_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      approval_id TEXT,
      created_at TEXT NOT NULL,
      acknowledged_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_key TEXT,
      source TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sensitive INTEGER NOT NULL DEFAULT 0,
      user_confirmed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      content TEXT NOT NULL,
      covered_from_cursor TEXT NOT NULL,
      covered_to_cursor TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(thread_id, version)
    );

    CREATE TABLE IF NOT EXISTS run_context_items (
      run_id TEXT NOT NULL,
      item_order INTEGER NOT NULL,
      kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      content_snapshot TEXT NOT NULL,
      scope TEXT,
      scope_key TEXT,
      summary_version INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY(run_id, item_order),
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS codex_session_sources (
      path TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      parsed_offset INTEGER NOT NULL DEFAULT 0,
      parsed_line_count INTEGER NOT NULL DEFAULT 0,
      parser_state_json TEXT NOT NULL DEFAULT '{}',
      head_size INTEGER NOT NULL DEFAULT 0,
      head_hash TEXT NOT NULL DEFAULT '',
      last_error TEXT,
      index_version INTEGER NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS codex_sessions (
      codex_thread_id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(source_path) REFERENCES codex_session_sources(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS codex_session_items (
      source_path TEXT NOT NULL,
      source_offset INTEGER NOT NULL,
      line_number INTEGER NOT NULL,
      item_id TEXT NOT NULL,
      item_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(source_path, source_offset),
      FOREIGN KEY(source_path) REFERENCES codex_session_sources(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS codex_session_search_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      version INTEGER NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS codex_session_search USING fts5(
      codex_thread_id UNINDEXED,
      source_path UNINDEXED,
      item_id UNINDEXED,
      item_type UNINDEXED,
      created_at UNINDEXED,
      title,
      cwd,
      content,
      tokenize = 'trigram'
    );

    CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status);
    CREATE INDEX IF NOT EXISTS idx_threads_codex_thread_id ON threads(codex_thread_id);
    CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_canonical_cwd
      ON projects(canonical_cwd)
      WHERE status = 'active' AND canonical_cwd IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_runs_codex_thread_id ON runs(codex_thread_id);
    CREATE INDEX IF NOT EXISTS idx_runs_thread_created_at ON runs(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_thread_public_status ON runs(thread_id, public_status);
    CREATE INDEX IF NOT EXISTS idx_runs_schedule_source ON runs(created_by, source_id);
    CREATE INDEX IF NOT EXISTS idx_codex_skill_operations_created_at
      ON codex_skill_operations(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_codex_skill_market_installs_updated_at
      ON codex_skill_market_installs(updated_at DESC, skill_id ASC);
    CREATE INDEX IF NOT EXISTS idx_enterprise_skill_installs_updated_at
      ON enterprise_skill_installs(updated_at DESC, skill_id ASC);
    CREATE INDEX IF NOT EXISTS idx_codex_mcp_operations_created_at
      ON codex_mcp_operations(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_schedules_enabled_next_run_at
      ON schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_schedules_deleted_at ON schedules(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_schedule_operations_created_at
      ON schedule_operations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_schedule_operations_schedule_id
      ON schedule_operations(schedule_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attachments_draft_hash
      ON attachments(draft_id, sha256)
      WHERE draft_id IS NOT NULL AND status = 'draft';
    CREATE INDEX IF NOT EXISTS idx_attachments_status_created_at
      ON attachments(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_approvals_status_requested_at
      ON approvals(status, requested_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_approvals_run_id
      ON approvals(run_id, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approvals_thread_id
      ON approvals(thread_id, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending
      ON notification_outbox(acknowledged_at, sequence);
    CREATE INDEX IF NOT EXISTS idx_memories_scope_enabled_updated
      ON memories(scope, scope_key, enabled, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_thread_version
      ON conversation_summaries(thread_id, version DESC);
    CREATE INDEX IF NOT EXISTS idx_run_context_items_source
      ON run_context_items(kind, source_id);
    CREATE INDEX IF NOT EXISTS idx_codex_sessions_updated_at
      ON codex_sessions(updated_at DESC, codex_thread_id DESC);
    CREATE INDEX IF NOT EXISTS idx_codex_sessions_kind_updated_at
      ON codex_sessions(kind, updated_at DESC, codex_thread_id DESC);
    CREATE INDEX IF NOT EXISTS idx_codex_session_items_source_line
      ON codex_session_items(source_path, line_number ASC);
  `);

  ensureColumn(db, 'threads', 'title', 'title TEXT');
  ensureColumn(db, 'threads', 'archived_at', 'archived_at TEXT');
  ensureColumn(db, 'threads', 'pinned_at', 'pinned_at TEXT');
  ensureColumn(db, 'threads', 'purpose', "purpose TEXT NOT NULL DEFAULT 'conversation'");
  ensureColumn(
    db,
    'threads',
    'project_id',
    'project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT'
  );
  ensureColumn(db, 'threads', 'enterprise_subject_id', 'enterprise_subject_id TEXT');
  ensureColumn(
    db,
    'threads',
    'origin',
    "origin TEXT NOT NULL DEFAULT 'opencreator_created'"
  );
  ensureColumn(db, 'runs', 'resume_mode', 'resume_mode TEXT');
  ensureColumn(db, 'runs', 'queue_state', "queue_state TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, 'runs', 'submission_mode', "submission_mode TEXT NOT NULL DEFAULT 'enqueue'");
  ensureColumn(db, 'runs', 'timeout_ms', 'timeout_ms INTEGER');
  ensureColumn(db, 'runs', 'public_prompt', 'public_prompt TEXT');
  ensureColumn(db, 'runs', 'triggered_at', 'triggered_at TEXT');
  ensureColumn(db, 'attachments', 'run_id', 'run_id TEXT');
  ensureColumn(db, 'codex_session_sources', 'head_size', 'head_size INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'codex_session_sources', 'head_hash', "head_hash TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'schedules', 'thread_id', 'thread_id TEXT');
  ensureColumn(db, 'schedule_operations', 'actor_type', 'actor_type TEXT');
  ensureColumn(db, 'schedule_operations', 'actor_run_id', 'actor_run_id TEXT');
  db.prepare(`
    UPDATE schedules
    SET concurrency_policy = 'queue'
    WHERE concurrency_policy = 'parallel'
  `).run();
  db.prepare(`
    UPDATE threads
    SET origin = CASE
      WHEN purpose = 'conversation' AND id LIKE 'thread_codex_%'
        THEN 'codex_discovered'
      ELSE 'opencreator_created'
    END
  `).run();
  assertUniqueCodexThreadIds(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_threads_project_id
      ON threads(project_id);
    CREATE INDEX IF NOT EXISTS idx_threads_origin
      ON threads(origin);
    CREATE INDEX IF NOT EXISTS idx_threads_knowledge_subject_updated
      ON threads(enterprise_subject_id, purpose, status, updated_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_unique_codex_thread_id
      ON threads(codex_thread_id)
      WHERE codex_thread_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_attachments_run_id
      ON attachments(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_thread_id
      ON schedules(thread_id)
      WHERE thread_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_schedule_operations_run_id
      ON schedule_operations(run_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_operations_actor_run_id
      ON schedule_operations(actor_run_id);
  `);
}

function assertUniqueCodexThreadIds(db: Database.Database): void {
  const duplicates = db.prepare(`
    SELECT codex_thread_id AS codexThreadId
    FROM threads
    WHERE codex_thread_id IS NOT NULL
    GROUP BY codex_thread_id
    HAVING COUNT(*) > 1
    ORDER BY codex_thread_id ASC
  `).all() as Array<{ codexThreadId: string }>;
  if (duplicates.length === 0) return;
  throw new Error(
    `THREAD_CODEX_ID_CONFLICT: ${duplicates.map(row => row.codexThreadId).join(', ')}`
  );
}

function ensureColumn(db: Database.Database, table: string, column: string, ddl: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some(row => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
