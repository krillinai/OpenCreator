import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageScheduler } from '../../src/creator/stage-scheduler.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator stage scheduler', () => {
  it('atomically claims one queued StageRun across two schedulers', async () => {
    const fixture = setup();
    const runStageRun = vi.fn(async (id: string) => {
      fixture.repository.updateStageRun({ id, status: 'succeeded' });
      return fixture.repository.getStageRun(id)!;
    });
    const first = createCreatorStageScheduler({
      repository: fixture.repository,
      runner: { runStageRun },
      owner: 'scheduler-a',
      pollIntervalMs: 60_000
    });
    const second = createCreatorStageScheduler({
      repository: fixture.repository,
      runner: { runStageRun },
      owner: 'scheduler-b',
      pollIntervalMs: 60_000
    });

    await expect.poll(() => runStageRun.mock.calls.length).toBe(1);
    await expect.poll(() => fixture.repository.getStageRun(fixture.stageRunId)?.dispatchStatus)
      .toBe('finished');
    expect(fixture.repository.getStageRun(fixture.stageRunId)?.attempt).toBe(1);
    await Promise.all([first.close(), second.close()]);
    fixture.db.close();
  });

  it('reclaims an expired claim after restart without creating another StageRun', async () => {
    const fixture = setup();
    const initial = fixture.repository.claimStageRun({
      id: fixture.stageRunId,
      owner: 'dead-daemon',
      now: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T00:00:01.000Z'
    });
    expect(initial?.attempt).toBe(1);
    const runStageRun = vi.fn(async (id: string) => {
      fixture.repository.updateStageRun({ id, status: 'succeeded' });
      return fixture.repository.getStageRun(id)!;
    });
    const scheduler = createCreatorStageScheduler({
      repository: fixture.repository,
      runner: { runStageRun },
      owner: 'restarted-daemon',
      now: () => Date.parse('2026-08-21T00:00:02.000Z'),
      pollIntervalMs: 60_000
    });

    await expect.poll(() => runStageRun).toHaveBeenCalledTimes(1);
    expect(fixture.repository.listStageRuns(fixture.jobId)).toHaveLength(1);
    expect(fixture.repository.getStageRun(fixture.stageRunId)).toMatchObject({
      attempt: 2,
      dispatchStatus: 'finished',
      status: 'succeeded'
    });
    await scheduler.close();
    fixture.db.close();
  });
});

function setup() {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-scheduler-'));
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const job = service.createJob({
    projectId: 'project-1',
    templateId: 'video-translation',
    state: { sourceUrl: 'https://www.youtube.com/watch?v=test' }
  });
  const stage = repository.createStageRun({
    jobId: job.id,
    stageId: 'subtitle',
    executor: 'krillin',
    status: 'queued',
    dispatchStatus: 'queued',
    idempotencyKey: 'stage-1'
  });
  return { db, repository, jobId: job.id, stageRunId: stage.id };
}
