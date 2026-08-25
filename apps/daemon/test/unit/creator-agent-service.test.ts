import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppServerApprovalDecision } from '../../src/codex/app-server-host-2026-07-28.js';
import { createCreatorAgentService } from '../../src/creator/agent/agent-service.js';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import type { AgentRuntimeAdapter } from '../../src/creator/agent/runtime-adapter.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator agent service', () => {
  it('creates and updates the Creator Thread with the requested access level', async () => {
    let turnNumber = 0;
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-sandbox',
      available: true,
      async runTurn() {
        turnNumber += 1;
        return { content: '已完成', runtimeTurnId: `runtime-turn-sandbox-${turnNumber}` };
      }
    };
    const fixture = setup(runtime);

    await fixture.agent.runTurn(fixture.jobId, {
      message: '使用完全访问处理',
      sandbox: 'danger-full-access'
    });
    expect(fixture.threads.current()?.sandbox).toBe('danger-full-access');
    expect(fixture.agent.getTimeline(fixture.jobId).session?.sandbox).toBe('danger-full-access');

    await fixture.agent.runTurn(fixture.jobId, {
      message: '切回请求批准',
      sandbox: 'workspace-write'
    });
    expect(fixture.threads.current()?.sandbox).toBe('workspace-write');
    expect(fixture.agent.getTimeline(fixture.jobId).session?.sandbox).toBe('workspace-write');
    fixture.db.close();
  });

  it('persists duplicate runtime events once and never regresses a terminal item', async () => {
    const runtime: AgentRuntimeAdapter = {
      id: 'fake',
      available: true,
      async runTurn(input) {
        input.onStarted?.({ pid: 101, generation: 7, reused: false });
        const completed = {
          method: 'item/completed',
          params: {
            item: { id: 'runtime-item-1', type: 'agentMessage', text: '真实结果' }
          }
        };
        await input.onNotification?.(completed);
        await input.onNotification?.(completed);
        await input.onNotification?.({
          method: 'item/started',
          params: {
            item: { id: 'runtime-item-1', type: 'agentMessage', text: '迟到事件' }
          }
        });
        return {
          content: '真实结果',
          runtimeThreadId: 'runtime-thread-1',
          runtimeTurnId: 'runtime-turn-1',
          processGeneration: 7
        };
      }
    };
    const fixture = setup(runtime);

    await fixture.agent.runTurn(fixture.jobId, {
      message: '处理视频',
      clientMessageId: 'message-1'
    });

    const timeline = fixture.agent.getTimeline(fixture.jobId)!;
    const runtimeItems = timeline.items.filter(item => item.runtimeItemId === 'runtime-item-1');
    const completedEvents = fixture.agent.listEvents(fixture.jobId)
      .filter(event => event.name === 'item/completed');
    expect(runtimeItems).toHaveLength(1);
    expect(runtimeItems[0]).toMatchObject({ status: 'completed', text: '真实结果' });
    expect(completedEvents).toHaveLength(1);
    expect(timeline.turns.at(-1)).toMatchObject({
      status: 'completed',
      runtimeTurnId: 'runtime-turn-1',
      content: '真实结果'
    });
    fixture.db.close();
  });

  it('persists final-answer deltas while the turn is still running', async () => {
    const release = deferred<void>();
    const streamed = deferred<void>();
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-streaming',
      available: true,
      async runTurn(input) {
        await input.onNotification?.({
          method: 'item/started',
          params: {
            item: {
              id: 'runtime-message-stream',
              type: 'agentMessage',
              phase: 'final_answer',
              text: ''
            }
          }
        });
        await input.onNotification?.({
          method: 'item/agentMessage/delta',
          params: { itemId: 'runtime-message-stream', delta: '正在生成' }
        });
        streamed.resolve();
        await release.promise;
        return { content: '正在生成结果', runtimeTurnId: 'runtime-turn-stream' };
      }
    };
    const fixture = setup(runtime);
    const turnPromise = fixture.agent.runTurn(fixture.jobId, { message: '生成结果' });

    await streamed.promise;
    expect(fixture.agent.getTimeline(fixture.jobId).turns.at(-1)).toMatchObject({
      status: 'running',
      content: '正在生成'
    });
    expect(fixture.agent.getTimeline(fixture.jobId).items.find(item => (
      item.runtimeItemId === 'runtime-message-stream'
    ))).toMatchObject({ status: 'running', text: '正在生成' });

    release.resolve();
    await turnPromise;
    expect(fixture.agent.getTimeline(fixture.jobId).turns.at(-1)).toMatchObject({
      status: 'completed',
      content: '正在生成结果'
    });
    fixture.db.close();
  });

  it('auto-approves OpenCreator write tools in full-access mode', async () => {
    let observedDecision: AppServerApprovalDecision | undefined;
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-full-access-creator-tool',
      available: true,
      async runTurn(input) {
        observedDecision = await input.onApprovalRequest?.({
          id: 'approval-write-1',
          method: 'mcpServer/elicitation/request',
          params: {
            serverName: 'opencreator_tools',
            mode: 'form',
            message: 'Allow the opencreator_tools MCP server to run tool "creator_apply_action"?',
            requestedSchema: { type: 'object', properties: {} }
          }
        });
        return { content: '已更新设置', runtimeTurnId: 'runtime-turn-full-access' };
      }
    };
    const fixture = setup(runtime);

    await fixture.agent.runTurn(fixture.jobId, {
      message: '更新字幕设置',
      sandbox: 'danger-full-access'
    });

    expect(observedDecision).toBe('approved');
    expect(fixture.agent.getTimeline(fixture.jobId).approvals).toEqual([]);
    fixture.db.close();
  });

  it('finalizes a running tool item when its assistant turn completes', async () => {
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-incomplete-tool-event',
      available: true,
      async runTurn(input) {
        await input.onNotification?.({
          method: 'item/started',
          params: {
            item: {
              id: 'runtime-tool-1',
              type: 'mcpToolCall',
              server: 'opencreator_tools',
              tool: 'creator_apply_action'
            }
          }
        });
        return {
          content: '样式已更新',
          runtimeTurnId: 'runtime-turn-1'
        };
      }
    };
    const fixture = setup(runtime);

    await fixture.agent.runTurn(fixture.jobId, { message: '把字幕换成粉色' });

    expect(fixture.agent.getTimeline(fixture.jobId).items.find(item => (
      item.runtimeItemId === 'runtime-tool-1'
    ))).toMatchObject({ status: 'completed' });
    fixture.db.close();
  });

  it('fails a running tool item when its assistant turn fails', async () => {
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-failed-tool-event',
      available: true,
      async runTurn(input) {
        await input.onNotification?.({
          method: 'item/started',
          params: {
            item: {
              id: 'runtime-tool-failed',
              type: 'mcpToolCall',
              server: 'opencreator_tools',
              tool: 'creator_apply_action'
            }
          }
        });
        throw new Error('runtime failed');
      }
    };
    const fixture = setup(runtime);

    await expect(fixture.agent.runTurn(fixture.jobId, { message: '更新字幕样式' }))
      .rejects.toThrow('runtime failed');

    expect(fixture.agent.getTimeline(fixture.jobId).items.find(item => (
      item.runtimeItemId === 'runtime-tool-failed'
    ))).toMatchObject({ status: 'failed' });
    fixture.db.close();
  });

  it('keeps a pending approval resumable in the same process generation', async () => {
    let observedDecision: AppServerApprovalDecision | undefined;
    const runtime = approvalRuntime(4, decision => {
      observedDecision = decision;
    });
    const fixture = setup(runtime);
    const turnPromise = fixture.agent.runTurn(fixture.jobId, {
      message: '执行需要审批的操作',
      clientMessageId: 'message-approval'
    });
    const approval = await waitForApproval(fixture.agent, fixture.jobId);

    expect(fixture.agent.getTimeline(fixture.jobId)?.turns.at(-1)?.status)
      .toBe('waiting_approval');
    expect(fixture.agent.respondApproval(approval.id, 'approved', 4).status)
      .toBe('approved');
    await turnPromise;

    expect(observedDecision).toBe('approved');
    expect(fixture.agent.getTimeline(fixture.jobId)).toMatchObject({
      approvals: [{ status: 'approved' }]
    });
    expect(fixture.agent.getTimeline(fixture.jobId)?.turns.at(-1)?.status)
      .toBe('completed');
    fixture.db.close();
  });

  it('auto-approves read-only Creator tools without creating an approval gate', async () => {
    let observedDecision: AppServerApprovalDecision | undefined;
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-read-only-tool',
      available: true,
      async runTurn(input) {
        input.onStarted?.({ pid: 101, generation: 4, reused: false });
        observedDecision = await input.onApprovalRequest?.({
          id: 'approval-request-read-only',
          method: 'mcpServer/elicitation/request',
          params: {
            serverName: 'opencreator_tools',
            message: 'Allow the opencreator_tools MCP server to run tool "creator_get_context"?',
            _meta: { codex_approval_kind: 'mcp_tool_call' }
          }
        });
        return {
          content: '已读取当前状态',
          runtimeThreadId: 'runtime-thread-1',
          runtimeTurnId: 'runtime-turn-1',
          processGeneration: 4
        };
      }
    };
    const fixture = setup(runtime);

    await fixture.agent.runTurn(fixture.jobId, {
      message: '读取当前状态',
      clientMessageId: 'message-read-only'
    });

    expect(observedDecision).toBe('approved');
    expect(fixture.agent.getTimeline(fixture.jobId).approvals).toHaveLength(0);
    fixture.db.close();
  });

  it('expires an approval instead of responding across process generations', async () => {
    let observedDecision: AppServerApprovalDecision | undefined;
    const runtime = approvalRuntime(3, decision => {
      observedDecision = decision;
    });
    const fixture = setup(runtime);
    const turnPromise = fixture.agent.runTurn(fixture.jobId, {
      message: '等待旧进程审批',
      clientMessageId: 'message-old-generation'
    });
    const approval = await waitForApproval(fixture.agent, fixture.jobId);

    const result = fixture.agent.respondApproval(approval.id, 'approved', 4);
    await turnPromise;

    expect(result).toMatchObject({
      status: 'expired',
      resolutionReason: 'process_generation_changed'
    });
    expect(observedDecision).toBe('expired');
    fixture.db.close();
  });

  it('uses native runtime steering for an active turn', async () => {
    const pending = deferred<{
      content: string;
      runtimeThreadId: string;
      runtimeTurnId: string;
      processGeneration: number;
    }>();
    const steer = vi.fn(async () => 'runtime-turn-active');
    const runtime: AgentRuntimeAdapter = {
      id: 'fake-steer',
      available: true,
      async runTurn(input) {
        input.onStarted?.({ pid: 101, generation: 5, reused: false });
        return pending.promise;
      },
      steer
    };
    const fixture = setup(runtime);
    const active = fixture.agent.runTurn(fixture.jobId, {
      message: '开始分析',
      clientMessageId: 'message-start'
    });
    await waitForActiveTurn(fixture.agent, fixture.jobId);

    const steered = await fixture.agent.steer(fixture.jobId, {
      message: '优先处理字幕',
      clientMessageId: 'message-steer'
    });
    expect(steer).toHaveBeenCalledWith(
      expect.any(String),
      '优先处理字幕',
      'message-steer'
    );
    expect(steered).toMatchObject({
      role: 'user',
      clientMessageId: 'message-steer',
      content: '优先处理字幕'
    });

    pending.resolve({
      content: '已处理',
      runtimeThreadId: 'runtime-thread-1',
      runtimeTurnId: 'runtime-turn-active',
      processGeneration: 5
    });
    await active;
    fixture.db.close();
  });
});

