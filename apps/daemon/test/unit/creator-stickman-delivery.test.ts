import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorArtifact } from '@opencreator/protocol';
import { createStickmanDeliveryExecutor } from '../../src/creator/stickman/delivery-executor.js';

let tempRoot = '';

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('stickman delivery executor', () => {
  it('materializes and validates the video and narration subtitle', async () => {
    const fixture = await createFixture();
    const result = await run(fixture.artifacts, fixture.workdir);
    expect(result.outputs.map(output => output.kind)).toEqual([
      'clean_video',
      'narration_subtitle',
      'delivery_manifest'
    ]);
    const manifest = JSON.parse(readFileSync(result.outputs.at(-1)!.path!, 'utf8'));
    expect(manifest).toMatchObject({
      packageStatus: 'technical-draft',
      placeholderAssets: [],
      blockingChecks: expect.arrayContaining([
        'visual_validation_missing',
        'narration_audio_unverified',
        'media_validation_missing',
        'video_frame_sampling_unverified'
      ])
    });
    expect(manifest.files.map((file: { name: string }) => file.name)).toEqual([
      'stickman-video.mp4',
      'narration.srt'
    ]);
  });

  it('marks the package publishable only when every real-media evidence gate passes', async () => {
    const fixture = await createFixture();
    addPublishableEvidence(fixture.artifacts, join(tempRoot, 'job-1', 'source'));
    const result = await run(fixture.artifacts, fixture.workdir, {
      sampleVideoFrames: async () => ({ sampleCount: 3 })
    });
    const manifest = JSON.parse(readFileSync(result.outputs.at(-1)!.path!, 'utf8'));

    expect(manifest).toMatchObject({
      packageStatus: 'publishable',
      placeholderAssets: [],
      blockingChecks: []
    });
    const delivery = result.outputs.at(-1);
    if (delivery === undefined) throw new Error('delivery manifest output is missing');
    expect(delivery.metadata?.packageStatus).toBe('publishable');
  });

  it('rejects extra, stale, hash-mismatched, and invalid subtitle inputs', async () => {
    let fixture = await createFixture();
    mkdirSync(join(fixture.workdir, 'delivery'), { recursive: true });
    writeFileSync(join(fixture.workdir, 'delivery', 'extra.txt'), 'extra');
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_extra_file'
    });

    fixture = await createFixture();
    fixture.artifacts[0] = { ...fixture.artifacts[0]!, status: 'stale' };
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_artifact_ambiguous'
    });

    fixture = await createFixture();
    fixture.artifacts[0] = { ...fixture.artifacts[0]!, sha256: '0'.repeat(64) };
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toMatchObject({
      code: 'creator_delivery_hash_mismatch'
    });

    fixture = await createFixture();
    const subtitle = fixture.artifacts.find(artifact => artifact.kind === 'narration_subtitle')!;
    writeFileSync(subtitle.path!, 'invalid subtitle');
    subtitle.sha256 = hashFile(subtitle.path!);
    await expect(run(fixture.artifacts, fixture.workdir)).rejects.toThrow(/invalid_srt/);
  });
});

async function createFixture(): Promise<{ artifacts: CreatorArtifact[]; workdir: string }> {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = mkdtempSync(join(tmpdir(), 'creator-stickman-delivery-'));
  const jobRoot = join(tempRoot, 'job-1');
  const sourceRoot = join(jobRoot, 'source');
  const workdir = join(jobRoot, 'stage-delivery');
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(workdir, { recursive: true });
  const files = {
    clean_video: join(sourceRoot, 'clean.mp4'),
    narration_subtitle: join(sourceRoot, 'narration.srt')
  };
  writeFileSync(files.clean_video, 'clean-video');
  writeFileSync(files.narration_subtitle, '1\n00:00:00,000 --> 00:00:01,000\n第一段旁白\n');
  return {
    workdir,
    artifacts: Object.entries(files).map(([kind, path], index): CreatorArtifact => ({
      id: `artifact-${index}`,
      jobId: 'job-1',
      kind,
      version: 1,
      status: 'completed',
      path,
      scopeKey: null,
      inputFingerprint: null,
      sha256: hashFile(path),
      sourceArtifactIds: [],
      metadata: kind === 'clean_video'
        ? { renderEngine: 'remotion', renderKind: 'final' }
        : {},
      createdAt: '2026-08-31T00:00:00.000Z'
    }))
  };
}

