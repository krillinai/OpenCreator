#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parse, stringify } from '@iarna/toml';

const args = process.argv.slice(2);
const stateDir = process.env.OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR;
const mode = process.env.OPENCREATOR_E2E_FAKE_CODEX_MODE ?? 'success';

if (stateDir !== undefined) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(
    join(stateDir, 'invocations.ndjson'),
    `${JSON.stringify({ pid: process.pid, args, codexHome: process.env.CODEX_HOME })}\n`
  );
}

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('codex-cli 0.149.0\n');
  process.exit(0);
}

if (args[0] === 'exec' && args.at(-1) === '--help') {
  process.stdout.write(
    args[1] === 'resume'
      ? 'Usage: codex exec resume [SESSION_ID] --json --last --model --config --cd --profile --sandbox --image\n'
      : 'Usage: codex exec [PROMPT] --json --profile --cd --sandbox --image --skip-git-repo-check\n'
  );
  process.exit(0);
}

if (args[0] === 'mcp' && args.at(-1) === '--help') {
  process.stdout.write(
    args[1] === 'add'
      ? 'Usage: codex mcp add --env --url --bearer-token-env-var --oauth-client-id --oauth-resource\n'
      : 'Commands:\n  list\n  get\n  add\n  remove\n  login\n  logout\n'
  );
  process.exit(0);
}

if (args[0] === 'mcp') {
  handleMcpCommand(args);
}

if (args[0] === 'app-server' && args.at(-1) === '--help') {
  process.stdout.write(
    'Run the app server\nUsage: codex app-server [OPTIONS]\n  --stdio\n  --disable <FEATURE>\n  generate-json-schema\n  generate-ts\n'
  );
  process.exit(0);
}

if (args.includes('app-server') && args.includes('--stdio')) {
  await handleAppServer();
  process.exit(0);
}

if (args[0] !== 'exec') {
  process.stderr.write(`Unsupported fake Codex invocation: ${args.join(' ')}\n`);
  process.exit(2);
}

const prompt = await readStdin();
const outputFlagIndex = args.indexOf('--output-last-message');
const isProbe = outputFlagIndex >= 0;

if (isProbe) {
  increment(join(requireStateDir(), 'probe-count.txt'));
  writeFileSync(join(requireStateDir(), 'probe-pid.txt'), String(process.pid));

  if (mode === 'probe-failure') {
    process.stderr.write('fake Codex probe failed by request\n');
    process.exit(17);
  }
  if (mode === 'probe-no-response') {
    process.exit(0);
  }
  if (mode === 'probe-tool-used') {
    process.stdout.write(`${JSON.stringify({
      type: 'item.completed',
      item: { type: 'command_execution', command: 'echo unsafe' }
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'unsafe response' }
    })}\n`);
    process.exit(0);
  }
  if (mode === 'probe-hang' || mode === 'probe-hang-ignore-term') {
    if (mode === 'probe-hang-ignore-term') {
      process.on('SIGTERM', () => undefined);
    }
    setInterval(() => undefined, 1_000);
    await new Promise(() => undefined);
  }

  const marker = prompt.match(/OPENCREATOR_READY_[a-f0-9]+/)?.[0];
  const response = marker === undefined
    ? 'hello from fake Codex'
    : `hello from fake Codex ${marker}`;
  const outputPath = args[outputFlagIndex + 1];
  if (outputPath !== undefined) writeFileSync(outputPath, response);
  process.stdout.write(`${JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: response }
  })}\n`);
  process.exit(0);
}

increment(join(requireStateDir(), 'run-count.txt'));
process.stdout.write(`${JSON.stringify({ type: 'turn.started' })}\n`);
process.stdout.write(`${JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: 'desktop e2e run completed' }
})}\n`);
process.stdout.write(`${JSON.stringify({ type: 'turn.completed' })}\n`);

function requireStateDir() {
  if (stateDir === undefined || stateDir.length === 0) {
    throw new Error('OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR is required');
  }
  return stateDir;
}

function increment(path) {
  const current = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
  writeFileSync(path, String(current + 1));
}

