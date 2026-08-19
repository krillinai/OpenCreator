import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createSkillOperationRepository } from '../../src/codex/skills/operations.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import type { InsertRunInput } from '../../src/storage/repositories.js';
import { createRunRepository, createThreadRepository } from '../../src/storage/repositories.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('runtime storage', () => {
  it('creates schema and persists a run', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runs = createRunRepository(db);

    runs.insertRun({
      id: 'run_1',
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: 'api',
      publicPrompt: '公开任务输入',
      triggeredAt: '2026-07-14T14:01:00.000Z',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 0.139.0',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const loaded = runs.getRun('run_1');
    expect(loaded?.public_status).toBe('queued');
    expect(loaded?.resume_mode).toBe('independent');
    expect(loaded?.submission_mode).toBe('enqueue');
    expect(loaded?.public_prompt).toBe('公开任务输入');
    expect(loaded?.triggered_at).toBe('2026-07-14T14:01:00.000Z');
    expect(columnNames(db, 'runs')).toEqual(expect.arrayContaining([
      'public_prompt',
      'triggered_at'
    ]));
  });

  it('creates tables and enforces unique event sequence per run', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('runs', 'run_events', 'threads')"
      )
      .all() as Array<{ name: string }>;

    expect(tableRows.map((row) => row.name).sort()).toEqual(['run_events', 'runs', 'threads']);

    const runs = createRunRepository(db);
    runs.insertRun({
      id: 'run_1',
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: 'api',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 0.139.0',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });

    const insertEvent = db.prepare(`
      INSERT INTO run_events (id, run_id, seq, type, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    expect(runs.getLastRunEventSeq('run_1')).toBe(0);
    insertEvent.run('event_1', 'run_1', 1, 'status', '{}');
    insertEvent.run('event_3', 'run_1', 3, 'done', '{}');

    expect(() => insertEvent.run('event_2', 'run_1', 1, 'status', '{}')).toThrow();
    expect(runs.getLastRunEventSeq('run_1')).toBe(3);
  });

  it('normalizes persisted run event timestamps to UTC ISO strings', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-event-time-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const runs = createRunRepository(db);

    runs.insertRun({
      id: 'run_1',
      publicStatus: 'succeeded',
      internalStatus: 'succeeded',
      createdBy: 'schedule',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      sandbox: 'read-only',
      codexVersion: 'codex-cli 0.139.0',
      codexBin: 'codex',
      codexHome: join(tempDir, 'codex-home'),
      normalizerVersion: 1
    });
    db.prepare(`
      INSERT INTO run_events (id, run_id, seq, type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'event_1',
      'run_1',
      1,
      'done',
      '{"type":"done","status":"succeeded"}',
      '2026-07-25 02:01:05'
    );

    expect(runs.listRunEvents('run_1')).toEqual([
      expect.objectContaining({
        id: 'event_1',
        ts: '2026-07-25T02:01:05.000Z'
      })
    ]);
  });

  it('creates project ownership schema and enforces active directory and Codex mapping uniqueness', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-projects-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('projects', 'project_migrations')"
      ).all()
    ).toEqual(expect.arrayContaining([
      { name: 'projects' },
      { name: 'project_migrations' }
    ]));
    expect(columnNames(db, 'threads')).toEqual(expect.arrayContaining([
      'project_id',
      'origin',
      'enterprise_subject_id'
    ]));

    const projectIndexes = db.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index'
        AND name IN (
          'idx_projects_active_canonical_cwd',
          'idx_threads_unique_codex_thread_id'
        )
    `).all() as Array<{ name: string; sql: string }>;
    expect(projectIndexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'idx_projects_active_canonical_cwd',
        sql: expect.stringContaining("WHERE status = 'active'")
      }),
      expect.objectContaining({
        name: 'idx_threads_unique_codex_thread_id',
        sql: expect.stringContaining('WHERE codex_thread_id IS NOT NULL')
      })
    ]));

    const insertProject = db.prepare(`
      INSERT INTO projects (
        id, name, cwd, canonical_cwd, profile, sandbox, status
      ) VALUES (?, ?, ?, ?, 'default', 'follow-global', 'active')
    `);
    insertProject.run('project_one', 'One', tempDir, tempDir);
    expect(() => {
      insertProject.run('project_two', 'Two', tempDir, tempDir);
    }).toThrow();

    const threads = createThreadRepository(db);
    threads.insertThread({
      id: 'thread_one',
      title: 'One',
      codexThreadId: 'codex_shared',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation'
    });
    expect(() => {
      threads.insertThread({
        id: 'thread_two',
        title: 'Two',
        codexThreadId: 'codex_shared',
        cwd: tempDir,
        canonicalCwd: tempDir,
        workspaceMode: 'external',
        profile: 'default',
        sandbox: 'read-only',
        status: 'active',
        purpose: 'conversation'
      });
    }).toThrow();
  });

  it('indexes and filters knowledge threads by exact enterprise subject', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-knowledge-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const threads = createThreadRepository(db);
    const base = {
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'managed',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active' as const,
      purpose: 'knowledge_conversation' as const
    };
    threads.insertThread({ id: 'thread_a', enterpriseSubjectId: 'acct_a', ...base });
    threads.insertThread({ id: 'thread_b', enterpriseSubjectId: 'acct_b', ...base });
    threads.insertThread({
      id: 'thread_c',
      enterpriseSubjectId: 'acct_a',
      ...base,
      purpose: 'conversation'
    });

    expect(threads.listKnowledgeThreads({
      enterpriseSubjectId: 'acct_a',
      status: 'active',
      limit: 10
    }).map(thread => thread.id)).toEqual(['thread_c', 'thread_a']);
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name = 'idx_threads_knowledge_subject_updated'
    `).get()).toEqual({ name: 'idx_threads_knowledge_subject_updated' });
  });

  it('persists nullable conversation pin timestamps across database restarts', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-thread-pin-'));
    const databasePath = join(tempDir, 'app.sqlite');
    db = openRuntimeDatabase(databasePath);
    let threads = createThreadRepository(db);
    threads.insertThread({
      id: 'thread_pinned',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      profile: 'default',
      sandbox: 'read-only',
      status: 'active',
      purpose: 'conversation'
    });

    expect(threads.getThread('thread_pinned')?.pinned_at).toBeNull();
    threads.updateThread({
      id: 'thread_pinned',
      pinnedAt: '2026-08-06T00:00:00.000Z'
    });
    db.close();

    db = openRuntimeDatabase(databasePath);
    threads = createThreadRepository(db);
    expect(threads.getThread('thread_pinned')?.pinned_at)
      .toBe('2026-08-06T00:00:00.000Z');
  });

  it('assigns only unowned OpenCreator conversation threads to projects', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-project-assignment-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    db.prepare(`
      INSERT INTO projects (
        id, name, cwd, canonical_cwd, profile, sandbox, status
      ) VALUES (
        'project_one', 'One', ?, ?, 'default', 'follow-global', 'active'
      )
    `).run(tempDir, tempDir);
    const threads = createThreadRepository(db);
    for (const input of [
      {
        id: 'thread_unowned',
        origin: 'opencreator_created' as const,
        purpose: 'conversation' as const
      },
      {
        id: 'thread_discovered',
        origin: 'codex_discovered' as const,
        purpose: 'conversation' as const
      },
      {
        id: 'thread_schedule',
        origin: 'opencreator_created' as const,
        purpose: 'schedule_task' as const
      }
    ]) {
      threads.insertThread({
        ...input,
        cwd: tempDir,
        canonicalCwd: tempDir,
        workspaceMode: 'external',
        profile: 'default',
        sandbox: 'read-only',
        status: 'active'
      });
    }

    expect(
      threads.listUnassignedOpenCreatorConversationThreads().map(thread => thread.id)
    ).toEqual(['thread_unowned']);
    expect(threads.assignProject({
      id: 'thread_unowned',
      projectId: 'project_one'
    })).toBe(true);
    expect(threads.assignProject({
      id: 'thread_unowned',
      projectId: 'project_one'
    })).toBe(false);
    expect(threads.assignProject({
      id: 'thread_discovered',
      projectId: 'project_one'
    })).toBe(false);
    expect(threads.assignProject({
      id: 'thread_schedule',
      projectId: 'project_one'
    })).toBe(false);
  });

  it('creates the persistent notification outbox and pending cursor index', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notification_outbox'"
      ).get()
    ).toEqual({ name: 'notification_outbox' });
    expect(columnNames(db, 'notification_outbox')).toEqual([
      'sequence',
      'id',
      'dedupe_key',
      'kind',
      'title',
      'body',
      'thread_id',
      'run_id',
      'approval_id',
      'created_at',
      'acknowledged_at'
    ]);
    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_notification_outbox_pending'"
      ).get()
    ).toEqual({ name: 'idx_notification_outbox_pending' });
  });

  it('creates attachment metadata and cleanup indexes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'"
      ).get()
    ).toEqual({ name: 'attachments' });
    expect(columnNames(db, 'attachments')).toEqual([
      'id',
      'file_name',
      'mime',
      'size',
      'sha256',
      'storage_path',
      'draft_id',
      'thread_id',
      'run_id',
      'status',
      'created_at',
      'updated_at'
    ]);
    expect(
      db.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND name IN ('idx_attachments_draft_hash', 'idx_attachments_status_created_at')`
      ).all()
    ).toEqual(expect.arrayContaining([
      { name: 'idx_attachments_draft_hash' },
      { name: 'idx_attachments_status_created_at' }
    ]));
  });

  it('creates codex session index tables, full-text search state, and indexes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('codex_sessions', 'codex_session_sources', 'codex_session_items')`
      )
      .all() as Array<{ name: string }>;
    expect(tableRows.map(row => row.name).sort()).toEqual([
      'codex_session_items',
      'codex_session_sources',
      'codex_sessions'
    ]);
    expect(
      db.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'codex_session_search'"
      ).get()
    ).toMatchObject({
      name: 'codex_session_search',
      sql: expect.stringContaining('fts5')
    });
    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_session_search_state'"
      ).get()
    ).toEqual({ name: 'codex_session_search_state' });
    expect(columnNames(db, 'codex_session_search_state')).toEqual([
      'id',
      'version',
      'completed_at'
    ]);

    expect(columnNames(db, 'codex_session_sources')).toEqual(
      expect.arrayContaining([
        'path',
        'file_id',
        'file_size',
        'mtime_ms',
        'parsed_offset',
        'parsed_line_count',
        'parser_state_json',
        'head_size',
        'head_hash',
        'last_error',
        'index_version'
      ])
    );

    const indexRows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND name IN (
             'idx_codex_sessions_updated_at',
             'idx_codex_sessions_kind_updated_at',
             'idx_codex_session_items_source_line'
           )`
      )
      .all() as Array<{ name: string }>;
    expect(indexRows.map(row => row.name).sort()).toEqual([
      'idx_codex_session_items_source_line',
      'idx_codex_sessions_kind_updated_at',
      'idx_codex_sessions_updated_at'
    ]);
  });

  it('creates codex skill operation log table', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_skill_operations'"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows).toEqual([{ name: 'codex_skill_operations' }]);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_codex_skill_operations_created_at'"
      )
      .all() as Array<{ name: string }>;
    expect(indexRows).toEqual([{ name: 'idx_codex_skill_operations_created_at' }]);
  });

  it('creates codex mcp operation log table', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_mcp_operations'"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows).toEqual([{ name: 'codex_mcp_operations' }]);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_codex_mcp_operations_created_at'"
      )
      .all() as Array<{ name: string }>;
    expect(indexRows).toEqual([{ name: 'idx_codex_mcp_operations_created_at' }]);
  });

  it('creates codex skill market install table and updated-at index', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'codex_skill_market_installs'"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows).toEqual([{ name: 'codex_skill_market_installs' }]);

    const indexRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_codex_skill_market_installs_updated_at'"
      )
      .all() as Array<{ name: string }>;
    expect(indexRows).toEqual([{ name: 'idx_codex_skill_market_installs_updated_at' }]);
  });

  it('creates scheduler tables, indexes, and run timeout column', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));

    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schedules', 'schedule_operations')"
      )
      .all() as Array<{ name: string }>;
    expect(tableRows.map(row => row.name).sort()).toEqual(['schedule_operations', 'schedules']);

    expect(columnNames(db, 'schedules')).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'cron',
        'timezone',
        'enabled',
        'prompt',
        'prompt_hash',
        'prompt_preview_redacted',
        'profile',
        'cwd',
        'canonical_cwd',
        'model',
        'reasoning',
        'sandbox',
        'timeout_ms',
        'concurrency_policy',
        'misfire_policy',
        'next_run_at',
        'last_run_at',
        'last_run_id',
        'last_status',
        'pending_trigger',
        'thread_id',
        'created_at',
        'updated_at',
        'deleted_at'
      ])
    );
    expect(columnNames(db, 'schedule_operations')).toEqual(
      expect.arrayContaining([
        'id',
        'schedule_id',
        'operation',
        'status',
        'run_id',
        'actor_type',
        'actor_run_id',
        'error_code',
        'error_message',
        'created_at'
      ])
    );
    expect(columnNames(db, 'runs')).toContain('timeout_ms');

    const indexRows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND name IN (
             'idx_schedules_enabled_next_run_at',
             'idx_schedules_deleted_at',
             'idx_schedules_thread_id',
             'idx_schedule_operations_created_at',
             'idx_schedule_operations_schedule_id',
             'idx_schedule_operations_run_id',
             'idx_schedule_operations_actor_run_id',
             'idx_runs_schedule_source'
           )`
      )
      .all() as Array<{ name: string }>;
    expect(indexRows.map(row => row.name).sort()).toEqual([
      'idx_runs_schedule_source',
      'idx_schedule_operations_actor_run_id',
      'idx_schedule_operations_created_at',
      'idx_schedule_operations_run_id',
      'idx_schedule_operations_schedule_id',
      'idx_schedules_deleted_at',
      'idx_schedules_enabled_next_run_at',
      'idx_schedules_thread_id'
    ]);
  });

  it('migrates legacy schedule operations without changing existing actor-less rows', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    const dbPath = join(tempDir, 'app.sqlite');
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schedules (
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
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );

      CREATE TABLE schedule_operations (
        id TEXT PRIMARY KEY,
        schedule_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        run_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO schedules (
        id, name, cron, timezone, prompt, prompt_hash, prompt_preview_redacted,
        profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
      ) VALUES (
        'sch_legacy', 'legacy task', '0 9 * * *', 'UTC', 'private prompt',
        'hash', 'private prompt', 'default', '/tmp', '/tmp', 'read-only', 'queue', 'skip'
      );

      INSERT INTO schedule_operations (
        id, schedule_id, operation, status, run_id
      ) VALUES (
        'schop_legacy', 'sch_legacy', 'run_now', 'succeeded', 'run_legacy'
      );
    `);
    legacyDb.close();

    db = openRuntimeDatabase(dbPath);

    expect(columnNames(db, 'schedule_operations')).toEqual(
      expect.arrayContaining(['actor_type', 'actor_run_id'])
    );
    expect(
      db.prepare(`
        SELECT actor_type, actor_run_id
        FROM schedule_operations
        WHERE id = 'schop_legacy'
      `).get()
    ).toEqual({
      actor_type: null,
      actor_run_id: null
    });
    expect(
      db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_schedule_operations_run_id',
            'idx_schedule_operations_actor_run_id'
          )
        ORDER BY name
      `).all()
    ).toEqual([
      { name: 'idx_schedule_operations_actor_run_id' },
      { name: 'idx_schedule_operations_run_id' }
    ]);
  });

  it('enforces unique active schedule thread bindings while allowing deleted history', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const insertSchedule = db.prepare(`
      INSERT INTO schedules (
        id, thread_id, name, cron, timezone, prompt, prompt_hash, prompt_preview_redacted,
        profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const values = [
      'thread_one',
      'daily status',
      '0 9 * * *',
      'Asia/Shanghai',
      'Summarize project status',
      'hash',
      'Summarize project status',
      'default',
      tempDir,
      tempDir,
      'workspace-write',
      'queue',
      'skip'
    ] as const;

    insertSchedule.run('sch_one', ...values);
    expect(() => insertSchedule.run('sch_conflict', ...values)).toThrow();

    db.prepare('UPDATE schedules SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run('sch_one');
    expect(() => insertSchedule.run('sch_replacement', ...values)).not.toThrow();
  });

  it('persists codex skill operations', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const operations = createSkillOperationRepository(db);

    const inserted = operations.insertOperation({
      operation: 'install',
      skillId: 'writer',
      codexHome: join(tempDir, 'codex-home'),
      skillsPath: join(tempDir, 'codex-home', 'skills'),
      sourcePath: join(tempDir, 'source'),
      targetPath: join(tempDir, 'codex-home', 'skills', 'writer'),
      status: 'succeeded'
    });

    expect(inserted).toMatchObject({
      operation: 'install',
      skillId: 'writer',
      status: 'succeeded',
      sourcePath: join(tempDir, 'source'),
      errorCode: null
    });
    expect(operations.listOperations()).toEqual([inserted]);
  });

function createTestDatabase(): Database.Database {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  return db;
}

function makeRunInput(overrides: Partial<InsertRunInput> = {}): InsertRunInput {
  return {
    id: 'run_default',
    publicStatus: 'queued',
    internalStatus: 'created',
    createdBy: 'api',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    sandbox: 'read-only',
    codexVersion: 'test',
    codexBin: 'codex',
    codexHome: join(tempDir, 'codex-home'),
    normalizerVersion: 1,
    ...overrides
  };
}

it('persists threads and codex thread binding', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);

  threads.insertThread({
    id: 'thread_1',
    title: 'R2 plan',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    model: 'gpt-5',
    reasoning: 'high',
    status: 'active'
  });

  expect(threads.getThread('thread_1')).toMatchObject({
    id: 'thread_1',
    title: 'R2 plan',
    codex_thread_id: null,
    status: 'active',
    purpose: 'conversation'
  });

  threads.setCodexThreadId('thread_1', '019f-thread');
  expect(threads.getThread('thread_1')?.codex_thread_id).toBe('019f-thread');
});

it('permanently deletes thread-owned records without deleting project files', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);
  const runs = createRunRepository(database);
  const projectFile = join(tempDir, 'keep.txt');
  writeFileSync(projectFile, 'keep');
  threads.insertThread({
    id: 'thread_delete',
    title: 'Delete me',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    status: 'active'
  });
  runs.insertRun(makeRunInput({ id: 'run_delete', threadId: 'thread_delete' }));
  database.prepare(`
    INSERT INTO run_events (id, run_id, seq, type, payload_json)
    VALUES ('event_delete', 'run_delete', 1, 'status', '{}')
  `).run();
  database.prepare(`
    INSERT INTO conversation_summaries (
      id, thread_id, content, covered_from_cursor, covered_to_cursor,
      item_count, version, created_at, updated_at
    ) VALUES (
      'summary_delete', 'thread_delete', 'summary', 'a', 'b',
      1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `).run();

  threads.deleteThread('thread_delete');

  expect(threads.getThread('thread_delete')).toBeUndefined();
  expect(runs.listRunsByThread('thread_delete')).toEqual([]);
  expect(database.prepare('SELECT id FROM run_events WHERE id = ?').get('event_delete'))
    .toBeUndefined();
  expect(database.prepare('SELECT id FROM conversation_summaries WHERE id = ?').get('summary_delete'))
    .toBeUndefined();
  expect(readFileSync(projectFile, 'utf8')).toBe('keep');
});

it('lists thread run history and preserves archived thread data', () => {
  const database = createTestDatabase();
  const threads = createThreadRepository(database);
  const runs = createRunRepository(database);

  threads.insertThread({
    id: 'thread_1',
    title: null,
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    sandbox: 'read-only',
    status: 'active'
  });
  runs.insertRun(makeRunInput({ id: 'run_1', threadId: 'thread_1', resumeMode: 'new_thread' }));

  expect(runs.listRunsByThread('thread_1')).toHaveLength(1);

  threads.archiveThread('thread_1');
  expect(threads.getThread('thread_1')).toMatchObject({ status: 'archived' });
  expect(runs.listRunsByThread('thread_1')).toHaveLength(1);

  const fixedArchivedAt = '2026-01-01T00:00:00.000Z';
  database.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(fixedArchivedAt, 'thread_1');
  threads.archiveThread('thread_1');
  expect(threads.getThread('thread_1')?.archived_at).toBe(fixedArchivedAt);
});

it('migrates legacy storage and preserves existing thread operations', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE runs (
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

    CREATE TABLE threads (
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
  legacyDb
    .prepare(
      `
      INSERT INTO runs (
        id, thread_id, codex_thread_id, public_status, internal_status, created_by,
        profile, cwd, canonical_cwd, workspace_mode, sandbox, codex_version, codex_bin,
        codex_home, normalizer_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      'legacy_run_1',
      'legacy_thread_1',
      null,
      'queued',
      'created',
      'api',
      'default',
      tempDir,
      tempDir,
      'external',
      'read-only',
      'test',
      'codex',
      join(tempDir, 'codex-home'),
      1
    );
  legacyDb
    .prepare(
      `
      INSERT INTO threads (
        id, codex_thread_id, cwd, canonical_cwd, workspace_mode, profile, sandbox, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run('legacy_thread_1', null, tempDir, tempDir, 'external', 'default', 'read-only', 'active');
  legacyDb.close();

  db = openRuntimeDatabase(dbPath);
  const runs = createRunRepository(db);
  const threads = createThreadRepository(db);

  expect(columnNames(db, 'runs')).toEqual(expect.arrayContaining(['resume_mode', 'queue_state', 'timeout_ms']));
  expect(columnNames(db, 'threads')).toEqual(expect.arrayContaining([
    'title',
    'archived_at',
    'purpose',
    'enterprise_subject_id'
  ]));
  expect(columnNames(db, 'schedules')).toContain('thread_id');
  expect(runs.getRun('legacy_run_1')?.queue_state).toBe('none');
  expect(threads.getThread('legacy_thread_1')?.purpose).toBe('conversation');

  threads.setCodexThreadId('legacy_thread_1', '019f-legacy-thread');
  expect(threads.getThread('legacy_thread_1')?.codex_thread_id).toBe('019f-legacy-thread');

  threads.archiveThread('legacy_thread_1');
  const fixedArchivedAt = '2026-01-01T00:00:00.000Z';
  db.prepare('UPDATE threads SET archived_at = ? WHERE id = ?').run(fixedArchivedAt, 'legacy_thread_1');
  expect(threads.getThread('legacy_thread_1')).toMatchObject({ status: 'archived' });

  threads.archiveThread('legacy_thread_1');
  expect(threads.getThread('legacy_thread_1')?.archived_at).toBe(fixedArchivedAt);
});

it('migrates legacy parallel schedules to queue before dedicated threads are attached', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-storage-'));
  const dbPath = join(tempDir, 'app.sqlite');
  const legacyDb = new Database(dbPath);
  legacyDb.exec(`
    CREATE TABLE schedules (
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);
  legacyDb.prepare(`
    INSERT INTO schedules (
      id, name, cron, timezone, prompt, prompt_hash, prompt_preview_redacted,
      profile, cwd, canonical_cwd, sandbox, concurrency_policy, misfire_policy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'sch_parallel',
    'legacy parallel',
    '0 9 * * *',
    'Asia/Shanghai',
    'Run task',
    'hash',
    'Run task',
    'default',
    tempDir,
    tempDir,
    'workspace-write',
    'parallel',
    'skip'
  );
  legacyDb.close();

  db = openRuntimeDatabase(dbPath);

  expect(columnNames(db, 'schedules')).toContain('thread_id');
  expect(
    db.prepare('SELECT concurrency_policy FROM schedules WHERE id = ?').get('sch_parallel')
  ).toEqual({ concurrency_policy: 'queue' });
});
});

function columnNames(database: Database.Database, table: string): string[] {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map(row => row.name);
}
