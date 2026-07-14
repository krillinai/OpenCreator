#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);

if (handleCapabilityProbe(args)) {
  process.exit(0);
}

if (!args.includes('app-server') || !args.includes('--stdio')) {
  process.stderr.write(`Unsupported fake Codex invocation: ${args.join(' ')}\n`);
  process.exit(2);
}

const configPath = requireEnvironment('CLAWEE_E2E_FAKE_CODEX_CONFIG');
const stateDir = requireEnvironment('CLAWEE_E2E_FAKE_CODEX_STATE_DIR');
mkdirSync(stateDir, { recursive: true });

const invocationCountPath = resolve(stateDir, 'invocation-count.txt');
const messagesPath = resolve(stateDir, 'messages.ndjson');
const invocationIndex = existsSync(invocationCountPath)
  ? Number(readFileSync(invocationCountPath, 'utf8'))
  : 0;
writeFileSync(invocationCountPath, String(invocationIndex + 1));

const config = readConfig(configPath);
const invocations = Array.isArray(config.invocations) ? config.invocations : [];
const invocation = invocations[Math.min(invocationIndex, Math.max(0, invocations.length - 1))] ?? {};
const readline = createInterface({ input: process.stdin });
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let threadId = invocation.threadId ?? `codex-e2e-thread-${invocationIndex + 1}`;
let turnId = `turn-e2e-${invocationIndex + 1}`;
let approvalRequestId;
let turnFinished = false;

readline.on('line', line => {
  const message = JSON.parse(line);
  appendFileSync(messagesPath, `${JSON.stringify({ invocationIndex, message })}\n`);

  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        userAgent: 'clawee-e2e',
        codexHome: process.env.CODEX_HOME,
        platformFamily: 'unix',
        platformOs: 'test'
      }
    });
    return;
  }

  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }

  if (message.method === 'thread/resume') {
    threadId = message.params?.threadId ?? threadId;
    send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }

  if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    send({
      method: 'turn/started',
      params: {
        threadId,
        turn: { id: turnId, status: 'inProgress' }
      }
    });
    void beginInvocation(message);
    return;
  }

  if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} });
    finishTurn('interrupted');
    return;
  }

  if (approvalRequestId !== undefined && message.id === approvalRequestId) {
    void finishApproval(message);
  }
});

async function beginInvocation(message) {
  await sleep(invocation.initialDelayMs);
  if (invocation.agentSchedule !== undefined) {
    await createAgentSchedule(invocation.agentSchedule);
  }
  writeWorkspaceFiles(invocation.files);

  if (invocation.approval === true) {
    const command = invocation.command ?? 'node protected-task.mjs';
    const itemId = `item-approval-${invocationIndex + 1}`;
    send({
      method: 'item/started',
      params: {
        threadId,
        turnId,
        item: {
          type: 'commandExecution',
          id: itemId,
          command,
          cwd: process.cwd(),
          status: 'inProgress',
          commandActions: []
        }
      }
    });
    approvalRequestId = `approval-rpc-${invocationIndex + 1}`;
    send({
      id: approvalRequestId,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId,
        turnId,
        itemId,
        startedAtMs: Date.now(),
        command,
        cwd: process.cwd(),
        reason: 'e2e protected operation'
      }
    });
    return;
  }

  await finishNormalInvocation(message);
}

async function finishNormalInvocation(message) {
  const prompt = message.params?.input?.find?.(item => item?.type === 'text')?.text;
  appendFileSync(
    resolve(stateDir, 'prompts.ndjson'),
    `${JSON.stringify({ invocationIndex, prompt })}\n`
  );
  if (typeof invocation.message === 'string') {
    sendAgentMessage(invocation.message);
  }
  await sleep(invocation.completionDelayMs);
  finishTurn(invocation.turnStatus ?? 'completed');
}

async function finishApproval(message) {
  const accepted = message.result?.decision === 'accept';
  const itemId = `item-approval-${invocationIndex + 1}`;
  send({
    method: 'serverRequest/resolved',
    params: { threadId, requestId: approvalRequestId }
  });
  send({
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      item: {
        type: 'commandExecution',
        id: itemId,
        command: invocation.command ?? 'node protected-task.mjs',
        cwd: process.cwd(),
        status: accepted ? 'completed' : 'declined',
        commandActions: [],
        aggregatedOutput: accepted ? 'approved by e2e' : '',
        exitCode: accepted ? 0 : null
      }
    }
  });
  if (accepted && typeof invocation.message === 'string') {
    sendAgentMessage(invocation.message);
  }
  await sleep(invocation.completionDelayMs);
  finishTurn('completed');
}

function sendAgentMessage(text) {
  send({
    method: 'item/completed',
    params: {
      threadId,
      turnId,
      item: {
        type: 'agentMessage',
        id: `item-message-${invocationIndex + 1}`,
        text
      }
    }
  });
}

function finishTurn(status) {
  if (turnFinished) return;
  turnFinished = true;
  send({
    method: 'turn/completed',
    params: {
      threadId,
      turn: { id: turnId, status }
    }
  });
}

async function createAgentSchedule(schedule) {
  const baseUrl = requireEnvironment('CLAWEE_AGENT_TOOL_URL').replace(/\/+$/, '');
  const token = requireEnvironment('CLAWEE_AGENT_CAPABILITY_TOKEN');
  const response = await fetch(`${baseUrl}/internal/agent-tools/schedules`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(schedule)
  });
  if (!response.ok) {
    throw new Error(`Agent schedule creation failed: ${response.status} ${await response.text()}`);
  }
}

function writeWorkspaceFiles(files) {
  if (files === undefined || files === null || typeof files !== 'object') return;
  const root = resolve(process.cwd());
  for (const [relativePath, content] of Object.entries(files)) {
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}/`)) {
      throw new Error(`Refusing to write outside workspace: ${relativePath}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, String(content));
  }
}

function readConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sleep(value) {
  const delay = Number(value ?? 0);
  return delay <= 0
    ? Promise.resolve()
    : new Promise(resolveSleep => setTimeout(resolveSleep, delay));
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function handleCapabilityProbe(probeArgs) {
  if (probeArgs.length === 1 && probeArgs[0] === '--version') {
    process.stdout.write('codex-cli 0.0.0-e2e\n');
    return true;
  }
  if (probeArgs[0] === 'exec' && probeArgs.at(-1) === '--help') {
    process.stdout.write(probeArgs[1] === 'resume'
      ? 'Usage: codex exec resume [SESSION_ID] --json --last --model --config --cd --profile --sandbox --image\n'
      : 'Usage: codex exec [PROMPT] --json --profile --cd --sandbox --image --skip-git-repo-check\n');
    return true;
  }
  if (probeArgs[0] === 'mcp' && probeArgs.at(-1) === '--help') {
    process.stdout.write('Commands:\n  list\n  get\n  add\n  remove\n  login\n  logout\n');
    return true;
  }
  if (probeArgs[0] === 'app-server' && probeArgs.at(-1) === '--help') {
    process.stdout.write('Run the app server\ngenerate-json-schema\ngenerate-ts\n');
    return true;
  }
  return false;
}
