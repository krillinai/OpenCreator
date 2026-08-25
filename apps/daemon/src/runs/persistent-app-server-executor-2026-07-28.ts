import type { RuntimeThread } from '../threads/types.js';
import type {
  AgentScheduleProcessInjector,
  RunMcpInjector
} from '../agent-tools/run-injection.js';
import type {
  CodexAppServerHost,
  CodexAppServerHostInput,
  CodexAppServerProcess,
  CodexAppServerResult,
  CodexAppServerTurnInput
} from '../codex/app-server-host-2026-07-28.js';
import {
  createAppServerRuntimeManager,
  type AppServerRuntimeExecution,
  type AppServerRuntimeManager,
  type AppServerRuntimeScope
} from '../codex/app-server-runtime-manager.js';

export type PersistentAppServerLifecycleEvent = {
  source: 'persistent_app_server';
  event:
    | 'process_started'
    | 'process_initialized'
    | 'process_reused'
    | 'mcp_refreshed'
    | 'profile_restarted'
    | 'process_exited'
    | 'run_assigned'
    | 'run_cleared';
  at: string;
  runId?: string;
  pid?: number;
  profile: string;
  generation?: number;
  reason?: string;
};

export type PersistentAppServerExecutionInput = CodexAppServerTurnInput & {
  runId: string;
  thread: RuntimeThread;
  profile: string;
  spawnTimeoutMs?: number;
  forceKillGraceMs?: number;
  onLifecycle?(event: PersistentAppServerLifecycleEvent): void;
};

export type PersistentAppServerExecution = CodexAppServerProcess & {
  started: Promise<{
    pid: number;
    reused: boolean;
  }>;
};

export type PersistentAppServerExecutor = {
  start(input: PersistentAppServerExecutionInput): PersistentAppServerExecution;
  isBusy(): boolean;
  invalidate(reason: string): Promise<void>;
  close(input?: {
    interruptGraceMs?: number;
    terminateGraceMs?: number;
  }): Promise<void>;
};

