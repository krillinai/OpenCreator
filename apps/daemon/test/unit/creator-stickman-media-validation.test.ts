import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import { createStickmanMediaValidationExecutor } from '../../src/creator/stickman/media-validation-executor.js';

let tempRoot = '';

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('stickman media validation executor', () => {
  it('binds ffprobe and exactly three frame samples to the current Remotion output', async () => {
    const fixture = setup();
    const result = await createStickmanMediaValidationExecutor({
      ffprobePath: 'unused',
      ffmpegPath: 'unused',
      validateVideo: async () => ({
        duration: 2,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true
      }),
      sampleFrames: async () => [1, 2, 3].map(index => ({
        index,
        timestampSeconds: index / 2,
        sha256: String(index).repeat(64),
        width: 1280 as const,
        height: 720 as const,
        brightnessMean: 180,
        contrastStddev: 20
      }))
    }).run(fixture.input as never);

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({
      kind: 'media_validation',
      status: 'completed',
      sourceArtifactIds: ['clean-1', 'timeline-1'],
      metadata: { sampleCount: 3, width: 1280, height: 720 }
    });
    expect(JSON.parse(readFileSync(result.outputs[0]!.path!, 'utf8'))).toMatchObject({
      ok: true,
      cleanVideoArtifactId: 'clean-1',
      timelineArtifactId: 'timeline-1',
      sampledFrames: [{ index: 1 }, { index: 2 }, { index: 3 }]
    });
  });

  it('rejects stale hashes, wrong lineage, and insufficient frame evidence', async () => {
    let fixture = setup();
    fixture.input.inputArtifacts[0]!.sha256 = '0'.repeat(64);
    await expect(run(fixture)).rejects.toMatchObject({ code: 'creator_media_validation_hash_mismatch' });

    fixture = setup();
    fixture.input.inputArtifacts[0]!.sourceArtifactIds = [];
    await expect(run(fixture)).rejects.toMatchObject({ code: 'creator_media_validation_lineage_mismatch' });

    fixture = setup();
    await expect(run(fixture, 2)).rejects.toMatchObject({ code: 'creator_media_validation_frame_count' });
  });
});

function setup() {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = mkdtempSync(join(tmpdir(), 'creator-stickman-media-validation-'));
  const jobRoot = join(tempRoot, 'job-1');
  const sourceRoot = join(jobRoot, 'source');
  const workdir = join(jobRoot, 'stage-media-validation');
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(workdir, { recursive: true });
  const timelinePath = join(sourceRoot, 'timeline.json');
  writeFileSync(timelinePath, JSON.stringify({
    fps: 30,
    width: 1280,
    height: 720,
    totalFrames: 60,
    shots: [{
      shotId: 'shot-01',
      startFrame: 0,
      endFrame: 60,
      imageArtifactId: 'image-1',
      audioArtifactId: 'audio-1',
      motion: 'static',
      imageSha256: 'c'.repeat(64),
      audioSha256: 'd'.repeat(64)
    }]
  }));
  const cleanPath = join(sourceRoot, 'clean.mp4');
  writeFileSync(cleanPath, 'validated remotion video');
  const timeline = artifact('timeline-1', 'timeline_manifest', timelinePath, []);
  const clean = artifact('clean-1', 'clean_video', cleanPath, [timeline.id]);
  return {
    input: {
      stageRun: { id: 'stage-1', stageId: 'media-validation' },
      job: { id: 'job-1' },
      inputArtifacts: [clean, timeline],
      workdir,
      signal: new AbortController().signal,
      reportProgress() {}
    }
  };
}

function run(fixture: ReturnType<typeof setup>, samples = 3) {
  return createStickmanMediaValidationExecutor({
    ffprobePath: 'unused',
    ffmpegPath: 'unused',
    validateVideo: async () => ({
      duration: 2,
      width: 1280,
      height: 720,
      hasVideo: true,
      hasAudio: true
    }),
    sampleFrames: async () => Array.from({ length: samples }, (_, position) => ({
      index: position + 1,
      timestampSeconds: position,
      sha256: String(position + 1).repeat(64),
      width: 1280 as const,
      height: 720 as const,
      brightnessMean: 180,
      contrastStddev: 20
    }))
  }).run(fixture.input as never);
}

function artifact(
  id: string,
  kind: string,
  path: string,
  sourceArtifactIds: string[]
): CreatorArtifact {
  return {
    id,
    jobId: 'job-1',
    kind,
    version: 1,
    status: 'completed',
    path,
    scopeKey: null,
    inputFingerprint: null,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    sourceArtifactIds,
    metadata: {},
    createdAt: '2026-09-03T00:00:00.000Z'
  };
}
