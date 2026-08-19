import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ScheduleRepository } from '../../src/scheduler/repository.js';
import type { InsertScheduleInput } from '../../src/scheduler/types.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('schedule repository', () => {
  it('creates schedules and maps booleans and nullable fields by id', () => {
    const repository = createRepository({ ids: ['sch_one'], now: '2026-07-06T00:00:00.000Z' });

    const inserted = repository.create(scheduleInput());
    const loaded = repository.getById('sch_one');

    expect(inserted).toMatchObject({
      id: 'sch_one',
      threadId: null,
      enabled: true,
      pendingTrigger: false,
      model: null,
      reasoning: null,
      timeoutMs: null,
      nextRunAt: '2026-07-06T09:00:00.000Z',
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      deletedAt: null,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z'
    });
    expect(loaded).toEqual(inserted);
  });

  it('persists and updates the dedicated thread binding', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      nowValues: ['2026-07-06T00:00:00.000Z', '2026-07-06T00:10:00.000Z']
    });

    const inserted = repository.create(scheduleInput({ threadId: 'thread_one' }));
    const updated = repository.update(inserted.id, { threadId: 'thread_two' });

    expect(inserted.threadId).toBe('thread_one');
    expect(updated?.threadId).toBe('thread_two');
    expect(repository.getById(inserted.id)?.threadId).toBe('thread_two');
  });

  it('lists non-deleted schedules newest first', () => {
    const repository = createRepository({
      ids: ['sch_old', 'sch_deleted', 'sch_new'],
      nowValues: [
        '2026-07-06T00:00:00.000Z',
        '2026-07-06T00:01:00.000Z',
        '2026-07-06T00:02:00.000Z',
        '2026-07-06T00:03:00.000Z'
      ]
    });
    repository.create(scheduleInput({ name: 'old' }));
    repository.create(scheduleInput({ name: 'deleted' }));
    repository.create(scheduleInput({ name: 'new' }));
    repository.softDelete('sch_deleted');

    expect(repository.list().map(schedule => schedule.id)).toEqual(['sch_new', 'sch_old']);
  });

  it('updates only provided fields and clears nullable fields', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      nowValues: ['2026-07-06T00:00:00.000Z', '2026-07-06T00:10:00.000Z']
    });
    repository.create(
      scheduleInput({
        name: 'before',
        enabled: true,
        model: 'gpt-5',
        reasoning: 'high',
        timeoutMs: 120000,
        nextRunAt: '2026-07-06T09:00:00.000Z'
      })
    );

    const updated = repository.update('sch_one', {
      enabled: false,
      model: null,
      reasoning: null,
      timeoutMs: null,
      nextRunAt: null
    });

    expect(updated).toMatchObject({
      id: 'sch_one',
      name: 'before',
      enabled: false,
      model: null,
      reasoning: null,
      timeoutMs: null,
      nextRunAt: null,
      updatedAt: '2026-07-06T00:10:00.000Z'
    });
    expect(repository.update('sch_one', {})).toEqual(updated);
  });

  it('soft deletes schedules and hides them from get and list', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      nowValues: ['2026-07-06T00:00:00.000Z', '2026-07-06T00:10:00.000Z']
    });
    repository.create(scheduleInput());

    expect(repository.softDelete('sch_one')).toBe(true);
    expect(repository.softDelete('sch_one')).toBe(false);
    expect(repository.getById('sch_one')).toBeNull();
    expect(repository.list()).toEqual([]);
  });

  it('lists due enabled non-deleted schedules by next run time', () => {
    const repository = createRepository({
      ids: ['sch_later', 'sch_disabled', 'sch_future', 'sch_earlier', 'sch_deleted']
    });
    repository.create(scheduleInput({ name: 'later', nextRunAt: '2026-07-06T08:30:00.000Z' }));
    repository.create(scheduleInput({ name: 'disabled', enabled: false, nextRunAt: '2026-07-06T08:00:00.000Z' }));
    repository.create(scheduleInput({ name: 'future', nextRunAt: '2026-07-06T10:00:00.000Z' }));
    repository.create(scheduleInput({ name: 'earlier', nextRunAt: '2026-07-06T08:00:00.000Z' }));
    repository.create(scheduleInput({ name: 'deleted', nextRunAt: '2026-07-06T07:00:00.000Z' }));
    repository.softDelete('sch_deleted');

    expect(repository.listDue('2026-07-06T09:00:00.000Z').map(schedule => schedule.id)).toEqual([
      'sch_earlier',
      'sch_later'
    ]);
  });

  it('returns the next enabled schedule by next run time', () => {
    const repository = createRepository({
      ids: ['sch_later', 'sch_disabled', 'sch_without_next', 'sch_earlier', 'sch_deleted']
    });
    repository.create(scheduleInput({ name: 'later', nextRunAt: '2026-07-06T08:30:00.000Z' }));
    repository.create(scheduleInput({ name: 'disabled', enabled: false, nextRunAt: '2026-07-06T07:00:00.000Z' }));
    repository.create(scheduleInput({ name: 'without next', nextRunAt: null }));
    repository.create(scheduleInput({ name: 'earlier', nextRunAt: '2026-07-06T08:00:00.000Z' }));
    repository.create(scheduleInput({ name: 'deleted', nextRunAt: '2026-07-06T06:00:00.000Z' }));
    repository.softDelete('sch_deleted');

    expect(repository.getNextEnabled()?.id).toBe('sch_earlier');
  });

  it('lists pending triggers for enabled non-deleted schedules', () => {
    const repository = createRepository({
      ids: ['sch_pending', 'sch_not_pending', 'sch_disabled', 'sch_deleted']
    });
    repository.create(scheduleInput({ name: 'pending' }));
    repository.create(scheduleInput({ name: 'not pending' }));
    repository.create(scheduleInput({ name: 'disabled', enabled: false }));
    repository.create(scheduleInput({ name: 'deleted' }));
    repository.setPendingTrigger('sch_pending', true);
    repository.setPendingTrigger('sch_disabled', true);
    repository.setPendingTrigger('sch_deleted', true);
    repository.softDelete('sch_deleted');

    expect(repository.listPendingTriggers().map(schedule => schedule.id)).toEqual(['sch_pending']);
  });

  it('records run metadata and clears pending trigger', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      nowValues: ['2026-07-06T00:00:00.000Z', '2026-07-06T00:01:00.000Z', '2026-07-06T00:02:00.000Z']
    });
    repository.create(scheduleInput());
    repository.setPendingTrigger('sch_one', true);

    const updated = repository.recordRun({
      id: 'sch_one',
      runId: 'run_one',
      ranAt: '2026-07-06T00:02:00.000Z',
      status: 'running'
    });

    expect(updated).toMatchObject({
      id: 'sch_one',
      lastRunAt: '2026-07-06T00:02:00.000Z',
      lastRunId: 'run_one',
      lastStatus: 'running',
      pendingTrigger: false,
      updatedAt: '2026-07-06T00:02:00.000Z'
    });
  });

  it('records skipped status without changing last run identity', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      nowValues: ['2026-07-06T00:00:00.000Z', '2026-07-06T00:01:00.000Z', '2026-07-06T00:02:00.000Z']
    });
    repository.create(scheduleInput());
    repository.recordRun({
      id: 'sch_one',
      runId: 'run_one',
      ranAt: '2026-07-06T00:01:00.000Z',
      status: 'running'
    });

    const updated = repository.recordSkipped({ id: 'sch_one', status: 'queued' });

    expect(updated).toMatchObject({
      id: 'sch_one',
      lastRunAt: '2026-07-06T00:01:00.000Z',
      lastRunId: 'run_one',
      lastStatus: 'queued',
      updatedAt: '2026-07-06T00:02:00.000Z'
    });
  });

  it('persists operation actors and keeps legacy actor-less rows readable', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      operationIds: ['schop_old', 'schop_new'],
      nowValues: [
        '2026-07-06T00:00:00.000Z',
        '2026-07-06T00:01:00.000Z',
        '2026-07-06T00:02:00.000Z'
      ]
    });
    repository.create(scheduleInput());

    const oldOperation = repository.insertOperation({
      scheduleId: 'sch_one',
      operation: 'run_queued',
      status: 'queued',
      runId: 'run_triggered'
    }, {
      type: 'agent',
      runId: 'run_actor'
    });
    const newOperation = repository.insertOperation({
      scheduleId: 'sch_one',
      operation: 'update',
      status: 'failed',
      errorCode: 'SCHEDULE_INVALID',
      errorMessage: 'bad cron'
    }, {
      type: 'user'
    });
    db?.prepare(`
      INSERT INTO schedule_operations (
        id, schedule_id, operation, status, created_at
      ) VALUES (
        'schop_legacy', 'sch_one', 'create', 'succeeded', '2026-07-06T00:00:30.000Z'
      )
    `).run();

    expect(repository.listOperations('sch_one')).toEqual([
      {
        ...newOperation,
        runId: null,
        actorType: 'user',
        actorRunId: null,
        errorCode: 'SCHEDULE_INVALID',
        errorMessage: 'bad cron'
      },
      {
        ...oldOperation,
        runId: 'run_triggered',
        actorType: 'agent',
        actorRunId: 'run_actor',
        errorCode: null,
        errorMessage: null
      },
      {
        id: 'schop_legacy',
        scheduleId: 'sch_one',
        operation: 'create',
        status: 'succeeded',
        runId: null,
        actorType: null,
        actorRunId: null,
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-07-06T00:00:30.000Z',
        diagnosticEvent: undefined
      }
    ]);
  });

  it('builds a safe trigger-to-thread-and-run trace without prompt or result content', () => {
    const repository = createRepository({
      ids: ['sch_one'],
      operationIds: ['schop_trigger'],
      nowValues: [
        '2026-07-06T00:00:00.000Z',
        '2026-07-06T01:00:00.000Z'
      ]
    });
    repository.create(scheduleInput({
      threadId: 'thread_task',
      prompt: 'TOKEN=private-schedule-prompt'
    }));
    db?.prepare(`
      INSERT INTO runs (
        id, thread_id, public_status, internal_status, created_by, source_id,
        public_prompt, triggered_at, profile, cwd, canonical_cwd, workspace_mode,
        sandbox, codex_version, codex_bin, codex_home, normalizer_version,
        started_at, ended_at, error_code, error_message
      ) VALUES (
        'run_schedule', 'thread_task', 'failed', 'failed', 'schedule', 'sch_one',
        'TOKEN=private-public-prompt', '2026-07-06T01:00:00.000Z',
        'default', @cwd, @cwd, 'external', 'read-only', 'test', 'codex',
        @codexHome, 1, '2026-07-06T01:00:01.000Z', '2026-07-06T01:00:03.000Z',
        'RUN_FAILED', 'TOKEN=private-error-result'
      )
    `).run({
      cwd: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });
    repository.insertOperation({
      scheduleId: 'sch_one',
      operation: 'run_queued',
      status: 'succeeded',
      runId: 'run_schedule'
    }, {
      type: 'timer'
    });
    db?.prepare(`
      INSERT INTO approvals (
        id, run_id, thread_id, turn_id, item_id, request_id, kind, status, risk,
        title, summary, details_json, requested_at, expires_at, resolved_at
      ) VALUES (
        'approval_schedule', 'run_schedule', 'thread_task', 'turn_1', 'item_1',
        'request_1', 'command_execution', 'approved', 'medium', 'Approve command',
        'TOKEN=private-summary', '{"result":"TOKEN=private-result"}',
        '2026-07-06T01:00:02.000Z', '2026-07-06T01:10:00.000Z',
        '2026-07-06T01:00:02.500Z'
      )
    `).run();

    const trace = repository.getRunTrace('run_schedule');

    expect(trace).toEqual({
      scheduleId: 'sch_one',
      threadId: 'thread_task',
      runId: 'run_schedule',
      triggerType: 'run_queued',
      actorType: 'timer',
      actorRunId: null,
      scheduledAt: '2026-07-06T01:00:00.000Z',
      startedAt: '2026-07-06T01:00:01.000Z',
      endedAt: '2026-07-06T01:00:03.000Z',
      status: 'failed',
      queueReason: 'thread_active',
      errorCode: 'RUN_FAILED',
      events: [
        {
          type: 'SCHEDULE_TRIGGERED',
          occurredAt: '2026-07-06T01:00:00.000Z',
          operationId: 'schop_trigger'
        },
        {
          type: 'SCHEDULE_RUN_STARTED',
          occurredAt: '2026-07-06T01:00:01.000Z'
        },
        {
          type: 'SCHEDULE_RUN_WAITING_APPROVAL',
          occurredAt: '2026-07-06T01:00:02.000Z'
        },
        {
          type: 'SCHEDULE_RUN_COMPLETED',
          occurredAt: '2026-07-06T01:00:03.000Z',
          errorCode: 'RUN_FAILED'
        }
      ]
    });
    expect(JSON.stringify(trace)).not.toMatch(/private|prompt|result/i);
  });

});

function createRepository(input: {
  ids?: string[];
  operationIds?: string[];
  now?: string;
  nowValues?: string[];
} = {}): ScheduleRepository {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-schedule-repository-'));
  db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const ids = [...(input.ids ?? [])];
  const operationIds = [...(input.operationIds ?? [])];
  const nowValues = [...(input.nowValues ?? [])];
  return new ScheduleRepository(db, {
    idFactory: () => ids.shift() ?? 'sch_default',
    operationIdFactory: () => operationIds.shift() ?? 'schop_default',
    now: () => nowValues.shift() ?? input.now ?? '2026-07-06T00:00:00.000Z'
  });
}

function scheduleInput(overrides: Partial<InsertScheduleInput> = {}): InsertScheduleInput {
  return {
    name: 'daily status',
    cron: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    enabled: true,
    prompt: 'Summarize project status',
    promptHash: 'hash_one',
    promptPreviewRedacted: 'Summarize project status',
    profile: 'default',
    cwd: tempDir,
    canonicalCwd: tempDir,
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    timeoutMs: null,
    concurrencyPolicy: 'queue',
    misfirePolicy: 'skip',
    nextRunAt: '2026-07-06T09:00:00.000Z',
    ...overrides
  };
}
