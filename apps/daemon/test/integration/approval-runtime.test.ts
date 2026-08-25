import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createApprovalManager } from '../../src/approvals/manager.js';
import {
  createRunManager,
  type RunManager
} from '../../src/runs/manager.js';
import { createMemoryService } from '../../src/memory/service.js';
import { createProjectManager } from '../../src/projects/manager.js';
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

  it('runs full-access commands without creating an approval record', async () => {
    const fixture = setup('accept', 'danger-full-access');
    const run = fixture.runManager.startRun({
      prompt: 'execute without approval',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'danger-full-access',
      threadId: fixture.thread.id,
      resumeMode: 'new_thread'
    });

    await expect.poll(
      () => fixture.runManager.getRun(run.id)?.status,
      { timeout: 5_000, interval: 20 }
    ).toBe('succeeded');
    expect(fixture.approvalManager.list({ runId: run.id })).toEqual([]);
    expect(fixture.runManager.listEvents(run.id).filter(event => event.type === 'approval'))
      .toEqual([]);
  });

  it('surfaces an MCP schedule tool approval and continues after the user approves it', async () => {
    const fixture = setupMcpElicitation();
    const run = fixture.runManager.startRun({
      prompt: 'create a protected schedule',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'workspace-write',
      threadId: fixture.thread.id,
      resumeMode: 'new_thread'
    });

    await expect.poll(
      () => fixture.approvalManager.list({ status: 'pending' })[0],
      { timeout: 5_000, interval: 20 }
    ).toMatchObject({
      runId: run.id,
      threadId: fixture.thread.id,
      kind: 'permissions',
      status: 'pending',
      title: '允许创建定时任务',
      summary: '武汉天气每5分钟简报',
      details: {
        serverName: 'opencreator_schedule',
        toolName: 'opencreator_schedule_create',
        toolDescription: '创建一个 OpenCreator 定时任务。',
        toolParams: {
          name: '武汉天气每5分钟简报'
        }
      }
    });

    const approval = fixture.approvalManager.list({ status: 'pending' })[0]!;
    expect(fixture.approvalManager.approve(approval.id).changed).toBe(true);
    await expect.poll(
      () => fixture.runManager.getRun(run.id)?.status,
      { timeout: 5_000, interval: 20 }
    ).toBe('succeeded');
  });

  it('runs a full-access MCP schedule tool without creating an approval record', async () => {
    const fixture = setupMcpElicitation('danger-full-access');
    const run = fixture.runManager.startRun({
      prompt: 'create a schedule without approval',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'danger-full-access',
      threadId: fixture.thread.id,
      resumeMode: 'new_thread'
    });

    await expect.poll(
      () => fixture.runManager.getRun(run.id)?.status,
      { timeout: 5_000, interval: 20 }
    ).toBe('succeeded');
    expect(fixture.approvalManager.list({ runId: run.id })).toEqual([]);
    expect(fixture.runManager.listEvents(run.id).filter(event => event.type === 'approval'))
      .toEqual([]);
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

  it('rotates an automatic schedule run when app-server cannot resume the previous thread', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-app-server-rotation-'));
    db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
    const threadManager = createThreadManager({ db, dataDir: tempDir });
    const thread = threadManager.createScheduleThread({
      purpose: 'schedule_task',
      workspaceMode: 'external',
      cwd: tempDir,
      profile: 'default',
      sandbox: 'read-only'
    });
    threadManager.setCodexThreadId(thread.id, 'codex-thread-old');
    const memoryService = createMemoryService({ db });
    memoryService.createSummary({
      threadId: thread.id,
      items: [{
        id: 'item_summary',
        type: 'assistant_message',
        text: 'app-server 恢复摘要',
        createdAt: '2026-07-14T12:00:00.000Z'
      }]
    });
    const fake = createFakeRotationAppServer(tempDir);
    const createdRunManager = createRunManager({
      db,
      dataDir: tempDir,
      codexBin: fake.bin,
      codexHome: join(tempDir, 'codex-home'),
      threadAccess: threadManager,
      resumeCapabilityVerified: true,
      runtimeTransport: 'app-server',
      prepareThreadRotationContext: input => memoryService.prepareThreadRotationContext(input)
    });
    runManager = createdRunManager;

    const run = await createdRunManager.createAndRun({
      threadId: thread.id,
      prompt: '内部执行提示',
      publicPrompt: '生成公开结果',
      createdBy: 'schedule',
      sourceId: 'schedule_1'
    });

    expect(run.status).toBe('succeeded');
    expect(fake.readInvocationCount()).toBe(2);
    expect(threadManager.getThread(thread.id)?.codexThreadId).toBe('codex-thread-new');
    expect(fake.readMessages()).toEqual(expect.arrayContaining([
      expect.objectContaining({ invocation: 0, method: 'thread/resume' }),
      expect.objectContaining({ invocation: 1, method: 'thread/start' }),
      expect.objectContaining({
        invocation: 1,
        method: 'turn/start',
        params: expect.objectContaining({
          input: [
            expect.objectContaining({
              text: expect.stringContaining('app-server 恢复摘要')
            })
          ]
        })
      })
    ]));
    expect(createdRunManager.listEvents(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'diagnostic',
        payload: expect.objectContaining({
          code: 'THREAD_CODEX_SESSION_ROTATED',
          message: '执行上下文已重新连接'
        })
      })
    ]));
  });
});

