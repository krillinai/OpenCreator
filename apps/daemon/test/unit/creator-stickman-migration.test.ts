import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { purgeLegacyStickmanJobs } from '../../src/creator/stickman/legacy-migration.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('legacy stickman migration', () => {
  it('purges only v1 jobs and resumes post-commit directory cleanup', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-migration-'));
    const jobsRoot = join(tempDir, 'jobs');
    mkdirSync(jobsRoot, { recursive: true });
    const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
    const repository = createCreatorRepository(db);
    const v1 = repository.createJob({ projectId: 'p1', templateId: 'stickman-video', templateVersion: 1, status: 'running', state: {} });
    const v2 = repository.createJob({ projectId: 'p1', templateId: 'stickman-video', templateVersion: 2, status: 'draft', state: {} });
    const other = repository.createJob({ projectId: 'p1', templateId: 'cover', templateVersion: 2, status: 'draft', state: {} });
    for (const job of [v1, v2, other]) {
      mkdirSync(join(jobsRoot, job.id), { recursive: true });
      writeFileSync(join(jobsRoot, job.id, 'marker.txt'), job.id);
    }
    const stage = repository.createStageRun({ jobId: v1.id, stageId: 'render', executor: 'stickman', status: 'failed' });
    repository.insertArtifact({ jobId: v1.id, kind: 'stickman_video', status: 'completed', path: null, sourceArtifactIds: [], metadata: {} });
    repository.createProviderRequest({
      jobId: v1.id,
      provider: 'test',
      stageRunId: stage.id,
      requestKey: 'legacy-request',
      requestHash: 'a'.repeat(64),
      status: 'failed'
    });
    let interrupted = true;
    const first = await purgeLegacyStickmanJobs({
      db,
      jobsRoot,
      async removeDirectory(path) {
        if (interrupted) {
          interrupted = false;
          throw new Error('injected cleanup interruption');
        }
        rmSync(path, { recursive: true, force: true });
      }
    });

    expect(repository.getJob(v1.id)).toBeUndefined();
    expect(repository.getJob(v2.id)).toBeDefined();
    expect(repository.getJob(other.id)).toBeDefined();
    expect(first).toMatchObject({ pendingJobIds: [v1.id], completed: false });
    expect(existsSync(join(jobsRoot, v1.id))).toBe(true);

    const second = await purgeLegacyStickmanJobs({ db, jobsRoot });
    expect(second).toMatchObject({ pendingJobIds: [], completed: true });
    expect(existsSync(join(jobsRoot, v1.id))).toBe(false);
    expect(existsSync(join(jobsRoot, v2.id))).toBe(true);
    expect(existsSync(join(jobsRoot, other.id))).toBe(true);
    db.close();
  });

  it('rejects an escaped legacy job directory without deleting outside the jobs root', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-migration-'));
    const jobsRoot = join(tempDir, 'jobs');
    const outside = join(tempDir, 'outside');
    mkdirSync(jobsRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
    db.prepare(`
      INSERT INTO creator_jobs (
        id, project_id, template_id, template_version, status, revision,
        state_json, created_at, updated_at
      ) VALUES (?, 'p1', 'stickman-video', 1, 'draft', 0, '{}', ?, ?)
    `).run('../outside', new Date().toISOString(), new Date().toISOString());

    const result = await purgeLegacyStickmanJobs({ db, jobsRoot });

    expect(result.blockedJobIds).toEqual(['../outside']);
    expect(result.pendingJobIds).toEqual(['../outside']);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(db.prepare('SELECT id FROM creator_jobs WHERE id = ?').get('../outside')).toBeUndefined();
    db.close();
  });
});
