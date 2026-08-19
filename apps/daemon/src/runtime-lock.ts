import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

export function acquireRuntimeLock(dataDir: string): () => void {
  const path = join(dataDir, 'opencreator-runtime.lock');
  removeStaleLock(path);
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch {
    const owner = readLockPid(path);
    throw new Error(
      owner === undefined
        ? `OpenCreator Runtime data directory is already locked: ${dataDir}`
        : `OpenCreator Runtime data directory is already used by process ${owner}: ${dataDir}`
    );
  }
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (readLockPid(path) === process.pid) rmSync(path, { force: true });
    } catch {
      // Process shutdown must continue even if the lock file cannot be removed.
    }
  };
}

function removeStaleLock(path: string): void {
  if (!existsSync(path)) return;
  const pid = readLockPid(path);
  if (pid !== undefined && processIsAlive(pid)) return;
  rmSync(path, { force: true });
}

function readLockPid(path: string): number | undefined {
  try {
    const pid = Number(readFileSync(path, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
