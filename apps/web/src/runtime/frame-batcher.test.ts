import { describe, expect, it, vi } from 'vitest';
import { createFrameBatcher } from './frame-batcher.js';

describe('createFrameBatcher', () => {
  it('commits queued values once per scheduled frame and preserves order', () => {
    const scheduled: Array<() => void> = [];
    const onFlush = vi.fn();
    const batcher = createFrameBatcher<number>({
      onFlush,
      schedule(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancel: vi.fn()
    });

    batcher.push(1);
    batcher.push(2);
    batcher.push(3);

    expect(scheduled).toHaveLength(1);
    expect(onFlush).not.toHaveBeenCalled();

    scheduled[0]?.();

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('flushes pending values immediately and cancels the scheduled frame', () => {
    const scheduled: Array<() => void> = [];
    const cancel = vi.fn();
    const onFlush = vi.fn();
    const batcher = createFrameBatcher<string>({
      onFlush,
      schedule(callback) {
        scheduled.push(callback);
        return 42;
      },
      cancel
    });

    batcher.push('status');
    batcher.push('done');
    batcher.flush();

    expect(cancel).toHaveBeenCalledWith(42);
    expect(onFlush).toHaveBeenCalledWith(['status', 'done']);

    scheduled[0]?.();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('clears pending values when a subscription is replaced or aborted', () => {
    const scheduled: Array<() => void> = [];
    const cancel = vi.fn();
    const onFlush = vi.fn();
    const batcher = createFrameBatcher<number>({
      onFlush,
      schedule(callback) {
        scheduled.push(callback);
        return 7;
      },
      cancel
    });

    batcher.push(1);
    batcher.clear();
    scheduled[0]?.();

    expect(cancel).toHaveBeenCalledWith(7);
    expect(onFlush).not.toHaveBeenCalled();
  });
});
