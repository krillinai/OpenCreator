export type FrameBatcher<T> = {
  push(value: T): void;
  flush(): void;
  clear(): void;
};

type FrameHandle = number | ReturnType<typeof setTimeout>;

export type FrameBatcherOptions<T> = {
  onFlush(values: T[]): void;
  schedule?(callback: () => void): FrameHandle;
  cancel?(handle: FrameHandle): void;
};

export function createFrameBatcher<T>(options: FrameBatcherOptions<T>): FrameBatcher<T> {
  const schedule = options.schedule ?? scheduleFrame;
  const cancel = options.cancel ?? cancelFrame;
  let pending: T[] = [];
  let scheduledHandle: FrameHandle | undefined;
  let scheduleGeneration = 0;

  function commit() {
    if (pending.length === 0) return;
    const values = pending;
    pending = [];
    options.onFlush(values);
  }

  function cancelScheduledFrame() {
    scheduleGeneration += 1;
    if (scheduledHandle === undefined) return;
    cancel(scheduledHandle);
    scheduledHandle = undefined;
  }

  return {
    push(value) {
      pending.push(value);
      if (scheduledHandle !== undefined) return;

      const generation = ++scheduleGeneration;
      scheduledHandle = schedule(() => {
        if (generation !== scheduleGeneration) return;
        scheduledHandle = undefined;
        commit();
      });
    },
    flush() {
      cancelScheduledFrame();
      commit();
    },
    clear() {
      cancelScheduledFrame();
      pending = [];
    }
  };
}

function scheduleFrame(callback: () => void): FrameHandle {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 16);
}

function cancelFrame(handle: FrameHandle): void {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle as number);
    return;
  }
  globalThis.clearTimeout(handle);
}
