import type {
  CleanupDeleteResponse,
  CleanupFailedItem,
  CleanupPreviewItem,
  CleanupPreviewResponse
} from '@opencreator/protocol';
import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { RunRepository, RunRow, ThreadRepository, ThreadRow } from '../storage/repositories.js';

export class CleanupError extends Error {
  constructor(
    public readonly code: 'VALIDATION_FAILED' | 'CLEANUP_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'CleanupError';
  }
}

export type CleanupServiceOptions = {
  dataDir: string;
  runs: Pick<RunRepository, 'getRun'>;
  threads: Pick<ThreadRepository, 'getThread'>;
  clock?: () => Date;
};

export type CleanupService = {
  preview(input: { olderThanDays: number }): CleanupPreviewResponse;
  delete(input: { olderThanDays: number }): CleanupDeleteResponse;
};

type RuntimeRootEntry = {
  id: string;
  path: string;
};

type DirectoryMetadata = {
  sizeBytes: number;
  lastModifiedAtMs: number;
};

const ACTIVE_PUBLIC_RUN_STATUSES = new Set(['queued', 'running', 'canceling']);
const ACTIVE_INTERNAL_RUN_STATUSES = new Set(['created', 'queued', 'spawning', 'running', 'canceling']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function createCleanupService(options: CleanupServiceOptions): CleanupService {
  const clock = options.clock ?? (() => new Date());

  return {
    preview(input: { olderThanDays: number }): CleanupPreviewResponse {
      return previewCleanup(options, clock(), input.olderThanDays);
    },
    delete(input: { olderThanDays: number }): CleanupDeleteResponse {
      const preview = previewCleanup(options, clock(), input.olderThanDays);
      const deleted: CleanupDeleteResponse['deleted'] = [];
      const failed: CleanupFailedItem[] = [];

      for (const item of preview.items) {
        try {
          rmSync(item.path, { recursive: true, force: false });
          deleted.push({
            type: item.type,
            id: item.id,
            path: item.path,
            sizeBytes: item.sizeBytes
          });
        } catch (error) {
          failed.push({
            type: item.type,
            id: item.id,
            path: item.path,
            sizeBytes: item.sizeBytes,
            error: formatError(error)
          });
        }
      }

      return {
        deleted,
        failed,
        totalDeletedBytes: deleted.reduce((total, item) => total + item.sizeBytes, 0),
        warnings: preview.warnings
      };
    }
  };
}

function previewCleanup(
  options: CleanupServiceOptions,
  now: Date,
  olderThanDays: number
): CleanupPreviewResponse {
  validateOlderThanDays(olderThanDays);

  const thresholdMs = now.getTime() - olderThanDays * DAY_MS;
  const warnings: string[] = [];
  const runRoot = resolve(options.dataDir, 'runs');
  const workspaceRoot = resolve(options.dataDir, 'workspaces');
  const items = [
    ...previewRunLogs(runRoot, options.runs, thresholdMs, olderThanDays, warnings),
    ...previewThreadWorkspaces(workspaceRoot, options.threads, thresholdMs, olderThanDays, warnings)
  ];

  return {
    olderThanDays,
    items,
    totalSizeBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
    warnings
  };
}

function previewRunLogs(
  root: string,
  runs: Pick<RunRepository, 'getRun'>,
  thresholdMs: number,
  olderThanDays: number,
  warnings: string[]
): CleanupPreviewItem[] {
  return scanRuntimeRoot(root, /^run_.+$/, warnings).flatMap(entry => {
    try {
      const row = runs.getRun(entry.id);
      if (!row || isActiveRun(row)) return [];
      const metadata = readDirectoryMetadata(entry.path);
      if (metadata.lastModifiedAtMs >= thresholdMs) return [];
      return [{
        type: 'run_logs',
        id: entry.id,
        path: entry.path,
        sizeBytes: metadata.sizeBytes,
        lastModifiedAt: new Date(metadata.lastModifiedAtMs).toISOString(),
        reason: `run logs older than ${olderThanDays} days`
      }];
    } catch (error) {
      warnings.push(`Skipping runtime cleanup candidate ${entry.path}: ${formatError(error)}`);
      return [];
    }
  });
}

function previewThreadWorkspaces(
  root: string,
  threads: Pick<ThreadRepository, 'getThread'>,
  thresholdMs: number,
  olderThanDays: number,
  warnings: string[]
): CleanupPreviewItem[] {
  return scanRuntimeRoot(root, /^thread_.+$/, warnings).flatMap(entry => {
    try {
      const row = threads.getThread(entry.id);
      if (!row || !isArchivedManagedThread(row)) return [];
      const metadata = readDirectoryMetadata(entry.path);
      if (metadata.lastModifiedAtMs >= thresholdMs) return [];
      return [{
        type: 'managed_thread_workspace',
        id: entry.id,
        path: entry.path,
        sizeBytes: metadata.sizeBytes,
        lastModifiedAt: new Date(metadata.lastModifiedAtMs).toISOString(),
        reason: `archived managed thread workspace older than ${olderThanDays} days`
      }];
    } catch (error) {
      warnings.push(`Skipping runtime cleanup candidate ${entry.path}: ${formatError(error)}`);
      return [];
    }
  });
}

function validateOlderThanDays(olderThanDays: number): void {
  if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
    throw new CleanupError('VALIDATION_FAILED', 'olderThanDays must be a positive integer');
  }
}

