import type {
  AgentEventEnvelope,
  PublicRunStatus,
  RuntimeApproval,
  RunSubmissionMode,
  TerminationReason
} from '@clawee/protocol';
import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import type { ApprovalManager } from '../approvals/manager.js';
import type {
  AgentScheduleRunInjector,
  AgentToolRunInjection
} from '../agent-tools/run-injection.js';
import {
  buildCodexExecArgs,
  buildCodexResumeArgs,
  type CodexMcpServerConfig
} from '../codex/argv.js';
import {
  buildCodexAppServerArgs,
  startCodexAppServer,
  type CodexAppServerResult,
  type AppServerRequest
} from '../codex/app-server-runner.js';
import { CodexExecError, startCodexExec } from '../codex/runner.js';
import {
  normalizerVersion,
  normalizeAppServerEvent,
  normalizeCodexEvent
} from '../events/normalizer.js';
import { parseJsonLine } from '../events/parser.js';
import { redactText, redactValue } from '../security/redaction.js';
import {
  createRunRepository,
  type ResolvedResumeMode,
  type RunQueueState,
  type RunRow
} from '../storage/repositories.js';
import type { RuntimeThread } from '../threads/types.js';
import { expandHome } from '../platform/paths.js';
import {
  createOrderedLogWriter,
  type OrderedLogWriter,
  type OrderedLogWriterMetrics
} from './ordered-log-writer.js';
import type {
  CreatedRun,
  CreateRunInput,
  ResolvedCreateRunInput
} from './types.js';

export type ThreadAccess = {
  getThread(id: string): RuntimeThread | undefined;
  assertRunnableThread?(id: string): RuntimeThread;
  repairCodexThreadBindings?(): {
    repairedThreadIds: string[];
    unresolvedThreadIds: string[];
  };
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};

