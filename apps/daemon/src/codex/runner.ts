import { spawn } from 'node:child_process';

export type RunCodexExecInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  args: string[];
  prompt: string;
  timeoutMs?: number;
  inactivityTimeoutMs?: number;
};

export type RunCodexExecResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: string[];
  stderr: string;
};

export function runCodexExec(input: RunCodexExecInput): Promise<RunCodexExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.codexBin, input.args, {
      cwd: input.cwd,
      env: { ...process.env, CODEX_HOME: input.codexHome },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutLines: string[] = [];
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let inactivityTimeout: NodeJS.Timeout | undefined;

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      timeout = undefined;
      inactivityTimeout = undefined;
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    const killAndReject = (error: Error) => {
      if (settled) return;
      child.kill('SIGTERM');
      rejectOnce(error);
    };

    const resetInactivityTimer = () => {
      if (!input.inactivityTimeoutMs) return;
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => {
        killAndReject(new Error(`Codex exec inactivity timeout after ${input.inactivityTimeoutMs}ms`));
      }, input.inactivityTimeoutMs);
    };

    if (input.timeoutMs) {
      timeout = setTimeout(() => {
        killAndReject(new Error(`Codex exec timeout after ${input.timeoutMs}ms`));
      }, input.timeoutMs);
    }
    resetInactivityTimer();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      resetInactivityTimer();
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      stdoutLines.push(...lines);
    });

    child.stderr.on('data', (chunk: string) => {
      resetInactivityTimer();
      stderr += chunk;
    });

    child.on('error', (error) => {
      rejectOnce(error);
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (stdoutBuffer.length > 0) stdoutLines.push(stdoutBuffer);
      resolve({ exitCode, signal, stdoutLines, stderr });
    });

    child.stdin.on('error', (error) => {
      killAndReject(error);
    });

    child.stdin.end(input.prompt);
  });
}
