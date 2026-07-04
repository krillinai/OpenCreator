import { spawn } from 'node:child_process';

export type RunCodexExecInput = {
  codexBin: string;
  codexHome: string;
  cwd: string;
  args: string[];
  prompt: string;
  timeoutMs?: number;
  spawnTimeoutMs?: number;
  inactivityTimeoutMs?: number;
  forceKillGraceMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrChunk?: (chunk: string) => void;
};

export type RunCodexExecResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: string[];
  stderr: string;
  terminationReason: CodexExecTerminationReason;
};

export type CodexExecTerminationReason =
  | 'completed'
  | 'canceled'
  | 'timeout'
  | 'spawn_timeout'
  | 'inactivity_timeout'
  | 'spawn_failed'
  | 'stdin_error';

export class CodexExecError extends Error {
  readonly terminationReason: CodexExecTerminationReason;
  readonly stdoutLines: string[];
  readonly stderr: string;

  constructor(input: {
    message: string;
    terminationReason: CodexExecTerminationReason;
    stdoutLines: string[];
    stderr: string;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = 'CodexExecError';
    this.terminationReason = input.terminationReason;
    this.stdoutLines = input.stdoutLines;
    this.stderr = input.stderr;
  }
}

export type CodexExecProcess = {
  pid?: number;
  cancel(): void;
  result: Promise<RunCodexExecResult>;
};

export function startCodexExec(input: RunCodexExecInput): CodexExecProcess {
  let cancelRequested = false;
  let forceKillTimeout: NodeJS.Timeout | undefined;
  let cancelProcess = () => {
    cancelRequested = true;
  };

  const result = new Promise<RunCodexExecResult>((resolve, reject) => {
    const child = spawn(input.codexBin, input.args, {
      cwd: input.cwd,
      env: { ...process.env, CODEX_HOME: input.codexHome },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutLines: string[] = [];
    let stdoutBuffer = '';
    let stderr = '';
    let settled = false;
    let pendingError: CodexExecError | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let spawnTimeout: NodeJS.Timeout | undefined;
    let inactivityTimeout: NodeJS.Timeout | undefined;
    let sawActivity = false;

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (spawnTimeout) clearTimeout(spawnTimeout);
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      timeout = undefined;
      spawnTimeout = undefined;
      inactivityTimeout = undefined;
      forceKillTimeout = undefined;
    };

    const rejectOnce = (error: CodexExecError) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    const kill = (signal: NodeJS.Signals = 'SIGTERM') => {
      if (settled) return;
      child.kill(signal);
      if (forceKillTimeout === undefined) {
        forceKillTimeout = setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, input.forceKillGraceMs ?? 2_000);
      }
    };

    const killAndRejectOnClose = (error: CodexExecError) => {
      if (settled) return;
      pendingError = error;
      kill();
    };

    const resetInactivityTimer = () => {
      if (!input.inactivityTimeoutMs) return;
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => {
        killAndRejectOnClose(
          new CodexExecError({
            message: `Codex exec inactivity timeout after ${input.inactivityTimeoutMs}ms`,
            terminationReason: 'inactivity_timeout',
            stdoutLines,
            stderr
          })
        );
      }, input.inactivityTimeoutMs);
    };

    const markActivity = () => {
      sawActivity = true;
      if (spawnTimeout) {
        clearTimeout(spawnTimeout);
        spawnTimeout = undefined;
      }
      resetInactivityTimer();
    };

    if (input.timeoutMs) {
      timeout = setTimeout(() => {
        killAndRejectOnClose(
          new CodexExecError({
            message: `Codex exec timeout after ${input.timeoutMs}ms`,
            terminationReason: 'timeout',
            stdoutLines,
            stderr
          })
        );
      }, input.timeoutMs);
    }
    if (input.spawnTimeoutMs) {
      spawnTimeout = setTimeout(() => {
        if (sawActivity) return;
        killAndRejectOnClose(
          new CodexExecError({
            message: `Codex exec spawn timeout after ${input.spawnTimeoutMs}ms`,
            terminationReason: 'spawn_timeout',
            stdoutLines,
            stderr
          })
        );
      }, input.spawnTimeoutMs);
    }
    resetInactivityTimer();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      markActivity();
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        stdoutLines.push(line);
        input.onStdoutLine?.(line);
      }
    });

    child.stderr.on('data', (chunk: string) => {
      markActivity();
      stderr += chunk;
      input.onStderrChunk?.(chunk);
    });

    child.on('error', (error) => {
      rejectOnce(
        new CodexExecError({
          message: error.message,
          terminationReason: 'spawn_failed',
          stdoutLines,
          stderr,
          cause: error
        })
      );
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (stdoutBuffer.length > 0) {
        stdoutLines.push(stdoutBuffer);
        input.onStdoutLine?.(stdoutBuffer);
      }
      if (pendingError !== undefined) {
        reject(pendingError);
        return;
      }
      resolve({
        exitCode,
        signal,
        stdoutLines,
        stderr,
        terminationReason: cancelRequested ? 'canceled' : 'completed'
      });
    });

    child.stdin.on('error', (error) => {
      killAndRejectOnClose(
        new CodexExecError({
          message: error.message,
          terminationReason: 'stdin_error',
          stdoutLines,
          stderr,
          cause: error
        })
      );
    });

    child.stdin.end(input.prompt);

    cancelProcess = () => {
      if (settled) return;
      cancelRequested = true;
      kill();
    };
  });

  return {
    cancel: () => cancelProcess(),
    result
  };
}

export function runCodexExec(input: RunCodexExecInput): Promise<RunCodexExecResult> {
  return startCodexExec(input).result;
}
