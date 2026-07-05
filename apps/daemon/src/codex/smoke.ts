import { spawn, spawnSync } from 'node:child_process';

export type SmokeCommandResult = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type RealCodexSmokeTurn = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  threadId: string | null;
  agentMessages: string[];
  malformedLines: string[];
};

export type RealCodexResumeSmokeResult = {
  marker: string;
  first: RealCodexSmokeTurn;
  second: RealCodexSmokeTurn;
  resumeContextContinuityVerified: boolean;
};

export function runSmokeCommand(command: string[]): SmokeCommandResult {
  const [bin, ...args] = command;
  if (!bin) {
    throw new Error('empty command');
  }

  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 30000
  });

  return {
    command,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

async function runCodexJsonTurn(input: { args: string[]; prompt: string }): Promise<RealCodexSmokeTurn> {
  const child = spawn('codex', input.args, { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });
  child.stdin.end(input.prompt);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
  return parseSmokeTurn(['codex', ...input.args], exitCode, stdout, stderr);
}

function parseSmokeTurn(command: string[], exitCode: number | null, stdout: string, stderr: string): RealCodexSmokeTurn {
  let threadId: string | null = null;
  const agentMessages: string[] = [];
  const malformedLines: string[] = [];

  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: string; item?: { type?: string; text?: string } };
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
        agentMessages.push(event.item.text);
      }
    } catch {
      malformedLines.push(line);
    }
  }

  return { command, exitCode, stdout, stderr, threadId, agentMessages, malformedLines };
}

export async function runRealCodexResumeSmoke(input: { marker: string }): Promise<RealCodexResumeSmokeResult> {
  const first = await runCodexJsonTurn({
    args: ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', process.cwd()],
    prompt: `Automated Runtime ABI smoke. Do not run tools and do not modify files. Reply with exactly this marker and no extra commentary: ${input.marker}`
  });

  if (first.threadId === null) {
    return {
      marker: input.marker,
      first,
      second: { command: [], exitCode: null, stdout: '', stderr: '', threadId: null, agentMessages: [], malformedLines: [] },
      resumeContextContinuityVerified: false
    };
  }

  const second = await runCodexJsonTurn({
    args: ['exec', 'resume', first.threadId, '--json'],
    prompt:
      'Automated Runtime ABI smoke. In the previous turn I asked you to reply with a marker. Reply with exactly that marker and no extra commentary.'
  });

  return {
    marker: input.marker,
    first,
    second,
    resumeContextContinuityVerified:
      second.exitCode === 0 && second.agentMessages.some(message => message.includes(input.marker))
  };
}
