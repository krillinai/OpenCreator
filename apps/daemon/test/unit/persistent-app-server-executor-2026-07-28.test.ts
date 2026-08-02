import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentScheduleProcessInjector,
  AgentToolProcessInjection
} from '../../src/agent-tools/run-injection.js';
import {
  createPersistentAppServerExecutor,
  type PersistentAppServerExecutor
} from '../../src/runs/persistent-app-server-executor-2026-07-28.js';
import type {
  CodexAppServerHost,
  CodexAppServerResult
} from '../../src/codex/app-server-host-2026-07-28.js';
import type { RuntimeThread } from '../../src/threads/types.js';

let tempDir = '';
let executors: PersistentAppServerExecutor[] = [];

afterEach(async () => {
  await Promise.allSettled(executors.map(executor => executor.close({
    interruptGraceMs: 100,
    terminateGraceMs: 100
  })));
  executors = [];
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('persistent app-server executor', () => {
  it('reuses one initialized process across run parameters and refreshes changed manifests', async () => {
    const fixture = createFixture();
    const executor = fixture.executor;
    for (const name of ['project-a', 'project-b', 'project-c']) {
      mkdirSync(join(tempDir, name));
    }

    const first = executor.start(runInput({
      runId: 'run-1',
      cwd: join(tempDir, 'project-a'),
      model: 'model-a',
      sandbox: 'read-only',
      reasoning: 'low',
      thread: thread({ id: 'thread-1', purpose: 'conversation' })
    }));
    const firstStarted = await first.started;
    await expect(first.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });

    const second = executor.start(runInput({
      runId: 'run-2',
      cwd: join(tempDir, 'project-b'),
      model: 'model-b',
      sandbox: 'danger-full-access',
      reasoning: 'high',
      thread: thread({ id: 'thread-2', purpose: 'conversation' })
    }));
    const secondStarted = await second.started;
    await expect(second.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });

    const third = executor.start(runInput({
      runId: 'run-3',
      cwd: join(tempDir, 'project-c'),
      thread: thread({ id: 'thread-3', purpose: 'schedule_task' })
    }));
    const thirdStarted = await third.started;
    await expect(third.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });

    expect(firstStarted).toMatchObject({ reused: false });
    expect(secondStarted).toEqual({ pid: firstStarted.pid, reused: true });
    expect(thirdStarted).toEqual({ pid: firstStarted.pid, reused: true });
    const messages = fixture.readMessages();
    expect(messages.filter(item => item.method === 'initialize')).toHaveLength(1);
    expect(messages.filter(item => item.method === 'turn/start')).toHaveLength(3);
    expect(messages.filter(item => item.method === 'config/mcpServer/reload')).toHaveLength(2);
    expect(messages.filter(item => item.method === 'turn/start').map(item => item.params))
      .toEqual([
        expect.objectContaining({
          cwd: join(tempDir, 'project-a'),
          model: 'model-a',
          effort: 'low',
          approvalPolicy: 'on-request'
        }),
        expect.objectContaining({
          cwd: join(tempDir, 'project-b'),
          model: 'model-b',
          effort: 'high',
          approvalPolicy: 'never'
        }),
        expect.objectContaining({
          cwd: join(tempDir, 'project-c')
        })
      ]);
    expect(fixture.injection.activate).toHaveBeenCalledTimes(3);
    expect(fixture.injection.deactivate).toHaveBeenCalledWith('run-1');
    expect(fixture.injection.deactivate).toHaveBeenCalledWith('run-2');
    expect(fixture.injection.deactivate).toHaveBeenCalledWith('run-3');
  });

  it('restarts once for every normalized profile change', async () => {
    const fixture = createFixture();

    const first = fixture.executor.start(runInput({
      runId: 'run-a1',
      profile: 'default'
    }));
    const firstStarted = await first.started;
    await first.result;

    const second = fixture.executor.start(runInput({
      runId: 'run-b',
      profile: 'work'
    }));
    const secondStarted = await second.started;
    await second.result;

    const third = fixture.executor.start(runInput({
      runId: 'run-a2',
      profile: 'default'
    }));
    const thirdStarted = await third.started;
    await third.result;

    expect(new Set([
      firstStarted.pid,
      secondStarted.pid,
      thirdStarted.pid
    ]).size).toBe(3);
    expect(fixture.readSpawns().map(item => item.args)).toEqual([
      expect.not.arrayContaining(['--profile']),
      expect.arrayContaining(['--profile', 'work']),
      expect.not.arrayContaining(['--profile'])
    ]);
  });

  it('rejects a second start while one job is active', async () => {
    const fixture = createFixture();
    const active = fixture.executor.start(runInput({
      runId: 'run-active',
      prompt: 'wait'
    }));
    await active.started;
    await expect.poll(() => fixture.readMessages().some(item =>
      item.method === 'turn/start'
    ), { timeout: 5_000 }).toBe(true);

    expect(() => fixture.executor.start(runInput({
      runId: 'run-overlap'
    }))).toThrow('busy');

    active.cancel();
    await expect(active.result).resolves.toMatchObject({
      turnStatus: 'interrupted',
      terminationReason: 'canceled'
    });
  });

  it('creates a new process after a crash without replaying the failed turn', async () => {
    const fixture = createFixture();
    const onTurnStartWritten = vi.fn();
    const crashed = fixture.executor.start(runInput({
      runId: 'run-crash',
      prompt: 'crash',
      onTurnStartWritten
    }));
    const crashedStarted = await crashed.started;
    await expect(crashed.result).rejects.toThrow('closed before turn completion');

    const recovered = fixture.executor.start(runInput({
      runId: 'run-recovered',
      prompt: 'complete'
    }));
    const recoveredStarted = await recovered.started;
    await expect(recovered.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });

    expect(recoveredStarted.pid).not.toBe(crashedStarted.pid);
    const crashTurns = fixture.readMessages().filter(item =>
      item.method === 'turn/start'
      && JSON.stringify(item.params).includes('crash')
    );
    expect(crashTurns).toHaveLength(1);
    expect(onTurnStartWritten).toHaveBeenCalledTimes(1);
  });

  it('crosses the no-replay boundary only after turn/start is written', async () => {
    const fixture = createFixture();
    const onTurnStartWritten = vi.fn();
    const failed = fixture.executor.start(runInput({
      runId: 'run-write-failed',
      model: 'close-stdin-before-turn',
      onTurnStartWritten
    }));
    const failedStarted = await failed.started;

    await expect(failed.result).rejects.toThrow(
      /EPIPE|stdin|write|socket/i
    );
    expect(onTurnStartWritten).not.toHaveBeenCalled();
    expect(fixture.readMessages().filter(item =>
      item.pid === failedStarted.pid
      && item.method === 'turn/start'
    )).toHaveLength(0);

    const recovered = fixture.executor.start(runInput({
      runId: 'run-after-write-failure'
    }));
    const recoveredStarted = await recovered.started;
    await expect(recovered.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });
    expect(recoveredStarted.pid).not.toBe(failedStarted.pid);
  });

  it('keeps the host reusable after a matched interrupt terminal event', async () => {
    const fixture = createFixture();
    const canceled = fixture.executor.start(runInput({
      runId: 'run-cancel',
      prompt: 'wait'
    }));
    const canceledStarted = await canceled.started;
    await expect.poll(() => fixture.readMessages().some(item =>
      item.method === 'turn/start'
    ), { timeout: 5_000 }).toBe(true);
    canceled.cancel();
    await expect(canceled.result).resolves.toMatchObject({
      turnStatus: 'interrupted',
      terminationReason: 'canceled'
    });

    const next = fixture.executor.start(runInput({
      runId: 'run-next'
    }));
    const nextStarted = await next.started;
    await next.result;

    expect(nextStarted).toEqual({
      pid: canceledStarted.pid,
      reused: true
    });
  });

  it('keeps the host reusable when canceled during a successful MCP refresh', async () => {
    const fixture = createFixture();
    const canceled = fixture.executor.start(runInput({
      runId: 'run-cancel-refresh',
      model: 'delay-mcp-refresh'
    }));
    const canceledStarted = await canceled.started;
    await expect.poll(() => fixture.readMessages().some(item =>
      item.method === 'config/mcpServer/reload'
      && item.pid === canceledStarted.pid
    ), { timeout: 5_000 }).toBe(true);
    canceled.cancel();
    await expect(canceled.result).rejects.toThrow(
      'canceled before turn start'
    );

    const next = fixture.executor.start(runInput({
      runId: 'run-after-refresh-cancel'
    }));
    const nextStarted = await next.started;
    await expect(next.result).resolves.toMatchObject({
      turnStatus: 'completed'
    });
    expect(nextStarted).toEqual({
      pid: canceledStarted.pid,
      reused: true
    });
  });

  it('escalates close to SIGKILL when interrupt and SIGTERM are ignored', async () => {
    const fixture = createFixture();
    const active = fixture.executor.start(runInput({
      runId: 'run-force-close',
      prompt: 'ignore-close'
    }));
    const started = await active.started;
    await expect.poll(() => fixture.readMessages().some(item =>
      item.method === 'turn/start'
    ), { timeout: 5_000 }).toBe(true);

    await fixture.executor.close({
      interruptGraceMs: 20,
      terminateGraceMs: 20
    });

    await expect(active.result).rejects.toThrow('closed before turn completion');
    expect(isProcessAlive(started.pid)).toBe(false);
    expect(fixture.injection.close).toHaveBeenCalledTimes(1);
  });

  it('does not create a replacement host while closing during a profile change', async () => {
    let releaseProfileClose!: () => void;
    const profileClose = new Promise<void>(resolve => {
      releaseProfileClose = resolve;
    });
    const firstHost = fakeHost(101, profileClose);
    const createHost = vi.fn(() => firstHost);
    const executor = createPersistentAppServerExecutor({
      codexBin: 'unused',
      codexHome: 'unused',
      createHost
    });
    executors.push(executor);

    const first = executor.start(runInput({
      runId: 'run-before-profile-change',
      profile: 'default'
    }));
    await first.started;
    await first.result;

    const changing = executor.start(runInput({
      runId: 'run-profile-change',
      profile: 'work'
    }));
    await expect.poll(() => firstHost.close).toHaveBeenCalledTimes(1);

    const closeWork = executor.close({
      interruptGraceMs: 20,
      terminateGraceMs: 20
    });
    releaseProfileClose();

    await closeWork;
    await expect(changing.result).rejects.toThrow('executor is closing');
    expect(createHost).toHaveBeenCalledTimes(1);
  });
});

