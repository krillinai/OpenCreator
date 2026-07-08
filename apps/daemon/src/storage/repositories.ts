import type { AgentEventEnvelope } from '@clawee/protocol';
import type Database from 'better-sqlite3';

export type ResolvedResumeMode = 'independent' | 'new_thread' | 'resume_thread';
export type RunQueueState = 'none' | 'queued' | 'started';

export type InsertRunInput = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  resumeMode?: ResolvedResumeMode;
  queueState?: RunQueueState;
  publicStatus: string;
  internalStatus: string;
  createdBy: string;
  sourceId?: string;
  timeoutMs?: number | null;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: string;
  promptHash?: string;
  promptPreviewRedacted?: string;
  model?: string;
  reasoning?: string;
  sandbox: string;
  codexVersion: string;
  codexBin: string;
  codexHome: string;
  normalizerVersion: number;
};

export type RunRow = {
  id: string;
  thread_id: string | null;
  codex_thread_id: string | null;
  resume_mode: ResolvedResumeMode | null;
  queue_state: RunQueueState;
  public_status: string;
  internal_status: string;
  created_by: string;
  source_id: string | null;
  profile: string;
  cwd: string;
  canonical_cwd: string;
  workspace_mode: string;
  prompt_hash: string | null;
  prompt_preview_redacted: string | null;
  model: string | null;
  reasoning: string | null;
  sandbox: string;
  codex_version: string;
  codex_bin: string;
  codex_home: string;
  normalizer_version: number;
  timeout_ms: number | null;
  inactivity_timeout_ms: number | null;
  transcript_reseed_mode: string | null;
  resume_argv_json: string | null;
  usage_source: string | null;
  termination_reason: string | null;
  exit_code: number | null;
  signal: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  error_code: string | null;
  error_message: string | null;
};

export type RunRepository = {
  insertRun(input: InsertRunInput): void;
  getRun(id: string): RunRow | undefined;
  listRuns(limit?: number): RunRow[];
  listRunsByThread(threadId: string, limit?: number): RunRow[];
  listNonTerminalRuns(): RunRow[];
  updateRunStatus(input: UpdateRunStatusInput): void;
  setRunCodexThreadId(runId: string, codexThreadId: string): void;
  setRunResumeMode(runId: string, resumeMode: ResolvedResumeMode): void;
  setRunQueueState(runId: string, queueState: RunQueueState): void;
  insertRunEvent(event: AgentEventEnvelope): void;
  listRunEvents(runId: string, afterSeq?: number): AgentEventEnvelope[];
};

export type InsertThreadInput = {
  id: string;
  title?: string | null;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: string;
  profile: string;
  sandbox: string;
  model?: string | null;
  reasoning?: string | null;
  status: 'active' | 'archived';
  createdAt?: string;
  updatedAt?: string;
};

export type ThreadRow = {
  id: string;
  title: string | null;
  codex_thread_id: string | null;
  cwd: string;
  canonical_cwd: string;
  workspace_mode: string;
  profile: string;
  sandbox: string;
  model: string | null;
  reasoning: string | null;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
};

export type ThreadRepository = {
  insertThread(input: InsertThreadInput): void;
  getThread(id: string): ThreadRow | undefined;
  getThreadByCodexThreadId(codexThreadId: string): ThreadRow | undefined;
  listThreads(input?: { status?: 'active' | 'archived' | 'all'; limit?: number }): ThreadRow[];
  archiveThread(id: string): void;
  updateImportedThread(input: UpdateImportedThreadInput): void;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};

export type UpdateImportedThreadInput = {
  id: string;
  title: string;
  cwd: string;
  canonicalCwd: string;
  updatedAt: string;
};

