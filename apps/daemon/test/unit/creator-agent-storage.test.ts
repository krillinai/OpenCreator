import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator agent storage', () => {
  it('reopens a complete Agent timeline and command receipt', () => {
    const fixture = createFixture();
    const session = fixture.agent.createSession({
      jobId: fixture.jobId,
      threadId: 'thread-1',
      runtimeThreadId: 'runtime-thread-1',
      hostGeneration: 3
    });
    const turn = fixture.agent.createTurn({
      jobId: fixture.jobId,
      sessionId: session.id,
      clientMessageId: 'message-1',
      runtimeTurnId: 'runtime-turn-1',
      role: 'user',
      content: '请翻译视频',
      status: 'running'
    });
    const item = fixture.agent.insertItem({
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: turn.id,
      runtimeItemId: 'runtime-item-1',
      kind: 'tool_call',
      status: 'running',
      toolName: 'creator_apply_action',
      sequence: 1,
      data: { action: 'run-stage' }
    });
    fixture.agent.appendEvent({
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: turn.id,
      itemId: item.id,
      type: 'item',
      name: 'item.started',
      runtimeEventKey: 'runtime-turn-1:item-1:started'
    });
    fixture.agent.createApproval({
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: turn.id,
      itemId: item.id,
      runtimeRequestId: 'request-1',
      processGeneration: 3,
      kind: 'tool_call',
      status: 'pending',
      title: '执行字幕阶段',
      summary: '需要确认',
      details: {},
      requestedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:10:00.000Z'
    });
    fixture.agent.createReceipt({
      jobId: fixture.jobId,
      actor: 'agent',
      command: 'run-stage',
      idempotencyKey: 'command-1',
      requestHash: 'hash-1',
      expectedRevision: 0,
      committedRevision: 1,
      status: 'committed',
      result: { ok: true },
      errorCode: null,
      errorMessage: null,
      stageRunId: null
    });
    fixture.db.close();

    const reopenedDb = openRuntimeDatabase(fixture.path);
    const reopened = createCreatorAgentRepository(reopenedDb);
    const timeline = reopened.timeline(fixture.jobId);
    const receipt = reopened.getReceiptByKey(fixture.jobId, 'command-1');
    reopenedDb.close();

    expect(timeline).toMatchObject({
      session: { runtimeThreadId: 'runtime-thread-1', hostGeneration: 3 },
      turns: [{ runtimeTurnId: 'runtime-turn-1', content: '请翻译视频' }],
      items: [{ runtimeItemId: 'runtime-item-1', toolName: 'creator_apply_action' }],
      approvals: [{ runtimeRequestId: 'request-1', processGeneration: 3 }],
      lastEventSequence: 1
    });
    expect(receipt).toMatchObject({
      requestHash: 'hash-1',
      committedRevision: 1,
      result: { ok: true }
    });
  });

  it('enforces stable runtime item and idempotency keys', () => {
    const fixture = createFixture();
    const session = fixture.agent.createSession({
      jobId: fixture.jobId,
      threadId: 'thread-1'
    });
    const turn = fixture.agent.createTurn({
      jobId: fixture.jobId,
      sessionId: session.id,
      role: 'user',
      content: '开始',
      status: 'running'
    });
    const itemInput = {
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: turn.id,
      runtimeItemId: 'runtime-item-1',
      kind: 'assistant_message' as const,
      status: 'completed' as const,
      sequence: 1
    };
    fixture.agent.insertItem(itemInput);
    expect(() => fixture.agent.insertItem({ ...itemInput, sequence: 2 }))
      .toThrow(/UNIQUE constraint failed/);

    const event = fixture.agent.appendEvent({
      jobId: fixture.jobId,
      sessionId: session.id,
      type: 'runtime',
      name: 'turn.completed',
      runtimeEventKey: 'turn-1:completed'
    });
    expect(fixture.agent.appendEvent({
      jobId: fixture.jobId,
      sessionId: session.id,
      type: 'runtime',
      name: 'turn.completed',
      runtimeEventKey: 'turn-1:completed'
    }).id).toBe(event.id);

    const receipt = {
      jobId: fixture.jobId,
      actor: 'user' as const,
      command: 'set-language',
      idempotencyKey: 'same-key',
      requestHash: 'hash-a',
      expectedRevision: 0,
      committedRevision: 1,
      status: 'committed' as const,
      result: null,
      errorCode: null,
      errorMessage: null,
      stageRunId: null
    };
    fixture.agent.createReceipt(receipt);
    expect(() => fixture.agent.createReceipt({ ...receipt, requestHash: 'hash-b' }))
      .toThrow(/UNIQUE constraint failed/);
    fixture.db.close();
  });

  it('marks nonterminal Agent state for explicit recovery', () => {
    const fixture = createFixture();
    const session = fixture.agent.createSession({
      jobId: fixture.jobId,
      threadId: 'thread-1',
      hostGeneration: 4
    });
    const turn = fixture.agent.createTurn({
      jobId: fixture.jobId,
      sessionId: session.id,
      role: 'user',
      content: '等待审批',
      status: 'waiting_approval'
    });
    const item = fixture.agent.insertItem({
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: turn.id,
      kind: 'approval',
      status: 'running',
      sequence: 1
    });
    const completedTurn = fixture.agent.createTurn({
      jobId: fixture.jobId,
      sessionId: session.id,
      role: 'assistant',
      content: '已经完成',
      status: 'completed'
    });
    const staleCompletedItem = fixture.agent.insertItem({
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: completedTurn.id,
      kind: 'tool_call',
      status: 'running',
      sequence: 1
    });
    fixture.agent.createApproval({
      jobId: fixture.jobId,
      sessionId: session.id,
      turnId: turn.id,
      itemId: item.id,
      runtimeRequestId: 'request-1',
      processGeneration: 4,
      kind: 'tool_call',
      status: 'pending',
      title: '确认',
      summary: '确认执行',
      details: {},
      requestedAt: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:10:00.000Z'
    });

    expect(fixture.agent.markForRecovery()).toEqual({
      sessions: 1,
      turns: 1,
      approvals: 1
    });
    expect(fixture.agent.timeline(fixture.jobId)).toMatchObject({
      session: { status: 'interrupted' },
      approvals: [{ status: 'expired', resolutionReason: 'daemon_restarted' }]
    });
    expect(fixture.agent.getItem(item.id)?.status).toBe('interrupted');
    expect(fixture.agent.getItem(staleCompletedItem.id)?.status).toBe('completed');
    fixture.db.close();
  });

  it('recreates Agent tables when upgrading a database from the previous schema', () => {
    const fixture = createFixture();
    fixture.db.exec(`
      DROP TABLE creator_command_receipts;
      DROP TABLE creator_agent_approvals;
      DROP TABLE creator_agent_events;
      DROP TABLE creator_agent_items;
      DROP TABLE creator_agent_turns;
      DROP TABLE creator_agent_sessions;
    `);
    fixture.db.close();

    const upgraded = openRuntimeDatabase(fixture.path);
    const tables = upgraded.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'creator_agent_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    upgraded.close();

    expect(tables.map(row => row.name)).toEqual([
      'creator_agent_approvals',
      'creator_agent_events',
      'creator_agent_items',
      'creator_agent_sessions',
      'creator_agent_turns'
    ]);
  });
});

function createFixture() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-agent-storage-'));
  const path = join(tempDir, 'app.sqlite');
  const db = openRuntimeDatabase(path);
  let sequence = 0;
  const creator = createCreatorRepository(db, {
    idFactory: prefix => `${prefix}_${++sequence}`,
    now: () => '2026-08-21T00:00:00.000Z'
  });
  const job = creator.createJob({
    projectId: 'project-1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: 'draft',
    state: {}
  });
  const agent = createCreatorAgentRepository(db, {
    idFactory: prefix => `${prefix}_${++sequence}`,
    now: () => '2026-08-21T00:00:00.000Z'
  });
  return { path, db, agent, jobId: job.id };
}
