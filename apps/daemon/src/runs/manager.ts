import type {
  AgentEventEnvelope,
  PublicRunStatus,
  RuntimeApproval,
  RunSubmissionMode,
  TerminationReason
} from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { ApprovalManager } from '../approvals/manager.js';
import { buildCodexExecArgs, buildCodexResumeArgs } from '../codex/argv.js';
import {
  startCodexAppServer,
  type AppServerRequest
} from '../codex/app-server-runner.js';
import { CodexExecError, startCodexExec } from '../codex/runner.js';
import {
  normalizerVersion,
  normalizeAppServerEvent,
  normalizeCodexEvent
} from '../events/normalizer.js';
import { parseJsonLine } from '../events/parser.js';
import { redactText } from '../security/redaction.js';
import {
  createRunRepository,
  type ResolvedResumeMode,
  type RunQueueState,
  type RunRow
} from '../storage/repositories.js';
import type { RuntimeThread } from '../threads/types.js';
import {
  createOrderedLogWriter,
  type OrderedLogWriter,
  type OrderedLogWriterMetrics
} from './ordered-log-writer.js';
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
  profileValidator?: {
    validateProfileForRun(name: string): { ok: true } | { ok: false; code: string; message: string };
  };
  runtimeTransport?: 'exec' | 'app-server';
  approvalManager?: ApprovalManager;
  logWriterFactory?(runDir: string): OrderedLogWriter;
};

export type RuntimeRun = {
  id: string;
  threadId?: string;
  codexThreadId?: string;
  status: PublicRunStatus;
  submissionMode: RunSubmissionMode;
  queuePosition?: number;
  cwd: string;
  profile: string;
  sandbox: string;
  createdBy: string;
  sourceId?: string | null;
  timeoutMs?: number | null;
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
  hasActiveRunForThread(threadId: string): boolean;
  listRuns(limit?: number): RuntimeRun[];
  listRunsByThread(threadId: string, limit?: number): RuntimeRun[];
  getLastEventSeq(runId: string): number;
  listEvents(runId: string, afterSeq?: number): AgentEventEnvelope[];
  subscribe(runId: string, subscriber: RunEventSubscriber): () => void;
  close(options?: { timeoutMs?: number }): Promise<void>;
};

const INTERACTIVE_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SCHEDULED_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const EXEC_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const EXEC_SPAWN_TIMEOUT_MS = 30_000;
const CODEX_THREAD_ID_MISSING_MESSAGE = 'Codex stream ended without thread.started thread_id';

type ActiveRun = {
  cancel(): void;
  done: Promise<CreatedRun>;
};

type QueuedRun = {
  id: string;
  input: CreateRunInput;
  runDir: string;
};

