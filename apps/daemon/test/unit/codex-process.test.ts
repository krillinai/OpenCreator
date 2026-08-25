import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnCodexProcess } from '../../src/codex/process.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Codex process launcher', () => {
  it('runs an executable without a shell on Unix', async () => {
    if (process.platform === 'win32') return;
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-process-'));
    const bin = join(tempDir, 'codex');
    writeFileSync(bin, '#!/bin/sh\nprintf \"%s\" \"$1\"\n');
    chmodSync(bin, 0o755);

    const child = spawnCodexProcess(bin, ['hello'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
    const [output, code] = await Promise.all([
      collect(child.stdout),
      exit
    ]);

    expect(code).toBe(0);
    expect(output).toBe('hello');
  });

  it('runs an npm-style .cmd entry on Windows', async () => {
    if (process.platform !== 'win32') return;
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-process-'));
    const bin = join(tempDir, 'codex.cmd');
    writeFileSync(bin, '@echo off\r\n<nul set /p=\"%~1\"\r\nexit /b 0\r\n');

    const child = spawnCodexProcess(bin, ['hello'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
    const [output, code] = await Promise.all([
      collect(child.stdout),
      exit
    ]);

    expect(code).toBe(0);
    expect(output).toBe('hello');
  });
});

async function collect(stream: NodeJS.ReadableStream): Promise<string> {
  let output = '';
  stream.setEncoding('utf8');
  for await (const chunk of stream) output += chunk;
  return output;
}
