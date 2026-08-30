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

  it('uses a generated image as the project cover', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-project-generated-image-'));
    const imagePath = join(tempDir, 'generated-image.webp');
    writeFileSync(imagePath, 'generated-image');
    const extractFrame = vi.fn();
    const service = createCreatorProjectCoverService({ jobsRoot: tempDir, extractFrame });

    const cover = await service.resolve(creatorJob([
      artifact('generated_image', imagePath, { fileName: 'generated-image.webp' })
    ]));

    expect(cover).toEqual({ path: imagePath, fileName: 'generated-image.webp' });
    expect(extractFrame).not.toHaveBeenCalled();
  });

  it('uses the first candidate from the latest result and ignores legacy selection state', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-project-latest-cover-'));
    const versionOnePath = join(tempDir, 'cover-v1-1.png');
    const versionTwoFirstPath = join(tempDir, 'cover-v2-1.png');
    const versionTwoSecondPath = join(tempDir, 'cover-v2-2.png');
    writeFileSync(versionOnePath, 'version-one');
    writeFileSync(versionTwoFirstPath, 'version-two-first');
    writeFileSync(versionTwoSecondPath, 'version-two-second');
    const service = createCreatorProjectCoverService({ jobsRoot: tempDir });
    const job = creatorJob([
      {
        ...artifact('cover_image', versionOnePath, { resultVersion: 1, candidate: 1 }),
        id: 'cover_v1_1',
        version: 1
      },
      {
        ...artifact('cover_image', versionTwoSecondPath, { resultVersion: 2, candidate: 2 }),
        id: 'cover_v2_2',
        version: 3
      },
      {
        ...artifact('cover_image', versionTwoFirstPath, { resultVersion: 2, candidate: 1 }),
        id: 'cover_v2_1',
        version: 2
      }
    ]);
    job.state.selectedCoverArtifactId = 'cover_v1_1';

    const cover = await service.resolve(job);

    expect(cover?.path).toBe(versionTwoFirstPath);
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