export function createRunManager(options: RunManagerOptions): RunManager {
  const runs = createRunRepository(options.db);
  const listRunsByThreadNewestFirst = options.db.prepare<{ threadId: string; limit: number }>(`
    SELECT * FROM runs
    WHERE thread_id = @threadId
    ORDER BY created_at DESC, rowid DESC
    LIMIT @limit
  `);
  const activeRuns = new Map<string, ActiveRun>();
  const runCompletions = new Map<string, Promise<CreatedRun>>();
  const queuedCompletionResolvers = new Map<string, (run: CreatedRun) => void>();
  const threadQueues = new Map<string, QueuedRun[]>();
  const runningThreadRun = new Map<string, string>();
  const subscribers = new Map<string, Set<RunEventSubscriber>>();
  const logWriters = new Map<string, OrderedLogWriter>();
  let closing = false;
  let closeWork: Promise<void> | undefined;

  const publish = (event: AgentEventEnvelope): Promise<void> => {
    runs.insertRunEvent(event);
    const logWrite = appendRunLog(
      event.runId,
      'events.ndjson',
      `${JSON.stringify(event)}\n`
    );
    for (const subscriber of subscribers.get(event.runId) ?? []) {
      try {
        subscriber(event);
      } catch {
        // Subscriber failures must not affect durable Run processing.
      }
    }
    return logWrite;
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
      if (closing) throw new Error('Run manager is closing');
      const thread = input.threadId === undefined
        ? undefined
        : options.threadAccess?.getThread(input.threadId);
      const resolvedResumeMode = resolveResumeMode(input, thread);
      const codexThreadId = thread?.codexThreadId ?? undefined;
      const id = insertInitialRun(input, resolvedResumeMode, codexThreadId);
      const runDir = join(options.dataDir, 'runs', id);

      if (input.threadId !== undefined && runningThreadRun.has(input.threadId)) {
        updateStatus(id, 'queued', 'queued');
        runs.setRunQueueState(id, 'queued');
        void publishStatus(id, 1, 'queued', publish, {
          threadId: input.threadId,
          codexThreadId
        }).catch(() => undefined);
        let resolveCompletion!: (run: CreatedRun) => void;
        const completion = new Promise<CreatedRun>(resolve => {
          resolveCompletion = resolve;
        });
        runCompletions.set(id, completion);
        queuedCompletionResolvers.set(id, resolveCompletion);
        const queue = threadQueues.get(input.threadId) ?? [];
        const queuedRun = { id, input, runDir };
        const submissionMode = input.submissionMode ?? 'enqueue';
        let queuePosition: number;
        if (submissionMode === 'interrupt_and_enqueue') {
          const firstRegularIndex = queue.findIndex(
            item => (item.input.submissionMode ?? 'enqueue') === 'enqueue'
          );
          const insertIndex = firstRegularIndex === -1 ? queue.length : firstRegularIndex;
          queue.splice(insertIndex, 0, queuedRun);
          queuePosition = insertIndex + 1;
        } else {
          queue.push(queuedRun);
          queuePosition = queue.length;
        }
        threadQueues.set(input.threadId, queue);
        if (submissionMode === 'interrupt_and_enqueue') {
          const activeRunId = runningThreadRun.get(input.threadId);
          const activeRow = activeRunId === undefined ? undefined : runs.getRun(activeRunId);
          if (activeRunId !== undefined && activeRow?.internal_status !== 'canceling') {
            manager.cancelRun(activeRunId);
          }
        }
        return {
          id,
          threadId: input.threadId,
          status: 'queued',
          submissionMode,
          queuePosition
        };
      }

      return startExistingRun({ id, input, runDir });
    },

    async createAndRun(input: CreateRunInput): Promise<CreatedRun> {
      const run = manager.startRun(input);
      return runCompletions.get(run.id) ?? activeRuns.get(run.id)?.done ?? run;
    },

    cancelRun(id: string): boolean {
      const active = activeRuns.get(id);
      if (active !== undefined) {
        active.cancel();
        return true;
      }

      const queued = removeQueuedRun(id);
      if (queued === undefined) return false;

      const endedAt = new Date().toISOString();
      const seq = nextSeqForRun(id);
      writeQueuedCancelDiagnostics(queued);
      updateStatus(id, 'canceled', 'canceled', {
        terminationReason: 'user_canceled',
        endedAt
      });
      runs.setRunQueueState(id, 'none');
      void (async () => {
        const statusWrite = publishStatus(
          id,
          seq,
          'canceling',
          publish,
          { threadId: queued.threadId }
        );
        const doneWrite = publishDone(
          id,
          seq + 1,
          'canceled',
          'user_canceled',
          publish
        );
        await safePublish(statusWrite);
        await safePublish(doneWrite);
        const logWriter = await closeRunLog(id);
        writeQueuedCancelDiagnostics(queued, logWriter);
        resolveRunCompletion(id, {
          id,
          threadId: queued.threadId,
          status: 'canceled',
          submissionMode: queued.input.submissionMode ?? 'enqueue'
        });
      })().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to finalize queued run ${id}: ${message}`);
      });
      return true;
    },

    getRun(id: string): RuntimeRun | undefined {
      const row = runs.getRun(id);
      return row === undefined ? undefined : decorateQueuePosition(mapRunRow(row));
    },

    hasActiveRunForThread(threadId: string): boolean {
      if (runningThreadRun.has(threadId)) return true;
      if ((threadQueues.get(threadId)?.length ?? 0) > 0) return true;
      return runs
        .listRunsByThread(threadId, 10_000)
        .some(run =>
          run.public_status === 'queued'
          || run.public_status === 'running'
          || run.internal_status === 'queued'
          || run.internal_status === 'running'
          || run.internal_status === 'canceling'
        );
    },

    listRuns(limit?: number): RuntimeRun[] {
      return runs.listRuns(limit).map(row => decorateQueuePosition(mapRunRow(row)));
    },

    listRunsByThread(threadId: string, limit?: number): RuntimeRun[] {
      return (listRunsByThreadNewestFirst.all({ threadId, limit: limit ?? 50 }) as RunRow[])
        .map(row => decorateQueuePosition(mapRunRow(row)));
    },

    getLastEventSeq(runId: string): number {
      return runs.getLastRunEventSeq(runId);
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
    },

    async close(closeOptions = {}) {
      if (closeWork === undefined) {
        closing = true;
        for (const active of activeRuns.values()) active.cancel();
        for (const queue of threadQueues.values()) {
          for (const queued of [...queue]) manager.cancelRun(queued.id);
        }

        closeWork = (async () => {
          const completions = [
            ...[...activeRuns.values()].map(active => active.done),
            ...runCompletions.values()
          ];
          await Promise.allSettled(completions);
          await Promise.all([...logWriters.values()].map(writer => writer.close()));
          logWriters.clear();
        })();
      }
      if (closeOptions.timeoutMs === undefined) {
        await closeWork;
        return;
      }
      await withTimeout(
        closeWork,
        closeOptions.timeoutMs,
        'Timed out waiting for run log writers to close'
      );
    }
  };

  function getLogWriter(runId: string): OrderedLogWriter {
    const existing = logWriters.get(runId);
    if (existing !== undefined) return existing;
    const runDir = join(options.dataDir, 'runs', runId);
    const writer = options.logWriterFactory?.(runDir) ?? createOrderedLogWriter({
      directory: runDir
    });
    logWriters.set(runId, writer);
    return writer;
  }

  function appendRunLog(runId: string, file: string, content: string): Promise<void> {
    return getLogWriter(runId).append(file, content);
  }

  async function safeAppendRunLog(runId: string, file: string, content: string): Promise<void> {
    try {
      await appendRunLog(runId, file, content);
    } catch {
      // The writer metrics retain the failure for diagnostics.
    }
  }

  async function safePublish(work: Promise<void>): Promise<void> {
    try {
      await work;
    } catch {
      // The writer metrics retain the failure for diagnostics.
    }
  }

  async function closeRunLog(runId: string): Promise<OrderedLogWriterMetrics> {
    const writer = getLogWriter(runId);
    await writer.close();
    const metrics = writer.getMetrics();
    logWriters.delete(runId);
    return metrics;
  }

  function closeDetachedRunLog(runId: string, writes: Promise<void>[]): void {
    const writer = getLogWriter(runId);
    void Promise.allSettled(writes)
      .then(() => writer.close())
      .finally(() => {
        if (logWriters.get(runId) === writer) logWriters.delete(runId);
      })
      .catch(() => undefined);
  }

  async function finalizeRun(input: {
    id: string;
    runDir: string;
    runInput: CreateRunInput;
    publicStatus: 'succeeded' | 'failed' | 'canceled';
    terminationReason: TerminationReason;
    diagnostics: Record<string, unknown>;
    statusExtra: {
      exitCode?: number | null;
      signal?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    };
    nextSeq(): number;
    publish: (event: AgentEventEnvelope) => Promise<void>;
  }): Promise<void> {
    const writer = getLogWriter(input.id);
    const beforeCloseMetrics = writer.getMetrics();
    if (beforeCloseMetrics.failureCount > 0) {
      await safePublish(publishDiagnostic(
        input.id,
        input.nextSeq(),
        'RUN_LOG_WRITE_FAILED',
        'One or more run log writes failed',
        input.publish,
        {
          failureCount: beforeCloseMetrics.failureCount,
          failures: beforeCloseMetrics.failures
        }
      ));
    }
    if (!hasDoneEvent(input.id)) {
      await safePublish(publishDone(
        input.id,
        input.nextSeq(),
        input.publicStatus,
        input.terminationReason,
        input.publish
      ));
    }

    const logWriter = await closeRunLog(input.id);
    writeJson(join(input.runDir, 'diagnostics.json'), {
      ...input.diagnostics,
      logWriter
    });
    updateStatus(input.id, input.publicStatus, input.publicStatus, {
      terminationReason: input.terminationReason,
      ...input.statusExtra,
      endedAt: new Date().toISOString()
    });
    activeRuns.delete(input.id);
    if (input.runInput.threadId !== undefined) runs.setRunQueueState(input.id, 'none');
    completeThreadRun(input.runInput.threadId, input.id);
  }

  function startExistingRun(input: QueuedRun): CreatedRun {
    const { id, runDir } = input;
    const runInput = input.input;
    if (runInput.threadId !== undefined) runningThreadRun.set(runInput.threadId, id);

    const thread = runInput.threadId === undefined
      ? undefined
      : options.threadAccess?.getThread(runInput.threadId);
    const resolvedResumeMode = resolveResumeMode(runInput, thread);
    const codexThreadId = thread?.codexThreadId ?? undefined;
    let resolvedCodexThreadId = resolvedResumeMode === 'resume_thread' ? codexThreadId : undefined;
    const plannedArgv = buildRunArgv(runInput, resolvedResumeMode, resolvedCodexThreadId);

    runs.setRunResumeMode(id, resolvedResumeMode);
    if (runInput.threadId !== undefined) runs.setRunQueueState(id, 'started');
    const createdRun = (status: PublicRunStatus): CreatedRun => ({
      id,
      ...(runInput.threadId === undefined ? {} : { threadId: runInput.threadId }),
      status,
      submissionMode: runInput.submissionMode ?? 'enqueue'
    });

    const failBeforeSpawnAndRelease = (failure: {
      code: string;
      message: string;
      terminationReason: TerminationReason;
    }): CreatedRun => {
      const run = failRunBeforeSpawn({
        id,
        runDir,
        code: failure.code,
        message: failure.message,
        terminationReason: failure.terminationReason,
        threadId: runInput.threadId,
        submissionMode: runInput.submissionMode ?? 'enqueue',
        diagnostics: buildThreadRunDiagnosticsMetadata({
          runInput,
          resumeMode: resolvedResumeMode,
          codexThreadId: resolvedCodexThreadId,
          argv: plannedArgv,
          queueState: runs.getRun(id)?.queue_state,
          errorCode: failure.code,
          errorMessage: failure.message,
          terminationReason: failure.terminationReason
        }),
        publish
      });
      resolveRunCompletion(id, run);
      if (runInput.threadId !== undefined) runs.setRunQueueState(id, 'none');
      completeThreadRun(runInput.threadId, id);
      return run;
    };

    if (plannedArgv === undefined) {
      return failBeforeSpawnAndRelease({
        code: 'CODEX_THREAD_ID_MISSING',
        message: 'resume_thread requires a persisted codexThreadId',
        terminationReason: 'stream_error'
      });
    }
    if (resolvedResumeMode === 'resume_thread' && options.resumeCapabilityVerified !== true) {
      return failBeforeSpawnAndRelease({
        code: 'RESUME_CAPABILITY_UNVERIFIED',
        message: 'Codex resume capability has not been verified',
        terminationReason: 'stream_error'
      });
    }
    if (runInput.threadId !== undefined) {
      const validation = options.profileValidator?.validateProfileForRun(runInput.profile);
      if (validation !== undefined && !validation.ok) {
        return failBeforeSpawnAndRelease({
          code: validation.code,
          message: validation.message,
          terminationReason: 'stream_error'
        });
      }
    }

    const stdoutLines: string[] = [];
    let stderr = '';
    let seq = lastSeqForRun(id);
    let sawTurnCompleted = false;
    let sawCodexThreadId = resolvedResumeMode === 'resume_thread';
    const codexArgs = plannedArgv;
    const runTimeouts = resolveRunTimeouts(runInput, options);
    if (resolvedResumeMode === 'resume_thread') {
      runs.setRunCodexThreadId(id, resolvedCodexThreadId!);
    }
    writeJson(join(runDir, 'meta.json'), {
      id,
      args: codexArgs,
      cwd: runInput.cwd,
      profile: runInput.profile,
      sandbox: runInput.sandbox,
      threadId: runInput.threadId,
      resumeMode: resolvedResumeMode,
      submissionMode: runInput.submissionMode ?? 'enqueue',
      attachmentIds: runInput.attachmentIds ?? []
    });
    if (resolvedResumeMode === 'new_thread' && codexThreadId !== undefined) {
      void publishDiagnostic(
        id,
        ++seq,
        'THREAD_CODEX_SESSION_RESET',
        'Starting a new Codex session for a thread that already had a Codex session',
        publish,
        { previousCodexThreadId: codexThreadId }
      ).catch(() => undefined);
    }

    if (options.runtimeTransport === 'app-server') {
      const process = startCodexAppServer({
        codexBin: options.codexBin,
        codexHome: options.codexHome,
        cwd: runInput.cwd,
        profile: runInput.profile,
        sandbox: runInput.sandbox,
        model: runInput.model,
        reasoning: runInput.reasoning,
        prompt: runInput.prompt,
        imagePaths: runInput.imagePaths,
        codexThreadId: resolvedResumeMode === 'resume_thread' ? resolvedCodexThreadId : undefined,
        timeoutMs: runTimeouts.timeoutMs,
        spawnTimeoutMs: runTimeouts.spawnTimeoutMs,
        inactivityTimeoutMs: runTimeouts.inactivityTimeoutMs,
        async onThreadStarted(parsedCodexThreadId) {
          sawCodexThreadId = true;
          resolvedCodexThreadId = parsedCodexThreadId;
          runs.setRunCodexThreadId(id, parsedCodexThreadId);
          if (runInput.threadId) {
            options.threadAccess?.setCodexThreadId(runInput.threadId, parsedCodexThreadId);
          }
          await publishStatus(id, ++seq, 'initializing', publish, {
            threadId: runInput.threadId,
            codexThreadId: parsedCodexThreadId
          });
        },
        async onNotification(notification) {
          const redactedLine = redactText(JSON.stringify(notification));
          stdoutLines.push(redactedLine);
          await appendRunLog(id, 'raw.redacted.ndjson', `${redactedLine}\n`);
          if (
            notification.method === 'turn/completed'
            && isRecord(notification.params)
          ) {
            sawTurnCompleted = true;
          }
          await publish(normalizeAppServerEvent({
            runId: id,
            seq: ++seq,
            raw: JSON.parse(redactedLine)
          }));
        },
        async onApprovalRequest(request) {
          if (options.approvalManager === undefined) return 'rejected';
          const pending = options.approvalManager.request(
            buildApprovalRequest({
              runId: id,
              threadId: runInput.threadId,
              codexThreadId: resolvedCodexThreadId,
              request
            })
          );
          await publishApproval(id, ++seq, pending.approval, publish);
          const decision = await pending.decision;
          const resolved = options.approvalManager.get(pending.approval.id);
          if (resolved !== undefined) {
            await publishApproval(id, ++seq, resolved, publish);
          }
          return decision;
        },
        async onStderrChunk(chunk) {
          const redactedChunk = redactText(chunk);
          stderr += redactedChunk;
          await appendRunLog(id, 'stderr.redacted.log', redactedChunk);
        }
      });

      updateStatus(id, 'running', 'running', { startedAt: new Date().toISOString() });

      const done = process.result.then(
        async result => {
          const publicStatus: 'succeeded' | 'failed' | 'canceled' =
            result.terminationReason === 'canceled'
              ? 'canceled'
              : result.turnStatus === 'completed'
                ? 'succeeded'
                : 'failed';
          const terminationReason: TerminationReason =
            result.terminationReason === 'canceled'
              ? 'user_canceled'
              : result.turnStatus === 'completed'
                ? 'completed'
                : 'stream_error';
          const diagnostics = {
            ...buildThreadRunDiagnosticsMetadata({
              runInput,
              resumeMode: resolvedResumeMode,
              codexThreadId: resolvedCodexThreadId,
              argv: ['app-server', '--stdio'],
              queueState: runs.getRun(id)?.queue_state,
              errorCode: publicStatus === 'failed' ? 'CODEX_STREAM_ERROR' : null,
              errorMessage: publicStatus === 'failed'
                ? `Codex turn ended with status ${result.turnStatus}`
                : null,
              terminationReason
            }),
            runtimeTransport: 'app-server',
            turnId: result.turnId,
            turnStatus: result.turnStatus,
            terminationReason,
            ...runTimeouts
          };
          await finalizeRun({
            id,
            runDir,
            runInput,
            publicStatus,
            terminationReason,
            diagnostics,
            statusExtra: publicStatus === 'failed'
              ? {
                  errorCode: 'CODEX_STREAM_ERROR',
                  errorMessage: `Codex turn ended with status ${result.turnStatus}`
                }
              : {},
            nextSeq: () => ++seq,
            publish
          });
          return createdRun(publicStatus);
        },
        async error => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const terminationReason = appServerErrorToTerminationReason(errorMessage);
          const publicStatus: 'failed' | 'canceled' =
            terminationReason === 'user_canceled' ? 'canceled' : 'failed';
          const errorCode = errorCodeForTermination(terminationReason);
          options.approvalManager?.cancelRun(id, 'run_failed');
          await safePublish(publishError(id, ++seq, errorCode, errorMessage, publish));
          await finalizeRun({
            id,
            runDir,
            runInput,
            publicStatus,
            terminationReason,
            diagnostics: {
              ...buildThreadRunDiagnosticsMetadata({
                runInput,
                resumeMode: resolvedResumeMode,
                codexThreadId: resolvedCodexThreadId,
                argv: ['app-server', '--stdio'],
                queueState: runs.getRun(id)?.queue_state,
                errorCode,
                errorMessage,
                terminationReason
              }),
              runtimeTransport: 'app-server',
              error: errorMessage,
              ...runTimeouts
            },
            statusExtra: { errorCode, errorMessage },
            nextSeq: () => ++seq,
            publish
          });
          return createdRun(publicStatus);
        }
      );

      activeRuns.set(id, {
        cancel() {
          updateStatus(id, 'running', 'canceling');
          options.approvalManager?.cancelRun(id, 'run_canceled');
          void publishStatus(id, ++seq, 'canceling', publish).catch(() => undefined);
          process.cancel();
        },
        done
      });
      bridgeRunCompletion(id, done);
      return createdRun('running');
    }

    const process = startCodexExec({
      codexBin: options.codexBin,
      codexHome: options.codexHome,
      cwd: runInput.cwd,
      args: codexArgs,
      prompt: runInput.prompt,
      timeoutMs: runTimeouts.timeoutMs,
      spawnTimeoutMs: runTimeouts.spawnTimeoutMs,
      inactivityTimeoutMs: runTimeouts.inactivityTimeoutMs,
      async onStdoutLine(line) {
        const redactedLine = redactText(line);
        stdoutLines.push(redactedLine);
        await appendRunLog(id, 'raw.redacted.ndjson', `${redactedLine}\n`);

        const parsed = parseJsonLine(redactedLine);
        seq += 1;
        if (!parsed.ok) {
          await publishDiagnostic(id, seq, 'CODEX_STREAM_ERROR', parsed.error, publish, {
            line: redactedLine
          });
          return;
        }

        if (isThreadStarted(parsed.value)) {
          const parsedCodexThreadId = parsed.value.thread_id;
          sawCodexThreadId = true;
          resolvedCodexThreadId = parsedCodexThreadId;
          runs.setRunCodexThreadId(id, parsedCodexThreadId);
          if (runInput.threadId) options.threadAccess?.setCodexThreadId(runInput.threadId, parsedCodexThreadId);
          await publishStatus(id, seq, 'initializing', publish, {
            threadId: runInput.threadId,
            codexThreadId: parsedCodexThreadId
          });
          return;
        }
        if (isTurnCompleted(parsed.value)) sawTurnCompleted = true;
        await publish(normalizeCodexEvent({ runId: id, seq, raw: parsed.value }));
      },
      async onStderrChunk(chunk) {
        const redactedChunk = redactText(chunk);
        stderr += redactedChunk;
        await appendRunLog(id, 'stderr.redacted.log', redactedChunk);
      }
    });

    updateStatus(id, 'running', 'running', { startedAt: new Date().toISOString() });

    const done = process.result.then(
      async result => {
        const exitedSuccessfully =
          result.exitCode === 0 && result.terminationReason !== 'canceled';
        const missingCodexThreadId =
          exitedSuccessfully && runInput.threadId !== undefined && !sawCodexThreadId;
        const streamError = exitedSuccessfully && (!sawTurnCompleted || missingCodexThreadId);
        const publicStatus: 'succeeded' | 'failed' | 'canceled' = result.terminationReason === 'canceled'
          ? 'canceled'
          : result.exitCode === 0 && !streamError
            ? 'succeeded'
            : 'failed';
        const terminationReason = streamError ? 'stream_error' : resultToTerminationReason(result);
        const resumeFailureCode =
          resolvedResumeMode === 'resume_thread'
            && result.terminationReason !== 'canceled'
            && result.exitCode !== 0
            && !streamError
            ? classifyResumeFailure(stdoutLines, stderr)
            : undefined;
        const errorCode = missingCodexThreadId
          ? 'CODEX_THREAD_ID_MISSING'
          : resumeFailureCode;
        const errorMessage = missingCodexThreadId
          ? CODEX_THREAD_ID_MISSING_MESSAGE
          : resumeFailureCode === undefined
            ? streamError
              ? 'Codex stream ended without turn.completed'
              : undefined
            : 'Codex resume failed';
        const diagnostics = {
          ...buildThreadRunDiagnosticsMetadata({
            runInput,
            resumeMode: resolvedResumeMode,
            codexThreadId: resolvedCodexThreadId,
            argv: codexArgs,
            queueState: runs.getRun(id)?.queue_state,
            errorCode: errorCode ?? null,
            errorMessage: errorMessage ?? null,
            terminationReason
          }),
          exitCode: result.exitCode,
          signal: result.signal,
          terminationReason,
          ...runTimeouts,
          ...(errorCode === undefined ? {} : { errorCode }),
          ...(errorMessage === undefined ? {} : { error: errorMessage, errorMessage })
        };
        if (missingCodexThreadId) {
          await safePublish(publishError(
            id,
            ++seq,
            'CODEX_THREAD_ID_MISSING',
            CODEX_THREAD_ID_MISSING_MESSAGE,
            publish
          ));
        } else if (streamError) {
          await safePublish(publishDiagnostic(
            id,
            ++seq,
            'CODEX_STREAM_ERROR',
            'Codex stream ended without turn.completed',
            publish
          ));
        }
        await finalizeRun({
          id,
          runDir,
          runInput,
          publicStatus,
          terminationReason,
          diagnostics,
          statusExtra: {
            exitCode: result.exitCode,
            signal: result.signal,
            ...(errorCode === undefined ? {} : { errorCode }),
            ...(errorMessage === undefined ? {} : { errorMessage })
          },
          nextSeq: () => ++seq,
          publish
        });
        return createdRun(publicStatus);
      },
      async error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const shutdownTimeoutAfterCompletedTurn = isShutdownTimeoutAfterCompletedTurn({
          error,
          sawTurnCompleted,
          sawCodexThreadId,
          threadId: runInput.threadId
        });
        if (shutdownTimeoutAfterCompletedTurn) {
          const terminationReason: TerminationReason = 'completed';
          const diagnostics = {
            ...buildThreadRunDiagnosticsMetadata({
              runInput,
              resumeMode: resolvedResumeMode,
              codexThreadId: resolvedCodexThreadId,
              argv: codexArgs,
              queueState: runs.getRun(id)?.queue_state,
              errorCode: null,
              errorMessage: null,
              terminationReason
            }),
            terminationReason,
            ...runTimeouts,
            warnings: [
              {
                code: 'CODEX_PROCESS_EXIT_TIMEOUT_AFTER_TURN_COMPLETED',
                message: errorMessage
              }
            ]
          };
          if (error instanceof CodexExecError) {
            for (const line of error.stdoutLines.slice(stdoutLines.length)) {
              await safeAppendRunLog(id, 'raw.redacted.ndjson', `${redactText(line)}\n`);
            }
            if (stderr.length === 0 && error.stderr.length > 0) {
              await safeAppendRunLog(id, 'stderr.redacted.log', redactText(error.stderr));
            }
          }
          await finalizeRun({
            id,
            runDir,
            runInput,
            publicStatus: 'succeeded',
            terminationReason,
            diagnostics,
            statusExtra: {},
            nextSeq: () => ++seq,
            publish
          });
          return createdRun('succeeded');
        }

        const missingCodexThreadId = runInput.threadId !== undefined && sawTurnCompleted && !sawCodexThreadId;
        const terminationReason = missingCodexThreadId ? 'stream_error' : errorToTerminationReason(error);
        const publicStatus: 'failed' | 'canceled' =
          terminationReason === 'user_canceled' ? 'canceled' : 'failed';
        const errorCode = missingCodexThreadId
          ? 'CODEX_THREAD_ID_MISSING'
          : errorCodeForTermination(terminationReason);
        const finalErrorMessage = missingCodexThreadId
          ? CODEX_THREAD_ID_MISSING_MESSAGE
          : errorMessage;
        const diagnostics = {
          ...buildThreadRunDiagnosticsMetadata({
            runInput,
            resumeMode: resolvedResumeMode,
            codexThreadId: resolvedCodexThreadId,
            argv: codexArgs,
            queueState: runs.getRun(id)?.queue_state,
            errorCode,
            errorMessage: finalErrorMessage,
            terminationReason
          }),
          error: finalErrorMessage,
          errorMessage: finalErrorMessage,
          terminationReason,
          ...runTimeouts
        };
        if (missingCodexThreadId) {
          await safePublish(publishError(
            id,
            ++seq,
            'CODEX_THREAD_ID_MISSING',
            CODEX_THREAD_ID_MISSING_MESSAGE,
            publish
          ));
        }
        if (error instanceof CodexExecError) {
          for (const line of error.stdoutLines.slice(stdoutLines.length)) {
            await safeAppendRunLog(id, 'raw.redacted.ndjson', `${redactText(line)}\n`);
          }
          if (stderr.length === 0 && error.stderr.length > 0) {
            await safeAppendRunLog(id, 'stderr.redacted.log', redactText(error.stderr));
          }
        }
        await finalizeRun({
          id,
          runDir,
          runInput,
          publicStatus,
          terminationReason,
          diagnostics,
          statusExtra: {
            errorCode,
            errorMessage: finalErrorMessage
          },
          nextSeq: () => ++seq,
          publish
        });
        return createdRun(publicStatus);
      }
    );

    activeRuns.set(id, {
      cancel() {
        updateStatus(id, 'running', 'canceling');
        void publishStatus(id, ++seq, 'canceling', publish).catch(() => undefined);
        process.cancel();
      },
      done
    });
    bridgeRunCompletion(id, done);

    return createdRun('running');
  }

  function failRunBeforeSpawn(input: {
    id: string;
    runDir: string;
    code: string;
    message: string;
    terminationReason: TerminationReason;
    threadId?: string;
    submissionMode: RunSubmissionMode;
    diagnostics?: Record<string, unknown>;
    publish: (event: AgentEventEnvelope) => Promise<void>;
  }): CreatedRun {
    const endedAt = new Date().toISOString();
    const diagnostics = {
      ...input.diagnostics,
      error: input.message,
      errorMessage: input.message,
      errorCode: input.code,
      terminationReason: input.terminationReason
    };
    writeJson(join(input.runDir, 'diagnostics.json'), diagnostics);
    updateStatus(input.id, 'failed', 'failed', {
      terminationReason: input.terminationReason,
      errorCode: input.code,
      errorMessage: input.message,
      endedAt
    });
    const seq = nextSeqForRun(input.id);
    closeDetachedRunLog(input.id, [
      publishError(input.id, seq, input.code, input.message, input.publish),
      publishDone(input.id, seq + 1, 'failed', input.terminationReason, input.publish)
    ]);
    return {
      id: input.id,
      ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
      status: 'failed',
      submissionMode: input.submissionMode
    };
  }

  function insertInitialRun(
    input: CreateRunInput,
    resolvedResumeMode: 'independent' | 'new_thread' | 'resume_thread',
    codexThreadId?: string
  ): string {
    const id = `run_${nanoid(10)}`;
    const runDir = join(options.dataDir, 'runs', id);
    const canonicalCwd = resolve(input.cwd);
    const args = resolvedResumeMode === 'resume_thread' && codexThreadId !== undefined
      ? buildCodexResumeArgs({
          codexThreadId,
          sandbox: input.sandbox,
          model: input.model,
          reasoning: input.reasoning,
          imagePaths: input.imagePaths
        })
      : buildCodexExecArgs({
          profile: input.profile,
          cwd: input.cwd,
          sandbox: input.sandbox,
          model: input.model,
          reasoning: input.reasoning,
          imagePaths: input.imagePaths
        });

    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'raw.redacted.ndjson'), '');
    writeFileSync(join(runDir, 'events.ndjson'), '');
    writeFileSync(join(runDir, 'stderr.redacted.log'), '');
    getLogWriter(id);
    runs.insertRun({
      id,
      publicStatus: 'queued',
      internalStatus: 'created',
      createdBy: input.createdBy ?? 'api',
      sourceId: input.sourceId,
      timeoutMs: input.timeoutMs ?? null,
      threadId: input.threadId,
      codexThreadId: resolvedResumeMode === 'resume_thread' ? codexThreadId : undefined,
      profile: input.profile,
      cwd: input.cwd,
      canonicalCwd,
      workspaceMode: 'managed',
      sandbox: input.sandbox,
      codexVersion: 'unknown',
      codexBin: options.codexBin,
      codexHome: options.codexHome,
      resumeMode: resolvedResumeMode,
      submissionMode: input.submissionMode ?? 'enqueue',
      normalizerVersion
    });

    writeJson(join(runDir, 'meta.json'), {
      id,
      args,
      cwd: input.cwd,
      profile: input.profile,
      sandbox: input.sandbox,
      threadId: input.threadId,
      resumeMode: resolvedResumeMode,
      submissionMode: input.submissionMode ?? 'enqueue',
      attachmentIds: input.attachmentIds ?? []
    });

    return id;
  }

  function hasDoneEvent(runId: string): boolean {
    return runs.listRunEvents(runId).some(event => event.type === 'done');
  }

  function lastSeqForRun(runId: string): number {
    return runs.getLastRunEventSeq(runId);
  }

  function nextSeqForRun(runId: string): number {
    return lastSeqForRun(runId) + 1;
  }

  function removeQueuedRun(runId: string): (QueuedRun & { threadId: string }) | undefined {
    for (const [threadId, queue] of threadQueues) {
      const index = queue.findIndex(run => run.id === runId);
      if (index === -1) continue;
      const [queued] = queue.splice(index, 1);
      if (queued === undefined) return undefined;
      if (queue.length === 0) threadQueues.delete(threadId);
      return { ...queued, threadId };
    }
    return undefined;
  }

  function decorateQueuePosition(run: RuntimeRun): RuntimeRun {
    if (run.status !== 'queued' || run.threadId === undefined) return run;
    const queue = threadQueues.get(run.threadId) ?? [];
    const index = queue.findIndex(item => item.id === run.id);
    return index === -1 ? run : { ...run, queuePosition: index + 1 };
  }

  function writeQueuedCancelDiagnostics(
    queued: QueuedRun & { threadId: string },
    logWriter?: OrderedLogWriterMetrics
  ): void {
    const row = runs.getRun(queued.id);
    const resumeMode = row?.resume_mode ?? resolveResumeMode(
      queued.input,
      options.threadAccess?.getThread(queued.threadId)
    );
    const codexThreadId = row?.codex_thread_id ?? undefined;
    const runInput: CreateRunInput = { ...queued.input, threadId: queued.threadId };

    writeJson(join(queued.runDir, 'diagnostics.json'), {
      ...buildThreadRunDiagnosticsMetadata({
        runInput,
        resumeMode,
        codexThreadId,
        argv: buildRunArgv(runInput, resumeMode, codexThreadId),
        queueState: row?.queue_state ?? 'queued',
        errorCode: null,
        errorMessage: null,
        terminationReason: 'user_canceled'
      }),
      terminationReason: 'user_canceled',
      ...(logWriter === undefined ? {} : { logWriter })
    });
  }

  function bridgeRunCompletion(runId: string, done: Promise<CreatedRun>): void {
    const queuedResolve = queuedCompletionResolvers.get(runId);
    if (queuedResolve !== undefined) {
      done.then(run => resolveRunCompletion(runId, run));
      return;
    }

    runCompletions.set(
      runId,
      done.finally(() => {
        runCompletions.delete(runId);
      })
    );
  }

  function resolveRunCompletion(runId: string, run: CreatedRun): void {
    const resolve = queuedCompletionResolvers.get(runId);
    if (resolve === undefined) return;
    queuedCompletionResolvers.delete(runId);
    runCompletions.delete(runId);
    resolve(run);
  }

  function completeThreadRun(threadId: string | undefined, runId: string): void {
    if (threadId === undefined) return;
    if (runningThreadRun.get(threadId) === runId) runningThreadRun.delete(threadId);
    startNextQueuedThreadRun(threadId);
  }

  function startNextQueuedThreadRun(threadId: string): void {
    if (closing) return;
    if (runningThreadRun.has(threadId)) return;
    const queue = threadQueues.get(threadId);
    const next = queue?.shift();
    if (queue !== undefined && queue.length === 0) threadQueues.delete(threadId);
    if (next === undefined) return;
    startExistingRun(next);
  }

  function recoverOrphanedRuns(): void {
    for (const run of runs.listNonTerminalRuns()) {
      mkdirSync(join(options.dataDir, 'runs', run.id), { recursive: true });
      const existingEvents = runs.listRunEvents(run.id);
      const nextSeq = (existingEvents.at(-1)?.seq ?? 0) + 1;
      const orphanErrorCode = run.thread_id === null ? 'DAEMON_RESTART' : 'THREAD_RUN_ORPHANED';
      const orphanErrorMessage = run.thread_id === null
        ? 'Run was still active when daemon restarted'
        : 'Thread run was still active when daemon restarted';
      updateStatus(run.id, 'failed', 'orphaned', {
        terminationReason: 'daemon_restart',
        errorCode: orphanErrorCode,
        errorMessage: orphanErrorMessage,
        endedAt: new Date().toISOString()
      });
      const diagnostics = {
        ...buildThreadRunDiagnosticsMetadataFromRow(run, {
          errorCode: orphanErrorCode,
          errorMessage: orphanErrorMessage,
          terminationReason: 'daemon_restart'
        }),
        error: orphanErrorMessage,
        errorMessage: orphanErrorMessage,
        errorCode: orphanErrorCode,
        terminationReason: 'daemon_restart'
      };
      writeJson(join(options.dataDir, 'runs', run.id, 'diagnostics.json'), diagnostics);
      const writes: Promise<void>[] = [];
      if (!existingEvents.some(event => event.type === 'error')) {
        writes.push(publishError(
          run.id,
          nextSeq,
          orphanErrorCode,
          orphanErrorMessage,
          publish
        ));
      }
      if (!existingEvents.some(event => event.type === 'done')) {
        const doneSeq = existingEvents.some(event => event.type === 'error') ? nextSeq : nextSeq + 1;
        writes.push(publishDone(run.id, doneSeq, 'failed', 'daemon_restart', publish));
      }
      if (writes.length > 0) closeDetachedRunLog(run.id, writes);
    }
  }

  return manager;
}

function buildApprovalRequest(input: {
  runId: string;
  threadId?: string;
  codexThreadId?: string;
  request: AppServerRequest;
}) {
  const params = input.request.params;
  const reason = optionalString(params.reason);
  const command = optionalString(params.command);
  const cwd = optionalString(params.cwd);
  const grantRoot = optionalString(params.grantRoot);
  const networkContext = isRecord(params.networkApprovalContext)
    ? params.networkApprovalContext
    : undefined;
  const host = optionalString(networkContext?.host);
  const protocol = optionalString(networkContext?.protocol);
  const port = typeof networkContext?.port === 'number' ? networkContext.port : undefined;
  const kind = input.request.method === 'item/commandExecution/requestApproval'
    ? 'command_execution' as const
    : input.request.method === 'item/fileChange/requestApproval'
      ? 'file_change' as const
      : 'permissions' as const;
  const title = kind === 'command_execution'
    ? host === undefined ? '允许执行命令' : '允许网络访问'
    : kind === 'file_change'
      ? '允许修改文件'
      : '允许扩大权限';
  const summary = host !== undefined
    ? `${protocol ?? 'network'}://${host}${port === undefined ? '' : `:${port}`}`
    : command ?? grantRoot ?? reason ?? title;
  const details = redactApprovalDetails({
    ...(reason === undefined ? {} : { reason }),
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(grantRoot === undefined ? {} : { grantRoot }),
    ...(host === undefined ? {} : {
      network: {
        host,
        ...(protocol === undefined ? {} : { protocol }),
        ...(port === undefined ? {} : { port })
      }
    }),
    ...(Array.isArray(params.commandActions) ? { commandActions: params.commandActions } : {}),
    ...(isRecord(params.permissions) ? { permissions: params.permissions } : {})
  });

  return {
    runId: input.runId,
    threadId: input.threadId,
    codexThreadId: input.codexThreadId,
    turnId: optionalString(params.turnId) ?? 'unknown',
    itemId: optionalString(params.itemId) ?? 'unknown',
    requestId: String(input.request.id),
    kind,
    risk: kind === 'file_change' ? 'medium' as const : 'high' as const,
    title,
    summary: redactText(summary),
    details
  };
}

function redactApprovalDetails(
  details: Record<string, unknown>
): Record<string, unknown> {
  try {
    const redacted = JSON.parse(redactText(JSON.stringify(details)));
    return isRecord(redacted) ? redacted : {};
  } catch {
    return {};
  }
}

function publishApproval(
  runId: string,
  seq: number,
  approval: RuntimeApproval,
  publish: (event: AgentEventEnvelope) => Promise<void>
): Promise<void> {
  return publish({
    id: `evt_${runId}_${seq}`,
    runId,
    seq,
    ts: new Date().toISOString(),
    type: 'approval',
    payload: {
      type: 'approval',
      approval
    },
    normalizerVersion
  });
}

function appServerErrorToTerminationReason(message: string): TerminationReason {
  const normalized = message.toLowerCase();
  if (normalized.includes('spawn timeout')) return 'spawn_timeout';
  if (normalized.includes('inactivity timeout')) return 'inactivity_timeout';
  if (normalized.includes(' timeout after')) return 'timeout';
  return 'stream_error';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function buildRunArgv(
  input: CreateRunInput,
  resumeMode: ResolvedResumeMode,
  codexThreadId?: string
): string[] | undefined {
  if (resumeMode === 'resume_thread') {
    if (codexThreadId === undefined) return undefined;
    return buildCodexResumeArgs({
      codexThreadId,
      sandbox: input.sandbox,
      model: input.model,
      reasoning: input.reasoning,
      imagePaths: input.imagePaths
    });
  }

  return buildCodexExecArgs({
    profile: input.profile,
    cwd: input.cwd,
    sandbox: input.sandbox,
    model: input.model,
    reasoning: input.reasoning,
    imagePaths: input.imagePaths
  });
}

function buildThreadRunDiagnosticsMetadata(input: {
  runInput: CreateRunInput;
  resumeMode: ResolvedResumeMode;
  codexThreadId?: string;
  argv?: string[];
  queueState?: RunQueueState;
  errorCode?: string | null;
  errorMessage?: string | null;
  terminationReason?: TerminationReason;
}): Record<string, unknown> {
  if (input.runInput.threadId === undefined) return {};

  return {
    threadId: input.runInput.threadId,
    codexThreadId: input.codexThreadId ?? null,
    resumeMode: input.resumeMode,
    argv: input.argv ?? null,
    attachmentIds: input.runInput.attachmentIds ?? [],
    cwd: input.runInput.cwd,
    profile: input.runInput.profile,
    sandbox: input.runInput.sandbox,
    queueState: input.queueState ?? 'none',
    errorCode: input.errorCode ?? null,
    errorMessage: input.errorMessage ?? null,
    ...(input.terminationReason === undefined ? {} : { terminationReason: input.terminationReason })
  };
}

function buildThreadRunDiagnosticsMetadataFromRow(
  run: RunRow,
  failure: {
    errorCode: string;
    errorMessage: string;
    terminationReason: TerminationReason;
  }
): Record<string, unknown> {
  if (run.thread_id === null) return {};

  return {
    threadId: run.thread_id,
    codexThreadId: run.codex_thread_id,
    resumeMode: run.resume_mode ?? 'independent',
    argv: null,
    cwd: run.cwd,
    profile: run.profile,
    sandbox: run.sandbox,
    queueState: run.queue_state,
    errorCode: failure.errorCode,
    errorMessage: failure.errorMessage,
    terminationReason: failure.terminationReason
  };
}

function publishStatus(
  runId: string,
  seq: number,
  label: 'queued' | 'initializing' | 'running' | 'canceling' | 'finalizing',
  publish: (event: AgentEventEnvelope) => Promise<void>,
  metadata: { threadId?: string; codexThreadId?: string } = {}
): Promise<void> {
  return publish({
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
  publish: (event: AgentEventEnvelope) => Promise<void>,
  details?: Record<string, unknown>
): Promise<void> {
  return publish({
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
  publish: (event: AgentEventEnvelope) => Promise<void>,
  details?: Record<string, unknown>
): Promise<void> {
  return publish({
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
  publish: (event: AgentEventEnvelope) => Promise<void>
): Promise<void> {
  return publish({
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

function resolveResumeMode(
  input: CreateRunInput,
  thread?: RuntimeThread
): 'independent' | 'new_thread' | 'resume_thread' {
  if (!input.threadId) return 'independent';
  if (input.resumeMode === 'new_thread') return 'new_thread';
  if (input.resumeMode === 'resume_thread') return 'resume_thread';
  return thread?.codexThreadId ? 'resume_thread' : 'new_thread';
}

function classifyResumeFailure(stdoutLines: string[], stderr: string): 'RESUME_TARGET_NOT_FOUND' | 'RESUME_FAILED' {
  const output = `${stdoutLines.join('\n')}\n${stderr}`.toLowerCase();
  return output.includes('not found') || output.includes('no session') || output.includes('unknown session')
    ? 'RESUME_TARGET_NOT_FOUND'
    : 'RESUME_FAILED';
}

function isShutdownTimeoutAfterCompletedTurn(input: {
  error: unknown;
  sawTurnCompleted: boolean;
  sawCodexThreadId: boolean;
  threadId?: string;
}): boolean {
  return input.error instanceof CodexExecError
    && input.error.terminationReason === 'timeout'
    && input.sawTurnCompleted
    && (input.threadId === undefined || input.sawCodexThreadId);
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
  if (reason === 'timeout') return 'CODEX_EXEC_TIMEOUT';
  if (reason === 'inactivity_timeout') return 'CODEX_EXEC_INACTIVITY_TIMEOUT';
  if (reason === 'spawn_timeout') return 'CODEX_EXEC_SPAWN_TIMEOUT';
  if (reason === 'spawn_failed') return 'SPAWN_FAILED';
  return 'CODEX_STREAM_ERROR';
}

function resolveRunTimeouts(
  input: CreateRunInput,
  options: Pick<RunManagerOptions, 'timeoutMs' | 'spawnTimeoutMs' | 'inactivityTimeoutMs'>
): { timeoutMs: number; spawnTimeoutMs: number; inactivityTimeoutMs: number } {
  const defaultTimeoutMs = input.createdBy === 'schedule'
    ? SCHEDULED_RUN_TIMEOUT_MS
    : INTERACTIVE_RUN_TIMEOUT_MS;

  return {
    timeoutMs: input.timeoutMs ?? options.timeoutMs ?? defaultTimeoutMs,
    spawnTimeoutMs: options.spawnTimeoutMs ?? EXEC_SPAWN_TIMEOUT_MS,
    inactivityTimeoutMs: options.inactivityTimeoutMs ?? EXEC_INACTIVITY_TIMEOUT_MS
  };
}

function mapRunRow(row: RunRow): RuntimeRun {
  return {
    id: row.id,
    ...(row.thread_id === null ? {} : { threadId: row.thread_id }),
    ...(row.codex_thread_id === null ? {} : { codexThreadId: row.codex_thread_id }),
    status: row.public_status as PublicRunStatus,
    submissionMode: row.submission_mode,
    cwd: row.cwd,
    profile: row.profile,
    sandbox: row.sandbox,
    createdBy: row.created_by,
    sourceId: row.source_id,
    timeoutMs: row.timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.termination_reason === null ? {} : { terminationReason: row.termination_reason }),
    exitCode: row.exit_code,
    signal: row.signal,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message })
  };
}
