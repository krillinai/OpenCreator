import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCreatorProjectCoverService } from '../../src/creator/project-cover.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator project cover', () => {
  it('reuses the latest real cover image without invoking ffmpeg', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-project-cover-'));
    const coverPath = join(tempDir, 'generated-cover.png');
    writeFileSync(coverPath, 'cover');
    const extractFrame = vi.fn();
    const service = createCreatorProjectCoverService({ jobsRoot: tempDir, extractFrame });

    const cover = await service.resolve(creatorJob([
      artifact('cover_image', coverPath, { fileName: 'generated-cover.png' })
    ]));

    expect(cover).toEqual({ path: coverPath, fileName: 'generated-cover.png' });
    expect(extractFrame).not.toHaveBeenCalled();
  });

  it('extracts and caches the fifth-second frame from the source video', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-project-cover-'));
    const sourcePath = join(tempDir, 'source.mp4');
    writeFileSync(sourcePath, 'video');
    const extractFrame = vi.fn(async (input: { outputPath: string; seconds: number }) => {
      await writeFile(input.outputPath, 'jpeg-frame');
    });
    const service = createCreatorProjectCoverService({ jobsRoot: tempDir, extractFrame });
    const job = creatorJob([artifact('source_video', sourcePath)]);

    const first = await service.resolve(job);
    const second = await service.resolve(job);

    expect(first?.path).toBe(second?.path);
    expect(first?.path).not.toBe(sourcePath);
    expect(await readFile(first!.path, 'utf8')).toBe('jpeg-frame');
    expect(extractFrame).toHaveBeenCalledTimes(1);
    expect(extractFrame).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath,
      seconds: 5
    }));
  });

  it('falls back to the first frame when a video is shorter than five seconds', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-project-cover-'));
    const sourcePath = join(tempDir, 'short.mp4');
    writeFileSync(sourcePath, 'video');
    const attempts: number[] = [];
    const extractFrame = vi.fn(async (input: { outputPath: string; seconds: number }) => {
      attempts.push(input.seconds);
      if (input.seconds === 5) throw new Error('no frame at five seconds');
      await writeFile(input.outputPath, 'first-frame');
    });
    const service = createCreatorProjectCoverService({ jobsRoot: tempDir, extractFrame });

    const cover = await service.resolve(creatorJob([artifact('source_video', sourcePath)]));

    expect(attempts).toEqual([5, 0]);
    expect(await readFile(cover!.path, 'utf8')).toBe('first-frame');
  });
});

function creatorJob(artifacts: CreatorArtifact[]): CreatorJob {
  return {
    id: 'creator_job_cover_test',
    projectId: 'project_1',
    templateId: 'video-translation',
    templateVersion: 1,
    status: 'completed',
    revision: 1,
    state: {},
    agentThreadId: null,
    stages: [],
    artifacts,
    activities: [],
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z'
  };
}

function artifact(
  kind: string,
  path: string,
  metadata: CreatorArtifact['metadata'] = {}
): CreatorArtifact {
  return {
    id: `artifact_${kind}`,
    jobId: 'creator_job_cover_test',
    kind,
    version: 1,
    status: 'completed',
    path,
    sourceArtifactIds: [],
    metadata,
    createdAt: '2026-08-25T00:00:00.000Z'
  };
}
