import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CreatorJob, ProjectResponse } from '@opencreator/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { publishCreatorArtifacts } from '../../src/creator/artifact-publisher.js';

let root = '';

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});

describe('creator artifact publisher', () => {
  it('copies completed deliverables by project, job and result version', async () => {
    root = await mkdtemp(join(tmpdir(), 'opencreator-publisher-'));
    const sourceDir = join(root, 'internal');
    await mkdir(sourceDir);
    const source = join(sourceDir, 'video.mp4');
    await writeFile(source, 'video');
    const job = {
      id: 'job/1',
      projectId: 'project_1',
      templateId: 'video-translation',
      artifacts: [{
        id: 'artifact_1',
        jobId: 'job/1',
        kind: 'horizontal_video',
        version: 2,
        status: 'completed',
        path: source,
        scopeKey: null,
        inputFingerprint: null,
        sha256: null,
        sourceArtifactIds: [],
        metadata: { resultVersion: 3, fileName: 'final.mp4' },
        createdAt: new Date().toISOString()
      }]
    } as unknown as CreatorJob;
    const project = { id: 'project_1', name: 'Demo' } as ProjectResponse;

    const published = await publishCreatorArtifacts({
      job,
      project,
      outputRoot: join(root, 'exports')
    });

    expect(published).toHaveLength(1);
    expect(published[0]).toContain(join('Demo-project_1', 'video-translation-job-1', 'V3'));
    expect(await readFile(published[0]!, 'utf8')).toBe('video');
    expect(await readFile(source, 'utf8')).toBe('video');
  });

  it('does not publish source or stale artifacts', async () => {
    root = await mkdtemp(join(tmpdir(), 'opencreator-publisher-'));
    const job = {
      id: 'job_1',
      projectId: 'project_1',
      templateId: 'image-generation',
      artifacts: [
        { kind: 'source_video', status: 'completed', path: '/missing/source.mp4' },
        { kind: 'generated_image', status: 'stale', path: '/missing/image.png' }
      ]
    } as unknown as CreatorJob;

    await expect(publishCreatorArtifacts({
      job,
      project: { id: 'project_1', name: 'Demo' } as ProjectResponse,
      outputRoot: join(root, 'exports')
    })).resolves.toEqual([]);
  });
});
