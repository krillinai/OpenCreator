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
};

export function createFakeCodex(dir: string, options: FakeCodexOptions) {
  const bin = join(dir, 'fake-codex.js');
  const promptPath = join(dir, 'prompt.txt');
  const codexHomePath = join(dir, 'codex-home.txt');
  const argvPath = join(dir, 'argv.json');
  mkdirSync(dir, { recursive: true });

  const script = `#!/usr/bin/env node
const fs = require('fs');
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(promptPath)}, prompt);
fs.writeFileSync(${JSON.stringify(codexHomePath)}, process.env.CODEX_HOME ?? '');
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
const delayMs = ${JSON.stringify(options.delayMs ?? 0)};
const initialDelayMs = ${JSON.stringify(options.initialDelayMs ?? 0)};
const lineDelayMs = ${JSON.stringify(options.lineDelayMs ?? 0)};
const ignoreSigterm = ${JSON.stringify(options.ignoreSigterm ?? false)};
process.on('SIGTERM', () => {
  if (!ignoreSigterm) process.exit(0);
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  if (initialDelayMs > 0) await sleep(initialDelayMs);
  for (const line of ${JSON.stringify(options.stderrLines ?? [])}) {
    console.error(line);
    if (lineDelayMs > 0) await sleep(lineDelayMs);
  }
  for (const line of ${JSON.stringify(options.rawStdoutLines ?? [])}) {
    console.log(line);
    if (lineDelayMs > 0) await sleep(lineDelayMs);
  }
  for (const event of ${JSON.stringify(options.stdoutLines)}) {
    console.log(JSON.stringify(event));
    if (lineDelayMs > 0) await sleep(lineDelayMs);
  }
  if (${JSON.stringify(options.hang ?? false)}) {
    setInterval(() => {}, 1000);
    return;
  }
  if (delayMs > 0) await sleep(delayMs);
  process.exit(${options.exitCode ?? 0});
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
    readCodexHome(): string {
      return readFileSync(codexHomePath, 'utf8');
    },
    readArgv(): string[] {
      return JSON.parse(readFileSync(argvPath, 'utf8')) as string[];
    }
  };
}
