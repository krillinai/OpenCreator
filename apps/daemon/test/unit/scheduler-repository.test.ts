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

  it('inserts and lists operations newest first with nullable fields mapped', () => {
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
      runId: 'run_one'
    });
    const newOperation = repository.insertOperation({
      scheduleId: 'sch_one',
      operation: 'update',
      status: 'failed',
      errorCode: 'SCHEDULE_INVALID',
      errorMessage: 'bad cron'
    });

    expect(repository.listOperations('sch_one')).toEqual([
      {
        ...newOperation,
        runId: null,
        errorCode: 'SCHEDULE_INVALID',
        errorMessage: 'bad cron'
      },
      {
        ...oldOperation,
        runId: 'run_one',
        errorCode: null,
        errorMessage: null
      }
    ]);
  });

  it('detects active runs only for matching schedule source', () => {
    const repository = createRepository();
    insertRun('run_created', {
      createdBy: 'schedule',
      sourceId: 'sch_created',
      publicStatus: 'failed',
      internalStatus: 'created'
    });
    insertRun('run_spawning', {
      createdBy: 'schedule',
      sourceId: 'sch_spawning',
      publicStatus: 'failed',
      internalStatus: 'spawning'
    });
    insertRun('run_queued', { createdBy: 'schedule', sourceId: 'sch_queued', publicStatus: 'queued' });
    insertRun('run_running', { createdBy: 'schedule', sourceId: 'sch_running', publicStatus: 'running' });
    insertRun('run_canceling', {
      createdBy: 'schedule',
      sourceId: 'sch_canceling',
      publicStatus: 'canceled',
      internalStatus: 'canceling'
    });
    insertRun('run_done', { createdBy: 'schedule', sourceId: 'sch_done', publicStatus: 'succeeded' });
    insertRun('run_api', { createdBy: 'api', sourceId: 'sch_one', publicStatus: 'running' });

    expect(repository.hasActiveRunForSource('schedule', 'sch_created')).toBe(true);
    expect(repository.hasActiveRunForSource('schedule', 'sch_spawning')).toBe(true);
    expect(repository.hasActiveRunForSource('schedule', 'sch_queued')).toBe(true);
    expect(repository.hasActiveRunForSource('schedule', 'sch_running')).toBe(true);
    expect(repository.hasActiveRunForSource('schedule', 'sch_canceling')).toBe(true);
    expect(repository.hasActiveRunForSource('schedule', 'sch_done')).toBe(false);
    expect(repository.hasActiveRunForSource('schedule', 'sch_one')).toBe(false);
    expect(repository.hasActiveRunForSource('schedule', 'missing')).toBe(false);
  });
});

function createRepository(input: {
  ids?: string[];
  operationIds?: string[];
  now?: string;
  nowValues?: string[];
} = {}): ScheduleRepository {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-schedule-repository-'));
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

function insertRun(
  id: string,
  input: { createdBy: string; sourceId: string; publicStatus: string; internalStatus?: string }
): void {
  db
    ?.prepare(
      `
      INSERT INTO runs (
        id, public_status, internal_status, created_by, source_id, profile, cwd, canonical_cwd,
        workspace_mode, sandbox, codex_version, codex_bin, codex_home, normalizer_version
      ) VALUES (
        @id, @publicStatus, @internalStatus, @createdBy, @sourceId, 'default', @cwd, @cwd,
        'external', 'read-only', 'test', 'codex', @codexHome, 1
      )
    `
    )
    .run({
      id,
      ...input,
      internalStatus: input.internalStatus ?? input.publicStatus,
      cwd: tempDir,
      codexHome: join(tempDir, 'codex-home')
    });
}
