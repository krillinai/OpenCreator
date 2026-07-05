import type { AgentEventEnvelope, PublicRunStatus, TerminationReason } from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { buildCodexExecArgs } from '../codex/argv.js';
import { CodexExecError, startCodexExec } from '../codex/runner.js';
import { normalizerVersion, normalizeCodexEvent } from '../events/normalizer.js';
import { parseJsonLine } from '../events/parser.js';
import { redactText } from '../security/redaction.js';
import { createRunRepository, type RunRow } from '../storage/repositories.js';
import type { RuntimeThread } from '../threads/types.js';
import type { CreatedRun, CreateRunInput } from './types.js';

export type ThreadAccess = {
  getThread(id: string): RuntimeThread | undefined;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};

export type RunManagerOptions = {
  db: Database.Database;
  dataDir: string;
  codexBin: string;
  codexHome: string;
  timeoutMs?: number;
  spawnTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  threadAccess?: ThreadAccess;
  resumeCapabilityVerified?: boolean;
};

export type RuntimeRun = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  status: PublicRunStatus;
  cwd: string;
  profile: string;
  sandbox: string;
  createdAt: string;
  updatedAt: string;
  terminationReason?: string;
  exitCode?: number | null;
  signal?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type RunEventSubscriber = (event: AgentEventEnvelope) => void;

export type RunManager = {
  startRun(input: CreateRunInput): CreatedRun;
  createAndRun(input: CreateRunInput): Promise<CreatedRun>;
  cancelRun(id: string): boolean;
  getRun(id: string): RuntimeRun | undefined;
  listRuns(limit?: number): RuntimeRun[];
  listRunsByThread(threadId: string, limit?: number): RuntimeRun[];
  listEvents(runId: string, afterSeq?: number): AgentEventEnvelope[];
  subscribe(runId: string, subscriber: RunEventSubscriber): () => void;
};

const EXEC_TIMEOUT_MS = 30_000;
const EXEC_INACTIVITY_TIMEOUT_MS = 30_000;
const CODEX_THREAD_ID_MISSING_MESSAGE = 'Codex stream ended without thread.started thread_id';

type ActiveRun = {
  cancel(): void;
  done: Promise<CreatedRun>;
};

