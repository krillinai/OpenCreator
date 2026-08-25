import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export async function runStage(label, command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const startedAt = Date.now();
  console.log(`[desktop-package] 开始：${label}`);

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
    shell: process.platform === 'win32' && !isAbsolute(command),
    detached: process.platform !== 'win32'
  });

  const result = await new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timer;
    const onSigint = () => abort('SIGINT');
    const onSigterm = () => abort('SIGTERM');
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
    };
    const finish = value => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = signal => {
      timedOut = false;
      void terminateProcessTree(child.pid).finally(() => {
        finish({ code: null, signal, timedOut: false });
      });
    };
    child.once('error', fail);
    child.once('exit', (code, signal) => finish({ code, signal, timedOut }));
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child.pid).finally(() => {
        finish({ code: null, signal: 'SIGKILL', timedOut: true });
      });
    }, timeoutMs);
    timer.unref();
  });

  const durationMs = Date.now() - startedAt;
  if (result.timedOut) {
    throw new Error(`阶段“${label}”在 ${timeoutMs}ms 后超时`);
  }
  if (result.code !== 0) {
    throw new Error(
      `阶段“${label}”失败：exit=${String(result.code)} signal=${String(result.signal)}`
    );
  }
  console.log(`[desktop-package] 完成：${label}（${durationMs}ms）`);
}

async function terminateProcessTree(pid) {
  if (typeof pid !== 'number') return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      });
      killer.once('error', () => resolve());
      killer.once('exit', () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  await delay(2_000);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The process group exited during the grace period.
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
