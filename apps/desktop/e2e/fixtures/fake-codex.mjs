#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const stateDir = process.env.CLAWEE_E2E_FAKE_CODEX_STATE_DIR;
const mode = process.env.CLAWEE_E2E_FAKE_CODEX_MODE ?? 'success';

if (stateDir !== undefined) {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(
    join(stateDir, 'invocations.ndjson'),
    `${JSON.stringify({ pid: process.pid, args, codexHome: process.env.CODEX_HOME })}\n`
  );
}

if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('codex-cli 0.0.0-clawee-e2e\n');
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

if (args[0] === 'app-server' && args.at(-1) === '--help') {
  process.stderr.write('app-server is intentionally unavailable in this fixture\n');
  process.exit(2);
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

  const marker = prompt.match(/CLAWEE_READY_[a-f0-9]+/)?.[0];
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
    throw new Error('CLAWEE_E2E_FAKE_CODEX_STATE_DIR is required');
  }
  return stateDir;
}

function increment(path) {
  const current = existsSync(path) ? Number(readFileSync(path, 'utf8')) : 0;
  writeFileSync(path, String(current + 1));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
