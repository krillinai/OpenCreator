import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FakeCodexOptions = {
  stdoutLines: unknown[];
  rawStdoutLines?: string[];
  stderrLines?: string[];
  exitCode?: number;
  delayMs?: number;
  initialDelayMs?: number;
  lineDelayMs?: number;
  hang?: boolean;
  ignoreSigterm?: boolean;
  invocations?: FakeCodexInvocation[];
};

export type FakeCodexInvocation = Omit<FakeCodexOptions, 'invocations'>;

export function createFakeCodex(dir: string, options: FakeCodexOptions) {
  const bin = join(dir, 'fake-codex.js');
  const promptPath = join(dir, 'prompt.txt');
  const promptsPath = join(dir, 'prompts.json');
  const codexHomePath = join(dir, 'codex-home.txt');
  const argvPath = join(dir, 'argv.json');
  const argvsPath = join(dir, 'argvs.json');
  const invocationCountPath = join(dir, 'invocation-count.txt');
  const agentToolEnvPath = join(dir, 'agent-tool-env.json');
  mkdirSync(dir, { recursive: true });

  const script = `#!/usr/bin/env node
const fs = require('fs');
const invocations = ${JSON.stringify(options.invocations ?? [withoutInvocations(options)])};
const invocationIndex = fs.existsSync(${JSON.stringify(invocationCountPath)})
  ? Number(fs.readFileSync(${JSON.stringify(invocationCountPath)}, 'utf8'))
  : 0;
const invocation = invocations[Math.min(invocationIndex, invocations.length - 1)];
fs.writeFileSync(${JSON.stringify(invocationCountPath)}, String(invocationIndex + 1));
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(promptPath)}, prompt);
const prompts = fs.existsSync(${JSON.stringify(promptsPath)})
  ? JSON.parse(fs.readFileSync(${JSON.stringify(promptsPath)}, 'utf8'))
  : [];
prompts.push(prompt);
fs.writeFileSync(${JSON.stringify(promptsPath)}, JSON.stringify(prompts));
fs.writeFileSync(${JSON.stringify(codexHomePath)}, process.env.CODEX_HOME ?? '');
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
const argvs = fs.existsSync(${JSON.stringify(argvsPath)})
  ? JSON.parse(fs.readFileSync(${JSON.stringify(argvsPath)}, 'utf8'))
  : [];
argvs.push(process.argv.slice(2));
fs.writeFileSync(${JSON.stringify(argvsPath)}, JSON.stringify(argvs));
fs.writeFileSync(${JSON.stringify(agentToolEnvPath)}, JSON.stringify({
  OPENCREATOR_AGENT_TOOL_URL: process.env.OPENCREATOR_AGENT_TOOL_URL,
  OPENCREATOR_AGENT_CAPABILITY_TOKEN: process.env.OPENCREATOR_AGENT_CAPABILITY_TOKEN,
  NO_PROXY: process.env.NO_PROXY,
  no_proxy: process.env.no_proxy
}));
const delayMs = invocation.delayMs ?? 0;
const initialDelayMs = invocation.initialDelayMs ?? 0;
const lineDelayMs = invocation.lineDelayMs ?? 0;
const ignoreSigterm = invocation.ignoreSigterm ?? false;
process.on('SIGTERM', () => {
  if (!ignoreSigterm) process.exit(0);
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  if (initialDelayMs > 0) await sleep(initialDelayMs);
  for (const line of invocation.stderrLines ?? []) {
    console.error(line);
    if (lineDelayMs > 0) await sleep(lineDelayMs);
  }
  for (const line of invocation.rawStdoutLines ?? []) {
    console.log(line);
    if (lineDelayMs > 0) await sleep(lineDelayMs);
  }
  for (const event of invocation.stdoutLines) {
    console.log(JSON.stringify(event));
    if (lineDelayMs > 0) await sleep(lineDelayMs);
  }
  if (invocation.hang ?? false) {
    setInterval(() => {}, 1000);
    return;
  }
  if (delayMs > 0) await sleep(delayMs);
  process.exit(invocation.exitCode ?? 0);
}
main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`;

  writeFileSync(bin, script);
  chmodSync(bin, 0o755);

  return {
    bin,
    readPrompt(): string {
      return readFileSync(promptPath, 'utf8');
    },
    readPrompts(): string[] {
      return JSON.parse(readFileSync(promptsPath, 'utf8')) as string[];
    },
    readCodexHome(): string {
      return readFileSync(codexHomePath, 'utf8');
    },
    readArgv(): string[] {
      return JSON.parse(readFileSync(argvPath, 'utf8')) as string[];
    },
    readArgvs(): string[][] {
      return JSON.parse(readFileSync(argvsPath, 'utf8')) as string[][];
    },
    readInvocationCount(): number {
      return Number(readFileSync(invocationCountPath, 'utf8'));
    },
    readAgentToolEnv(): {
      OPENCREATOR_AGENT_TOOL_URL?: string;
      OPENCREATOR_AGENT_CAPABILITY_TOKEN?: string;
      NO_PROXY?: string;
      no_proxy?: string;
    } {
      return JSON.parse(readFileSync(agentToolEnvPath, 'utf8')) as {
        OPENCREATOR_AGENT_TOOL_URL?: string;
        OPENCREATOR_AGENT_CAPABILITY_TOKEN?: string;
        NO_PROXY?: string;
        no_proxy?: string;
      };
    }
  };
}

function withoutInvocations(options: FakeCodexOptions): FakeCodexInvocation {
  const { invocations: _invocations, ...invocation } = options;
  return invocation;
}
