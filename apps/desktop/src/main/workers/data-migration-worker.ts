import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from 'node:path';
import {
  isMainThread,
  parentPort,
  workerData
} from 'node:worker_threads';

export type RuntimeImportInput = {
  source?: string;
  target: string;
};

export type RuntimeImportResult =
  | { imported: true; source: string; target: string }
  | { imported: false; reason: 'NO_SOURCE' | 'TARGET_EXISTS' };

export type RuntimeImportWorkerMessage =
  | { ok: true; result: RuntimeImportResult }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export class RuntimeImportValidationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RuntimeImportValidationError';
  }
}

export function runRuntimeDataImport(
  input: RuntimeImportInput
): RuntimeImportResult {
  if (input.source === undefined || input.source.trim().length === 0) {
    return { imported: false, reason: 'NO_SOURCE' };
  }

  const source = resolve(input.source);
  const target = resolve(input.target);
  const sourceReal = validateSourceDirectory(source);
  const targetReal = resolveProspectiveRealPath(target);
  assertPathsAreIndependent(sourceReal, targetReal);
  if (existsSync(target) && readdirSync(target).length > 0) {
    return { imported: false, reason: 'TARGET_EXISTS' };
  }
  assertRuntimeNotLocked(sourceReal);
  validateSqlite(join(sourceReal, 'app.sqlite'));

  mkdirSync(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.${basename(target)}.import-${process.pid}-${Date.now()}`
  );
  assertPathsAreIndependent(sourceReal, resolveProspectiveRealPath(temporary));
  rmSync(temporary, { recursive: true, force: true });

  try {
    validatePortableTree(sourceReal);
    cpSync(sourceReal, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    validatePortableTree(temporary);
    validateSqlite(join(temporary, 'app.sqlite'));
    if (existsSync(target)) rmSync(target, { recursive: true });
    renameSync(temporary, target);
    return { imported: true, source: sourceReal, target };
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    throw error;
  }
}

function validateSourceDirectory(path: string): string {
  if (!existsSync(path)) {
    throw new RuntimeImportValidationError(
      'SOURCE_MISSING',
      `Runtime import source does not exist: ${path}`
    );
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new RuntimeImportValidationError(
      'SOURCE_INVALID',
      `Runtime import source must be a real directory: ${path}`
    );
  }
  return realpathSync(path);
}

function validatePortableTree(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new RuntimeImportValidationError(
        'SYMLINK_REJECTED',
        `Runtime import contains a symbolic link: ${path}`
      );
    }
    if (stat.isDirectory()) {
      validatePortableTree(path);
      continue;
    }
    if (!stat.isFile()) {
      throw new RuntimeImportValidationError(
        'SPECIAL_FILE_REJECTED',
        `Runtime import contains a special file: ${path}`
      );
    }
  }
}

function validateSqlite(path: string): void {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new RuntimeImportValidationError(
      'DATABASE_MISSING',
      `Runtime database does not exist: ${path}`
    );
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, {
      open: true,
      readOnly: true
    });
    const rows = database.prepare('PRAGMA quick_check').all();
    const values = rows.flatMap(row => Object.values(row));
    if (values.length !== 1 || values[0] !== 'ok') {
      throw new Error(values.map(String).join('; ') || 'unknown quick_check result');
    }
  } catch (error) {
    throw new RuntimeImportValidationError(
      'DATABASE_CORRUPT',
      `Runtime database quick_check failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    database?.close();
  }
}

function assertRuntimeNotLocked(source: string): void {
  const lockPath = join(source, 'opencreator-runtime.lock');
  if (!existsSync(lockPath)) return;
  const pid = Number(readFileSync(lockPath, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ESRCH') return;
    throw new RuntimeImportValidationError(
      'SOURCE_LOCKED',
      `Runtime source may still be in use by process ${pid}`
    );
  }
  throw new RuntimeImportValidationError(
    'SOURCE_LOCKED',
    `Runtime source is currently in use by process ${pid}`
  );
}

function assertPathsAreIndependent(source: string, target: string): void {
  if (isPathWithin(source, target) || isPathWithin(target, source)) {
    throw new RuntimeImportValidationError(
      'PATH_RELATION_INVALID',
      'Runtime import source, temporary directory, and target must not contain one another'
    );
  }
}

function isPathWithin(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === ''
    || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function resolveProspectiveRealPath(path: string): string {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      throw new RuntimeImportValidationError(
        'SYMLINK_REJECTED',
        `Runtime import path must not be a symbolic link: ${path}`
      );
    }
    return realpathSync(path);
  }
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  return join(realpathSync(parent), basename(path));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

if (!isMainThread) {
  try {
    parentPort?.postMessage({
      ok: true,
      result: runRuntimeDataImport(workerData as RuntimeImportInput)
    } satisfies RuntimeImportWorkerMessage);
  } catch (error) {
    parentPort?.postMessage({
      ok: false,
      error: {
        code: error instanceof RuntimeImportValidationError
          ? error.code
          : 'MIGRATION_FAILED',
        message: error instanceof Error ? error.message : String(error)
      }
    } satisfies RuntimeImportWorkerMessage);
  }
}
