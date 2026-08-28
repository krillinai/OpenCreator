#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);

if (handleCapabilityProbe(args)) {
  process.exit(0);
}

if (!args.includes('app-server') || !args.includes('--stdio')) {
  process.stderr.write(`Unsupported fake Codex invocation: ${args.join(' ')}\n`);
  process.exit(2);
}

const configPath = requireEnvironment('OPENCREATOR_E2E_FAKE_CODEX_CONFIG');
const stateDir = requireEnvironment('OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR');
mkdirSync(stateDir, { recursive: true });
appendFileSync(resolve(stateDir, 'app-server-pids.txt'), `${process.pid}\n`);

const invocationCountPath = resolve(stateDir, 'invocation-count.txt');
const messagesPath = resolve(stateDir, 'messages.ndjson');
const readline = createInterface({ input: process.stdin });
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let invocationIndex;
let invocation = {};
let threadId = 'codex-e2e-session-provider';
let turnId = 'turn-e2e-session-provider';
let approvalRequestId;
let turnFinished = false;
let turnStartedAt = 0;
let currentPrompt;
let currentAgentMessage;

readline.on('line', line => {
  const message = JSON.parse(line);
  appendFileSync(messagesPath, `${JSON.stringify({
    invocationIndex: invocationIndex ?? null,
    message
  })}\n`);

  if (message.method === 'initialize') {
    send({
      id: message.id,
      result: {
        userAgent: 'opencreator-e2e',
        codexHome: process.env.CODEX_HOME,
        platformFamily: 'unix',
        platformOs: 'test'
      }
    });
    return;
  }

  if (message.method === 'thread/list') {
    const config = readConfig(configPath);
    send({
      id: message.id,
      result: {
        data: Array.isArray(config.threads) ? config.threads : [],
        nextCursor: null
      }
    });
    return;
  }

  if (message.method === 'model/list') {
    send({
      id: message.id,
      result: {
        data: [],
        nextCursor: null
      }
    });
    return;
  }

  if (message.method === 'config/read') {
    send({
      id: message.id,
      result: {
        config: {
          model: 'gpt-5',
          openai_base_url: ''
        },
        layers: []
      }
    });
    return;
  }

  if (message.method === 'account/read') {
    send({
      id: message.id,
      result: {
        account: null,
        requiresOpenaiAuth: true
      }
    });
    return;
  }

  if (message.method === 'thread/turns/list') {
    const turns = readTurns(message.params?.threadId);
    const limit = Number(message.params?.limit ?? turns.length);
    send({
      id: message.id,
      result: {
        data: turns.slice(-limit).reverse(),
        nextCursor: null,
        backwardsCursor: null
      }
    });
    return;
  }

  if (message.method === 'thread/read') {
    const requestedThreadId = message.params?.threadId ?? threadId;
    send({
      id: message.id,
      result: {
        thread: {
          id: requestedThreadId,
          turns: message.params?.includeTurns === true
            ? readTurns(requestedThreadId)
            : []
        }
      }
    });
    return;
  }

  if (message.method === 'thread/search') {
    const config = readConfig(configPath);
    const searchTerm = String(message.params?.searchTerm ?? '').toLocaleLowerCase();
    const configured = Array.isArray(config.searchResults)
      ? config.searchResults
      : [];
    send({
      id: message.id,
      result: {
        data: configured.filter(result => (
          searchTerm.length === 0
          || String(result.snippet ?? '').toLocaleLowerCase().includes(searchTerm)
          || String(result.thread?.name ?? '').toLocaleLowerCase().includes(searchTerm)
          || String(result.thread?.preview ?? '').toLocaleLowerCase().includes(searchTerm)
        )),
        nextCursor: null,
        backwardsCursor: null
      }
    });
    return;
  }

  if (message.method === 'thread/start') {
    ensureInvocation();
    send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }

  if (message.method === 'config/mcpServer/reload') {
    send({ id: message.id, result: {} });
    return;
  }

  if (message.method === 'thread/resume') {
    ensureInvocation();
    threadId = message.params?.threadId ?? threadId;
    send({ id: message.id, result: { thread: { id: threadId } } });
    return;
  }

  if (message.method === 'turn/start') {
    prepareInvocationForTurn(message.params?.threadId);
    turnStartedAt = Date.now();
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
  currentPrompt = message.params?.input?.find?.(item => item?.type === 'text')?.text;
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
  currentAgentMessage = text;
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
  persistTurn(status);
  send({
    method: 'turn/completed',
    params: {
      threadId,
      turn: { id: turnId, status }
    }
  });
}

function persistTurn(status) {
  if (typeof currentPrompt !== 'string' || currentPrompt.trim().length === 0) return;
  const turns = readTurns(threadId);
  const items = [{
    type: 'userMessage',
    id: `user-${turnId}`,
    clientId: null,
    content: [{ type: 'text', text: currentPrompt, text_elements: [] }]
  }];
  if (typeof currentAgentMessage === 'string') {
    items.push({
      type: 'agentMessage',
      id: `assistant-${turnId}`,
      text: currentAgentMessage,
      phase: 'final_answer',
      memoryCitation: null
    });
  }
  turns.push({
    id: turnId,
    status: status === 'interrupted'
      ? 'interrupted'
      : status === 'failed'
        ? 'failed'
        : 'completed',
    startedAt: Math.floor((turnStartedAt || Date.now()) / 1_000),
    completedAt: Math.floor(Date.now() / 1_000),
    itemsView: 'summary',
    items,
    error: status === 'failed' ? { message: 'failed' } : null,
    durationMs: Math.max(0, Date.now() - turnStartedAt)
  });
  writeFileSync(turnsPath(threadId), JSON.stringify(turns));
}

function readTurns(targetThreadId) {
  if (typeof targetThreadId !== 'string' || targetThreadId.length === 0) return [];
  const path = turnsPath(targetThreadId);
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(value) ? value : [];
}

function turnsPath(targetThreadId) {
  return resolve(
    stateDir,
    `turns-${Buffer.from(targetThreadId, 'utf8').toString('base64url')}.json`
  );
}

async function createAgentSchedule(schedule) {
  const baseUrl = readAgentToolBaseUrl();
  const token = requireEnvironment('OPENCREATOR_AGENT_CAPABILITY_TOKEN');
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

function readAgentToolBaseUrl() {
  const legacyBaseUrl = process.env.OPENCREATOR_AGENT_TOOL_URL;
  if (typeof legacyBaseUrl === 'string' && legacyBaseUrl.length > 0) {
    return legacyBaseUrl.replace(/\/+$/, '');
  }

  const mcpUrl = readCodexConfigValue('mcp_servers.opencreator_schedule.url');
  const route = '/internal/agent-tools/mcp';
  const parsed = new URL(mcpUrl);
  if (!parsed.pathname.endsWith(route)) {
    throw new Error(`Unexpected OpenCreator schedule MCP URL: ${mcpUrl}`);
  }
  parsed.pathname = parsed.pathname.slice(0, -route.length) || '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

function readCodexConfigValue(key) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] !== '-c') continue;
    const config = args[index + 1];
    const prefix = `${key}=`;
    if (!config.startsWith(prefix)) continue;
    const value = config.slice(prefix.length);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  throw new Error(`Missing Codex config value: ${key}`);
}

function writeWorkspaceFiles(files) {
  if (files === undefined || files === null || typeof files !== 'object') return;
  const root = resolve(process.cwd());
  for (const [relativePath, content] of Object.entries(files)) {
    const target = resolve(root, relativePath);
    const workspaceRelativePath = relative(root, target);
    if (workspaceRelativePath.startsWith('..') || isAbsolute(workspaceRelativePath)) {
      throw new Error(`Refusing to write outside workspace: ${relativePath}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, String(content));
  }
}

function readConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function prepareInvocationForTurn(targetThreadId) {
  if (invocationIndex !== undefined && turnFinished) {
    invocationIndex = undefined;
    invocation = {};
    approvalRequestId = undefined;
    turnStartedAt = 0;
    currentPrompt = undefined;
    currentAgentMessage = undefined;
  }
  ensureInvocation(targetThreadId);
}

function ensureInvocation(targetThreadId) {
  if (invocationIndex !== undefined) return;
  invocationIndex = existsSync(invocationCountPath)
    ? Number(readFileSync(invocationCountPath, 'utf8'))
    : 0;
  writeFileSync(invocationCountPath, String(invocationIndex + 1));
  const config = readConfig(configPath);
  const invocations = Array.isArray(config.invocations) ? config.invocations : [];
  invocation = invocations[
    Math.min(invocationIndex, Math.max(0, invocations.length - 1))
  ] ?? {};
  threadId = invocation.threadId
    ?? targetThreadId
    ?? `codex-e2e-thread-${invocationIndex + 1}`;
  turnId = `turn-e2e-${invocationIndex + 1}`;
  turnFinished = false;
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