function fakeHost(
  pid: number,
  closeResult: Promise<void>
): CodexAppServerHost {
  return {
    pid,
    started: Promise.resolve(pid),
    run: vi.fn(() => ({
      cancel: vi.fn(),
      result: Promise.resolve<CodexAppServerResult>({
        threadId: 'codex-thread',
        turnId: 'codex-turn',
        turnStatus: 'completed',
        stderr: '',
        terminationReason: 'completed',
        outputTruncation: {
          stderr: { truncated: false, droppedBytes: 0, droppedItems: 0 },
          frames: { truncated: false, droppedBytes: 0, droppedItems: 0 }
        }
      })
    })),
    isReusable: vi.fn(() => true),
    close: vi.fn(() => closeResult)
  };
}

function createFixture(): {
  executor: PersistentAppServerExecutor;
  injection: AgentToolProcessInjection;
  readMessages(): Array<Record<string, unknown>>;
  readSpawns(): Array<{ pid: number; args: string[] }>;
} {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-persistent-app-server-'));
  const fakeCodex = createFakeAppServer(tempDir);
  const injection: AgentToolProcessInjection = {
    mcpServers: [],
    env: {},
    activate: vi.fn(input => ({
      manifestKey: input.thread.purpose === 'schedule_task'
        ? 'schedule_task'
        : 'conversation'
    })),
    deactivate: vi.fn(),
    close: vi.fn()
  };
  const processInjector: AgentScheduleProcessInjector = {
    create: vi.fn(() => injection)
  };
  const executor = createPersistentAppServerExecutor({
    codexBin: fakeCodex,
    codexHome: join(tempDir, 'codex-home'),
    processInjector
  });
  executors.push(executor);
  return {
    executor,
    injection,
    readMessages: () => readNdjson(join(tempDir, 'messages.ndjson')),
    readSpawns: () => readNdjson(join(tempDir, 'spawns.ndjson')) as Array<{
      pid: number;
      args: string[];
    }>
  };
}