export function createPersistentAppServerExecutor(input: {
  codexBin: string;
  codexHome: string;
  runtimeManager?: AppServerRuntimeManager;
  processInjector?: AgentScheduleProcessInjector;
  runtimeInjector?: RunMcpInjector;
  createHost?(input: CodexAppServerHostInput): CodexAppServerHost;
  onLifecycle?(event: PersistentAppServerLifecycleEvent): void;
}): PersistentAppServerExecutor {
  const ownsRuntimeManager = input.runtimeManager === undefined;
  let activeRun: PersistentAppServerExecutionInput | undefined;
  const runtimeManager = input.runtimeManager ?? createAppServerRuntimeManager({
    codexBin: input.codexBin,
    codexHome: input.codexHome,
    processInjector: input.processInjector,
    createHost: input.createHost,
    onHostLifecycle({ event, generation }) {
      if (activeRun === undefined) return;
      if (
        event.event !== 'process_initialized'
        && event.event !== 'mcp_refreshed'
        && event.event !== 'process_exited'
      ) {
        return;
      }
      emit(activeRun, event.event, {
        pid: event.pid,
        generation: event.generation ?? generation,
        reason: event.reason
      });
    }
  });
  let activeExecution: AppServerRuntimeExecution | undefined;
  let activeScope: AppServerRuntimeScope | undefined;
  let busy = false;
  let closing = false;
  let closeWork: Promise<void> | undefined;

  function start(run: PersistentAppServerExecutionInput): PersistentAppServerExecution {
    if (closing) throw new Error('Persistent app-server executor is closing');
    if (busy) throw new Error('Persistent app-server executor is busy');
    busy = true;
    activeRun = run;
    const scope = projectScope(run.thread);
    activeScope = scope;
    let cancelRequested = false;

    const executionWork = Promise.resolve(input.runtimeInjector?.prepare({
      runId: run.runId,
      thread: run.thread,
      createdBy: 'api'
    })).then(runtimeInjection => {
      if (closing) throw new Error('Persistent app-server executor is closing');
      const execution = runtimeManager.startTurn({
        ...turnInput(run),
        scope,
        runId: run.runId,
        thread: run.thread,
        profile: run.profile,
        projectId: run.thread.projectId ?? undefined,
        runtimeInjection,
        spawnTimeoutMs: run.spawnTimeoutMs,
        forceKillGraceMs: run.forceKillGraceMs
      });
      activeExecution = execution;
      if (cancelRequested) execution.cancel();
      return execution;
    });
    const started = executionWork.then(async execution => {
      const info = await execution.started;
      emit(run, info.reused ? 'process_reused' : 'process_started', {
        pid: info.pid,
        generation: info.generation
      });
      emit(run, 'run_assigned', {
        pid: info.pid,
        generation: info.generation
      });
      return { pid: info.pid, reused: info.reused };
    });
    void started.catch(() => undefined);
    const result = executionWork
      .then(execution => execution.result)
      .catch(error => {
        if (
          closing
          && error instanceof Error
          && error.message.includes('Runtime Manager is closing')
        ) {
          throw new Error('Persistent app-server executor is closing');
        }
        throw error;
      })
      .finally(() => {
        emit(run, 'run_cleared', {
          pid: runtimeManager.listScopes()
            .find(item => sameScope(item.scope, scope))?.pid
        });
        activeExecution = undefined;
        activeScope = undefined;
        activeRun = undefined;
        busy = false;
      });
    return {
      cancel() {
        cancelRequested = true;
        activeExecution?.cancel();
      },
      async steer(steerInput) {
        const execution = await executionWork;
        if (execution.steer === undefined) throw new Error('Codex app-server turn is not steerable');
        return execution.steer(steerInput);
      },
      started,
      result
    };
  }

  function emit(
    run: PersistentAppServerExecutionInput,
    event: PersistentAppServerLifecycleEvent['event'],
    details: Partial<PersistentAppServerLifecycleEvent> = {}
  ) {
    const payload: PersistentAppServerLifecycleEvent = {
      source: 'persistent_app_server',
      event,
      at: new Date().toISOString(),
      profile: run.profile,
      runId: run.runId,
      ...details
    };
    input.onLifecycle?.(payload);
    run.onLifecycle?.(payload);
  }

  return {
    start,
    isBusy() {
      return busy;
    },
    async invalidate(reason) {
      if (closing) return;
      await runtimeManager.invalidate(reason);
    },
    async close(options = {}) {
      if (closeWork !== undefined) return closeWork;
      closing = true;
      closeWork = (async () => {
        activeExecution?.cancel();
        if (ownsRuntimeManager) {
          await runtimeManager.close();
          return;
        }
        if (activeScope !== undefined) {
          await runtimeManager.closeScope(
            activeScope,
            'executor_closed',
            options.interruptGraceMs ?? 1_000,
            options.terminateGraceMs ?? 2_000
          );
        }
        await runtimeManager.closeScopes(
          'project',
          'executor_closed',
          options.interruptGraceMs ?? 1_000,
          options.terminateGraceMs ?? 2_000
        );
        await activeExecution?.result.catch(() => undefined);
      })();
      await closeWork;
    }
  };
}

function projectScope(thread: RuntimeThread): AppServerRuntimeScope {
  return {
    kind: 'project',
    id: thread.projectId ?? thread.id
  };
}

function sameScope(left: AppServerRuntimeScope, right: AppServerRuntimeScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function turnInput(input: PersistentAppServerExecutionInput): CodexAppServerTurnInput {
  return {
    cwd: input.cwd,
    sandbox: input.sandbox,
    model: input.model,
    reasoning: input.reasoning,
    prompt: input.prompt,
    imagePaths: input.imagePaths,
    codexThreadId: input.codexThreadId,
    timeoutMs: input.timeoutMs,
    inactivityTimeoutMs: input.inactivityTimeoutMs,
    onNotification: input.onNotification,
    onThreadStarted: input.onThreadStarted,
    onTurnStartWritten: input.onTurnStartWritten,
    onApprovalRequest: input.onApprovalRequest,
    onStderrChunk: input.onStderrChunk
  };
}

export type { CodexAppServerResult };