export function createRunRepository(db: Database.Database): RunRepository {
  const insert = db.prepare(`
    INSERT INTO runs (
      id, thread_id, codex_thread_id, resume_mode, queue_state, public_status, internal_status, created_by, source_id,
      profile, cwd, canonical_cwd, workspace_mode, prompt_hash, prompt_preview_redacted,
      model, reasoning, sandbox, codex_version, codex_bin, codex_home, normalizer_version, timeout_ms
    ) VALUES (
      @id, @threadId, @codexThreadId, @resumeMode, @queueState, @publicStatus, @internalStatus, @createdBy, @sourceId,
      @profile, @cwd, @canonicalCwd, @workspaceMode, @promptHash, @promptPreviewRedacted,
      @model, @reasoning, @sandbox, @codexVersion, @codexBin, @codexHome, @normalizerVersion, @timeoutMs
    )
  `);

  const get = db.prepare<string>('SELECT * FROM runs WHERE id = ?');
  const list = db.prepare<{ limit: number }>(`
    SELECT * FROM runs
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listByThread = db.prepare<{ threadId: string; limit: number }>(`
    SELECT * FROM runs
    WHERE thread_id = @threadId
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
  `);
  const listNonTerminal = db.prepare(`
    SELECT *
    FROM runs
    WHERE public_status IN ('queued', 'running')
       OR internal_status IN ('created', 'queued', 'spawning', 'running', 'canceling')
    ORDER BY created_at ASC, id ASC
  `);
  const updateStatus = db.prepare(`
    UPDATE runs
    SET public_status = @publicStatus,
        internal_status = @internalStatus,
        termination_reason = @terminationReason,
        exit_code = @exitCode,
        signal = @signal,
        error_code = @errorCode,
        error_message = @errorMessage,
        started_at = COALESCE(started_at, @startedAt),
        ended_at = @endedAt,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const setCodexThreadId = db.prepare(`
    UPDATE runs
    SET codex_thread_id = @codexThreadId,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @runId
  `);
  const setResumeMode = db.prepare(`
    UPDATE runs
    SET resume_mode = @resumeMode,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @runId
  `);
  const setQueueState = db.prepare(`
    UPDATE runs
    SET queue_state = @queueState,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @runId
  `);
  const insertEvent = db.prepare(`
    INSERT OR REPLACE INTO run_events (
      id, run_id, seq, type, payload_json, raw_event_id
    ) VALUES (
      @id, @runId, @seq, @type, @payloadJson, @rawEventId
    )
  `);
  const listEvents = db.prepare<{ runId: string; afterSeq: number }>(`
    SELECT *
    FROM run_events
    WHERE run_id = @runId AND seq > @afterSeq
    ORDER BY seq ASC
  `);

  return {
    insertRun(input: InsertRunInput): void {
      insert.run({
        threadId: null,
        codexThreadId: null,
        resumeMode: 'independent',
        queueState: 'none',
        sourceId: null,
        timeoutMs: null,
        promptHash: null,
        promptPreviewRedacted: null,
        model: null,
        reasoning: null,
        ...input
      });
    },
    getRun(id: string): RunRow | undefined {
      return get.get(id) as RunRow | undefined;
    },
    listRuns(limit = 50): RunRow[] {
      return list.all({ limit }) as RunRow[];
    },
    listRunsByThread(threadId: string, limit = 50): RunRow[] {
      return listByThread.all({ threadId, limit }) as RunRow[];
    },
    listNonTerminalRuns(): RunRow[] {
      return listNonTerminal.all() as RunRow[];
    },
    updateRunStatus(input: UpdateRunStatusInput): void {
      updateStatus.run({
        terminationReason: null,
        exitCode: null,
        signal: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        endedAt: null,
        ...input
      });
    },
    setRunCodexThreadId(runId: string, codexThreadId: string): void {
      setCodexThreadId.run({ runId, codexThreadId });
    },
    setRunResumeMode(runId: string, resumeMode: ResolvedResumeMode): void {
      setResumeMode.run({ runId, resumeMode });
    },
    setRunQueueState(runId: string, queueState: RunQueueState): void {
      setQueueState.run({ runId, queueState });
    },
    insertRunEvent(event: AgentEventEnvelope): void {
      insertEvent.run({
        id: event.id,
        runId: event.runId,
        seq: event.seq,
        type: event.type,
        payloadJson: JSON.stringify(event.payload),
        rawEventId: event.rawEventId ?? null
      });
    },
    listRunEvents(runId: string, afterSeq = 0): AgentEventEnvelope[] {
      const rows = listEvents.all({ runId, afterSeq }) as RunEventRow[];
      return rows.map(row => ({
        id: row.id,
        runId: row.run_id,
        seq: row.seq,
        ts: row.created_at,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        normalizerVersion: 1,
        ...(row.raw_event_id === null ? {} : { rawEventId: row.raw_event_id })
      })) as AgentEventEnvelope[];
    }
  };
}

export function createThreadRepository(db: Database.Database): ThreadRepository {
  const insert = db.prepare(`
    INSERT INTO threads (
      id, title, codex_thread_id, cwd, canonical_cwd, workspace_mode,
      profile, sandbox, model, reasoning, status, created_at, updated_at
    ) VALUES (
      @id, @title, @codexThreadId, @cwd, @canonicalCwd, @workspaceMode,
      @profile, @sandbox, @model, @reasoning, @status,
      COALESCE(@createdAt, CURRENT_TIMESTAMP), COALESCE(@updatedAt, CURRENT_TIMESTAMP)
    )
  `);
  const get = db.prepare<string>('SELECT * FROM threads WHERE id = ?');
  const getByCodexThreadId = db.prepare<string>('SELECT * FROM threads WHERE codex_thread_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1');
  const list = db.prepare<{ status: 'active' | 'archived' | 'all'; limit: number }>(`
    SELECT * FROM threads
    WHERE (@status = 'all' OR status = @status)
    ORDER BY updated_at DESC, id DESC
    LIMIT @limit
  `);
  const archive = db.prepare(`
    UPDATE threads
    SET status = 'archived',
        archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const updateImported = db.prepare(`
    UPDATE threads
    SET title = @title,
        cwd = @cwd,
        canonical_cwd = @canonicalCwd,
        updated_at = @updatedAt
    WHERE id = @id
  `);
  const setCodexThreadId = db.prepare(`
    UPDATE threads
    SET codex_thread_id = @codexThreadId,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @threadId
  `);
  const touch = db.prepare(`
    UPDATE threads
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  return {
    insertThread(input: InsertThreadInput): void {
      insert.run({
        title: null,
        codexThreadId: null,
        model: null,
        reasoning: null,
        createdAt: null,
        updatedAt: null,
        ...input
      });
    },
    getThread(id: string): ThreadRow | undefined {
      return get.get(id) as ThreadRow | undefined;
    },
    getThreadByCodexThreadId(codexThreadId: string): ThreadRow | undefined {
      return getByCodexThreadId.get(codexThreadId) as ThreadRow | undefined;
    },
    listThreads(input = {}): ThreadRow[] {
      return list.all({
        status: input.status ?? 'active',
        limit: input.limit ?? 50
      }) as ThreadRow[];
    },
    archiveThread(id: string): void {
      archive.run(id);
    },
    updateImportedThread(input: UpdateImportedThreadInput): void {
      updateImported.run(input);
    },
    setCodexThreadId(threadId: string, codexThreadId: string): void {
      setCodexThreadId.run({ threadId, codexThreadId });
    },
    touchThread(threadId: string): void {
      touch.run(threadId);
    }
  };
}

export type UpdateRunStatusInput = {
  id: string;
  publicStatus: string;
  internalStatus: string;
  terminationReason?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

type RunEventRow = {
  id: string;
  run_id: string;
  seq: number;
  type: AgentEventEnvelope['type'];
  payload_json: string;
  raw_event_id: string | null;
  created_at: string;
};
