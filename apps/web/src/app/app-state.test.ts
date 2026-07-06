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
});