function run(
  artifacts: CreatorArtifact[],
  workdir: string,
  options: {
    sampleVideoFrames?: () => Promise<{ sampleCount: number }>;
  } = {}
) {
  return createStickmanDeliveryExecutor({
    ffprobePath: 'unused',
    validateVideo: async () => ({
      duration: 1,
      width: 1280,
      height: 720,
      hasVideo: true,
      hasAudio: true
    }),
    ...(options.sampleVideoFrames === undefined
      ? {}
      : { sampleVideoFrames: options.sampleVideoFrames })
  }).run({
    stageRun: { id: 'stage-delivery', stageId: 'package-validation' },
    job: { id: 'job-1' },
    inputArtifacts: artifacts,
    workdir,
    signal: new AbortController().signal,
    reportProgress() {}
  } as never);
}

function addPublishableEvidence(artifacts: CreatorArtifact[], sourceRoot: string): void {
  const narrationPath = join(sourceRoot, 'segment-01.wav');
  writeFileSync(narrationPath, 'real-narration-fixture');
  const narration = artifact('artifact-narration', 'narration_audio', narrationPath, {
    duration: 1,
    provider: 'openai',
    timingSource: 'ffprobe'
  }, 'segment-01');
  const timingPath = join(sourceRoot, 'audio-timing.json');
  writeFileSync(timingPath, JSON.stringify({
    scriptArtifactId: 'script-1',
    timingSource: 'ffprobe_cumulative_tts_duration',
    segments: [{
      segmentId: 'segment-01',
      startSeconds: 0,
      endSeconds: 1,
      durationSeconds: 1,
      audioArtifactId: narration.id,
      audioSha256: narration.sha256
    }],
    totalDurationSeconds: 1
  }));
  const timelinePath = join(sourceRoot, 'timeline.json');
  writeFileSync(timelinePath, JSON.stringify({
    fps: 30,
    width: 1280,
    height: 720,
    totalFrames: 30,
    shots: [{
      shotId: 'shot-01',
      startFrame: 0,
      endFrame: 30,
      imageArtifactId: 'image-1',
      audioArtifactId: narration.id,
      motion: 'static',
      imageSha256: 'a'.repeat(64),
      audioSha256: narration.sha256
    }]
  }));
  const visualPath = join(sourceRoot, 'visual-validation.json');
  writeFileSync(visualPath, JSON.stringify({
    ok: true,
    validation: 'automated_decode_aspect_nonblank_hash_and_ocr',
    approvedShotSpecArtifactId: 'shot-spec-1',
    shotCount: 1,
    ocrStatus: 'passed',
    publishable: true,
    warnings: [],
    shots: [{
      shotId: 'shot-01',
      imageArtifactId: 'image-1',
      imageSha256: 'a'.repeat(64),
      width: 1024,
      height: 576,
      brightnessMean: 200,
      contrastStddev: 30,
      ocrStatus: 'passed',
      detectedText: []
    }]
  }));
  const timelineArtifact = artifact('artifact-timeline', 'timeline_manifest', timelinePath, {
    timingSource: 'ffprobe_cumulative_tts_duration'
  });
  const cleanVideo = artifacts.find(candidate => candidate.kind === 'clean_video')!;
  const mediaValidationPath = join(sourceRoot, 'media-validation.json');
  writeFileSync(mediaValidationPath, JSON.stringify({
    ok: true,
    validation: 'ffprobe_and_three_frame_sampling',
    cleanVideoArtifactId: cleanVideo.id,
    cleanVideoSha256: cleanVideo.sha256,
    timelineArtifactId: timelineArtifact.id,
    duration: 1,
    expectedDuration: 1,
    durationTolerance: 0.15,
    width: 1280,
    height: 720,
    hasVideo: true,
    hasAudio: true,
    sampledFrames: [1, 2, 3].map(index => ({
      index,
      timestampSeconds: index / 4,
      sha256: String(index).repeat(64),
      width: 1280,
      height: 720,
      brightnessMean: 180,
      contrastStddev: 24
    }))
  }));
  artifacts.push(
    narration,
    artifact('artifact-timing', 'audio_timing', timingPath),
    timelineArtifact,
    artifact('artifact-visual', 'visual_validation', visualPath),
    artifact('artifact-media-validation', 'media_validation', mediaValidationPath)
  );
}

function artifact(
  id: string,
  kind: string,
  path: string,
  metadata: CreatorArtifact['metadata'] = {},
  scopeKey: string | null = null
): CreatorArtifact {
  return {
    id,
    jobId: 'job-1',
    kind,
    version: 1,
    status: 'completed',
    path,
    scopeKey,
    inputFingerprint: null,
    sha256: hashFile(path),
    sourceArtifactIds: [],
    metadata,
    createdAt: '2026-09-03T00:00:00.000Z'
  };
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