async function handleAppServer() {
  const input = createInterface({ input: process.stdin });
  let threadSequence = 0;
  let turnSequence = 0;
  let currentThreadId;
  let currentTurnId;

  const send = value => {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  };

  for await (const line of input) {
    if (line.trim().length === 0) continue;
    const message = JSON.parse(line);
    const params = isRecord(message.params) ? message.params : {};

    if (message.method === 'initialized') continue;

    if (message.method === 'initialize') {
      send({
        id: message.id,
        result: {
          userAgent: 'opencreator-desktop-e2e',
          codexHome: process.env.CODEX_HOME,
          platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
          platformOs: process.platform
        }
      });
      continue;
    }

    if (message.method === 'model/list') {
      send({ id: message.id, result: { data: [], nextCursor: null } });
      continue;
    }

    if (message.method === 'skills/extraRoots/set') {
      send({ id: message.id, result: {} });
      continue;
    }

    if (message.method === 'skills/list') {
      send({
        id: message.id,
        result: {
          data: [{
            cwd: process.cwd(),
            skills: [{
              name: 'opencreator-runtime',
              path: join(process.cwd(), 'opencreator-runtime', 'SKILL.md')
            }]
          }]
        }
      });
      continue;
    }

    if (message.method === 'account/read') {
      send({
        id: message.id,
        result: { account: null, requiresOpenaiAuth: true }
      });
      continue;
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
      continue;
    }

    if (message.method === 'thread/start' || message.method === 'thread/resume') {
      currentThreadId = typeof params.threadId === 'string'
        ? params.threadId
        : `desktop-e2e-thread-${++threadSequence}`;
      send({
        id: message.id,
        result: { thread: { id: currentThreadId } }
      });
      continue;
    }

    if (message.method === 'thread/read') {
      const threadId = typeof params.threadId === 'string'
        ? params.threadId
        : currentThreadId;
      send({
        id: message.id,
        result: { thread: { id: threadId, turns: [] } }
      });
      continue;
    }

    if (message.method === 'config/mcpServer/reload') {
      send({ id: message.id, result: {} });
      continue;
    }

    if (message.method === 'turn/start') {
      currentThreadId = typeof params.threadId === 'string'
        ? params.threadId
        : currentThreadId ?? `desktop-e2e-thread-${++threadSequence}`;
      currentTurnId = `desktop-e2e-turn-${++turnSequence}`;
      increment(join(requireStateDir(), 'run-count.txt'));
      send({
        id: message.id,
        result: { turn: { id: currentTurnId, status: 'inProgress' } }
      });
      send({
        method: 'turn/started',
        params: {
          threadId: currentThreadId,
          turn: { id: currentTurnId, status: 'inProgress' }
        }
      });
      send({
        method: 'item/completed',
        params: {
          threadId: currentThreadId,
          turnId: currentTurnId,
          item: {
            id: `desktop-e2e-item-${turnSequence}`,
            type: 'agentMessage',
            text: 'desktop e2e run completed'
          }
        }
      });
      send({
        method: 'turn/completed',
        params: {
          threadId: currentThreadId,
          turn: { id: currentTurnId, status: 'completed' }
        }
      });
      continue;
    }

    if (message.method === 'turn/steer') {
      send({ id: message.id, result: { turnId: currentTurnId } });
      continue;
    }

    if (message.method === 'turn/interrupt') {
      send({ id: message.id, result: {} });
      send({
        method: 'turn/completed',
        params: {
          threadId: currentThreadId,
          turn: { id: currentTurnId, status: 'interrupted' }
        }
      });
      continue;
    }

    if (message.id !== undefined) {
      send({
        id: message.id,
        error: {
          code: -32601,
          message: `Unsupported fake app-server method: ${message.method}`
        }
      });
    }
  }
}

function handleMcpCommand(commandArgs) {
  const operation = commandArgs[1];
  if (operation === 'list' && commandArgs.length === 3 && commandArgs[2] === '--json') {
    const config = readCodexConfig();
    const servers = Object.entries(readMcpServers(config))
      .filter(([, server]) => isRecord(server))
      .map(([name, server]) => serializeMcpServer(name, server));
    process.stdout.write(JSON.stringify(servers));
    process.exit(0);
  }

  if (
    operation === 'get'
    && commandArgs.length === 4
    && commandArgs[3] === '--json'
  ) {
    const name = commandArgs[2];
    const server = readMcpServers(readCodexConfig())[name];
    if (typeof name !== 'string' || !isRecord(server)) {
      failMcp(`MCP server not found: ${name ?? ''}`);
    }
    process.stdout.write(JSON.stringify(serializeMcpServer(name, server)));
    process.exit(0);
  }

  if (operation === 'add') {
    const input = parseMcpAdd(commandArgs);
    const config = readCodexConfig();
    const servers = ensureMcpServers(config);
    servers[input.name] = input.server;
    writeCodexConfig(config);
    process.stdout.write(`Added MCP server '${input.name}'.\n`);
    process.exit(0);
  }

  if (operation === 'remove' && commandArgs.length === 3) {
    const name = commandArgs[2];
    const config = readCodexConfig();
    const servers = readMcpServers(config);
    if (typeof name !== 'string' || !isRecord(servers[name])) {
      failMcp(`MCP server not found: ${name ?? ''}`);
    }
    delete servers[name];
    writeCodexConfig(config);
    process.stdout.write(`Removed MCP server '${name}'.\n`);
    process.exit(0);
  }

  if (
    (operation === 'login' || operation === 'logout')
    && commandArgs.length === 3
  ) {
    const name = commandArgs[2];
    if (typeof name !== 'string' || !isRecord(readMcpServers(readCodexConfig())[name])) {
      failMcp(`MCP server not found: ${name ?? ''}`);
    }
    process.exit(0);
  }

  failMcp(`Unsupported fake Codex invocation: ${commandArgs.join(' ')}`);
}

