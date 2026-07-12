import { appendFile as appendFileFs } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_HIGH_WATER_MARK_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUED_BYTES = 8 * 1024 * 1024;

type AppendFile = (path: string, content: string) => Promise<void>;

export type OrderedLogWriterFailure = {
  file: string;
  message: string;
  at: string;
  kind: 'write' | 'backpressure';
};

export type OrderedLogWriterMetrics = {
  queuedBytes: number;
  peakQueuedBytes: number;
  highWaterMarkBytes: number;
  maxQueuedBytes: number;
  highWaterMarkHits: number;
  backpressureRejects: number;
  writesAttempted: number;
  writesCompleted: number;
  bytesWritten: number;
  totalWriteDurationMs: number;
  maxWriteDurationMs: number;
  drainCount: number;
  totalDrainDurationMs: number;
  maxDrainDurationMs: number;
  failureCount: number;
  failures: OrderedLogWriterFailure[];
  closed: boolean;
};

export type OrderedLogWriter = {
  append(file: string, content: string): Promise<void>;
  drain(): Promise<void>;
  close(): Promise<void>;
  getMetrics(): OrderedLogWriterMetrics;
};

export class OrderedLogBackpressureError extends Error {
  constructor(
    public readonly queuedBytes: number,
    public readonly incomingBytes: number,
    public readonly maxQueuedBytes: number
  ) {
    super(
      `Run log queue limit exceeded: ${queuedBytes} + ${incomingBytes} > ${maxQueuedBytes} bytes`
    );
    this.name = 'OrderedLogBackpressureError';
  }
}

export class OrderedLogWriterClosedError extends Error {
  constructor() {
    super('Run log writer is closed');
    this.name = 'OrderedLogWriterClosedError';
  }
}

export function createOrderedLogWriter(input: {
  directory: string;
  highWaterMarkBytes?: number;
  maxQueuedBytes?: number;
  appendFile?: AppendFile;
}): OrderedLogWriter {
  const highWaterMarkBytes =
    input.highWaterMarkBytes ?? DEFAULT_HIGH_WATER_MARK_BYTES;
  const maxQueuedBytes = input.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
  if (highWaterMarkBytes <= 0 || maxQueuedBytes < highWaterMarkBytes) {
    throw new Error('Run log queue limits are invalid');
  }

  const appendFile = input.appendFile ?? appendFileFs;
  let tail = Promise.resolve();
  let queuedBytes = 0;
  let peakQueuedBytes = 0;
  let highWaterMarkHits = 0;
  let backpressureRejects = 0;
  let writesAttempted = 0;
  let writesCompleted = 0;
  let bytesWritten = 0;
  let totalWriteDurationMs = 0;
  let maxWriteDurationMs = 0;
  let drainCount = 0;
  let totalDrainDurationMs = 0;
  let maxDrainDurationMs = 0;
  let closed = false;
  const failures: OrderedLogWriterFailure[] = [];

  function recordFailure(
    file: string,
    error: unknown,
    kind: OrderedLogWriterFailure['kind']
  ): void {
    failures.push({
      file,
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
      kind
    });
  }

  async function drain(): Promise<void> {
    drainCount += 1;
    const startedAt = performance.now();
    await tail;
    const durationMs = performance.now() - startedAt;
    totalDrainDurationMs += durationMs;
    maxDrainDurationMs = Math.max(maxDrainDurationMs, durationMs);
  }

  return {
    append(file, content) {
      if (closed) return Promise.reject(new OrderedLogWriterClosedError());
      if (!/^[A-Za-z0-9._-]+$/.test(file)) {
        return Promise.reject(new Error(`Run log file name is invalid: ${file}`));
      }

      const contentBytes = Buffer.byteLength(content);
      const nextQueuedBytes = queuedBytes + contentBytes;
      if (nextQueuedBytes > maxQueuedBytes) {
        const error = new OrderedLogBackpressureError(
          queuedBytes,
          contentBytes,
          maxQueuedBytes
        );
        backpressureRejects += 1;
        recordFailure(file, error, 'backpressure');
        return Promise.reject(error);
      }

      writesAttempted += 1;
      queuedBytes = nextQueuedBytes;
      peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes);
      if (queuedBytes >= highWaterMarkBytes) highWaterMarkHits += 1;

      const task = tail.then(async () => {
        const startedAt = performance.now();
        try {
          await appendFile(join(input.directory, file), content);
          writesCompleted += 1;
          bytesWritten += contentBytes;
        } catch (error) {
          recordFailure(file, error, 'write');
          throw error;
        } finally {
          const durationMs = performance.now() - startedAt;
          totalWriteDurationMs += durationMs;
          maxWriteDurationMs = Math.max(maxWriteDurationMs, durationMs);
          queuedBytes -= contentBytes;
        }
      });
      tail = task.catch(() => undefined);
      return task;
    },

    drain,

    async close() {
      closed = true;
      await drain();
    },

    getMetrics() {
      return {
        queuedBytes,
        peakQueuedBytes,
        highWaterMarkBytes,
        maxQueuedBytes,
        highWaterMarkHits,
        backpressureRejects,
        writesAttempted,
        writesCompleted,
        bytesWritten,
        totalWriteDurationMs,
        maxWriteDurationMs,
        drainCount,
        totalDrainDurationMs,
        maxDrainDurationMs,
        failureCount: failures.length,
        failures: failures.map(failure => ({ ...failure })),
        closed
      };
    }
  };
}
