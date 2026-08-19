import type { AgentEventEnvelope, PublicRunStatus, RunResponse } from '@opencreator/protocol';

export type RunSubscriptionState = 'idle' | 'connecting' | 'connected' | 'disconnected';
export type RunCancelState = 'idle' | 'requested' | 'failed';

export type RunRegistryState = {
  runsById: Record<string, RunResponse | undefined>;
  runIdsByThreadId: Record<string, string[] | undefined>;
  activeRunIdByThreadId: Record<string, string | undefined>;
  lastSeqByRunId: Record<string, number | undefined>;
  subscriptionStateByRunId: Record<string, RunSubscriptionState | undefined>;
  cancelStateByRunId: Record<string, RunCancelState | undefined>;
};

export type RunRegistryAction =
  | { type: 'reset' }
  | {
      type: 'merge_thread_runs';
      threadId: string;
      knownRunIdsAtRequestStart: string[];
      runs: RunResponse[];
    }
  | { type: 'upsert_run'; run: RunResponse }
  | { type: 'record_event'; event: AgentEventEnvelope }
  | {
      type: 'set_subscription_state';
      runId: string;
      state: RunSubscriptionState;
    }
  | { type: 'set_cancel_state'; runId: string; state: RunCancelState };

export const initialRunRegistryState: RunRegistryState = createInitialState();

export function runRegistryReducer(
  state: RunRegistryState,
  action: RunRegistryAction
): RunRegistryState {
  switch (action.type) {
    case 'reset':
      return createInitialState();
    case 'merge_thread_runs':
      return mergeThreadRuns(
        state,
        action.threadId,
        action.knownRunIdsAtRequestStart,
        action.runs
      );
    case 'upsert_run':
      return upsertRun(state, action.run);
    case 'record_event':
      return recordEvent(state, action.event);
    case 'set_subscription_state':
      return {
        ...state,
        subscriptionStateByRunId: {
          ...state.subscriptionStateByRunId,
          [action.runId]: action.state
        }
      };
    case 'set_cancel_state':
      return {
        ...state,
        cancelStateByRunId: {
          ...state.cancelStateByRunId,
          [action.runId]: action.state
        }
      };
  }
}

export function getThreadActiveRun(
  state: RunRegistryState,
  threadId: string | undefined
): RunResponse | undefined {
  if (threadId === undefined) return undefined;
  const runId = state.activeRunIdByThreadId[threadId];
  return runId === undefined ? undefined : state.runsById[runId];
}

export function isThreadRunBusy(
  state: RunRegistryState,
  threadId: string | undefined
): boolean {
  return getThreadActiveRun(state, threadId) !== undefined;
}

export function getThreadQueuedRuns(
  state: RunRegistryState,
  threadId: string | undefined
): RunResponse[] {
  if (threadId === undefined) return [];
  return (state.runIdsByThreadId[threadId] ?? [])
    .map(runId => state.runsById[runId])
    .filter((run): run is RunResponse => run?.status === 'queued')
    .sort((left, right) =>
      (left.queuePosition ?? Number.MAX_SAFE_INTEGER)
      - (right.queuePosition ?? Number.MAX_SAFE_INTEGER)
    );
}

export function getRunCancelState(
  state: RunRegistryState,
  runId: string | undefined
): RunCancelState {
  if (runId === undefined) return 'idle';
  return state.cancelStateByRunId[runId] ?? 'idle';
}

function createInitialState(): RunRegistryState {
  return {
    runsById: {},
    runIdsByThreadId: {},
    activeRunIdByThreadId: {},
    lastSeqByRunId: {},
    subscriptionStateByRunId: {},
    cancelStateByRunId: {}
  };
}

function mergeThreadRuns(
  state: RunRegistryState,
  threadId: string,
  knownRunIdsAtRequestStart: string[],
  runs: RunResponse[]
): RunRegistryState {
  const normalizedRuns = runs.map(run => (
    run.threadId === threadId ? run : { ...run, threadId }
  ));
  const runsById = { ...state.runsById };
  const cancelStateByRunId = { ...state.cancelStateByRunId };
  const subscriptionStateByRunId = { ...state.subscriptionStateByRunId };

  for (const run of normalizedRuns) {
    const existingRun = runsById[run.id];
    runsById[run.id] = existingRun !== undefined
      && isTerminal(existingRun.status)
      && !isTerminal(run.status)
      ? existingRun
      : run;
    cancelStateByRunId[run.id] ??= 'idle';
    subscriptionStateByRunId[run.id] ??= 'idle';
    if (isTerminal(runsById[run.id]!.status)) {
      cancelStateByRunId[run.id] = 'idle';
      subscriptionStateByRunId[run.id] = 'idle';
    }
  }

  const responseRunIds = normalizedRuns.map(run => run.id);
  const knownRunIds = new Set(knownRunIdsAtRequestStart);
  const preservedActiveRunIds = (state.runIdsByThreadId[threadId] ?? []).filter(runId => {
    const run = runsById[runId];
    return run !== undefined
      && !responseRunIds.includes(runId)
      && !knownRunIds.has(runId)
      && !isTerminal(run.status);
  });
  const runIds = [...preservedActiveRunIds, ...responseRunIds];
  return {
    ...state,
    runsById,
    runIdsByThreadId: {
      ...state.runIdsByThreadId,
      [threadId]: runIds
    },
    activeRunIdByThreadId: withActiveRunId(
      state.activeRunIdByThreadId,
      threadId,
      selectActiveRunId(runIds, runsById)
    ),
    cancelStateByRunId,
    subscriptionStateByRunId
  };
}

