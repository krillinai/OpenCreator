import { describe, expect, it } from 'vitest';
import { reduceAppState, initialAppState } from './app-state.js';

describe('app state', () => {
  it('tracks active run by thread id and clears it on done', () => {
    const running = reduceAppState(initialAppState, {
      type: 'run_started',
      threadId: 'thread_1',
      runId: 'run_1',
      status: 'running'
    });
    expect(running.activeRunByThreadId.thread_1).toBe('run_1');

    const done = reduceAppState(running, {
      type: 'run_done',
      threadId: 'thread_1',
      runId: 'run_1'
    });
    expect(done.activeRunByThreadId.thread_1).toBeUndefined();
  });

  it('does not track terminal run_started statuses', () => {
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      const state = reduceAppState(initialAppState, {
        type: 'run_started',
        threadId: 'thread_1',
        runId: `run_${status}`,
        status
      });

      expect(state.activeRunByThreadId.thread_1).toBeUndefined();
    }
  });

  it('does not clear active run for a different run id', () => {
    const running = reduceAppState(initialAppState, {
      type: 'run_started',
      threadId: 'thread_1',
      runId: 'run_1',
      status: 'running'
    });

    const done = reduceAppState(running, {
      type: 'run_done',
      threadId: 'thread_1',
      runId: 'run_2'
    });

    expect(done.activeRunByThreadId.thread_1).toBe('run_1');
  });
});
