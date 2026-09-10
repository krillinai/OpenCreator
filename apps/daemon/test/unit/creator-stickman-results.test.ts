import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { readCreatorResultSnapshots } from '@opencreator/protocol';
import { registerCreatorRoutes } from '../../src/api/routes.creator.js';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorEventHub } from '../../src/creator/events.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createCreatorStageRunner } from '../../src/creator/stage-runner.js';
import { createStickmanDeliveryExecutor } from '../../src/creator/stickman/delivery-executor.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempRoot = '';
let database: ReturnType<typeof openRuntimeDatabase> | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('stickman result snapshots', () => {
  it('creates a snapshot only after package validation and keeps the previous result readable', async () => {
    const context = setup();
    const job = context.service.createJob({
      projectId: 'project-1',
      templateId: 'stickman-video',
      state: { topic: 'snapshot test' }
    });
    await insertInputs(context.repository, job.id, 'v1');
    expect(readCreatorResultSnapshots(context.service.getJob(job.id)!.state.resultSnapshots)).toEqual([]);

    const firstRun = await context.runner.run(job.id, 'package-validation');
    expect(firstRun.status).toBe('succeeded');
    const afterFirst = context.service.getJob(job.id)!;
    const firstSnapshots = readCreatorResultSnapshots(afterFirst.state.resultSnapshots);
    expect(firstSnapshots).toHaveLength(1);
    expect(Object.keys(firstSnapshots[0]!.artifactRefs).sort()).toEqual([
      'clean_video',
      'delivery_manifest',
      'narration_subtitle'
    ]);
    const firstCleanId = firstSnapshots[0]!.artifactRefs.clean_video![0]!;

    await insertInputs(context.repository, job.id, 'v2');
    const secondRun = await context.runner.run(job.id, 'package-validation');
    expect(secondRun.status).toBe('succeeded');
    const afterSecond = context.service.getJob(job.id)!;
    const snapshots = readCreatorResultSnapshots(afterSecond.state.resultSnapshots);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.artifactRefs.clean_video).toEqual([firstCleanId]);
    expect(snapshots[1]!.artifactRefs.clean_video).not.toEqual([firstCleanId]);
    expect(afterSecond.artifacts.find(artifact => artifact.id === firstCleanId)?.status).toBe('completed');

    const app = Fastify();
    await registerCreatorRoutes(app, context.service, createCreatorEventHub(), {
      dispatcher: context.dispatcher,
      stageRunner: context.runner
    });
    const response = await app.inject({
      method: 'GET',
      url: `/creator/jobs/${job.id}/artifacts/${firstCleanId}/content`
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.toString()).toBe('clean-v1');
    await app.close();
  });

  it('does not create a snapshot or completed job when package validation fails', async () => {
    const context = setup();
    const job = context.service.createJob({
      projectId: 'project-1',
      templateId: 'stickman-video'
    });
    const inserted = await insertInputs(context.repository, job.id, 'bad');
    writeFileSync(inserted.clean_video.path!, 'tampered-after-hash');
    const run = await context.runner.run(job.id, 'package-validation');
    expect(run.status).toBe('failed');
    const failed = context.service.getJob(job.id)!;
    expect(failed.status).toBe('failed');
    expect(readCreatorResultSnapshots(failed.state.resultSnapshots)).toEqual([]);
  });
});

function setup() {
  tempRoot = mkdtempSync(join(tmpdir(), 'creator-stickman-results-'));
  database = openRuntimeDatabase(join(tempRoot, 'runtime.sqlite'));
  const repository = createCreatorRepository(database);
  const templates = createDefaultCreatorTemplateRegistry();
  const service = createCreatorService({ repository, templates });
  const receipts = createCreatorAgentRepository(database);
  const dispatcher = createCreatorCommandDispatcher({ service, repository, receipts });
  const runner = createCreatorStageRunner({
    repository,
    templates,
    executors: [createStickmanDeliveryExecutor({
      ffprobePath: 'unused',
      validateVideo: async () => ({
        duration: 1,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true
      })
    })],
    workRoot: join(tempRoot, 'jobs')
  });
  return { repository, service, dispatcher, runner };
}

