import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexAppServerClient } from '../../src/codex/app-server-client.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Codex app-server client', () => {
  it('initializes lazily and reuses one process for concurrent requests', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-app-server-client-'));
    const codexBin = createFakeAppServer(tempDir);
    const client = createCodexAppServerClient({
      codexBin,
      codexHome: join(tempDir, 'codex-home'),
      requestTimeoutMs: 10_000
    });

    const [threads, search] = await Promise.all([
      client.request<{ data: unknown[] }>('thread/list', { limit: 50 }),
      client.request<{ data: unknown[] }>('thread/search', { searchTerm: '测试' })
    ]);

    expect(threads).toEqual({ data: [{ id: 'thread-1' }] });
    expect(search).toEqual({ data: [{ snippet: '测试' }] });
    await client.close();
    expect(readFileSync(join(tempDir, 'initializations.txt'), 'utf8')).toBe('1');
    expect(readFileSync(join(tempDir, 'requests.txt'), 'utf8').trim().split('\n')).toEqual([
      'thread/list',
      'thread/search'
    ]);
  });

  it('restarts the process after an initialization timeout', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-app-server-client-'));
    const codexBin = createTimeoutThenRecoverAppServer(tempDir);
    const client = createCodexAppServerClient({
      codexBin,
      codexHome: join(tempDir, 'codex-home'),
      requestTimeoutMs: 5_000
    });

    try {
      await expect(
        client.request('thread/list', { limit: 50 })
      ).rejects.toThrow('Codex app-server request timed out: initialize');

      await expect(
        client.request('thread/list', { limit: 50 })
      ).resolves.toEqual({ data: [{ id: 'thread-recovered' }] });
      expect(readFileSync(join(tempDir, 'initializations.txt'), 'utf8')).toBe('2');
    } finally {
      await client.close();
    }
  });
});

function createFakeAppServer(dir: string): string {
  const bin = join(dir, 'fake-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const initPath = ${JSON.stringify(join(dir, 'initializations.txt'))};
const requestsPath = ${JSON.stringify(join(dir, 'requests.txt'))};
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    const count = fs.existsSync(initPath) ? Number(fs.readFileSync(initPath, 'utf8')) : 0;
    fs.writeFileSync(initPath, String(count + 1));
    send({ id: message.id, result: { userAgent: 'fake' } });
    return;
  }
  if (message.method === 'initialized') return;
  fs.appendFileSync(requestsPath, message.method + '\\n');
  if (message.method === 'thread/list') {
    send({ id: message.id, result: { data: [{ id: 'thread-1' }] } });
    return;
  }
  if (message.method === 'thread/search') {
    send({ id: message.id, result: { data: [{ snippet: message.params.searchTerm }] } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function createTimeoutThenRecoverAppServer(dir: string): string {
  const bin = join(dir, 'fake-codex-timeout.sh');
  writeFileSync(bin, `#!/bin/sh
init_path=${JSON.stringify(join(dir, 'initializations.txt'))}
if [ -f "$init_path" ]; then
  count=$(cat "$init_path")
else
  count=0
fi
count=$((count + 1))
printf '%s' "$count" > "$init_path"

if [ "$count" -eq 1 ]; then
  while IFS= read -r _line; do :; done
  exit 0
fi

while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\\n' '{"id":"opencreator_sessions_1","result":{"userAgent":"fake"}}'
      ;;
    *'"method":"initialized"'*)
      ;;
    *'"method":"thread/list"'*)
      printf '%s\\n' '{"id":"opencreator_sessions_2","result":{"data":[{"id":"thread-recovered"}]}}'
      ;;
  esac
done
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}
