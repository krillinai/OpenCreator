import type { spawnSync } from 'node:child_process';
import { spawnCodexProcessSync } from '../process.js';
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
  const result = spawnCodexProcessSync(input.codexBin, input.args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    // Codex CLI expects the daemon environment (PATH/HOME/SHELL); env is not recorded, and argv/output are redacted.
    env: { ...process.env, CODEX_HOME: input.codexHome },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  let diagnosticStderr = stderr;
  const errorMessage = result.error?.message ?? null;
  const timedOut = isTimedOut(result, errorMessage);

  if (timedOut) {
    diagnosticStderr = appendDiagnostic(diagnosticStderr, `[codex-mcp] timed out after ${timeoutMs}ms`);
  } else if (errorMessage !== null) {
    diagnosticStderr = appendDiagnostic(diagnosticStderr, `[codex-mcp] process error: ${errorMessage}`);
  }

  if (result.signal !== null && result.signal !== undefined) {
    diagnosticStderr = appendDiagnostic(diagnosticStderr, `[codex-mcp] termination signal: ${result.signal}`);
  }

  const sensitiveValues = input.sensitiveValues ?? [];
  return {
    command: input.args,
    redactedCommand: redactMcpArgv(input.args),
    exitCode: timedOut ? null : result.status,
    stdout,
    stderr,
    redactedStdout: redactMcpText(stdout, sensitiveValues),
    redactedStderr: redactMcpText(diagnosticStderr, sensitiveValues),
    timedOut,
    errorMessage
  };
}

function isTimedOut(result: ReturnType<typeof spawnSync>, errorMessage: string | null): boolean {
  return (
    getErrorCode(result.error) === 'ETIMEDOUT' ||
    (errorMessage !== null && /ETIMEDOUT|timed out/i.test(errorMessage))
  );
}

function getErrorCode(error: Error | null | undefined): string | undefined {
  if (error == null || !('code' in error) || typeof error.code !== 'string') {
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