async function insertInputs(
  repository: ReturnType<typeof createCreatorRepository>,
  jobId: string,
  label: string
) {
  const sourceRoot = join(tempRoot, 'jobs', jobId, `source-${label}`);
  mkdirSync(sourceRoot, { recursive: true });
  const files = {
    clean_video: join(sourceRoot, 'clean.mp4'),
    narration_subtitle: join(sourceRoot, 'narration.srt'),
    narration_audio: join(sourceRoot, 'segment-01.wav'),
    audio_timing: join(sourceRoot, 'audio-timing.json'),
    timeline_manifest: join(sourceRoot, 'timeline.json'),
    visual_validation: join(sourceRoot, 'visual-validation.json'),
    media_validation: join(sourceRoot, 'media-validation.json')
  };
  writeFileSync(files.clean_video, `clean-${label}`);
  writeFileSync(files.narration_subtitle, `1\n00:00:00,000 --> 00:00:01,000\n${label}\n`);
  writeFileSync(files.narration_audio, `narration-${label}`);

  const insert = (
    kind: keyof typeof files,
    metadata: Record<string, string | number> = {},
    scopeKey: string | null = null
  ) => repository.insertArtifact({
      jobId,
      kind,
      status: 'completed',
      path: files[kind],
      sha256: createHash('sha256').update(readFileSync(files[kind])).digest('hex'),
      scopeKey,
      sourceArtifactIds: [],
      metadata: {
        fileName: files[kind].split(/[\\/]/).at(-1) ?? kind,
        ...metadata
      }
    });

  const cleanVideo = insert('clean_video', { renderEngine: 'remotion', renderKind: 'final' });
  const narrationSubtitle = insert('narration_subtitle');
  const narrationAudio = insert('narration_audio', {
    duration: 1,
    provider: 'openai',
    timingSource: 'ffprobe'
  }, 'segment-01');
  writeFileSync(files.audio_timing, JSON.stringify({
    scriptArtifactId: `script-${label}`,
    timingSource: 'ffprobe_cumulative_tts_duration',
    segments: [{
      segmentId: 'segment-01',
      startSeconds: 0,
      endSeconds: 1,
      durationSeconds: 1,
      audioArtifactId: narrationAudio.id,
      audioSha256: narrationAudio.sha256
    }],
    totalDurationSeconds: 1
  }));
  const audioTiming = insert('audio_timing');
  writeFileSync(files.timeline_manifest, JSON.stringify({
    fps: 30,
    width: 1280,
    height: 720,
    totalFrames: 30,
    shots: [{
      shotId: 'shot-01',
      startFrame: 0,
      endFrame: 30,
      imageArtifactId: `image-${label}`,
      audioArtifactId: narrationAudio.id,
      motion: 'static',
      imageSha256: 'a'.repeat(64),
      audioSha256: narrationAudio.sha256
    }]
  }));
  const timeline = insert('timeline_manifest', {
    timingSource: 'ffprobe_cumulative_tts_duration'
  });
  writeFileSync(files.visual_validation, JSON.stringify({
    ok: true,
    validation: 'automated_decode_aspect_nonblank_hash_and_ocr',
    approvedShotSpecArtifactId: `shot-spec-${label}`,
    shotCount: 1,
    ocrStatus: 'passed',
    publishable: true,
    warnings: [],
    shots: [{
      shotId: 'shot-01',
      imageArtifactId: `image-${label}`,
      imageSha256: 'a'.repeat(64),
      width: 1280,
      height: 720,
      brightnessMean: 200,
      contrastStddev: 30,
      ocrStatus: 'passed',
      detectedText: []
    }]
  }));
  const visualValidation = insert('visual_validation');
  writeFileSync(files.media_validation, JSON.stringify({
    ok: true,
    validation: 'ffprobe_and_three_frame_sampling',
    cleanVideoArtifactId: cleanVideo.id,
    cleanVideoSha256: cleanVideo.sha256,
    timelineArtifactId: timeline.id,
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
  const mediaValidation = insert('media_validation');
  return {
    clean_video: cleanVideo,
    narration_subtitle: narrationSubtitle,
    narration_audio: narrationAudio,
    audio_timing: audioTiming,
    timeline_manifest: timeline,
    visual_validation: visualValidation,
    media_validation: mediaValidation
  };
}