export type RunManagerOptions = {
  db: Database.Database;
  dataDir: string;
  codexBin: string;
  codexHome: string;
  homeDir?: string;
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
  recordRunContext?(runId: string, items: NonNullable<CreateRunInput['contextItems']>): void;
  prepareThreadRotationContext?(input: {
    prompt: string;
    threadId: string;
  }): {
    executionPrompt: string;
    items: NonNullable<CreateRunInput['contextItems']>;
  };
  codexThreadRotationRunThreshold?: number;
  onRunTerminal?(runId: string): void;
  logWriterFactory?(runDir: string): OrderedLogWriter;
  agentToolInjector?: AgentScheduleRunInjector;
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
  publicPrompt?: string;
  triggeredAt?: string;
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
  steerRun?(id: string): boolean;
  getRun(id: string): RuntimeRun | undefined;
  hasActiveRunForThread(threadId: string): boolean;
  hasActiveRunForProject(projectId: string): boolean;
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
export const DEFAULT_CODEX_THREAD_ROTATION_RUN_THRESHOLD = 50;
const CODEX_THREAD_ID_MISSING_MESSAGE = 'Codex stream ended without thread.started thread_id';

type ActiveRun = {
  cancel(): void;
  done: Promise<CreatedRun>;
};

type QueuedRun = {
  id: string;
  input: ResolvedCreateRunInput;
  runDir: string;
};

type CodexThreadRotation = {
  reason: 'resume_failed' | 'run_threshold';
  previousCodexThreadId: string;
  nextCodexThreadId?: string;
  announced: boolean;
};

export function createRunManager(options: RunManagerOptions): RunManager {
  const runs = createRunRepository(options.db);
  const codexThreadRotationRunThreshold = normalizeRotationRunThreshold(
    options.codexThreadRotationRunThreshold
  );
  const listRunsByThreadNewestFirst = options.db.prepare<{ threadId: string; limit: number }>(`
    SELECT * FROM runs
    WHERE thread_id = @threadId
    ORDER BY created_at DESC, rowid DESC
    LIMIT @limit
  `);
  const countTerminalRunsByCodexThread = options.db.prepare<{
    threadId: string;
    codexThreadId: string;
  }>(`
    SELECT COUNT(*) AS count
    FROM runs
    WHERE thread_id = @threadId
      AND codex_thread_id = @codexThreadId
      AND public_status IN ('succeeded', 'failed', 'canceled')
  `);
  const findActiveRunByProject = options.db.prepare<{ projectId: string }>(`
    SELECT 1
    FROM runs
    INNER JOIN threads ON threads.id = runs.thread_id
    WHERE threads.project_id = @projectId
      AND (
        runs.public_status IN ('queued', 'running')
        OR runs.internal_status IN ('queued', 'running', 'canceling')
      )
    LIMIT 1
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

  const bindingRepair = options.threadAccess?.repairCodexThreadBindings?.();
  if ((bindingRepair?.unresolvedThreadIds.length ?? 0) > 0) {
    console.warn(
      `Codex thread binding repair skipped ambiguous threads: ${
        bindingRepair!.unresolvedThreadIds.join(', ')
      }`
    );
  }
  recoverOrphanedRuns();

  const manager: RunManager = {
    startRun(input: CreateRunInput): CreatedRun {
      if (closing) throw new Error('Run manager is closing');
      const runInput = resolveCreateRunInput(input);
      const thread = runInput.threadId === undefined
        ? undefined
        : options.threadAccess?.getThread(runInput.threadId);
      const resolvedResumeMode = resolveResumeMode(runInput, thread);
      const codexThreadId = thread?.codexThreadId ?? undefined;
      const id = insertInitialRun(runInput, resolvedResumeMode, codexThreadId);
      const runDir = join(options.dataDir, 'runs', id);
      if (
        runInput.createdBy === 'schedule'
        && runInput.publicPrompt !== undefined
        && runInput.triggeredAt !== undefined
      ) {
        void publishScheduleTrigger(
          id,
          1,
          runInput.publicPrompt,
          runInput.triggeredAt,
          publish
        ).catch(() => undefined);
      }

      if (runInput.threadId !== undefined && runningThreadRun.has(runInput.threadId)) {
        updateStatus(id, 'queued', 'queued');
        runs.setRunQueueState(id, 'queued');
        void publishStatus(id, nextSeqForRun(id), 'queued', publish, {
          threadId: runInput.threadId,
          codexThreadId
        }).catch(() => undefined);
        let resolveCompletion!: (run: CreatedRun) => void;
        const completion = new Promise<CreatedRun>(resolve => {
          resolveCompletion = resolve;
        });
        runCompletions.set(id, completion);
        queuedCompletionResolvers.set(id, resolveCompletion);
        const queue = threadQueues.get(runInput.threadId) ?? [];
        const queuedRun = { id, input: runInput, runDir };
        const submissionMode = runInput.submissionMode ?? 'enqueue';
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
        threadQueues.set(runInput.threadId, queue);
        if (submissionMode === 'interrupt_and_enqueue') {
          const activeRunId = runningThreadRun.get(runInput.threadId);
          const activeRow = activeRunId === undefined ? undefined : runs.getRun(activeRunId);
          if (activeRunId !== undefined && activeRow?.internal_status !== 'canceling') {
            manager.cancelRun(activeRunId);
          }
        }
        return {
          id,
          threadId: runInput.threadId,
          status: 'queued',
          submissionMode,
          queuePosition
        };
      }

      return startExistingRun({ id, input: runInput, runDir });
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
      notifyRunTerminal(id);
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

    steerRun(id: string): boolean {
      for (const [threadId, queue] of threadQueues) {
        const index = queue.findIndex(run => run.id === id);
        if (index === -1) continue;

        const [queued] = queue.splice(index, 1);
        if (queued === undefined) return false;
        queue.unshift(queued);

        const activeRunId = runningThreadRun.get(threadId);
        const activeRow = activeRunId === undefined ? undefined : runs.getRun(activeRunId);
        if (activeRunId !== undefined && activeRow?.internal_status !== 'canceling') {
          manager.cancelRun(activeRunId);
        }
        return true;
      }
      return false;
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

    hasActiveRunForProject(projectId: string): boolean {
      return findActiveRunByProject.get({ projectId }) !== undefined;
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
    notifyRunTerminal(input.id);
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
    let resolvedResumeMode = resolveResumeMode(runInput, thread);
    const codexThreadId = thread?.codexThreadId ?? undefined;
    let resolvedCodexThreadId = resolvedResumeMode === 'resume_thread' ? codexThreadId : undefined;
    let executionRunInput = runInput;
    let rotation: CodexThreadRotation | undefined;
    if (
      resolvedResumeMode === 'resume_thread'
      && codexThreadId !== undefined
      && shouldAutomaticallyRotate(runInput)
      && codexThreadRotationRunThreshold > 0
      && (
        (countTerminalRunsByCodexThread.get({
          threadId: runInput.threadId!,
          codexThreadId
        }) as { count: number }).count
      ) >= codexThreadRotationRunThreshold
    ) {
      rotation = {
        reason: 'run_threshold',
        previousCodexThreadId: codexThreadId,
        announced: false
      };
      resolvedResumeMode = 'new_thread';
      resolvedCodexThreadId = undefined;
      executionRunInput = prepareRotationRunInput(runInput);
    }
    const plannedArgv = buildRuntimeArgv(
      executionRunInput,
      resolvedResumeMode,
      resolvedCodexThreadId,
      options.runtimeTransport
    );

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

    if (
      plannedArgv === undefined
      || (
        resolvedResumeMode === 'resume_thread'
        && resolvedCodexThreadId === undefined
      )
    ) {
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

    let agentToolInjection: AgentToolRunInjection | undefined;
    try {
      agentToolInjection = thread === undefined
        ? undefined
        : options.agentToolInjector?.prepare({
            runId: id,
            thread,
            createdBy: runInput.createdBy ?? 'api'
          });
    } catch (error) {
      return failBeforeSpawnAndRelease({
        code: 'AGENT_TOOL_INJECTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        terminationReason: 'stream_error'
      });
    }

    const stdoutLines: string[] = [];
    let stderr = '';
    let seq = lastSeqForRun(id);
    let sawTurnCompleted = false;
    let sawCodexThreadId = resolvedResumeMode === 'resume_thread';
    let codexArgs = buildRuntimeArgv(
      executionRunInput,
      resolvedResumeMode,
      resolvedCodexThreadId,
      options.runtimeTransport,
      agentToolInjection?.mcpServers
    );
    if (codexArgs === undefined) {
      return failBeforeSpawnAndRelease({
        code: 'CODEX_THREAD_ID_MISSING',
        message: 'resume_thread requires a persisted codexThreadId',
        terminationReason: 'stream_error'
      });
    }
    const runTimeouts = resolveRunTimeouts(runInput, options);
    if (resolvedResumeMode === 'resume_thread') {
      runs.setRunCodexThreadId(id, resolvedCodexThreadId!);
    }
    writeJson(join(runDir, 'meta.json'), {
      id,
      args: codexArgs,
      cwd: executionRunInput.cwd,
      profile: executionRunInput.profile,
      sandbox: executionRunInput.sandbox,
      threadId: runInput.threadId,
      resumeMode: resolvedResumeMode,
      submissionMode: runInput.submissionMode ?? 'enqueue',
      attachmentIds: executionRunInput.attachmentIds ?? [],
      contextItemIds: executionRunInput.contextItems?.map(item => item.sourceId) ?? []
    });
    if (
      resolvedResumeMode === 'new_thread'
      && codexThreadId !== undefined
      && rotation === undefined
    ) {
      void publishDiagnostic(
        id,
        ++seq,
        'THREAD_CODEX_SESSION_RESET',
        'Starting a new Codex session for a thread that already had a Codex session',
        publish,
        { previousCodexThreadId: codexThreadId }
      ).catch(() => undefined);
    }

    async function announceRotation(parsedCodexThreadId: string): Promise<void> {
      if (rotation === undefined || rotation.announced) return;
      rotation.nextCodexThreadId = parsedCodexThreadId;
      rotation.announced = true;
      await safePublish(publishDiagnostic(
        id,
        ++seq,
        'THREAD_CODEX_SESSION_ROTATED',
        '执行上下文已重新连接',
        publish,
        {
          reason: rotation.reason,
          previousCodexThreadId: rotation.previousCodexThreadId,
          nextCodexThreadId: parsedCodexThreadId
        }
      ));
    }

    function prepareRotationRunInput(
      input: ResolvedCreateRunInput
    ): ResolvedCreateRunInput {
      const prompt = redactText(input.publicPrompt ?? input.prompt);
      let prepared: ReturnType<NonNullable<
        RunManagerOptions['prepareThreadRotationContext']
      >> | undefined;
      try {
        prepared = input.threadId === undefined
          ? undefined
          : options.prepareThreadRotationContext?.({
              prompt,
              threadId: input.threadId
            });
      } catch (error) {
        void publishDiagnostic(
          id,
          ++seq,
          'THREAD_ROTATION_CONTEXT_UNAVAILABLE',
          '会话摘要暂不可用，已使用本次公开任务输入重新连接',
          publish,
          { error: redactText(error instanceof Error ? error.message : String(error)) }
        ).catch(() => undefined);
      }
      const contextItems = prepared?.items.map(item => ({
        ...item,
        content: redactText(item.content)
      })) ?? [];
      if (contextItems.length > 0) {
        try {
          options.recordRunContext?.(id, contextItems);
        } catch {
          // Context persistence failure must not prevent the bounded recovery attempt.
        }
      }
      return {
        ...input,
        executionPrompt: redactText(prepared?.executionPrompt ?? prompt),
        contextItems
      };
    }

    function writeCurrentRunMeta(): void {
      writeJson(join(runDir, 'meta.json'), {
        id,
        args: codexArgs,
        cwd: executionRunInput.cwd,
        profile: executionRunInput.profile,
        sandbox: executionRunInput.sandbox,
        threadId: runInput.threadId,
        resumeMode: resolvedResumeMode,
        submissionMode: runInput.submissionMode ?? 'enqueue',
        attachmentIds: executionRunInput.attachmentIds ?? [],
        contextItemIds: executionRunInput.contextItems?.map(item => item.sourceId) ?? []
      });
    }

    function rotationDiagnostics(): Record<string, unknown> {
      return rotation === undefined
        ? {}
        : {
            rotation: {
              reason: rotation.reason,
              previousCodexThreadId: rotation.previousCodexThreadId,
              nextCodexThreadId: rotation.nextCodexThreadId ?? null
            }
          };
    }

    async function bindStartedCodexThread(parsedCodexThreadId: string): Promise<void> {
      runs.setRunCodexThreadId(id, parsedCodexThreadId);
      if (runInput.threadId === undefined) return;
      try {
        options.threadAccess?.setCodexThreadId(runInput.threadId, parsedCodexThreadId);
      } catch (error) {
        if (!isThreadCodexIdConflict(error)) throw error;
        await safePublish(publishDiagnostic(
          id,
          ++seq,
          'THREAD_CODEX_ID_CONFLICT',
          'Codex thread id is already bound to another thread',
          publish,
          {
            threadId: runInput.threadId,
            codexThreadId: parsedCodexThreadId
          }
        ));
        throw error;
      }
    }

    if (options.runtimeTransport === 'app-server') {
      let appServerThreadEstablished = false;
      let appServerTurnStarted = false;

      function startAppServerAttempt() {
        return startCodexAppServer({
          codexBin: options.codexBin,
          codexHome: options.codexHome,
          cwd: executionRunInput.cwd,
          profile: executionRunInput.profile,
          sandbox: executionRunInput.sandbox,
          model: executionRunInput.model,
          reasoning: executionRunInput.reasoning,
          prompt: executionRunInput.executionPrompt ?? executionRunInput.prompt,
          imagePaths: executionRunInput.imagePaths,
          mcpServers: agentToolInjection?.mcpServers,
          env: agentToolInjection?.env,
          codexThreadId: resolvedResumeMode === 'resume_thread' ? resolvedCodexThreadId : undefined,
          timeoutMs: runTimeouts.timeoutMs,
          spawnTimeoutMs: runTimeouts.spawnTimeoutMs,
          inactivityTimeoutMs: runTimeouts.inactivityTimeoutMs,
          async onThreadStarted(parsedCodexThreadId) {
            appServerThreadEstablished = true;
            sawCodexThreadId = true;
            resolvedCodexThreadId = parsedCodexThreadId;
            await bindStartedCodexThread(parsedCodexThreadId);
            await publishStatus(id, ++seq, 'initializing', publish, {
              threadId: runInput.threadId,
              codexThreadId: parsedCodexThreadId
            });
            await announceRotation(parsedCodexThreadId);
          },
          async onNotification(notification) {
            const redactedNotification = redactValue(notification);
            const redactedLine = JSON.stringify(redactedNotification);
            stdoutLines.push(redactedLine);
            await appendRunLog(id, 'raw.redacted.ndjson', `${redactedLine}\n`);
            if (notification.method === 'turn/started') appServerTurnStarted = true;
            if (
              notification.method === 'turn/completed'
              && isRecord(notification.params)
            ) {
              sawTurnCompleted = true;
            }
            await publish(normalizeAppServerEvent({
              runId: id,
              seq: ++seq,
              raw: redactedNotification
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
      }

      async function rotateAppServerAfterResumeFailure(): Promise<CreatedRun> {
        rotation = {
          reason: 'resume_failed',
          previousCodexThreadId: codexThreadId!,
          announced: false
        };
        resolvedResumeMode = 'new_thread';
        resolvedCodexThreadId = undefined;
        executionRunInput = prepareRotationRunInput(runInput);
        codexArgs = buildRuntimeArgv(
          executionRunInput,
          resolvedResumeMode,
          resolvedCodexThreadId,
          options.runtimeTransport,
          agentToolInjection?.mcpServers
        );
        stdoutLines.length = 0;
        stderr = '';
        sawTurnCompleted = false;
        sawCodexThreadId = false;
        appServerThreadEstablished = false;
        appServerTurnStarted = false;
        runs.setRunResumeMode(id, resolvedResumeMode);
        writeCurrentRunMeta();
        currentProcess = startAppServerAttempt();
        return currentProcess.result.then(handleAppServerResult, handleAppServerError);
      }

      async function handleAppServerResult(
        result: CodexAppServerResult
      ): Promise<CreatedRun> {
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
            argv: codexArgs,
            queueState: runs.getRun(id)?.queue_state,
            errorCode: publicStatus === 'failed' ? 'CODEX_STREAM_ERROR' : null,
            errorMessage: publicStatus === 'failed'
              ? `Codex turn ended with status ${result.turnStatus}`
              : null,
            terminationReason
          }),
          ...rotationDiagnostics(),
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
      }

      async function handleAppServerError(error: unknown): Promise<CreatedRun> {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const bindingConflict = isThreadCodexIdConflict(error);
        if (
          resolvedResumeMode === 'resume_thread'
          && rotation === undefined
          && shouldAutomaticallyRotate(runInput)
          && !appServerThreadEstablished
          && !appServerTurnStarted
          && isAppServerResumeFailure(errorMessage)
        ) {
          return rotateAppServerAfterResumeFailure();
        }

        const terminationReason = appServerErrorToTerminationReason(errorMessage);
        const publicStatus: 'failed' | 'canceled' =
          terminationReason === 'user_canceled' ? 'canceled' : 'failed';
        const errorCode = bindingConflict
          ? 'THREAD_CODEX_ID_CONFLICT'
          : rotation === undefined
            ? errorCodeForTermination(terminationReason)
            : 'THREAD_CODEX_ROTATION_FAILED';
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
              argv: codexArgs,
              queueState: runs.getRun(id)?.queue_state,
              errorCode,
              errorMessage,
              terminationReason
            }),
            ...rotationDiagnostics(),
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

      let currentProcess = startAppServerAttempt();
      updateStatus(id, 'running', 'running', { startedAt: new Date().toISOString() });
      const done = currentProcess.result.then(handleAppServerResult, handleAppServerError);

      activeRuns.set(id, {
        cancel() {
          updateStatus(id, 'running', 'canceling');
          options.approvalManager?.cancelRun(id, 'run_canceled');
          void publishStatus(id, ++seq, 'canceling', publish).catch(() => undefined);
          currentProcess.cancel();
        },
        done
      });
      bridgeRunCompletion(id, done);
      return createdRun('running');
    }

    async function onExecStdoutLine(line: string): Promise<void> {
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
        await bindStartedCodexThread(parsedCodexThreadId);
        await publishStatus(id, seq, 'initializing', publish, {
          threadId: runInput.threadId,
          codexThreadId: parsedCodexThreadId
        });
        await announceRotation(parsedCodexThreadId);
        return;
      }
      if (isTurnCompleted(parsed.value)) sawTurnCompleted = true;
      await publish(normalizeCodexEvent({ runId: id, seq, raw: parsed.value }));
    }

    async function onExecStderrChunk(chunk: string): Promise<void> {
      const redactedChunk = redactText(chunk);
      stderr += redactedChunk;
      await appendRunLog(id, 'stderr.redacted.log', redactedChunk);
    }

    function startExecAttempt() {
      return startCodexExec({
        codexBin: options.codexBin,
        codexHome: options.codexHome,
        cwd: executionRunInput.cwd,
        args: codexArgs!,
        prompt: executionRunInput.executionPrompt ?? executionRunInput.prompt,
        env: agentToolInjection?.env,
        timeoutMs: runTimeouts.timeoutMs,
        spawnTimeoutMs: runTimeouts.spawnTimeoutMs,
        inactivityTimeoutMs: runTimeouts.inactivityTimeoutMs,
        onStdoutLine: onExecStdoutLine,
        onStderrChunk: onExecStderrChunk
      });
    }

    async function rotateExecAfterResumeFailure(): Promise<CreatedRun> {
      rotation = {
        reason: 'resume_failed',
        previousCodexThreadId: codexThreadId!,
        announced: false
      };
      resolvedResumeMode = 'new_thread';
      resolvedCodexThreadId = undefined;
      executionRunInput = prepareRotationRunInput(runInput);
      codexArgs = buildRuntimeArgv(
        executionRunInput,
        resolvedResumeMode,
        resolvedCodexThreadId,
        options.runtimeTransport,
        agentToolInjection?.mcpServers
      );
      if (codexArgs === undefined) {
        throw new Error('Unable to build Codex arguments for thread rotation');
      }
      stdoutLines.length = 0;
      stderr = '';
      sawTurnCompleted = false;
      sawCodexThreadId = false;
      runs.setRunResumeMode(id, resolvedResumeMode);
      writeCurrentRunMeta();
      currentProcess = startExecAttempt();
      return currentProcess.result.then(handleExecResult, handleExecError);
    }

    async function handleExecResult(result: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      terminationReason: string;
    }): Promise<CreatedRun> {
      const exitedSuccessfully =
        result.exitCode === 0 && result.terminationReason !== 'canceled';
      const missingCodexThreadId =
        exitedSuccessfully && runInput.threadId !== undefined && !sawCodexThreadId;
      const streamError = exitedSuccessfully && (!sawTurnCompleted || missingCodexThreadId);
      const resumeFailureCode =
        resolvedResumeMode === 'resume_thread'
          && result.terminationReason !== 'canceled'
          && result.exitCode !== 0
          && !streamError
          ? classifyResumeFailure(stdoutLines, stderr)
          : undefined;
      if (
        resumeFailureCode !== undefined
        && rotation === undefined
        && shouldAutomaticallyRotate(runInput)
      ) {
        return rotateExecAfterResumeFailure();
      }

      const publicStatus: 'succeeded' | 'failed' | 'canceled' = result.terminationReason === 'canceled'
        ? 'canceled'
        : result.exitCode === 0 && !streamError
          ? 'succeeded'
          : 'failed';
      const terminationReason = streamError ? 'stream_error' : resultToTerminationReason(result);
      const errorCode = missingCodexThreadId
        ? 'CODEX_THREAD_ID_MISSING'
        : resumeFailureCode
          ?? (rotation === undefined || publicStatus !== 'failed'
            ? undefined
            : 'THREAD_CODEX_ROTATION_FAILED');
      const errorMessage = missingCodexThreadId
        ? CODEX_THREAD_ID_MISSING_MESSAGE
        : resumeFailureCode !== undefined
          ? 'Codex resume failed'
          : streamError
            ? 'Codex stream ended without turn.completed'
            : errorCode === 'THREAD_CODEX_ROTATION_FAILED'
              ? 'Codex thread rotation failed'
              : undefined;
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
        ...rotationDiagnostics(),
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
    }

    async function handleExecError(error: unknown): Promise<CreatedRun> {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const bindingConflict = isThreadCodexIdConflict(error);
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
          ...rotationDiagnostics(),
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
        : bindingConflict
          ? 'THREAD_CODEX_ID_CONFLICT'
          : rotation === undefined
            ? errorCodeForTermination(terminationReason)
            : 'THREAD_CODEX_ROTATION_FAILED';
      const finalErrorMessage = missingCodexThreadId
        ? CODEX_THREAD_ID_MISSING_MESSAGE
        : bindingConflict
          ? 'Codex thread id is already bound to another thread'
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
        ...rotationDiagnostics(),
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

    let currentProcess = startExecAttempt();
    updateStatus(id, 'running', 'running', { startedAt: new Date().toISOString() });
    const done = currentProcess.result.then(handleExecResult, handleExecError);

    activeRuns.set(id, {
      cancel() {
        updateStatus(id, 'running', 'canceling');
        void publishStatus(id, ++seq, 'canceling', publish).catch(() => undefined);
        currentProcess.cancel();
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
    notifyRunTerminal(input.id);
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
    input: ResolvedCreateRunInput,
    resolvedResumeMode: 'independent' | 'new_thread' | 'resume_thread',
    codexThreadId?: string
  ): string {
    const id = `run_${nanoid(10)}`;
    const runDir = join(options.dataDir, 'runs', id);
    const canonicalCwd = resolve(input.cwd);
    const args = buildRuntimeArgv(
      input,
      resolvedResumeMode,
      codexThreadId,
      options.runtimeTransport
    );

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
      publicPrompt: input.createdBy === 'schedule' ? input.publicPrompt : null,
      triggeredAt: input.createdBy === 'schedule' ? input.triggeredAt : null,
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
    if ((input.contextItems?.length ?? 0) > 0) {
      options.recordRunContext?.(id, input.contextItems!);
    }

    writeJson(join(runDir, 'meta.json'), {
      id,
      args,
      cwd: input.cwd,
      profile: input.profile,
      sandbox: input.sandbox,
      threadId: input.threadId,
      resumeMode: resolvedResumeMode,
      submissionMode: input.submissionMode ?? 'enqueue',
      attachmentIds: input.attachmentIds ?? [],
      contextItemIds: input.contextItems?.map(item => item.sourceId) ?? []
    });

    return id;
  }

  function resolveCreateRunInput(input: CreateRunInput): ResolvedCreateRunInput {
    const normalizedInput: CreateRunInput = input.createdBy === 'schedule'
      ? {
          ...input,
          publicPrompt: input.publicPrompt ?? input.prompt,
          triggeredAt: input.triggeredAt ?? new Date().toISOString()
        }
      : {
          ...input,
          publicPrompt: undefined,
          triggeredAt: undefined
        };

    if (normalizedInput.threadId !== undefined && options.threadAccess !== undefined) {
      const thread = options.threadAccess.assertRunnableThread?.(normalizedInput.threadId)
        ?? options.threadAccess.getThread(normalizedInput.threadId);
      if (thread === undefined) throw new Error(`Thread not found: ${normalizedInput.threadId}`);
      if (thread.status === 'archived') throw new Error(`Thread is archived: ${normalizedInput.threadId}`);
      return {
        ...normalizedInput,
        cwd: thread.workspaceMode === 'managed'
          ? thread.canonicalCwd
          : expandHome(thread.cwd, options.homeDir ?? homedir()),
        profile: thread.profile,
        sandbox: thread.sandbox,
        model: thread.model ?? undefined,
        reasoning: thread.reasoning ?? undefined
      };
    }

    if (
      normalizedInput.cwd === undefined
      || normalizedInput.profile === undefined
      || normalizedInput.sandbox === undefined
    ) {
      throw new Error('Run execution configuration is required when thread access is unavailable');
    }
    return {
      ...normalizedInput,
      cwd: expandHome(normalizedInput.cwd, options.homeDir ?? homedir()),
      profile: normalizedInput.profile,
      sandbox: normalizedInput.sandbox
    };
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
    const runInput: ResolvedCreateRunInput = { ...queued.input, threadId: queued.threadId };

    writeJson(join(queued.runDir, 'diagnostics.json'), {
      ...buildThreadRunDiagnosticsMetadata({
        runInput,
        resumeMode,
        codexThreadId,
        argv: buildRuntimeArgv(
          runInput,
          resumeMode,
          codexThreadId,
          options.runtimeTransport
        ),
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
      notifyRunTerminal(run.id);
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

  function notifyRunTerminal(runId: string): void {
    try {
      options.onRunTerminal?.(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Run terminal callback failed for ${runId}: ${message}`);
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
  const mcpMeta = isRecord(params._meta) ? params._meta : undefined;
  const serverName = optionalString(params.serverName);
  const mcpMessage = optionalString(mcpMeta?.message);
  const toolDescription = optionalString(mcpMeta?.tool_description);
  const toolParams = isRecord(mcpMeta?.tool_params) ? mcpMeta.tool_params : undefined;
  const toolParamsDisplay = Array.isArray(mcpMeta?.tool_params_display)
    ? mcpMeta.tool_params_display
    : undefined;
  const toolName = optionalString(mcpMeta?.tool_name)
    ?? parseMcpToolName(mcpMessage)
    ?? inferBuiltInMcpToolName(serverName, toolDescription);
  const scheduleName = optionalString(toolParams?.name);
  const isMcpElicitation = input.request.method === 'mcpServer/elicitation/request';
  const isScheduleCreate =
    serverName === 'clawee_schedule'
    && toolName === 'clawee_schedule_create';
  const kind = input.request.method === 'item/commandExecution/requestApproval'
    ? 'command_execution' as const
    : input.request.method === 'item/fileChange/requestApproval'
      ? 'file_change' as const
      : 'permissions' as const;
  const title = isScheduleCreate
    ? '允许创建定时任务'
    : isMcpElicitation
      ? '允许调用 MCP 工具'
      : kind === 'command_execution'
        ? host === undefined ? '允许执行命令' : '允许网络访问'
        : kind === 'file_change'
          ? '允许修改文件'
          : '允许扩大权限';
  const summary = host !== undefined
    ? `${protocol ?? 'network'}://${host}${port === undefined ? '' : `:${port}`}`
    : scheduleName ?? toolName ?? serverName ?? command ?? grantRoot ?? reason ?? title;
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
    ...(serverName === undefined ? {} : { serverName }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(toolDescription === undefined ? {} : { toolDescription }),
    ...(toolParams === undefined ? {} : { toolParams }),
    ...(toolParamsDisplay === undefined ? {} : { toolParamsDisplay }),
    ...(Array.isArray(params.commandActions) ? { commandActions: params.commandActions } : {}),
    ...(isRecord(params.permissions) ? { permissions: params.permissions } : {})
  });

  return {
    runId: input.runId,
    threadId: input.threadId,
    codexThreadId: input.codexThreadId,
    turnId: optionalString(params.turnId) ?? 'unknown',
    itemId: optionalString(params.itemId) ?? toolName ?? serverName ?? 'unknown',
    requestId: String(input.request.id),
    kind,
    risk: kind === 'file_change' ? 'medium' as const : 'high' as const,
    title,
    summary: redactText(summary),
    details
  };
}

