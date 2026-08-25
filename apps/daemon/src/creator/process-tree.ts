import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export function spawnCreatorProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
  signal: AbortSignal
): ChildProcess {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== 'win32',
    windowsHide: true
  });
  const abort = () => void terminateProcessTree(child.pid);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  child.once('exit', () => signal.removeEventListener('abort', abort));
  return child;
}

export async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined || pid <= 0) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { process.kill(pid, 'SIGTERM'); } catch { return; }
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch { /* Process already exited. */ }
  }
}
