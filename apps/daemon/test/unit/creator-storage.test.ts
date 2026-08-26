import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator storage', () => {
  it('reopens creator jobs with artifacts and activities', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-storage-'));
    const path = join(tempDir, 'app.sqlite');
    const firstDb = openRuntimeDatabase(path);
    const first = createCreatorRepository(firstDb, {
      idFactory: prefix => `${prefix}_1`,
      now: () => '2026-08-20T00:00:00.000Z'
    });
    const job = first.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      templateVersion: 1,
      status: 'draft',
      state: { targetLanguage: 'en' }
    });
    first.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'target.srt'),
      sourceArtifactIds: [],
      metadata: { language: 'en' }
    });
    first.insertActivity({
      jobId: job.id,
      revision: 0,
      actor: 'user',
      action: 'create-job',
      summary: 'Created job',
      details: {}
    });
    firstDb.close();

    const secondDb = openRuntimeDatabase(path);
    const restored = createCreatorRepository(secondDb).getJob(job.id);
    secondDb.close();

    expect(restored).toMatchObject({
      id: job.id,
      revision: 0,
      state: { targetLanguage: 'en' },
      artifacts: [{ kind: 'target_subtitle', version: 1, status: 'completed' }],
      activities: [{ action: 'create-job', actor: 'user' }]
    });
  });

  it('marks nonterminal stage runs interrupted when the database reopens', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-storage-'));
    const path = join(tempDir, 'app.sqlite');
    const firstDb = openRuntimeDatabase(path);
    const repository = createCreatorRepository(firstDb);
    const job = repository.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      templateVersion: 1,
      status: 'running',
      state: {}
    });
    repository.createStageRun({
      jobId: job.id,
      stageId: 'subtitle',
      executor: 'fake',
      status: 'running'
    });
    firstDb.close();

    const secondDb = openRuntimeDatabase(path);
    const restored = createCreatorRepository(secondDb).getJob(job.id);
    secondDb.close();

    expect(restored?.stages[0]).toMatchObject({ status: 'interrupted' });
    expect(restored?.status).toBe('needs_input');
  });

  it('repairs project snapshots that incorrectly started from the UI placeholder V2', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-storage-'));
    const path = join(tempDir, 'app.sqlite');
    const firstDb = openRuntimeDatabase(path);
    const first = createCreatorRepository(firstDb);
    const job = first.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      templateVersion: 1,
      status: 'completed',
      state: {}
    });
    const subtitle = first.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: join(tempDir, 'target.srt'),
      sourceArtifactIds: [],
      metadata: { resultVersion: 2 }
    });
    first.updateJob({
      id: job.id,
      status: 'completed',
      revision: 1,
      state: {
        resultVersion: 2,
        latestResultVersion: 2,
        resultVersions: [{ value: 2, description: '生成字幕' }],
        resultSnapshots: [{
          version: 2,
          createdAt: '2026-08-25T00:00:00.000Z',
          action: 'stage-succeeded',
          stageId: 'subtitle',
          description: '生成字幕',
          artifactRefs: { target_subtitle: [subtitle.id] },
          changedArtifactIds: [subtitle.id],
          staleArtifactIds: [],
          state: {}
        }]
      }
    });
    firstDb.close();

    const secondDb = openRuntimeDatabase(path);
    const restored = createCreatorRepository(secondDb).getJob(job.id)!;
    secondDb.close();

    expect(restored.state).toMatchObject({
      resultVersion: 1,
      latestResultVersion: 1,
      resultVersions: [{ value: 1 }],
      resultSnapshots: [{ version: 1 }]
    });
    expect(restored.artifacts[0]?.metadata.resultVersion).toBe(1);
  });

  it('registers legacy vertical subtitles without creating a new project version', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-storage-'));
    const path = join(tempDir, 'app.sqlite');
    const subtitleDir = join(tempDir, 'subtitle-output');
    const targetPath = join(subtitleDir, 'target_language_srt.srt');
    const verticalPath = join(subtitleDir, 'short_origin_mixed_srt.srt');
    mkdirSync(subtitleDir, { recursive: true });
    writeFileSync(targetPath, '1\n00:00:00,000 --> 00:00:01,000\n横屏字幕\n');
    writeFileSync(verticalPath, [
      '1',
      '00:00:00,000 --> 00:00:02,000',
      '竖屏短字幕',
      '',
      '2',
      '00:00:00,000 --> 00:00:01,000',
      'Overlapping translation',
      ''
    ].join('\n'));

    const firstDb = openRuntimeDatabase(path);
    const first = createCreatorRepository(firstDb);
    const job = first.createJob({
      projectId: 'project_1',
      templateId: 'video-translation',
      templateVersion: 1,
      status: 'completed',
      state: {}
    });
    const target = first.insertArtifact({
      jobId: job.id,
      kind: 'target_subtitle',
      status: 'completed',
      path: targetPath,
      sourceArtifactIds: [],
      metadata: { resultVersion: 1, fileName: 'target_language_srt.srt' }
    });
    first.updateJob({
      id: job.id,
      status: 'completed',
      revision: 1,
      state: {
        resultVersion: 1,
        latestResultVersion: 1,
        resultSnapshots: [{
          version: 1,
          createdAt: '2026-08-25T00:00:00.000Z',
          action: 'stage-succeeded',
          stageId: 'subtitle',
          description: '生成字幕',
          artifactRefs: { target_subtitle: [target.id] },
          changedArtifactIds: [target.id],
          staleArtifactIds: [],
          state: {}
        }]
      }
    });
    firstDb.close();

    const secondDb = openRuntimeDatabase(path);
    const restored = createCreatorRepository(secondDb).getJob(job.id)!;
    secondDb.close();

    const vertical = restored.artifacts.find(artifact => artifact.kind === 'vertical_subtitle');
    expect(vertical).toMatchObject({
      version: 1,
      status: 'completed',
      path: verticalPath,
      sourceArtifactIds: [target.id],
      metadata: {
        resultVersion: 1,
        fileName: 'short_origin_mixed_srt.srt',
        cueCount: 2,
        cues: [
          { text: '竖屏短字幕' },
          { text: 'Overlapping translation' }
        ]
      }
    });
    expect(restored.state.resultVersion).toBe(1);
    expect(restored.state.resultSnapshots).toMatchObject([{
      version: 1,
      artifactRefs: {
        target_subtitle: [target.id],
        vertical_subtitle: [vertical!.id]
      }
    }]);
  });
});