export function createRunManager(options: RunManagerOptions): RunManager {
  const runs = createRunRepository(options.db);
  const activeRuns = new Map<string, ActiveRun>();
  const subscribers = new Map<string, Set<RunEventSubscriber>>();

  const publish = (event: AgentEventEnvelope) => {
    runs.insertRunEvent(event);
    appendFileSync(join(options.dataDir, 'runs', event.runId, 'events.ndjson'), `${JSON.stringify(event)}\n`);
    for (const subscriber of subscribers.get(event.runId) ?? []) subscriber(event);
  };

  const updateStatus = (
    id: string,
    publicStatus: PublicRunStatus,
    internalStatus: string = publicStatus,
    extra: {
      terminationReason?: TerminationReason | null;
      exitCode?: number | null;
      signal?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
      startedAt?: string | null;
      endedAt?: string | null;
    } = {}
  ) => {
    runs.updateRunStatus({
      id,
      publicStatus,
      internalStatus,
      ...extra
    });
  };

  recoverOrphanedRuns();

  const manager: RunManager = {
    startRun(input: CreateRunInput): CreatedRun {
      if (input.resumeMode === 'resume_thread' && input.threadId === undefined) {
        const id = insertInitialRun(input);
        const runDir = join(options.dataDir, 'runs', id);
        writeJson(join(runDir, 'diagnostics.json'), {
          error: 'resume_thread requires threadId',
          terminationReason: 'stream_error'
        });
        updateStatus(id, 'failed', 'failed', {
          terminationReason: 'stream_error',
          errorCode: 'RESUME_FAILED',
          errorMessage: 'resume_thread requires threadId',
          endedAt: new Date().toISOString()
        });
        publishDone(id, 1, 'failed', 'stream_error', publish);
        return { id, status: 'failed' };
      }

      const id = insertInitialRun(input);
      const runDir = join(options.dataDir, 'runs', id);
      const stdoutLines: string[] = [];
      let stderr = '';
      let seq = 0;
      let sawTurnCompleted = false;
      let sawCodexThreadId = false;

      const process = startCodexExec({
        codexBin: options.codexBin,
        codexHome: options.codexHome,
        cwd: input.cwd,
        args: buildCodexExecArgs({
          profile: input.profile,
          cwd: input.cwd,
          sandbox: input.sandbox,
          model: input.model,
          reasoning: input.reasoning
        }),
        prompt: input.prompt,
        timeoutMs: options.timeoutMs ?? EXEC_TIMEOUT_MS,
        spawnTimeoutMs: options.spawnTimeoutMs,
        inactivityTimeoutMs: options.inactivityTimeoutMs ?? EXEC_INACTIVITY_TIMEOUT_MS,
        onStdoutLine(line) {
          const redactedLine = redactText(line);
          stdoutLines.push(redactedLine);
          appendFileSync(join(runDir, 'raw.redacted.ndjson'), `${redactedLine}\n`);

          const parsed = parseJsonLine(redactedLine);
          seq += 1;
          if (!parsed.ok) {
            publishDiagnostic(id, seq, 'CODEX_STREAM_ERROR', parsed.error, publish, {
              line: redactedLine
            });
            return;
          }

          if (isThreadStarted(parsed.value)) {
            const codexThreadId = parsed.value.thread_id;
            sawCodexThreadId = true;
            runs.setRunCodexThreadId(id, codexThreadId);
            if (input.threadId) options.threadAccess?.setCodexThreadId(input.threadId, codexThreadId);
            publishStatus(id, seq, 'initializing', publish, {
              threadId: input.threadId,
              codexThreadId
            });
            return;
          }
          if (isTurnCompleted(parsed.value)) sawTurnCompleted = true;
          publish(normalizeCodexEvent({ runId: id, seq, raw: parsed.value }));
        },
        onStderrChunk(chunk) {
          const redactedChunk = redactText(chunk);
          stderr += redactedChunk;
          appendFileSync(join(runDir, 'stderr.redacted.log'), redactedChunk);
        }
      });

      updateStatus(id, 'running', 'running', { startedAt: new Date().toISOString() });

      const done = process.result
        .then(result => {
          const exitedSuccessfully =
            result.exitCode === 0 && result.terminationReason !== 'canceled';
          const missingCodexThreadId =
            exitedSuccessfully && input.threadId !== undefined && !sawCodexThreadId;
          const streamError = exitedSuccessfully && (!sawTurnCompleted || missingCodexThreadId);
          const publicStatus: PublicRunStatus = result.terminationReason === 'canceled'
            ? 'canceled'
            : result.exitCode === 0 && !streamError
              ? 'succeeded'
              : 'failed';
          const terminationReason = streamError ? 'stream_error' : resultToTerminationReason(result);
          const errorCode = missingCodexThreadId ? 'CODEX_THREAD_ID_MISSING' : undefined;
          const errorMessage = missingCodexThreadId
            ? CODEX_THREAD_ID_MISSING_MESSAGE
            : undefined;
          writeJson(join(runDir, 'diagnostics.json'), {
            exitCode: result.exitCode,
            signal: result.signal,
            terminationReason,
            ...(missingCodexThreadId
              ? { error: errorMessage }
              : streamError
                ? { error: 'Codex stream ended without turn.completed' }
                : {})
          });
          if (missingCodexThreadId) {
            publishError(
              id,
              ++seq,
              'CODEX_THREAD_ID_MISSING',
              CODEX_THREAD_ID_MISSING_MESSAGE,
              publish
            );
          } else if (streamError) {
            publishDiagnostic(
              id,
              ++seq,
              'CODEX_STREAM_ERROR',
              'Codex stream ended without turn.completed',
              publish
            );
          }
          updateStatus(id, publicStatus, publicStatus, {
            terminationReason,
            exitCode: result.exitCode,
            signal: result.signal,
            ...(errorCode === undefined ? {} : { errorCode }),
            ...(errorMessage === undefined ? {} : { errorMessage }),
            endedAt: new Date().toISOString()
          });

          if (!hasDoneEvent(id)) publishDone(id, ++seq, publicStatus, terminationReason, publish);
          activeRuns.delete(id);
          return { id, status: publicStatus };
        })
        .catch(error => {
          const terminationReason = errorToTerminationReason(error);
          const publicStatus: PublicRunStatus =
            terminationReason === 'user_canceled' ? 'canceled' : 'failed';
          writeJson(join(runDir, 'diagnostics.json'), {
            error: error instanceof Error ? error.message : String(error),
            terminationReason
          });
          updateStatus(id, publicStatus, publicStatus, {
            terminationReason,
            errorCode: errorCodeForTermination(terminationReason),
            errorMessage: error instanceof Error ? error.message : String(error),
            endedAt: new Date().toISOString()
          });
          if (error instanceof CodexExecError) {
            for (const line of error.stdoutLines.slice(stdoutLines.length)) {
              appendFileSync(join(runDir, 'raw.redacted.ndjson'), `${redactText(line)}\n`);
            }
            if (stderr.length === 0 && error.stderr.length > 0) {
              appendFileSync(join(runDir, 'stderr.redacted.log'), redactText(error.stderr));
            }
          }
          publishDone(id, ++seq, publicStatus, terminationReason, publish);
          activeRuns.delete(id);
          return { id, status: publicStatus };
        });

      activeRuns.set(id, {
        cancel() {
          updateStatus(id, 'running', 'canceling');
          publishStatus(id, ++seq, 'canceling', publish);
          process.cancel();
        },
        done
      });

      return { id, status: 'running' };
    },

    async createAndRun(input: CreateRunInput): Promise<CreatedRun> {
      const run = manager.startRun(input);
      return activeRuns.get(run.id)?.done ?? run;
    },

    cancelRun(id: string): boolean {
      const active = activeRuns.get(id);
      if (active === undefined) return false;
      active.cancel();
      return true;
    },

    getRun(id: string): RuntimeRun | undefined {
      const row = runs.getRun(id);
      return row === undefined ? undefined : mapRunRow(row);
    },

    listRuns(limit?: number): RuntimeRun[] {
      return runs.listRuns(limit).map(mapRunRow);
    },

    listRunsByThread(threadId: string, limit?: number): RuntimeRun[] {
      return runs.listRunsByThread(threadId, limit).map(mapRunRow);
    },

    listEvents(runId: string, afterSeq?: number): AgentEventEnvelope[] {
      return runs.listRunEvents(runId, afterSeq);
    },

    subscribe(runId: string, subscriber: RunEventSubscriber): () => void {
      const set = subscribers.get(runId) ?? new Set<RunEventSubscriber>();
      set.add(subscriber);
      subscribers.set(runId, set);
      return () => {
        set.delete(subscriber);
        if (set.size === 0) subscribers.delete(runId);
      };
    }
  };

  function insertInitialRun(input: CreateRunInput): string {
    const id = `run_${nanoid(10)}`;
    const runDir = join(options.dataDir, 'runs', id);
    const canonicalCwd = resolve(input.cwd);
    const args = buildCodexExecArgs({
      profile: input.profile,
      cwd: input.cwd,
      sandbox: input.sandbox,
      model: input.model,
      reasoning: input.reasoning
    });

    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'raw.redacted.ndjson'), '');
    writeFileSync(join(runDir, 'events.ndjson'), '');
    writeFileSync(join(runDir, 'stderr.redacted.log'), '');
    runs.insertRun({
      id,
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: 'api',
      threadId: input.threadId,
      profile: input.profile,
      cwd: input.cwd,
      canonicalCwd,
      workspaceMode: 'managed',
      sandbox: input.sandbox,
      codexVersion: 'unknown',
      codexBin: options.codexBin,
      codexHome: options.codexHome,
      resumeMode: input.threadId === undefined ? 'independent' : normalizeResumeMode(input.resumeMode),
      normalizerVersion
    });

    writeJson(join(runDir, 'meta.json'), {
      id,
      args,
      cwd: input.cwd,
      profile: input.profile,
      sandbox: input.sandbox,
      threadId: input.threadId,
      resumeMode: input.resumeMode ?? 'new_thread'
    });

    return id;
  }

  function hasDoneEvent(runId: string): boolean {
    return runs.listRunEvents(runId).some(event => event.type === 'done');
  }

  function recoverOrphanedRuns(): void {
    for (const run of runs.listNonTerminalRuns()) {
      mkdirSync(join(options.dataDir, 'runs', run.id), { recursive: true });
      const existingEvents = runs.listRunEvents(run.id);
      const nextSeq = (existingEvents.at(-1)?.seq ?? 0) + 1;
      updateStatus(run.id, 'failed', 'orphaned', {
        terminationReason: 'daemon_restart',
        errorCode: 'DAEMON_RESTART',
        errorMessage: 'Run was still active when daemon restarted',
        endedAt: new Date().toISOString()
      });
      writeJson(join(options.dataDir, 'runs', run.id, 'diagnostics.json'), {
        error: 'Run was still active when daemon restarted',
        terminationReason: 'daemon_restart'
      });
      if (!existingEvents.some(event => event.type === 'error')) {
        publishError(
          run.id,
          nextSeq,
          'DAEMON_RESTART',
          'Run was still active when daemon restarted',
          publish
        );
      }
      if (!existingEvents.some(event => event.type === 'done')) {
        const doneSeq = existingEvents.some(event => event.type === 'error') ? nextSeq : nextSeq + 1;
        publishDone(run.id, doneSeq, 'failed', 'daemon_restart', publish);
      }
    }
  }

  return manager;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function publishStatus(
  runId: string,
  seq: number,
  label: 'queued' | 'initializing' | 'running' | 'canceling' | 'finalizing',
  publish: (event: AgentEventEnvelope) => void,
  metadata: { threadId?: string; codexThreadId?: string } = {}
): void {
  publish({
    id: `evt_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date().toISOString(),
    type: 'status',
    payload: { type: 'status', label, ...metadata },
    normalizerVersion
  });
}

function publishDiagnostic(
  runId: string,
  seq: number,
  code: string,
  message: string,
  publish: (event: AgentEventEnvelope) => void,
  details?: Record<string, unknown>
): void {
  publish({
    id: `evt_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date().toISOString(),
    type: 'diagnostic',
    payload: {
      type: 'diagnostic',
      code,
      severity: 'warning',
      message,
      ...(details === undefined ? {} : { details })
    },
    normalizerVersion
  });
}

