import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

it('saves edited source subtitles without replacing the transcript or source video', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'creator-transcription-editing-'));
  const db = openRuntimeDatabase(join(tempDir, 'app.sqlite'));
  try {
    const repository = createCreatorRepository(db);
    const service = createCreatorService({ repository, templates: createDefaultCreatorTemplateRegistry() });
    const job = service.createJob({ projectId: 'project_1', templateId: 'transcription', state: { sourceType: 'file' } });
    const videoPath = join(tempDir, 'interview.mp4');
    const subtitlePath = join(tempDir, 'interview.srt');
    writeFileSync(videoPath, 'video');
    writeFileSync(subtitlePath, '1\n00:00:00,000 --> 00:00:01,000\nOriginal transcript\n');
    const video = repository.insertArtifact({ jobId: job.id, kind: 'source_video', status: 'completed', path: videoPath, sourceArtifactIds: [], metadata: { fileName: 'interview.mp4' } });
    const subtitle = repository.insertArtifact({ jobId: job.id, kind: 'source_subtitle', status: 'completed', path: subtitlePath, sourceArtifactIds: [video.id], metadata: { fileName: 'interview.srt', resultVersion: 1 } });
    repository.updateJob({ id: job.id, status: 'completed', revision: 0, state: {
      ...job.state, resultVersion: 1, latestResultVersion: 1,
      resultSnapshots: [{ version: 1, createdAt: subtitle.createdAt, action: 'stage-succeeded', stageId: 'transcription', description: 'Initial transcript', artifactRefs: { source_video: [video.id], source_subtitle: [subtitle.id] }, changedArtifactIds: [subtitle.id], staleArtifactIds: [], state: {} }]
    } });

    const response = service.applyAction(job.id, {
      actor: 'user', action: 'edit-subtitle', expectedRevision: 0,
      input: {
        artifactId: subtitle.id, baseResultVersion: 1, preserveResultVersion: true,
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: 'Edited transcript' }]
      }
    });

    const edited = response.job.artifacts.filter(artifact => artifact.kind === 'source_subtitle').at(-1)!;
    expect(edited.id).not.toBe(subtitle.id);
    expect(edited.metadata.editedFromArtifactId).toBe(subtitle.id);
    expect(readFileSync(edited.path!, 'utf8')).toContain('Edited transcript');
    expect(readFileSync(subtitlePath, 'utf8')).toContain('Original transcript');
    expect(response.job.state.subtitleArtifactId).toBe(edited.id);
    expect(response.job.state.resultSnapshots).toMatchObject([{
      version: 1,
      artifactRefs: { source_video: [video.id], source_subtitle: [edited.id] }
    }]);
    expect(response.job.artifacts.find(artifact => artifact.id === video.id)).toMatchObject({ status: 'completed', path: videoPath });
  } finally {
    db.close();
  }
});
