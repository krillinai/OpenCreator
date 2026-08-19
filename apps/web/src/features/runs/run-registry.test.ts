import type { AgentEventEnvelope, RunResponse } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  getRunCancelState,
  getThreadActiveRun,
  getThreadQueuedRuns,
  initialRunRegistryState,
  isThreadRunBusy,
  runRegistryReducer
} from './run-registry.js';

describe('run registry', () => {
  it('merges thread runs and selects the running run ahead of queued runs', () => {
    const running = createRun({ id: 'run_running', status: 'running' });
    const queued = createRun({ id: 'run_queued', status: 'queued' });
    const completed = createRun({ id: 'run_completed', status: 'succeeded' });

    const state = runRegistryReducer(initialRunRegistryState, {
      type: 'merge_thread_runs',
      threadId: 'thread_1',
      knownRunIdsAtRequestStart: [],
      runs: [queued, completed, running]
    });

    expect(state.runIdsByThreadId.thread_1).toEqual([
      'run_queued',
      'run_completed',
      'run_running'
    ]);
    expect(getThreadActiveRun(state, 'thread_1')).toEqual(running);
    expect(isThreadRunBusy(state, 'thread_1')).toBe(true);
    expect(getThreadQueuedRuns(state, 'thread_1').map(run => run.id)).toEqual([
      'run_queued'
    ]);
  });

  it('keeps run state isolated by thread', () => {
    const first = runRegistryReducer(initialRunRegistryState, {
      type: 'merge_thread_runs',
      threadId: 'thread_a',
      knownRunIdsAtRequestStart: [],
      runs: [createRun({ id: 'run_a', threadId: 'thread_a', status: 'running' })]
    });
    const state = runRegistryReducer(first, {
      type: 'merge_thread_runs',
      threadId: 'thread_b',
      knownRunIdsAtRequestStart: [],
      runs: []
    });

    expect(isThreadRunBusy(state, 'thread_a')).toBe(true);
    expect(isThreadRunBusy(state, 'thread_b')).toBe(false);
  });

  it('does not let an older empty thread query erase a locally confirmed active run', () => {
    const started = runRegistryReducer(initialRunRegistryState, {
      type: 'upsert_run',
      run: createRun({ id: 'run_started', status: 'running' })
    });
    const state = runRegistryReducer(started, {
      type: 'merge_thread_runs',
      threadId: 'thread_1',
      knownRunIdsAtRequestStart: [],
      runs: []
    });

    expect(getThreadActiveRun(state, 'thread_1')?.id).toBe('run_started');
  });

  it('accepts a later authoritative empty query for runs known when the request started', () => {
    const started = runRegistryReducer(initialRunRegistryState, {
      type: 'upsert_run',
      run: createRun({ id: 'run_started', status: 'running' })
    });
    const state = runRegistryReducer(started, {
      type: 'merge_thread_runs',
      threadId: 'thread_1',
      knownRunIdsAtRequestStart: ['run_started'],
      runs: []
    });

    expect(getThreadActiveRun(state, 'thread_1')).toBeUndefined();
  });

  it('does not let a stale query move a terminal run back to running', () => {
    const completed = runRegistryReducer(initialRunRegistryState, {
      type: 'upsert_run',
      run: createRun({ id: 'run_completed', status: 'succeeded' })
    });
    const state = runRegistryReducer(completed, {
      type: 'merge_thread_runs',
      threadId: 'thread_1',
      knownRunIdsAtRequestStart: ['run_completed'],
      runs: [createRun({ id: 'run_completed', status: 'running' })]
    });

    expect(state.runsById.run_completed?.status).toBe('succeeded');
    expect(getThreadActiveRun(state, 'thread_1')).toBeUndefined();
  });

  it('tracks subscription, cancellation, event sequence, and terminal status', () => {
    let state = runRegistryReducer(initialRunRegistryState, {
      type: 'upsert_run',
      run: createRun({ id: 'run_1', status: 'running', lastEventSeq: 3 })
    });
    state = runRegistryReducer(state, {
      type: 'set_subscription_state',
      runId: 'run_1',
      state: 'connecting'
    });
    state = runRegistryReducer(state, {
      type: 'set_cancel_state',
      runId: 'run_1',
      state: 'requested'
    });
    state = runRegistryReducer(state, {
      type: 'record_event',
      event: createEvent('status', 4, {
        type: 'status',
        label: 'canceling',
        threadId: 'thread_1'
      })
    });

    expect(state.subscriptionStateByRunId.run_1).toBe('connected');
    expect(state.lastSeqByRunId.run_1).toBe(4);
    expect(state.runsById.run_1?.lastEventSeq).toBe(4);
    expect(getRunCancelState(state, 'run_1')).toBe('requested');
    expect(isThreadRunBusy(state, 'thread_1')).toBe(true);

    state = runRegistryReducer(state, {
      type: 'record_event',
      event: createEvent('done', 5, {
        type: 'done',
        status: 'canceled',
        terminationReason: 'user_canceled'
      })
    });

    expect(state.runsById.run_1?.status).toBe('canceled');
    expect(state.lastSeqByRunId.run_1).toBe(5);
    expect(getRunCancelState(state, 'run_1')).toBe('idle');
    expect(isThreadRunBusy(state, 'thread_1')).toBe(false);
  });

  it('ignores older duplicate event sequences', () => {
    let state = runRegistryReducer(initialRunRegistryState, {
      type: 'upsert_run',
      run: createRun({ id: 'run_1', status: 'running' })
    });
    state = runRegistryReducer(state, {
      type: 'record_event',
      event: createEvent('done', 5, {
        type: 'done',
        status: 'succeeded',
        terminationReason: 'completed'
      })
    });
    state = runRegistryReducer(state, {
      type: 'record_event',
      event: createEvent('status', 4, {
        type: 'status',
        label: 'running',
        threadId: 'thread_1'
      })
    });

    expect(state.runsById.run_1?.status).toBe('succeeded');
    expect(state.lastSeqByRunId.run_1).toBe(5);
  });
});

function createRun(overrides: Partial<RunResponse> = {}): RunResponse {
  return {
    id: 'run_1',
    threadId: 'thread_1',
    status: 'running',
    ...overrides
  };
}

function createEvent<Type extends AgentEventEnvelope['type']>(
  type: Type,
  seq: number,
  payload: Extract<AgentEventEnvelope, { type: Type }>['payload']
): AgentEventEnvelope {
  return {
    id: `event_${seq}`,
    runId: 'run_1',
    seq,
    ts: new Date(0).toISOString(),
    type,
    payload,
    normalizerVersion: 1
  } as AgentEventEnvelope;
}