function scanRuntimeRoot(root: string, idPattern: RegExp, warnings: string[]): RuntimeRootEntry[] {
  if (!existsSync(root)) return [];

  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      warnings.push(`Skipping unsafe runtime cleanup root: ${root}`);
      return [];
    }

    const realRoot = realpathSync(root);
    return readdirSync(root)
      .filter(id => idPattern.test(id))
      .flatMap(id => {
        const candidatePath = join(root, id);
        try {
          const candidateStat = lstatSync(candidatePath);
          if (!candidateStat.isDirectory() || candidateStat.isSymbolicLink()) {
            warnings.push(`Skipping unsafe runtime cleanup candidate: ${candidatePath}`);
            return [];
          }

          const realCandidatePath = realpathSync(candidatePath);
          if (!isPathInside(realRoot, realCandidatePath)) {
            warnings.push(`Skipping unsafe runtime cleanup candidate: ${candidatePath}`);
            return [];
          }

          return [{ id, path: candidatePath }];
        } catch (error) {
          warnings.push(`Skipping runtime cleanup candidate ${candidatePath}: ${formatError(error)}`);
          return [];
        }
      });
  } catch (error) {
    warnings.push(`Skipping runtime cleanup candidate ${root}: ${formatError(error)}`);
    return [];
  }
}

function readDirectoryMetadata(path: string): DirectoryMetadata {
  const rootStat = statSync(path);
  let sizeBytes = 0;
  let lastModifiedAtMs = rootStat.mtimeMs;

  for (const dirent of readdirSync(path, { withFileTypes: true })) {
    const childPath = join(path, dirent.name);
    const childStat = lstatSync(childPath);
    if (childStat.isSymbolicLink()) continue;
    lastModifiedAtMs = Math.max(lastModifiedAtMs, childStat.mtimeMs);

    if (childStat.isDirectory()) {
      const childMetadata = readDirectoryMetadata(childPath);
      sizeBytes += childMetadata.sizeBytes;
      lastModifiedAtMs = Math.max(lastModifiedAtMs, childMetadata.lastModifiedAtMs);
    } else if (childStat.isFile()) {
      sizeBytes += childStat.size;
    }
  }

  return { sizeBytes, lastModifiedAtMs };
}

function isActiveRun(row: Pick<RunRow, 'public_status' | 'internal_status'>): boolean {
  return ACTIVE_PUBLIC_RUN_STATUSES.has(row.public_status)
    || ACTIVE_INTERNAL_RUN_STATUSES.has(row.internal_status);
}

function isArchivedManagedThread(row: Pick<ThreadRow, 'workspace_mode' | 'status'>): boolean {
  return row.workspace_mode === 'managed' && row.status === 'archived';
}

function isPathInside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