function publishError(
  runId: string,
  seq: number,
  code: string,
  message: string,
  publish: (event: AgentEventEnvelope) => void,
  details?: Record<string, unknown>
): void {
  publish({
    id: `evt_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date().toISOString(),
    type: 'error',
    payload: {
      type: 'error',
      code,
      message,
      ...(details === undefined ? {} : { details })
    },
    normalizerVersion
  });
}

function publishDone(
  runId: string,
  seq: number,
  status: 'succeeded' | 'failed' | 'canceled',
  terminationReason: TerminationReason,
  publish: (event: AgentEventEnvelope) => void
): void {
  publish({
    id: `evt_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date().toISOString(),
    type: 'done',
    payload: {
      type: 'done',
      status,
      terminationReason
    },
    normalizerVersion
  });
}

function resultToTerminationReason(result: {
  terminationReason: string;
  exitCode: number | null;
}): TerminationReason {
  if (result.terminationReason === 'canceled') return 'user_canceled';
  if (result.exitCode === 0) return 'completed';
  return 'codex_exit_non_zero';
}

function isTurnCompleted(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'turn.completed';
}

function isThreadStarted(value: unknown): value is { type: 'thread.started'; thread_id: string } {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (value as { type?: unknown }).type === 'thread.started'
    && typeof (value as { thread_id?: unknown }).thread_id === 'string'
    && (value as { thread_id: string }).thread_id.trim().length > 0;
}

