import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApprovalManager } from '../../src/approvals/manager.js';
import {
  createRunManager,
  type RunManager
} from '../../src/runs/manager.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';
import { createThreadManager } from '../../src/threads/manager.js';

let tempDir = '';
let db: Database.Database | undefined;
let runManager: RunManager | undefined;

afterEach(async () => {
  await runManager?.close();
  runManager = undefined;
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('approval runtime integration', () => {
  it('pauses a run until approval and then continues the same app-server turn', async () => {
    const fixture = setup('accept');
    const run = fixture.runManager.startRun({
      prompt: 'execute a protected command',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      threadId: fixture.thread.id,
      resumeMode: 'new_thread'
    });

    await expect.poll(
      () => fixture.approvalManager.list({ status: 'pending' })[0],
      { timeout: 5_000, interval: 20 }
    ).toMatchObject({
      runId: run.id,
      threadId: fixture.thread.id,
      kind: 'command_execution',
      status: 'pending',
      details: {
        command: 'rm -rf build'
      }
    });

    const approval = fixture.approvalManager.list({ status: 'pending' })[0]!;
    expect(fixture.approvalManager.approve(approval.id).changed).toBe(true);
    await expect.poll(
      () => fixture.runManager.getRun(run.id)?.status,
      { timeout: 5_000, interval: 20 }
    ).toBe('succeeded');

    expect(fixture.runManager.listEvents(run.id).filter(event => event.type === 'approval'))
      .toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            approval: expect.objectContaining({ status: 'pending' })
          })
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            approval: expect.objectContaining({ status: 'approved' })
          })
        })
      ]);
  });

  it('returns an official decline response without executing the command', async () => {
    const fixture = setup('decline');
    const run = fixture.runManager.startRun({
      prompt: 'execute a protected command',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      threadId: fixture.thread.id,
      resumeMode: 'new_thread'
    });

    await expect.poll(
      () => fixture.approvalManager.list({ status: 'pending' }).length,
      { timeout: 5_000, interval: 20 }
    ).toBe(1);
    const approval = fixture.approvalManager.list({ status: 'pending' })[0]!;
    fixture.approvalManager.reject(approval.id);

    await expect.poll(
      () => fixture.runManager.getRun(run.id)?.status,
      { timeout: 5_000, interval: 20 }
    ).toBe('succeeded');
    expect(fixture.approvalManager.get(approval.id)?.status).toBe('rejected');
  });

  it('cancels a pending approval when app-server exits unexpectedly', async () => {
    const fixture = setup('close');
    const run = fixture.runManager.startRun({
      prompt: 'execute a protected command',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only',
      threadId: fixture.thread.id,
      resumeMode: 'new_thread'
    });

    await expect.poll(
      () => fixture.runManager.getRun(run.id)?.status,
      { timeout: 5_000, interval: 20 }
    ).toBe('failed');
    expect(fixture.approvalManager.list({ runId: run.id })).toEqual([
      expect.objectContaining({
        status: 'canceled',
        resolutionReason: 'run_failed'
      })
    ]);
  });

  it('fails explicit app-server resume before spawn when the thread has no Codex session', () => {
    const fixture = setup('accept');
    const run = fixture.runManager.startRun({
      prompt: 'resume without a target',
      threadId: fixture.thread.id,
      resumeMode: 'resume_thread'
    });

    expect(run.status).toBe('failed');
    expect(fixture.runManager.getRun(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'CODEX_THREAD_ID_MISSING'
    });
  });
});

function setup(expectedDecision: 'accept' | 'decline' | 'close') {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-approval-runtime-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const threadManager = createThreadManager({ db, dataDir: tempDir });
  const thread = threadManager.createThread({
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox: 'read-only'
  });
  const approvalManager = createApprovalManager({ db });
  const createdRunManager = createRunManager({
    db,
    dataDir: tempDir,
    codexBin: createFakeApprovalAppServer(tempDir, expectedDecision),
    codexHome: join(tempDir, 'codex-home'),
    threadAccess: threadManager,
    resumeCapabilityVerified: true,
    runtimeTransport: 'app-server',
    approvalManager
  });
  runManager = createdRunManager;
  return { approvalManager, runManager: createdRunManager, thread };
}

function createFakeApprovalAppServer(
  dir: string,
  expectedDecision: 'accept' | 'decline' | 'close'
): string {
  const bin = join(dir, 'fake-approval-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'test' } });
  } else if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'codex-thread-approval' } } });
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-approval', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: 'codex-thread-approval', turn: { id: 'turn-approval', status: 'inProgress' } } });
    send({ method: 'item/started', params: { threadId: 'codex-thread-approval', turnId: 'turn-approval', item: { type: 'commandExecution', id: 'item-approval', command: 'rm -rf build', cwd: process.cwd(), status: 'inProgress', commandActions: [] } } });
    send({ id: 'approval-rpc', method: 'item/commandExecution/requestApproval', params: { threadId: 'codex-thread-approval', turnId: 'turn-approval', itemId: 'item-approval', startedAtMs: Date.now(), command: 'rm -rf build', cwd: process.cwd(), reason: 'outside sandbox' } });
    if (${JSON.stringify(expectedDecision)} === 'close') setTimeout(() => process.exit(2), 25);
  } else if (message.id === 'approval-rpc') {
    if (!message.result || message.result.decision !== ${JSON.stringify(expectedDecision)}) {
      process.stderr.write('unexpected decision\\n');
      process.exit(2);
      return;
    }
    send({ method: 'serverRequest/resolved', params: { threadId: 'codex-thread-approval', requestId: 'approval-rpc' } });
    send({ method: 'item/completed', params: { threadId: 'codex-thread-approval', turnId: 'turn-approval', item: { type: 'commandExecution', id: 'item-approval', command: 'rm -rf build', cwd: process.cwd(), status: ${JSON.stringify(expectedDecision === 'accept' ? 'completed' : 'declined')}, commandActions: [], aggregatedOutput: ${JSON.stringify(expectedDecision === 'accept' ? 'done' : '')}, exitCode: ${expectedDecision === 'accept' ? 0 : 'null'} } } });
    send({ method: 'turn/completed', params: { threadId: 'codex-thread-approval', turn: { id: 'turn-approval', status: 'completed' } } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}