function parseMcpAdd(commandArgs) {
  const name = commandArgs[2];
  if (typeof name !== 'string' || name.length === 0) {
    failMcp('MCP server name is required');
  }

  const env = {};
  const server = {};
  let index = 3;
  while (index < commandArgs.length) {
    const arg = commandArgs[index];
    if (arg === '--env') {
      const assignment = commandArgs[index + 1];
      const separator = assignment?.indexOf('=') ?? -1;
      if (separator <= 0) failMcp('--env requires KEY=VALUE');
      env[assignment.slice(0, separator)] = assignment.slice(separator + 1);
      index += 2;
      continue;
    }
    if (arg === '--bearer-token-env-var') {
      server.bearer_token_env_var = requireMcpOptionValue(commandArgs, index);
      index += 2;
      continue;
    }
    if (arg === '--oauth-client-id') {
      server.oauth_client_id = requireMcpOptionValue(commandArgs, index);
      index += 2;
      continue;
    }
    if (arg === '--oauth-resource') {
      server.oauth_resource = requireMcpOptionValue(commandArgs, index);
      index += 2;
      continue;
    }
    if (arg === '--url') {
      server.url = requireMcpOptionValue(commandArgs, index);
      index += 2;
      continue;
    }
    if (arg === '--') {
      const command = commandArgs[index + 1];
      if (typeof command !== 'string' || command.length === 0) {
        failMcp('stdio MCP command is required after --');
      }
      server.command = command;
      server.args = commandArgs.slice(index + 2);
      index = commandArgs.length;
      continue;
    }
    failMcp(`Unsupported codex mcp add argument: ${arg ?? ''}`);
  }

  if (Object.keys(env).length > 0) server.env = env;
  if (typeof server.command !== 'string' && typeof server.url !== 'string') {
    failMcp('codex mcp add requires --url or a stdio command');
  }
  return { name, server };
}

function requireMcpOptionValue(commandArgs, index) {
  const value = commandArgs[index + 1];
  if (typeof value !== 'string' || value.length === 0) {
    failMcp(`${commandArgs[index]} requires a value`);
  }
  return value;
}

function serializeMcpServer(name, server) {
  const { enabled, ...transportConfig } = server;
  return {
    name,
    enabled: enabled !== false,
    transport: {
      type: typeof transportConfig.command === 'string'
        ? 'stdio'
        : typeof transportConfig.url === 'string'
          ? 'streamable_http'
          : 'unknown',
      ...transportConfig
    }
  };
}

function readCodexConfig() {
  const configPath = codexConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    const source = readFileSync(configPath, 'utf8');
    return source.trim().length === 0 ? {} : parse(source);
  } catch (error) {
    failMcp(`Unable to read Codex config: ${errorMessage(error)}`);
  }
}

function writeCodexConfig(config) {
  const codexHome = requireCodexHome();
  mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  writeFileSync(codexConfigPath(), stringify(config), { mode: 0o600 });
}

function readMcpServers(config) {
  return isRecord(config.mcp_servers) ? config.mcp_servers : {};
}

function ensureMcpServers(config) {
  if (!isRecord(config.mcp_servers)) config.mcp_servers = {};
  return config.mcp_servers;
}

function codexConfigPath() {
  return join(requireCodexHome(), 'config.toml');
}

function requireCodexHome() {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome === undefined || codexHome.length === 0) {
    failMcp('CODEX_HOME is required for fake Codex MCP commands');
  }
  return codexHome;
}

function failMcp(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