function parseMcpToolName(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  return message.match(/\btool\s+"([^"]+)"/i)?.[1];
}

function inferBuiltInMcpToolName(
  serverName: string | undefined,
  description: string | undefined
): string | undefined {
  if (serverName !== 'clawee_schedule' || description === undefined) {
    return undefined;
  }
  const tools = [
    ['创建一个 Clawee 定时任务', 'clawee_schedule_create'],
    ['更新当前任务会话绑定的定时任务', 'clawee_schedule_update'],
    ['暂停当前任务会话绑定的定时任务', 'clawee_schedule_pause'],
    ['恢复当前任务会话绑定的定时任务', 'clawee_schedule_resume'],
    ['立即触发当前任务会话绑定的定时任务', 'clawee_schedule_run_now'],
    ['读取当前任务会话绑定的定时任务', 'clawee_schedule_get']
  ] as const;
  return tools.find(([prefix]) => description.startsWith(prefix))?.[1];
}

function redactApprovalDetails(
  details: Record<string, unknown>
): Record<string, unknown> {
  const redacted = redactValue(details);
  return isRecord(redacted) ? redacted : {};
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
  input: ResolvedCreateRunInput,
  resumeMode: ResolvedResumeMode,
  codexThreadId?: string,
  mcpServers?: CodexMcpServerConfig[]
): string[] | undefined {
  if (resumeMode === 'resume_thread') {
    if (codexThreadId === undefined) return undefined;
    return buildCodexResumeArgs({
      codexThreadId,
      sandbox: input.sandbox,
      model: input.model,
      reasoning: input.reasoning,
      imagePaths: input.imagePaths,
      mcpServers
    });
  }

  return buildCodexExecArgs({
    profile: input.profile,
    cwd: input.cwd,
    sandbox: input.sandbox,
    model: input.model,
    reasoning: input.reasoning,
    imagePaths: input.imagePaths,
    mcpServers
  });
}