function setup(runtime: AgentRuntimeAdapter) {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-agent-service-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const agentRepository = createCreatorAgentRepository(db);
  const templates = createDefaultCreatorTemplateRegistry();
  const creator = createCreatorService({ repository, templates });
  const job = creator.createJob({
    projectId: 'project-1',
    templateId: 'video-translation'
  });
  const dispatcher = createCreatorCommandDispatcher({
    service: creator,
    repository,
    receipts: agentRepository
  });
  const threads = threadFixture();
  const agent = createCreatorAgentService({
    creator,
    dispatcher,
    repository: agentRepository,
    threads,
    contextBuilder: createAgentContextBuilder({ templates }),
    runtime
  });
  return { db, jobId: job.id, agent, threads };
}

function approvalRuntime(
  generation: number,
  observe: (decision: AppServerApprovalDecision) => void
): AgentRuntimeAdapter {
  return {
    id: 'fake-approval',
    available: true,
    async runTurn(input) {
      input.onStarted?.({ pid: 101, generation, reused: false });
      const decision = await input.onApprovalRequest?.({
        id: 'approval-request-1',
        method: 'item/commandExecution/requestApproval',
        params: { itemId: 'approval-item-1', reason: '需要执行真实命令' }
      });
      observe(decision ?? 'canceled');
      return {
        content: '审批流程结束',
        runtimeThreadId: 'runtime-thread-1',
        runtimeTurnId: 'runtime-turn-1',
        processGeneration: generation
      };
    }
  };
}

