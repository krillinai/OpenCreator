import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpOperationRepository } from '../../src/codex/mcp/operations.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex mcp operations', () => {
  it('persists redacted mcp operations newest first', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-ops-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const operations = createMcpOperationRepository(db);

    const first = operations.insertOperation({
      operation: 'add',
      serverName: 'github',
      codexHome: join(tempDir, 'codex-home'),
      command: [
        'mcp',
        'add',
        'github',
        '--env',
        'GITHUB_TOKEN=[REDACTED]',
        '--',
        'node',
        'server.js'
      ],
      status: 'succeeded',
      exitCode: 0,
      timedOut: false
    });
    const second = operations.insertOperation({
      operation: 'remove',
      serverName: 'github',
      codexHome: join(tempDir, 'codex-home'),
      command: ['mcp', 'remove', 'github'],
      status: 'failed',
      exitCode: 1,
      timedOut: false,
      errorCode: 'MCP_COMMAND_FAILED',
      errorMessage: 'failed'
    });

    expect(first.id).toMatch(/^mcpop_/);
    expect(operations.listOperations()).toEqual([
      expect.objectContaining({
        id: second.id,
        operation: 'remove',
        errorCode: 'MCP_COMMAND_FAILED'
      }),
      expect.objectContaining({
        id: first.id,
        operation: 'add',
        command: expect.arrayContaining(['GITHUB_TOKEN=[REDACTED]'])
      })
    ]);
    expect(operations.listOperations(1)).toHaveLength(1);
  });

  it('maps timeout and nullable failure fields', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-ops-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const operations = createMcpOperationRepository(db);

    const failed = operations.insertOperation({
      operation: 'login',
      serverName: null,
      codexHome: join(tempDir, 'codex-home'),
      command: ['mcp', 'login', 'github'],
      status: 'failed',
      timedOut: true,
      errorCode: 'MCP_COMMAND_TIMEOUT',
      errorMessage: 'timed out'
    });

    expect(failed).toMatchObject({
      operation: 'login',
      serverName: null,
      timedOut: true,
      exitCode: null,
      errorCode: 'MCP_COMMAND_TIMEOUT',
      errorMessage: 'timed out'
    });
    expect(operations.listOperations()).toEqual([failed]);
  });

  it('clamps list operation limits', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-ops-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const operations = createMcpOperationRepository(db);

    for (let index = 0; index < 201; index += 1) {
      operations.insertOperation({
        operation: 'get',
        serverName: `server-${index}`,
        codexHome: join(tempDir, 'codex-home'),
        command: ['mcp', 'get', `server-${index}`],
        status: 'succeeded',
        exitCode: 0,
        timedOut: false
      });
    }

    expect(operations.listOperations(0)).toHaveLength(1);
    expect(operations.listOperations(-10)).toHaveLength(1);
    expect(operations.listOperations(999)).toHaveLength(200);
  });
});
