import {
  BoundedFrameBuffer,
  BoundedLineBuffer,
  BoundedTextBuffer,
  type BufferTruncation
} from './bounded-buffer.js';
import {
  spawnCodexProcess,
  terminateCodexProcess
} from './process.js';

const MAX_STDOUT_LINES = 10_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_STDOUT_FRAME_BYTES = 1024 * 1024;

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
  finalKillSettleMs?: number;
  env?: Record<string, string>;
  beforeSpawn?: () => Promise<void>;
  onStdoutLine?: (line: string) => Promise<void> | void;
  onStderrChunk?: (chunk: string) => Promise<void> | void;
};

export type RunCodexExecResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: string[];
  stderr: string;
  terminationReason: CodexExecTerminationReason;
  outputTruncation: {
    stdout: BufferTruncation;
    stderr: BufferTruncation;
    frames: BufferTruncation;
  };
};

export type CodexExecTerminationReason =
  | 'completed'
  | 'canceled'
  | 'timeout'
  | 'spawn_timeout'
  | 'inactivity_timeout'
  | 'spawn_failed'
  | 'stdin_error'
  | 'stream_handler_failed';

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
  if (input.beforeSpawn !== undefined) {
    let process: CodexExecProcess | undefined;
    let cancelRequested = false;
    return {
      cancel() {
        cancelRequested = true;
        process?.cancel();
      },
      result: input.beforeSpawn().then(() => {
        if (cancelRequested) {
          throw new CodexExecError({
            message: 'Codex exec canceled before spawn',
            terminationReason: 'canceled',
            stdoutLines: [],
            stderr: ''
          });
        }
        process = startCodexExec({ ...input, beforeSpawn: undefined });
        return process.result;
      })
    };
  }
  let cancelRequested = false;
  let forceKillTimeout: NodeJS.Timeout | undefined;
  let finalKillTimeout: NodeJS.Timeout | undefined;
  let cancelProcess = () => {
    cancelRequested = true;
  };

  const result = new Promise<RunCodexExecResult>((resolve, reject) => {
    const child = spawnCodexProcess(input.codexBin, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env, CODEX_HOME: input.codexHome },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutLines = new BoundedLineBuffer(
      MAX_STDOUT_LINES,
      MAX_STDOUT_BYTES
    );
    const stdoutFrames = new BoundedFrameBuffer(MAX_STDOUT_FRAME_BYTES);
    const stderr = new BoundedTextBuffer(MAX_STDERR_BYTES);
    let settled = false;
    let pendingError: CodexExecError | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let spawnTimeout: NodeJS.Timeout | undefined;
    let inactivityTimeout: NodeJS.Timeout | undefined;
    let sawActivity = false;
    let stdoutWork = Promise.resolve();
    let stderrWork = Promise.resolve();

    const snapshots = () => ({
      stdoutLines: stdoutLines.lines(),
      stderr: stderr.text()
    });

    const clearTimers = () => {
      if (timeout) clearTimeout(timeout);
      if (spawnTimeout) clearTimeout(spawnTimeout);
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      if (finalKillTimeout) clearTimeout(finalKillTimeout);
      timeout = undefined;
      spawnTimeout = undefined;
      inactivityTimeout = undefined;
      forceKillTimeout = undefined;
      finalKillTimeout = undefined;
    };

    const rejectOnce = (error: CodexExecError) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    const kill = (signal: NodeJS.Signals = 'SIGTERM') => {
      if (settled) return;
      void terminateCodexProcess(child, signal);
      if (forceKillTimeout === undefined) {
        forceKillTimeout = setTimeout(() => {
          if (settled) return;
          void terminateCodexProcess(child, 'SIGKILL').finally(() => {
            if (settled) return;
            finalKillTimeout = setTimeout(() => {
              if (settled) return;
              rejectOnce(pendingError ?? new CodexExecError({
                message: 'Codex exec did not exit after forced termination',
                terminationReason: cancelRequested ? 'canceled' : 'timeout',
                ...snapshots()
              }));
            }, input.finalKillSettleMs ?? 1_000);
          });
        }, input.forceKillGraceMs ?? 2_000);
      }
    };

    const killAndRejectOnClose = (error: CodexExecError) => {
      if (settled || pendingError !== undefined) return;
      pendingError = error;
      if (timeout) clearTimeout(timeout);
      if (spawnTimeout) clearTimeout(spawnTimeout);
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      timeout = undefined;
      spawnTimeout = undefined;
      inactivityTimeout = undefined;
      kill();
    };

    const resetInactivityTimer = () => {
      if (!input.inactivityTimeoutMs) return;
      if (inactivityTimeout) clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => {
        killAndRejectOnClose(new CodexExecError({
          message: `Codex exec inactivity timeout after ${input.inactivityTimeoutMs}ms`,
          terminationReason: 'inactivity_timeout',
          ...snapshots()
        }));
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
        killAndRejectOnClose(new CodexExecError({
          message: `Codex exec timeout after ${input.timeoutMs}ms`,
          terminationReason: 'timeout',
          ...snapshots()
        }));
      }, input.timeoutMs);
    }
    if (input.spawnTimeoutMs) {
      spawnTimeout = setTimeout(() => {
        if (sawActivity) return;
        killAndRejectOnClose(new CodexExecError({
          message: `Codex exec spawn timeout after ${input.spawnTimeoutMs}ms`,
          terminationReason: 'spawn_timeout',
          ...snapshots()
        }));
      }, input.spawnTimeoutMs);
    }
    resetInactivityTimer();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      markActivity();
      child.stdout.pause();
      stdoutWork = stdoutWork
        .then(async () => {
          for (const line of stdoutFrames.push(chunk)) {
            stdoutLines.append(line);
            await input.onStdoutLine?.(line);
          }
        })
        .catch(error => {
          killAndRejectOnClose(streamHandlerError(
            'stdout',
            error,
            snapshots()
          ));
        })
        .finally(() => {
          if (!settled && pendingError === undefined) child.stdout.resume();
        });
    });

    child.stderr.on('data', (chunk: string) => {
      markActivity();
      child.stderr.pause();
      stderrWork = stderrWork
        .then(async () => {
          stderr.append(chunk);
          await input.onStderrChunk?.(chunk);
        })
        .catch(error => {
          killAndRejectOnClose(streamHandlerError(
            'stderr',
            error,
            snapshots()
          ));
        })
        .finally(() => {
          if (!settled && pendingError === undefined) child.stderr.resume();
        });
    });

    child.on('error', error => {
      rejectOnce(new CodexExecError({
        message: error.message,
        terminationReason: 'spawn_failed',
        ...snapshots(),
        cause: error
      }));
    });

    child.on('close', (exitCode, signal) => {
      if (settled) return;
      clearTimers();
      void Promise.all([stdoutWork, stderrWork])
        .then(async () => {
          const finalFrame = stdoutFrames.flush();
          if (finalFrame !== undefined) {
            stdoutLines.append(finalFrame);
            await input.onStdoutLine?.(finalFrame);
          }
          settled = true;
          if (pendingError !== undefined) {
            reject(pendingError);
            return;
          }
          resolve({
            exitCode,
            signal,
            ...snapshots(),
            terminationReason: cancelRequested ? 'canceled' : 'completed',
            outputTruncation: {
              stdout: stdoutLines.truncation(),
              stderr: stderr.truncation(),
              frames: stdoutFrames.truncation()
            }
          });
        })
        .catch(error => {
          settled = true;
          reject(streamHandlerError('stdout', error, snapshots()));
        });
    });

    child.stdin.on('error', error => {
      killAndRejectOnClose(new CodexExecError({
        message: error.message,
        terminationReason: 'stdin_error',
        ...snapshots(),
        cause: error
      }));
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

function streamHandlerError(
  stream: 'stdout' | 'stderr',
  error: unknown,
  snapshots: {
    stdoutLines: string[];
    stderr: string;
  }
): CodexExecError {
  const message = error instanceof Error ? error.message : String(error);
  return new CodexExecError({
    message: `Codex ${stream} handler failed: ${message}`,
    terminationReason: 'stream_handler_failed',
    ...snapshots,
    cause: error
  });
}

export function runCodexExec(
  input: RunCodexExecInput
): Promise<RunCodexExecResult> {
  return startCodexExec(input).result;
}
