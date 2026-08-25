import { describe, expect, it, vi } from 'vitest';
import { createAgentCapabilityTokenStore } from '../../src/agent-tools/capability-token.js';
import type {
  AgentScheduleProcessInjector,
  AgentToolProcessInjection
} from '../../src/agent-tools/run-injection.js';
import type {
  CodexAppServerHost,
  CodexAppServerResult,
  CodexAppServerTurnInput
} from '../../src/codex/app-server-host-2026-07-28.js';
import {
  createAppServerRuntimeManager,
  type AppServerRuntimeManager,
  type AppServerRuntimeTurnInput
} from '../../src/codex/app-server-runtime-manager.js';
import type { RuntimeThread } from '../../src/threads/types.js';

describe('app-server runtime manager', () => {
  it('serializes turns in one scope and deactivates every completed turn', async () => {
    const first = deferred<CodexAppServerResult>();
    const second = deferred<CodexAppServerResult>();
    const host = fakeHost(101, [first.promise, second.promise]);
    const injection = fakeInjection();
    const manager = createManager({ host, injection });

    const turnA = manager.startTurn(turnInput({ runId: 'run-a', prompt: 'A' }));
    const turnB = manager.startTurn(turnInput({ runId: 'run-b', prompt: 'B' }));

    await turnA.started;
    expect(host.run).toHaveBeenCalledTimes(1);
    expect(manager.isScopeBusy({ kind: 'project', id: 'project-1' })).toBe(true);

    first.resolve(result('turn-a'));
    await turnA.result;
    await turnB.started;
    expect(host.run).toHaveBeenCalledTimes(2);
    expect(injection.deactivate).toHaveBeenNthCalledWith(1, 'run-a');

    second.resolve(result('turn-b'));
    await turnB.result;
    expect(injection.deactivate).toHaveBeenNthCalledWith(2, 'run-b');
    await manager.close();
  });

  it('allows independent scopes to own independent active hosts', async () => {
    const work = [deferred<CodexAppServerResult>(), deferred<CodexAppServerResult>()];
    const hosts = [
      fakeHost(201, [work[0]!.promise]),
      fakeHost(202, [work[1]!.promise])
    ];
    const createHost = vi.fn(() => hosts[createHost.mock.calls.length - 1]!);
    const manager = createAppServerRuntimeManager({
      codexBin: 'unused',
      codexHome: 'unused',
      createHost
    });

    const projectTurn = manager.startTurn(turnInput({ runId: 'project-run' }));
    const creatorTurn = manager.startTurn(turnInput({
      scope: { kind: 'creator-job', id: 'job-2' },
      runId: 'creator-run',
      jobId: 'job-2'
    }));

    await Promise.all([projectTurn.started, creatorTurn.started]);
    expect(createHost).toHaveBeenCalledTimes(2);
    expect(hosts[0]!.run).toHaveBeenCalledTimes(1);
    expect(hosts[1]!.run).toHaveBeenCalledTimes(1);

    work[0]!.resolve(result('project-turn'));
    work[1]!.resolve(result('creator-turn'));
    await Promise.all([projectTurn.result, creatorTurn.result]);
    await manager.close();
  });

  it('revokes the old process token when its host closes', async () => {
    const capabilities = createAgentCapabilityTokenStore();
    let token: string | undefined;
    const processInjector: AgentScheduleProcessInjector = {
      create() {
        const lease = capabilities.issueProcess({
          createdBy: 'api',
          maxScopes: ['creator:context', 'creator:action']
        });
        token = lease.token;
        return {
          mcpServers: [],
          env: {},
          activate(input) {
            lease.activate({
              runId: input.runId,
              threadId: input.thread.id,
              jobId: input.jobId,
              projectId: input.projectId,
              processGeneration: input.processGeneration,
              createdBy: input.createdBy,
              scopes: ['creator:context', 'creator:action']
            });
            return { manifestKey: input.runId };
          },
          deactivate: runId => { lease.deactivate(runId); },
          close: () => { lease.revoke(); }
        };
      }
    };
    const pending = deferred<CodexAppServerResult>();
    const host = fakeHost(301, [pending.promise]);
    const manager = createAppServerRuntimeManager({
      codexBin: 'unused',
      codexHome: 'unused',
      createHost: () => host,
      processInjector
    });
    const active = manager.startTurn(turnInput({
      scope: { kind: 'creator-job', id: 'job-1' },
      jobId: 'job-1'
    }));
    const started = await active.started;

    expect(capabilities.authorize(token, {
      scope: 'creator:action',
      jobId: 'job-1',
      processGeneration: started.generation
    })).toMatchObject({ jobId: 'job-1' });
    expect(() => capabilities.authorize(token, {
      scope: 'creator:action',
      jobId: 'job-2'
    })).toThrowError(/job binding/i);
    expect(() => capabilities.authorize(token, {
      scope: 'creator:action',
      processGeneration: started.generation + 1
    })).toThrowError(/generation/i);

    pending.resolve(result('turn-1'));
    await active.result;
    await manager.closeScope({ kind: 'creator-job', id: 'job-1' });
    expect(() => capabilities.inspect(token)).toThrowError(/invalid/i);
    capabilities.close();
    await manager.close();
  });

  it('does not evict a host while a turn is active or queued', async () => {
    const first = deferred<CodexAppServerResult>();
    const second = deferred<CodexAppServerResult>();
    const host = fakeHost(401, [first.promise, second.promise]);
    const manager = createManager({ host, maxIdleHosts: 0 });

    const active = manager.startTurn(turnInput({ runId: 'active' }));
    const queued = manager.startTurn(turnInput({ runId: 'queued' }));
    await active.started;
    await manager.sweepIdle();
    expect(host.close).not.toHaveBeenCalled();

    first.resolve(result('active-turn'));
    await active.result;
    await queued.started;
    expect(host.close).not.toHaveBeenCalled();
    second.resolve(result('queued-turn'));
    await queued.result;
    expect(host.close).toHaveBeenCalledWith('idle_evicted', undefined);
    await manager.close();
  });

  it('restarts with a new generation and process lease after config changes', async () => {
    const hosts = [
      fakeHost(501, [Promise.resolve(result('turn-1'))]),
      fakeHost(502, [Promise.resolve(result('turn-2'))])
    ];
    const injections = [fakeInjection(), fakeInjection()];
    const createHost = vi.fn(() => hosts[createHost.mock.calls.length - 1]!);
    const processInjector: AgentScheduleProcessInjector = {
      create: vi.fn(() => injections[(processInjector.create as ReturnType<typeof vi.fn>).mock.calls.length - 1])
    };
    const manager = createAppServerRuntimeManager({
      codexBin: 'unused',
      codexHome: 'unused',
      createHost,
      processInjector
    });

    const first = manager.startTurn(turnInput({
      runtimeInjection: { mcpServers: [], env: {}, configurationFingerprint: 'v1' }
    }));
    const firstStarted = await first.started;
    await first.result;

    const second = manager.startTurn(turnInput({
      runId: 'run-2',
      runtimeInjection: { mcpServers: [], env: {}, configurationFingerprint: 'v2' }
    }));
    const secondStarted = await second.started;
    await second.result;

    expect(secondStarted.generation).toBeGreaterThan(firstStarted.generation);
    expect(secondStarted.reused).toBe(false);
    expect(hosts[0]!.close).toHaveBeenCalledWith(
      'runtime_configuration_changed',
      undefined
    );
    expect(injections[0]!.close).toHaveBeenCalledTimes(1);
    expect(injections[1]!.activate).toHaveBeenCalledWith(expect.objectContaining({
      processGeneration: secondStarted.generation
    }));
    await manager.close();
  });

  it('requests thread reconciliation only when a new host resumes a thread', async () => {
    const host = fakeHost(601, [
      Promise.resolve(result('turn-1')),
      Promise.resolve(result('turn-2'))
    ]);
    const manager = createManager({ host });

    const first = manager.startTurn(turnInput({ codexThreadId: 'codex-thread' }));
    await first.result;
    const second = manager.startTurn(turnInput({
      runId: 'run-2',
      codexThreadId: 'codex-thread'
    }));
    await second.result;

    expect(host.run).toHaveBeenNthCalledWith(1, expect.objectContaining({
      codexThreadId: 'codex-thread',
      readThreadBeforeResume: true
    }));
    expect(host.run).toHaveBeenNthCalledWith(2, expect.objectContaining({
      codexThreadId: 'codex-thread',
      readThreadBeforeResume: false
    }));
    await manager.close();
  });

  it('allows callers to skip full thread reconciliation on a new host', async () => {
    const host = fakeHost(602, [Promise.resolve(result('turn-1'))]);
    const manager = createManager({ host });

    const execution = manager.startTurn(turnInput({
      codexThreadId: 'codex-thread',
      readThreadBeforeResume: false
    }));
    await execution.result;

    expect(host.run).toHaveBeenCalledWith(expect.objectContaining({
      codexThreadId: 'codex-thread',
      readThreadBeforeResume: false
    }));
    await manager.close();
  });
});