function buildRuntimeArgv(
  input: ResolvedCreateRunInput,
  resumeMode: ResolvedResumeMode,
  codexThreadId: string | undefined,
  runtimeTransport: RunManagerOptions['runtimeTransport'],
  mcpServers?: CodexMcpServerConfig[]
): string[] | undefined {
  if (runtimeTransport === 'app-server') {
    return buildCodexAppServerArgs({
      profile: input.profile,
      mcpServers
    });
  }
  return buildRunArgv(input, resumeMode, codexThreadId, mcpServers);
}

function buildThreadRunDiagnosticsMetadata(input: {
  runInput: ResolvedCreateRunInput;
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

function publishScheduleTrigger(
  runId: string,
  seq: number,
  prompt: string,
  triggeredAt: string,
  publish: (event: AgentEventEnvelope) => Promise<void>
): Promise<void> {
  return publish({
    id: `evt_${runId}_${seq}`,
    runId,
    seq,
    ts: triggeredAt,
    type: 'schedule_trigger',
    payload: {
      type: 'schedule_trigger',
      prompt,
      triggeredAt
    },
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

function isThreadCodexIdConflict(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (
      'code' in current
      && current.code === 'THREAD_CODEX_ID_CONFLICT'
    ) {
      return true;
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
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

function isAppServerResumeFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('not found')
    || normalized.includes('no session')
    || normalized.includes('unknown session')
    || normalized.includes('thread/resume');
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

function shouldAutomaticallyRotate(input: CreateRunInput): boolean {
  return input.threadId !== undefined
    && input.createdBy === 'schedule'
    && (input.resumeMode === undefined || input.resumeMode === 'auto');
}

function normalizeRotationRunThreshold(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CODEX_THREAD_ROTATION_RUN_THRESHOLD;
  if (!Number.isFinite(value)) return DEFAULT_CODEX_THREAD_ROTATION_RUN_THRESHOLD;
  return Math.max(0, Math.floor(value));
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
    ...(row.public_prompt === null ? {} : { publicPrompt: row.public_prompt }),
    ...(row.triggered_at === null ? {} : { triggeredAt: row.triggered_at }),
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
