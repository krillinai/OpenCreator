import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorAgentService } from '../../src/creator/agent/agent-service.js';
import { createAgentContextBuilder } from '../../src/creator/agent/context-builder.js';
import { createCreatorAgentReconciler } from '../../src/creator/agent/reconciler.js';
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

describe('creator agent recovery', () => {
  it('does not replay an unconfirmed turn and only continues after a new user message', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-agent-recovery-'));
    const dbPath = join(tempDir, 'runtime.sqlite');
    const firstDb = openRuntimeDatabase(dbPath);
    const firstCreatorRepository = createCreatorRepository(firstDb);
    const templates = createDefaultCreatorTemplateRegistry();
    const firstCreator = createCreatorService({
      repository: firstCreatorRepository,
      templates
    });
    const job = firstCreator.createJob({
      projectId: 'project-1',
      templateId: 'video-translation'
    });
    firstCreator.bindAgentThread(job.id, 'thread-1');
    const firstAgentRepository = createCreatorAgentRepository(firstDb);
    const session = firstAgentRepository.createSession({
      jobId: job.id,
      threadId: 'thread-1',
      runtimeThreadId: 'runtime-thread-1',
      hostGeneration: 2
    });
    const turn = firstAgentRepository.createTurn({
      jobId: job.id,
      sessionId: session.id,
      role: 'assistant',
      content: '',
      status: 'running',
      runtimeTurnId: 'runtime-turn-old'
    });
    const item = firstAgentRepository.insertItem({
      jobId: job.id,
      sessionId: session.id,
      turnId: turn.id,
      kind: 'approval',
      status: 'running',
      sequence: 1
    });
    firstAgentRepository.createApproval({
      jobId: job.id,
      sessionId: session.id,
      turnId: turn.id,
      itemId: item.id,
      runtimeRequestId: 'request-old',
      processGeneration: 2,
      kind: 'tool_call',
      status: 'pending',
      title: '旧审批',
      summary: '旧进程审批',
      details: {},
      requestedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:15:00.000Z'
    });
    firstDb.close();

    const db = openRuntimeDatabase(dbPath);
    const creatorRepository = createCreatorRepository(db);
    const agentRepository = createCreatorAgentRepository(db);
    const recovery = createCreatorAgentReconciler({ repository: agentRepository });
    expect(recovery.reconcileAfterDaemonRestart()).toEqual({
      sessions: 1,
      turns: 1,
      approvals: 1
    });
    const creator = createCreatorService({ repository: creatorRepository, templates });
    const runTurn = vi.fn<AgentRuntimeAdapter['runTurn']>().mockImplementation(async input => {
      input.onStarted?.({ pid: 202, generation: 3, reused: false });
      await input.onThreadRead?.({
        id: 'runtime-thread-1',
        turns: [{
          id: 'runtime-turn-old',
          status: 'completed',
          items: [{
            id: 'runtime-agent-message-old',
            type: 'agentMessage',
            text: '旧 Turn 实际已在 Codex 完成'
          }]
        }]
      });
      return {
        content: '已根据新消息继续',
        runtimeThreadId: 'runtime-thread-1',
        runtimeTurnId: 'runtime-turn-new',
        processGeneration: 3
      };
    });
    const dispatcher = createCreatorCommandDispatcher({
      service: creator,
      repository: creatorRepository,
      receipts: agentRepository
    });
    const agent = createCreatorAgentService({
      creator,
      dispatcher,
      repository: agentRepository,
      threads: {
        createThread: () => ({ id: 'thread-new' }) as never,
        getThread: id => id === 'thread-1' ? ({ id }) as never : undefined,
        updateThread: id => ({ id }) as never
      },
      contextBuilder: createAgentContextBuilder({ templates }),
      runtime: { id: 'fake', available: true, runTurn }
    });

    expect(runTurn).not.toHaveBeenCalled();
    expect(agent.getTimeline(job.id)).toMatchObject({
      session: { status: 'interrupted' },
      turns: [{ status: 'needs_user_resolution' }],
      approvals: [{ status: 'expired', resolutionReason: 'daemon_restarted' }]
    });

    await agent.runTurn(job.id, {
      message: '继续这个任务',
      clientMessageId: 'explicit-continuation'
    });

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(agent.getTimeline(job.id)?.turns.map(candidate => ({
      status: candidate.status,
      content: candidate.content
    }))).toEqual([
      { status: 'completed', content: '旧 Turn 实际已在 Codex 完成' },
      { status: 'completed', content: '继续这个任务' },
      { status: 'completed', content: '已根据新消息继续' }
    ]);
    db.close();
  });
});
