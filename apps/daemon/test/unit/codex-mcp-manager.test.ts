import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpManager } from '../../src/codex/mcp/manager.js';
import type { ResolvedCodexHome } from '../../src/codex/home.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

const capabilities = {
  mcpAdd: true,
  mcpAddEnv: true,
  mcpAddUrl: true,
  mcpAddBearerTokenEnvVar: true,
  mcpAddOAuth: true
};

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex mcp manager', () => {
  it('runs add/list/get/remove through codex and stores redacted operations', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-mcp-manager-'));
    const codexHome = makeCodexHome(join(tempDir, 'codex-home'), 'isolated');
    const codexBin = makeFakeCodex(tempDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createMcpManager({ codexBin, codexHome, db, capabilities });

    const added = await manager.addServer({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'real-secret' }
    });
    const list = await manager.listServers();
    const got = await manager.getServer('github');
    const removed = await manager.removeServer('github', false);

    expect(added.server).toMatchObject({ name: 'github', transport: 'stdio' });
    expect(list.servers).toHaveLength(1);
    expect(got).toMatchObject({ name: 'github', transport: 'stdio' });
    expect(removed).toMatchObject({ removed: true });

    expect(added.operation).toMatchObject({
      operation: 'add',
      serverName: 'github',
      command: expect.arrayContaining(['GITHUB_TOKEN=[REDACTED]']),
      status: 'succeeded'
    });
    expect(added.operation.command).not.toContain('GITHUB_TOKEN=real-secret');

    const commands = readCommands(tempDir);
    expect(commands).toContain('mcp add github --env GITHUB_TOKEN=real-secret -- node server.js');
    expect(commands).toEqual([
      'mcp add github --env GITHUB_TOKEN=real-secret -- node server.js',
      'mcp get github --json',
      'mcp list --json',
      'mcp get github --json',
      'mcp remove github'
    ]);

    expect(manager.listOperations().map((operation) => operation.operation)).toEqual([
      'remove',
      'get',
      'list',
      'get',
      'add'
    ]);
  });

  it('rejects unconfirmed global CODEX_HOME writes', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-mcp-manager-'));
    const codexHome = makeCodexHome(join(tempDir, 'codex-home'), 'global');
    const codexBin = makeFakeCodex(tempDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createMcpManager({ codexBin, codexHome, db, capabilities });

    await expect(
      manager.addServer({
        name: 'github',
        transport: 'stdio',
        command: 'node'
      })
    ).rejects.toThrow('MCP_WRITE_CONFIRMATION_REQUIRED');

    expect(manager.listOperations()).toEqual([]);
    expect(readCommands(tempDir)).toEqual([]);
  });

  it('supports destructured addServer calls and still logs the verification get', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-mcp-manager-'));
    const codexHome = makeCodexHome(join(tempDir, 'codex-home'), 'isolated');
    const codexBin = makeFakeCodex(tempDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const { addServer, listOperations } = createMcpManager({ codexBin, codexHome, db, capabilities });

    const added = await addServer({
      name: 'github',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { GITHUB_TOKEN: 'real-secret' }
    });

    expect(added.server).toMatchObject({ name: 'github', transport: 'stdio' });
    expect(readCommands(tempDir)).toEqual([
      'mcp add github --env GITHUB_TOKEN=real-secret -- node server.js',
      'mcp get github --json'
    ]);
    expect(listOperations().map((operation) => operation.operation)).toEqual(['get', 'add']);
  });

  it('redacts add request env values from failed operation diagnostics', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-mcp-manager-'));
    const codexHome = makeCodexHome(join(tempDir, 'codex-home'), 'isolated');
    const codexBin = makeFakeCodex(tempDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createMcpManager({ codexBin, codexHome, db, capabilities });

    await expect(
      manager.addServer({
        name: 'fail-add',
        transport: 'stdio',
        command: 'node',
        env: { GITHUB_TOKEN: 'real-secret' }
      })
    ).rejects.toThrow('[REDACTED]');

    const failed = manager.listOperations()[0];
    expect(failed).toMatchObject({
      operation: 'add',
      status: 'failed',
      errorCode: 'MCP_COMMAND_FAILED'
    });
    expect(JSON.stringify(failed)).toContain('[REDACTED]');
    expect(JSON.stringify(failed)).not.toContain('real-secret');
  });

  it('returns diagnostics and logs a failed operation when list fails', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-mcp-manager-'));
    const codexHome = makeCodexHome(join(tempDir, 'fail-list-codex-home'), 'isolated');
    const codexBin = makeFakeCodex(tempDir);
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const manager = createMcpManager({ codexBin, codexHome, db, capabilities });

    const listed = await manager.listServers();

    expect(listed).toMatchObject({
      servers: [],
      diagnostics: ['list failed']
    });
    expect(manager.listOperations()[0]).toMatchObject({
      operation: 'list',
      status: 'failed',
      errorCode: 'MCP_COMMAND_FAILED',
      errorMessage: 'list failed'
    });
  });
});

function makeCodexHome(path: string, mode: ResolvedCodexHome['mode']): ResolvedCodexHome {
  return {
    path,
    mode,
    source: mode === 'global' ? 'default' : 'isolated',
    writable: mode === 'isolated'
  };
}

function makeFakeCodex(dir: string): string {
  const codexBin = join(dir, 'fake-codex.js');
  const commandsPath = JSON.stringify(join(dir, 'commands.json'));
  writeFileSync(
    codexBin,
    `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const commandsPath = ${commandsPath};
const command = process.argv.slice(2).join(' ');
const commands = existsSync(commandsPath) ? JSON.parse(readFileSync(commandsPath, 'utf8')) : [];
commands.push(command);
writeFileSync(commandsPath, JSON.stringify(commands));

if (command === 'mcp list --json') {
  if (process.env.CODEX_HOME && process.env.CODEX_HOME.includes('fail-list')) {
    process.stderr.write('list failed');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify([{ name: 'github', transport: 'stdio', command: 'node', args: ['server.js'], env: { GITHUB_TOKEN: 'real-secret' } }]));
  process.exit(0);
}
if (command === 'mcp get github --json') {
  process.stdout.write(JSON.stringify({ name: 'github', transport: 'stdio', command: 'node', args: ['server.js'], env: { GITHUB_TOKEN: 'real-secret' } }));
  process.exit(0);
}
if (/^mcp (add|remove|login|logout)\\b/.test(command)) {
  if (command.startsWith('mcp add fail-add ')) {
    process.stderr.write('codex saw bare secret real-secret');
    process.exit(1);
  }
  process.exit(0);
}
process.stderr.write('not found\\n');
process.exit(1);
`
  );
  chmodSync(codexBin, 0o755);
  return codexBin;
}

function readCommands(dir: string): string[] {
  try {
    return JSON.parse(readFileSync(join(dir, 'commands.json'), 'utf8')) as string[];
  } catch {
    return [];
  }
}