function upsertRun(state: RunRegistryState, run: RunResponse): RunRegistryState {
  const runsById = {
    ...state.runsById,
    [run.id]: run
  };
  const threadId = run.threadId;
  const cancelStateByRunId = {
    ...state.cancelStateByRunId,
    [run.id]: isTerminal(run.status)
      ? 'idle'
      : state.cancelStateByRunId[run.id] ?? 'idle'
  } satisfies RunRegistryState['cancelStateByRunId'];
  const subscriptionStateByRunId = {
    ...state.subscriptionStateByRunId,
    [run.id]: isTerminal(run.status)
      ? 'idle'
      : state.subscriptionStateByRunId[run.id] ?? 'idle'
  } satisfies RunRegistryState['subscriptionStateByRunId'];

  if (threadId === undefined) {
    return {
      ...state,
      runsById,
      cancelStateByRunId,
      subscriptionStateByRunId
    };
  }

  const existingIds = state.runIdsByThreadId[threadId] ?? [];
  const runIds = existingIds.includes(run.id)
    ? existingIds
    : [run.id, ...existingIds];

  return {
    ...state,
    runsById,
    runIdsByThreadId: {
      ...state.runIdsByThreadId,
      [threadId]: runIds
    },
    activeRunIdByThreadId: withActiveRunId(
      state.activeRunIdByThreadId,
      threadId,
      selectActiveRunId(runIds, runsById)
    ),
    cancelStateByRunId,
    subscriptionStateByRunId
  };
}

function recordEvent(
  state: RunRegistryState,
  event: AgentEventEnvelope
): RunRegistryState {
  const previousSeq = state.lastSeqByRunId[event.runId] ?? 0;
  if (event.seq <= previousSeq) return state;

  let next = state;
  const existingRun = state.runsById[event.runId];

  if (event.type === 'status') {
    const threadId = existingRun?.threadId ?? event.payload.threadId;
    if (threadId !== undefined) {
      next = upsertRun(next, {
        ...existingRun,
        id: event.runId,
        threadId,
        codexThreadId: existingRun?.codexThreadId ?? event.payload.codexThreadId,
        status: publicStatusForLabel(event.payload.label)
      });
    }
  } else if (event.type === 'done' && existingRun !== undefined) {
    next = upsertRun(next, {
      ...existingRun,
      status: event.payload.status
    });
  }

  const updatedRun = next.runsById[event.runId];
  return {
    ...next,
    runsById: updatedRun === undefined
      ? next.runsById
      : {
          ...next.runsById,
          [event.runId]: {
            ...updatedRun,
            lastEventSeq: Math.max(updatedRun.lastEventSeq ?? 0, event.seq)
          }
        },
    lastSeqByRunId: {
      ...next.lastSeqByRunId,
      [event.runId]: event.seq
    },
    subscriptionStateByRunId: {
      ...next.subscriptionStateByRunId,
      [event.runId]: event.type === 'done' ? 'idle' : 'connected'
    },
    cancelStateByRunId: {
      ...next.cancelStateByRunId,
      [event.runId]: event.type === 'done'
        ? 'idle'
        : event.type === 'status' && event.payload.label === 'canceling'
          ? 'requested'
          : next.cancelStateByRunId[event.runId] ?? 'idle'
    }
  };
}

function selectActiveRunId(
  runIds: string[],
  runsById: RunRegistryState['runsById']
): string | undefined {
  return runIds.find(runId => runsById[runId]?.status === 'running')
    ?? runIds.find(runId => runsById[runId]?.status === 'queued');
}

function withActiveRunId(
  activeRunIdByThreadId: RunRegistryState['activeRunIdByThreadId'],
  threadId: string,
  runId: string | undefined
): RunRegistryState['activeRunIdByThreadId'] {
  const next = { ...activeRunIdByThreadId };
  if (runId === undefined) delete next[threadId];
  else next[threadId] = runId;
  return next;
}

function publicStatusForLabel(
  label: Extract<AgentEventEnvelope, { type: 'status' }>['payload']['label']
): PublicRunStatus {
  return label === 'queued' ? 'queued' : 'running';
}

function isTerminal(status: PublicRunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}