function setup(
  expectedDecision: 'accept' | 'decline' | 'close',
  sandbox: 'read-only' | 'danger-full-access' = 'read-only'
) {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-approval-runtime-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const projectManager = createProjectManager({ db, homeDir: tempDir });
  const project = projectManager.createProject({
    cwd: tempDir,
    profile: 'default',
    sandbox
  });
  const threadManager = createThreadManager({
    db,
    dataDir: tempDir,
    projectManager
  });
  const thread = threadManager.createConversationThread({
    projectId: project.id
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

function setupMcpElicitation(
  sandbox: 'workspace-write' | 'danger-full-access' = 'workspace-write'
) {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-mcp-approval-runtime-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const threadManager = createThreadManager({ db, dataDir: tempDir });
  const thread = threadManager.createThread({
    purpose: 'schedule_draft',
    workspaceMode: 'external',
    cwd: tempDir,
    profile: 'default',
    sandbox
  });
  const approvalManager = createApprovalManager({ db });
  const createdRunManager = createRunManager({
    db,
    dataDir: tempDir,
    codexBin: createFakeMcpElicitationAppServer(tempDir),
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

function createFakeMcpElicitationAppServer(dir: string): string {
  const bin = join(dir, 'fake-mcp-approval-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'test' } });
  } else if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'codex-thread-mcp-approval' } } });
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-mcp-approval', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: 'codex-thread-mcp-approval', turn: { id: 'turn-mcp-approval', status: 'inProgress' } } });
    send({
      id: 'mcp-approval-rpc',
      method: 'mcpServer/elicitation/request',
      params: {
        threadId: 'codex-thread-mcp-approval',
        turnId: 'turn-mcp-approval',
        serverName: 'opencreator_schedule',
        mode: 'form',
        _meta: {
          codex_approval_kind: 'mcp_tool_call',
          tool_description: '创建一个 OpenCreator 定时任务。',
          tool_params: {
            name: '武汉天气每5分钟简报'
          }
        },
        requestedSchema: {
          type: 'object',
          properties: {}
        }
      }
    });
  } else if (message.id === 'mcp-approval-rpc') {
    if (
      !message.result
      || message.result.action !== 'accept'
      || JSON.stringify(message.result.content) !== '{}'
      || message.result._meta !== null
    ) {
      process.stderr.write('unexpected MCP elicitation response\\n');
      process.exit(2);
      return;
    }
    send({ method: 'serverRequest/resolved', params: { threadId: 'codex-thread-mcp-approval', requestId: 'mcp-approval-rpc' } });
    send({ method: 'turn/completed', params: { threadId: 'codex-thread-mcp-approval', turn: { id: 'turn-mcp-approval', status: 'completed' } } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function createFakeRotationAppServer(dir: string) {
  const bin = join(dir, 'fake-rotation-app-server.js');
  const countPath = join(dir, 'app-server-invocation-count.txt');
  const messagesPath = join(dir, 'app-server-messages.ndjson');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const countPath = ${JSON.stringify(countPath)};
const messagesPath = ${JSON.stringify(messagesPath)};
const invocation = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0;
fs.writeFileSync(countPath, String(invocation + 1));
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const message = JSON.parse(line);
  fs.appendFileSync(messagesPath, JSON.stringify({ invocation, ...message }) + '\\n');
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake', codexHome: process.env.CODEX_HOME, platformFamily: 'unix', platformOs: 'test' } });
  } else if (message.method === 'thread/read') {
    send({ id: message.id, result: { thread: { id: message.params.threadId, turns: [] } } });
  } else if (message.method === 'thread/resume') {
    send({ id: message.id, error: { code: -32001, message: 'No session found for codex-thread-old' } });
  } else if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'codex-thread-new' } } });
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-rotation', status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: 'codex-thread-new', turn: { id: 'turn-rotation', status: 'inProgress' } } });
    send({ method: 'turn/completed', params: { threadId: 'codex-thread-new', turn: { id: 'turn-rotation', status: 'completed' } } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return {
    bin,
    readInvocationCount(): number {
      return Number(readFileSync(countPath, 'utf8'));
    },
    readMessages(): Array<Record<string, unknown>> {
      return readFileSync(messagesPath, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>);
    }
  };
}
