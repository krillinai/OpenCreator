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
    }
  };
}
