import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FakeCodexOptions = {
  stdoutLines: unknown[];
  stderrLines?: string[];
  exitCode?: number;
};

export function createFakeCodex(dir: string, options: FakeCodexOptions) {
  const bin = join(dir, 'fake-codex.js');
  const promptPath = join(dir, 'prompt.txt');
  const codexHomePath = join(dir, 'codex-home.txt');
  mkdirSync(dir, { recursive: true });

  const script = `#!/usr/bin/env node
const fs = require('fs');
const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(promptPath)}, prompt);
fs.writeFileSync(${JSON.stringify(codexHomePath)}, process.env.CODEX_HOME ?? '');
for (const line of ${JSON.stringify(options.stderrLines ?? [])}) console.error(line);
for (const event of ${JSON.stringify(options.stdoutLines)}) console.log(JSON.stringify(event));
process.exit(${options.exitCode ?? 0});
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
    }
  };
}