function threadFixture() {
  type FixtureThread = {
    id: string;
    sandbox: 'workspace-write' | 'danger-full-access';
  };
  const threads = new Map<string, FixtureThread>();
  return {
    createThread(request: { sandbox?: FixtureThread['sandbox'] }) {
      const thread: FixtureThread = {
        id: `thread-${threads.size + 1}`,
        sandbox: request.sandbox ?? 'workspace-write'
      };
      threads.set(thread.id, thread);
      return thread as never;
    },
    getThread(id: string) {
      return threads.get(id) as never;
    },
    updateThread(id: string, request: { sandbox?: FixtureThread['sandbox'] }) {
      const current = threads.get(id);
      if (current === undefined) throw new Error('thread not found');
      const updated = { ...current, sandbox: request.sandbox ?? current.sandbox };
      threads.set(id, updated);
      return updated as never;
    },
    current() {
      return [...threads.values()].at(-1);
    }
  };
}

async function waitForApproval(
  agent: ReturnType<typeof createCreatorAgentService>,
  jobId: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const approval = agent.getTimeline(jobId)?.approvals[0];
    if (approval !== undefined) return approval;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Approval was not persisted');
}

async function waitForActiveTurn(
  agent: ReturnType<typeof createCreatorAgentService>,
  jobId: string
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (agent.getTimeline(jobId).turns.some(turn => turn.status === 'running')) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Active turn was not persisted');
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
