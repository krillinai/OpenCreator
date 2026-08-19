import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApprovalManager } from '../../src/approvals/manager.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createRunRepository } from '../../src/storage/repositories.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  vi.useRealTimers();
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-approvals-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  createRunRepository(db).insertRun({
    id: 'run_1',
    threadId: 'thread_1',
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
  return createApprovalManager({ db, defaultTtlMs: 60_000 });
}

describe('approval manager', () => {
  it('persists a pending approval and resolves approve idempotently', async () => {
    const manager = setup();
    const pending = manager.request({
      runId: 'run_1',
      threadId: 'thread_1',
      codexThreadId: 'codex_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'rpc_1',
      kind: 'command_execution',
      risk: 'high',
      title: '执行高风险命令',
      summary: 'rm [REDACTED]',
      details: { command: 'rm [REDACTED]', cwd: tempDir }
    });

    expect(manager.list({ status: 'pending' })).toHaveLength(1);
    const first = manager.approve(pending.approval.id);
    const second = manager.approve(pending.approval.id);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.approval.status).toBe('approved');
    await expect(pending.decision).resolves.toBe('approved');
  });

  it('rejects an approval and keeps the terminal decision idempotent', async () => {
    const manager = setup();
    const pending = manager.request({
      runId: 'run_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'rpc_1',
      kind: 'file_change',
      risk: 'medium',
      title: '修改文件',
      summary: '修改工作区文件',
      details: { grantRoot: tempDir }
    });

    expect(manager.reject(pending.approval.id).approval.status).toBe('rejected');
    expect(manager.approve(pending.approval.id)).toMatchObject({
      changed: false,
      approval: { status: 'rejected' }
    });
    await expect(pending.decision).resolves.toBe('rejected');
  });

  it('expires unanswered approvals without granting them', async () => {
    vi.useFakeTimers();
    const manager = setup();
    const pending = manager.request({
      runId: 'run_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'rpc_1',
      kind: 'command_execution',
      risk: 'high',
      title: '访问网络',
      summary: '访问 example.com',
      details: { host: 'example.com' },
      ttlMs: 100
    });

    await vi.advanceTimersByTimeAsync(101);

    await expect(pending.decision).resolves.toBe('expired');
    expect(manager.get(pending.approval.id)?.status).toBe('expired');
  });

  it('cancels persisted pending approvals on daemon restart', async () => {
    const manager = setup();
    const pending = manager.request({
      runId: 'run_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      itemId: 'item_1',
      requestId: 'rpc_1',
      kind: 'command_execution',
      risk: 'high',
      title: '执行命令',
      summary: '命令',
      details: {}
    });
    manager.detach(pending.approval.id);

    const recovered = createApprovalManager({ db: db!, defaultTtlMs: 60_000 });

    expect(recovered.get(pending.approval.id)).toMatchObject({
      status: 'canceled',
      resolutionReason: 'daemon_restart'
    });
  });
});