function runInput(
  overrides: Partial<Parameters<PersistentAppServerExecutor['start']>[0]> = {}
): Parameters<PersistentAppServerExecutor['start']>[0] {
  return {
    runId: 'run-default',
    thread: thread(),
    cwd: tempDir,
    profile: 'default',
    sandbox: 'workspace-write',
    prompt: 'complete',
    inactivityTimeoutMs: 5_000,
    ...overrides
  };
}

function thread(overrides: Partial<RuntimeThread> = {}): RuntimeThread {
  return {
    id: 'thread-default',
    title: '测试会话',
    projectId: 'project-1',
    origin: 'clawee_created',
    cwd: tempDir,
    canonicalCwd: tempDir,
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    ...overrides
  };
}

function createFakeAppServer(dir: string): string {
  const bin = join(dir, 'fake-persistent-codex.js');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const spawnLog = ${JSON.stringify(join(dir, 'spawns.ndjson'))};
const messageLog = ${JSON.stringify(join(dir, 'messages.ndjson'))};
fs.appendFileSync(spawnLog, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + '\\n');
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let threadSequence = 0;
let turnSequence = 0;
let currentThreadId;
let currentTurnId;
let currentPrompt;
let currentModel;
process.on('SIGTERM', () => {
  if (currentPrompt === 'ignore-close') return;
  process.exit(0);
});
rl.on('line', line => {
  const message = JSON.parse(line);
  fs.appendFileSync(messageLog, JSON.stringify({ pid: process.pid, ...message }) + '\\n');
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake' } });
    return;
  }
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    currentThreadId = message.params.threadId || ('thread-' + process.pid + '-' + (++threadSequence));
    currentModel = message.params.model;
    if (message.params.model === 'close-stdin-before-turn') {
      fs.closeSync(0);
      send({ id: message.id, result: { thread: { id: currentThreadId } } });
      setInterval(() => {}, 1000);
      return;
    }
    send({ id: message.id, result: { thread: { id: currentThreadId } } });
    return;
  }
  if (message.method === 'config/mcpServer/reload') {
    if (currentModel === 'delay-mcp-refresh') {
      setTimeout(() => send({ id: message.id, result: {} }), 100);
      return;
    }
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === 'turn/start') {
    currentTurnId = 'turn-' + process.pid + '-' + (++turnSequence);
    send({ id: message.id, result: { turn: { id: currentTurnId, status: 'inProgress' } } });
    send({ method: 'turn/started', params: { threadId: currentThreadId, turn: { id: currentTurnId, status: 'inProgress' } } });
    currentPrompt = message.params.input?.[0]?.text;
    if (currentPrompt === 'crash') {
      process.exit(9);
      return;
    }
    if (currentPrompt === 'wait' || currentPrompt === 'ignore-close') return;
    send({ method: 'turn/completed', params: { threadId: currentThreadId, turn: { id: currentTurnId, status: 'completed' } } });
    return;
  }
  if (message.method === 'turn/interrupt') {
    if (currentPrompt === 'ignore-close') return;
    send({ id: message.id, result: {} });
    send({ method: 'turn/completed', params: { threadId: currentThreadId, turn: { id: currentTurnId, status: 'interrupted' } } });
  }
});
`, 'utf8');
  chmodSync(bin, 0o755);
  return bin;
}

function readNdjson(path: string): Array<Record<string, unknown>> {
  try {
    const content = readFileSync(path, 'utf8').trim();
    if (content.length === 0) return [];
    return content.split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
