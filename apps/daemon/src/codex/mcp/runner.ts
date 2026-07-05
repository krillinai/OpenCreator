import { spawnSync } from 'node:child_process';
import { redactMcpArgv, redactMcpText } from './redaction.js';

export type McpCommandResult = {
  command: string[];
  redactedCommand: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  redactedStdout: string;
  redactedStderr: string;
  timedOut: boolean;
  errorMessage: string | null;
};

export type RunMcpCommandInput = {
  codexBin: string;
  codexHome: string;
  args: string[];
  timeoutMs?: number;
  sensitiveValues?: string[];
};

export function runMcpCommand(input: RunMcpCommandInput): McpCommandResult {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const result = spawnSync(input.codexBin, input.args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, CODEX_HOME: input.codexHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdout = result.stdout ?? '';
  let stderr = result.stderr ?? '';
  const errorMessage = result.error?.message ?? null;
  const timedOut = isTimedOut(result, errorMessage);

  if (timedOut) {
    stderr = appendDiagnostic(stderr, `[codex-mcp] timed out after ${timeoutMs}ms`);
  } else if (errorMessage !== null) {
    stderr = appendDiagnostic(stderr, `[codex-mcp] process error: ${errorMessage}`);
  }

  if (result.signal !== null && result.signal !== undefined) {
    stderr = appendDiagnostic(stderr, `[codex-mcp] termination signal: ${result.signal}`);
  }

  const sensitiveValues = input.sensitiveValues ?? [];
  return {
    command: input.args,
    redactedCommand: redactMcpArgv(input.args),
    exitCode: timedOut ? null : result.status,
    stdout,
    stderr,
    redactedStdout: redactMcpText(stdout, sensitiveValues),
    redactedStderr: redactMcpText(stderr, sensitiveValues),
    timedOut,
    errorMessage
  };
}

function isTimedOut(result: ReturnType<typeof spawnSync>, errorMessage: string | null): boolean {
  return (
    errorMessage?.includes('ETIMEDOUT') === true ||
    getErrorCode(result.error) === 'ETIMEDOUT' ||
    (result.signal === 'SIGTERM' && result.status === null)
  );
}

function getErrorCode(error: Error | undefined): string | undefined {
  if (error === undefined || !('code' in error) || typeof error.code !== 'string') {
    return undefined;
  }
  return error.code;
}

function appendDiagnostic(stderr: string, diagnostic: string): string {
  if (stderr.length === 0) {
    return `${diagnostic}\n`;
  }
  return stderr.endsWith('\n') ? `${stderr}${diagnostic}\n` : `${stderr}\n${diagnostic}\n`;
}
