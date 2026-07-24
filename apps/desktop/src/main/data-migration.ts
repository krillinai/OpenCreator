import { Worker } from 'node:worker_threads';
import type {
  RuntimeImportInput,
  RuntimeImportResult,
  RuntimeImportWorkerMessage
} from './workers/data-migration-worker.js';

export type { RuntimeImportInput, RuntimeImportResult };

export type RuntimeDataImportTask = {
  result: Promise<RuntimeImportResult>;
  cancel(): Promise<void>;
};

export function startRuntimeDataImport(
  input: RuntimeImportInput
): RuntimeDataImportTask {
  if (input.source === undefined || input.source.trim().length === 0) {
    return {
      result: Promise.resolve({ imported: false, reason: 'NO_SOURCE' }),
      cancel: async () => undefined
    };
  }

  const worker = new Worker(
    new URL('./workers/data-migration-worker.js', import.meta.url),
    { workerData: input }
  );
  let settled = false;
  let resolveResult: (result: RuntimeImportResult) => void;
  let rejectResult: (error: Error) => void;
  const result = new Promise<RuntimeImportResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  worker.once('message', (message: RuntimeImportWorkerMessage) => {
    if (settled) return;
    settled = true;
    if (message.ok) {
      resolveResult(message.result);
    } else {
      rejectResult(new RuntimeDataMigrationError(
        message.error.code,
        message.error.message
      ));
    }
  });
  worker.once('error', error => {
    if (settled) return;
    settled = true;
    rejectResult(error);
  });
  worker.once('exit', code => {
    if (settled) return;
    settled = true;
    rejectResult(new RuntimeDataMigrationError(
      'WORKER_EXITED',
      `Runtime data migration worker exited with code ${code}`
    ));
  });

  return {
    result,
    async cancel() {
      if (settled) return;
      settled = true;
      await worker.terminate();
      rejectResult(new RuntimeDataMigrationError(
        'MIGRATION_CANCELED',
        'Runtime data migration was canceled'
      ));
    }
  };
}

export class RuntimeDataMigrationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RuntimeDataMigrationError';
  }
}
