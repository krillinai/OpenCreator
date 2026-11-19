import { Worker } from 'node:worker_threads';
import type { CreatorTaskTrace } from './task-trace.js';

export type TaskTraceCommand = { type: 'enqueue'; events: CreatorTaskTrace[] }
  | { type: 'list' } | { type: 'ack'; ids: string[] } | { type: 'clear' };

export function createTaskTraceOutbox(path: string, isOpen: () => boolean) {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<number, (value?: unknown) => void>();
  let needsClear = false;
  let clearing: Promise<boolean> | undefined;

  function release(current: Worker): void {
    if (worker !== current) return;
    worker = undefined;
    for (const resolve of pending.values()) resolve();
  }

  function request<Result>(command: TaskTraceCommand, fallback: Result): Promise<Result> {
    if (!isOpen() || pending.size >= 4) return Promise.resolve(fallback);
    try {
      if (!worker) {
        const entry = import.meta.url.endsWith('.ts') ? './task-trace-worker.ts' : './task-trace-worker.js';
        const current = new Worker(new URL(entry, import.meta.url), { workerData: path });
        worker = current;
        current.on('message', ({ id, value }: { id: number; value: unknown }) => {
          if (worker === current) pending.get(id)?.(value);
        });
        current.on('error', () => release(current));
        current.on('exit', () => release(current));
      }
      const current = worker;
      const id = ++nextId;
      return new Promise<Result>(resolve => {
        const timeout = setTimeout(() => {
          release(current);
          void current.terminate().catch(() => undefined);
        }, 2_000);
        pending.set(id, value => {
          clearTimeout(timeout);
          pending.delete(id);
          if (pending.size === 0) current.unref();
          resolve((value as Result | undefined) ?? fallback);
        });
        current.ref();
        try { current.postMessage({ id, command }); } catch { pending.get(id)?.(); }
      });
    } catch {
      return Promise.resolve(fallback);
    }
  }

  function clearTrace(): Promise<boolean> {
    needsClear = true;
    clearing ??= request({ type: 'clear' }, false).then(ok => {
      needsClear = !ok;
      clearing = undefined;
      return ok;
    });
    return clearing;
  }

  return {
    async enqueueTrace(events: CreatorTaskTrace[]): Promise<void> {
      if (needsClear && !await clearTrace()) return;
      await request({ type: 'enqueue', events }, false);
    },
    async listTrace(): Promise<CreatorTaskTrace[]> {
      if (needsClear && !await clearTrace()) return [];
      return request<CreatorTaskTrace[]>({ type: 'list' }, []);
    },
    async ackTrace(ids: string[]): Promise<number> {
      if (needsClear) return 0;
      return request({ type: 'ack', ids }, 0);
    },
    clearTrace,
    async closeTrace(): Promise<void> {
      const current = worker;
      if (!current) return;
      release(current);
      await current.terminate().catch(() => undefined);
    }
  };
}
