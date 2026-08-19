import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApprovalManager } from '../../src/approvals/manager.js';
import { buildServer } from '../../src/api/server.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository } from '../../src/storage/repositories.js';

let tempDir = '';
let db: Database.Database | undefined;
let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('approval API', () => {
  it('lists and resolves approvals idempotently', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-approval-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    createRunRepository(db).insertRun({
      id: 'run_approval',
      threadId: 'thread_approval',
      publicStatus: 'running',
      internalStatus: 'running',
      createdBy: 'api',
      profile: 'default',
      cwd: tempDir,
      canonicalCwd: tempDir,
      workspaceMode: 'external',
      sandbox: 'read-only',
      codexVersion: 'test',
      codexBin: 'codex',
      codexHome: tempDir,
      normalizerVersion: 1
    });
    const approvalManager = createApprovalManager({ db });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db,
      approvalManager
    });
    const pending = approvalManager.request({
      runId: 'run_approval',
      threadId: 'thread_approval',
      turnId: 'turn_approval',
      itemId: 'item_approval',
      requestId: 'rpc_approval',
      kind: 'command_execution',
      risk: 'high',
      title: '允许执行命令',
      summary: 'rm -rf build',
      details: { command: 'rm -rf build' }
    });

    const list = await server.inject({
      method: 'GET',
      url: '/approvals?status=pending&threadId=thread_approval',
      headers: { authorization: 'Bearer secret' }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      approvals: [
        {
          id: pending.approval.id,
          status: 'pending'
        }
      ]
    });

    const first = await server.inject({
      method: 'POST',
      url: `/approvals/${pending.approval.id}/approve`,
      headers: { authorization: 'Bearer secret' }
    });
    const second = await server.inject({
      method: 'POST',
      url: `/approvals/${pending.approval.id}/approve`,
      headers: { authorization: 'Bearer secret' }
    });

    expect(first.json()).toMatchObject({
      changed: true,
      approval: { status: 'approved' }
    });
    expect(second.json()).toMatchObject({
      changed: false,
      approval: { status: 'approved' }
    });
    await expect(pending.decision).resolves.toBe('approved');
  });

  it('rejects invalid filters and returns a typed missing error', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-approval-api-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const approvalManager = createApprovalManager({ db });
    server = await buildServer({
      token: 'secret',
      dataDir: tempDir,
      db,
      approvalManager
    });

    const invalid = await server.inject({
      method: 'GET',
      url: '/approvals?status=unsafe',
      headers: { authorization: 'Bearer secret' }
    });
    const missing = await server.inject({
      method: 'POST',
      url: '/approvals/missing/reject',
      headers: { authorization: 'Bearer secret' }
    });

    expect(invalid.statusCode).toBe(400);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: 'APPROVAL_NOT_FOUND' }
    });
  });
});
