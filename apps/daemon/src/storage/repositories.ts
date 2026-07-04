import type { AgentEventEnvelope } from '@clawee/protocol';
import type Database from 'better-sqlite3';

export type InsertRunInput = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  publicStatus: string;
  internalStatus: string;
  createdBy: string;
  sourceId?: string;
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
  updateRunStatus(input: UpdateRunStatusInput): void;
  insertRunEvent(event: AgentEventEnvelope): void;
  listRunEvents(runId: string, afterSeq?: number): AgentEventEnvelope[];
};

export function createRunRepository(db: Database.Database): RunRepository {
  const insert = db.prepare(`
    INSERT INTO runs (
      id, thread_id, codex_thread_id, public_status, internal_status, created_by, source_id,
      profile, cwd, canonical_cwd, workspace_mode, prompt_hash, prompt_preview_redacted,
      model, reasoning, sandbox, codex_version, codex_bin, codex_home, normalizer_version
    ) VALUES (
      @id, @threadId, @codexThreadId, @publicStatus, @internalStatus, @createdBy, @sourceId,
      @profile, @cwd, @canonicalCwd, @workspaceMode, @promptHash, @promptPreviewRedacted,
      @model, @reasoning, @sandbox, @codexVersion, @codexBin, @codexHome, @normalizerVersion
    )
  `);

  const get = db.prepare<string>('SELECT * FROM runs WHERE id = ?');
  const list = db.prepare<{ limit: number }>(`
    SELECT * FROM runs
    ORDER BY created_at DESC, id DESC
    LIMIT @limit
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
        sourceId: null,
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
