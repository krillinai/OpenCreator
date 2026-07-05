import { spawn, spawnSync } from 'node:child_process';

export type SmokeCommandResult = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  terminationSignal: NodeJS.Signals | null;
  errorMessage: string | null;
};

export type SmokeCommandOptions = {
  timeoutMs?: number;
};

export type RealCodexSmokeTurn = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  threadId: string | null;
  agentMessages: string[];
  eventTypes: string[];
  toolEvents: string[];
  malformedLines: string[];
  timedOut: boolean;
  terminationSignal: string | null;
};

export type RealCodexResumeSmokeResult = {
  marker: string;
  first: RealCodexSmokeTurn;
  second: RealCodexSmokeTurn;
  resumeContextContinuityVerified: boolean;
};

const CODEX_JSON_TURN_TIMEOUT_MS = 110_000;
const REAL_CODEX_RESUME_TURN_TIMEOUT_MS = CODEX_JSON_TURN_TIMEOUT_MS;
const CODEX_JSON_TURN_KILL_GRACE_MS = 2_000;
const TOOL_EVENT_PATTERN = /(^|[._-])(command|tool|mcp|function_call|web_search|shell|patch)([._-]|$)/i;

export function runSmokeCommand(command: string[], options: SmokeCommandOptions = {}): SmokeCommandResult {
  const [bin, ...args] = command;
  if (!bin) {
    throw new Error('empty command');
  }
  const timeoutMs = options.timeoutMs ?? 30_000;

  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: timeoutMs
  });
  const errorMessage = result.error?.message ?? null;
  const timedOut = errorMessage !== null && /\bETIMEDOUT\b/.test(errorMessage);
  const diagnostic = [
    timedOut ? formatSmokeDiagnostic(`timed out after ${timeoutMs}ms`) : '',
    errorMessage !== null ? formatSmokeDiagnostic(`process error: ${errorMessage}`) : '',
    result.signal !== null ? formatSmokeDiagnostic(`termination signal: ${result.signal}`) : ''
  ].join('');

  return {
    command,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${diagnostic}`,
    timedOut,
    terminationSignal: result.signal,
    errorMessage
  };
}

async function runCodexJsonTurn(input: { args: string[]; prompt: string; timeoutMs?: number }): Promise<RealCodexSmokeTurn> {
  const child = spawn('codex', input.args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  const timeoutMs = input.timeoutMs ?? CODEX_JSON_TURN_TIMEOUT_MS;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let terminationSignal: string | null = null;
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  child.stdin.on('error', error => {
    stderr += formatSmokeDiagnostic(`stdin error: ${error.message}`);
  });

  const exitCode = await new Promise<number | null>(resolve => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      if (forceKillTimeout !== undefined) clearTimeout(forceKillTimeout);
    };

    const finishOnce = (code: number | null, signal: string | null) => {
      if (settled) return;
      settled = true;
      terminationSignal = signal;
      clearTimers();
      resolve(code);
    };

    child.once('error', error => {
      stderr += formatSmokeDiagnostic(`process error: ${error.message}`);
      finishOnce(null, null);
    });

    child.once('close', (code, signal) => {
      finishOnce(code, signal);
    });

    timeout = setTimeout(() => {
      timedOut = true;
      stderr += formatSmokeDiagnostic(`timed out after ${timeoutMs}ms; sent SIGTERM`);
      child.kill('SIGTERM');
      forceKillTimeout = setTimeout(() => {
        stderr += formatSmokeDiagnostic(`did not exit after SIGTERM grace ${CODEX_JSON_TURN_KILL_GRACE_MS}ms; sent SIGKILL`);
        child.kill('SIGKILL');
      }, CODEX_JSON_TURN_KILL_GRACE_MS);
    }, timeoutMs);

    try {
      child.stdin.end(input.prompt);
    } catch (error) {
      stderr += formatSmokeDiagnostic(`stdin end error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return parseSmokeTurn(['codex', ...input.args], exitCode, stdout, stderr, { timedOut, terminationSignal });
}

function parseSmokeTurn(
  command: string[],
  exitCode: number | null,
  stdout: string,
  stderr: string,
  processResult: { timedOut: boolean; terminationSignal: string | null } = { timedOut: false, terminationSignal: null }
): RealCodexSmokeTurn {
  let threadId: string | null = null;
  const agentMessages: string[] = [];
  const eventTypes: string[] = [];
  const toolEvents: string[] = [];
  const malformedLines: string[] = [];

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } };
      const eventType = typeof event.type === 'string' ? event.type : undefined;
      const itemType = typeof event.item?.type === 'string' ? event.item.type : undefined;
      if (eventType !== undefined) eventTypes.push(eventType);
      if (isToolOrCommandEvent(eventType) || isToolOrCommandEvent(itemType)) {
        toolEvents.push([eventType, itemType].filter(Boolean).join(':'));
      }
      if (eventType === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
      if (eventType === 'item.completed' && itemType === 'agent_message' && typeof event.item?.text === 'string') {
        agentMessages.push(event.item.text);
      }
    } catch {
      malformedLines.push(line);
    }
  }

  return { command, exitCode, stdout, stderr, threadId, agentMessages, eventTypes, toolEvents, malformedLines, ...processResult };
}

export async function runRealCodexResumeSmoke(input: { marker: string }): Promise<RealCodexResumeSmokeResult> {
  const first = await runCodexJsonTurn({
    args: ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', process.cwd()],
    prompt: `Automated Runtime ABI smoke. Do not run tools and do not modify files. Reply with exactly this marker and no extra commentary: ${input.marker}`,
    timeoutMs: REAL_CODEX_RESUME_TURN_TIMEOUT_MS
  });

  if (first.threadId === null) {
    return {
      marker: input.marker,
      first,
      second: emptySmokeTurn(),
      resumeContextContinuityVerified: false
    };
  }

  const second = await runCodexJsonTurn({
    args: ['exec', 'resume', first.threadId, '--json'],
    prompt:
      'Automated Runtime ABI smoke. Do not run tools and do not modify files. In the previous turn I asked you to reply with a marker. Reply with exactly that marker and no extra commentary.',
    timeoutMs: REAL_CODEX_RESUME_TURN_TIMEOUT_MS
  });

  return {
    marker: input.marker,
    first,
    second,
    resumeContextContinuityVerified:
      second.exitCode === 0 && second.agentMessages.some(message => message.includes(input.marker))
  };
}

function emptySmokeTurn(): RealCodexSmokeTurn {
  return {
    command: [],
    exitCode: null,
    stdout: '',
    stderr: '',
    threadId: null,
    agentMessages: [],
    eventTypes: [],
    toolEvents: [],
    malformedLines: [],
    timedOut: false,
    terminationSignal: null
  };
}

function isToolOrCommandEvent(value: string | undefined): boolean {
  return value !== undefined && TOOL_EVENT_PATTERN.test(value);
}

function formatSmokeDiagnostic(message: string): string {
  return `\n[real-codex-smoke] ${message}`;
}