function normalizeResumeMode(
  resumeMode: CreateRunInput['resumeMode']
): 'new_thread' | 'resume_thread' {
  return resumeMode === 'resume_thread' ? 'resume_thread' : 'new_thread';
}

function errorToTerminationReason(error: unknown): TerminationReason {
  if (error instanceof CodexExecError) {
    if (error.terminationReason === 'timeout') return 'timeout';
    if (error.terminationReason === 'spawn_timeout') return 'spawn_timeout';
    if (error.terminationReason === 'inactivity_timeout') return 'inactivity_timeout';
    if (error.terminationReason === 'spawn_failed') return 'spawn_failed';
  }
  return 'stream_error';
}

function errorCodeForTermination(reason: TerminationReason): string {
  if (reason === 'timeout' || reason === 'inactivity_timeout') return 'CODEX_STREAM_ERROR';
  if (reason === 'spawn_timeout') return 'SPAWN_TIMEOUT';
  if (reason === 'spawn_failed') return 'SPAWN_FAILED';
  return 'CODEX_STREAM_ERROR';
}

function mapRunRow(row: RunRow): RuntimeRun {
  return {
    id: row.id,
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    ...(row.codex_thread_id === null ? {} : { codexThreadId: row.codex_thread_id }),
    status: row.public_status as PublicRunStatus,
    cwd: row.cwd,
    profile: row.profile,
    sandbox: row.sandbox,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.termination_reason === null ? {} : { terminationReason: row.termination_reason }),
    exitCode: row.exit_code,
    signal: row.signal,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message })
  };
}