function createManager(input: {
  host: CodexAppServerHost;
  injection?: AgentToolProcessInjection;
  maxIdleHosts?: number;
}): AppServerRuntimeManager {
  return createAppServerRuntimeManager({
    codexBin: 'unused',
    codexHome: 'unused',
    createHost: vi.fn(() => input.host),
    processInjector: input.injection === undefined
      ? undefined
      : { create: vi.fn(() => input.injection) },
    maxIdleHosts: input.maxIdleHosts
  });
}

function fakeHost(
  pid: number,
  results: Array<Promise<CodexAppServerResult>>
): CodexAppServerHost {
  let runIndex = 0;
  return {
    pid,
    started: Promise.resolve(pid),
    run: vi.fn((_input: CodexAppServerTurnInput) => ({
      cancel: vi.fn(),
      result: results[runIndex++]!
    })),
    isReusable: vi.fn(() => true),
    close: vi.fn(async () => undefined)
  };
}

function fakeInjection(): AgentToolProcessInjection {
  return {
    mcpServers: [],
    env: {},
    activate: vi.fn(input => ({ manifestKey: input.runId })),
    deactivate: vi.fn(),
    close: vi.fn()
  };
}

function turnInput(
  overrides: Partial<AppServerRuntimeTurnInput> = {}
): AppServerRuntimeTurnInput {
  return {
    scope: { kind: 'project', id: 'project-1' },
    runId: 'run-1',
    thread: thread(),
    cwd: 'D:\\creator-project',
    profile: 'default',
    sandbox: 'workspace-write',
    prompt: 'complete',
    projectId: 'project-1',
    ...overrides
  };
}

function thread(): RuntimeThread {
  return {
    id: 'thread-1',
    title: '测试会话',
    projectId: 'project-1',
    enterpriseSubjectId: null,
    origin: 'opencreator_created',
    cwd: 'D:\\creator-project',
    canonicalCwd: 'D:\\creator-project',
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  };
}

function result(turnId: string): CodexAppServerResult {
  return {
    threadId: 'codex-thread',
    turnId,
    turnStatus: 'completed',
    stderr: '',
    terminationReason: 'completed',
    outputTruncation: {
      stderr: { truncated: false, droppedBytes: 0, droppedItems: 0 },
      frames: { truncated: false, droppedBytes: 0, droppedItems: 0 }
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
