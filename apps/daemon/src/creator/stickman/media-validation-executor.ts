import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import type { CreatorArtifact } from '@opencreator/protocol';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateMediaFile } from '../validators/media.js';
import { stickmanMediaValidationSchema, stickmanTimelineSchema } from './contracts.js';

type MediaProbe = typeof validateMediaFile;
type FrameSample = {
  index: number;
  timestampSeconds: number;
  sha256: string;
  width: 1280;
  height: 720;
  brightnessMean: number;
  contrastStddev: number;
};

export function createStickmanMediaValidationExecutor(input: {
  ffprobePath: string;
  ffmpegPath: string;
  validateVideo?: MediaProbe;
  sampleFrames?: (path: string, duration: number, workdir: string) => Promise<FrameSample[]>;
}): CreatorExecutor {
  const validateVideo = input.validateVideo ?? validateMediaFile;
  const sampleFrames = input.sampleFrames
    ?? ((path, duration, workdir) => sampleVideoFrames(input.ffmpegPath, path, duration, workdir));
  return {
    id: 'stickman-media-validation',
    async run(stage) {
      const cleanVideo = requireArtifact(stage.inputArtifacts, 'clean_video');
      const timelineArtifact = requireArtifact(stage.inputArtifacts, 'timeline_manifest');
      if (
        cleanVideo.path === null
        || cleanVideo.sha256 === null
        || timelineArtifact.path === null
      ) {
        throw new CreatorExecutorError(
          'creator_stage_input_missing',
          'Clean video, its hash, and Timeline are required for media validation'
        );
      }
      const jobRoot = dirname(resolve(stage.workdir));
      assertInside(jobRoot, cleanVideo.path);
      assertInside(jobRoot, timelineArtifact.path);
      const actualVideoSha256 = await sha256File(cleanVideo.path);
      if (actualVideoSha256 !== cleanVideo.sha256.toLowerCase()) {
        throw new CreatorExecutorError(
          'creator_media_validation_hash_mismatch',
          'Clean video no longer matches its artifact hash'
        );
      }
      if (!cleanVideo.sourceArtifactIds.includes(timelineArtifact.id)) {
        throw new CreatorExecutorError(
          'creator_media_validation_lineage_mismatch',
          'Clean video is not derived from the current Timeline'
        );
      }
      const timeline = stickmanTimelineSchema.parse(JSON.parse(
        await readFile(timelineArtifact.path, 'utf8')
      ));
      const expectedDuration = timeline.totalFrames / timeline.fps;
      const durationTolerance = Math.max(0.15, 2 / timeline.fps);
      const media = await validateVideo(cleanVideo.path, input.ffprobePath);
      if (
        media.width !== 1280
        || media.height !== 720
        || !media.hasVideo
        || !media.hasAudio
        || Math.abs(media.duration - expectedDuration) > durationTolerance
      ) {
        throw new CreatorExecutorError(
          'creator_media_validation_failed',
          'Clean video must be decodable 1280x720 audio/video media with Timeline-matched duration'
        );
      }
      const sampledFrames = await sampleFrames(
        cleanVideo.path,
        media.duration,
        join(stage.workdir, 'frame-samples')
      );
      if (sampledFrames.length !== 3) {
        throw new CreatorExecutorError(
          'creator_media_validation_frame_count',
          'Media validation requires exactly three decoded frame samples'
        );
      }
      const report = stickmanMediaValidationSchema.parse({
        ok: true,
        validation: 'ffprobe_and_three_frame_sampling',
        cleanVideoArtifactId: cleanVideo.id,
        cleanVideoSha256: actualVideoSha256,
        timelineArtifactId: timelineArtifact.id,
        duration: media.duration,
        expectedDuration,
        durationTolerance,
        width: 1280,
        height: 720,
        hasVideo: true,
        hasAudio: true,
        sampledFrames
      });
      const path = join(stage.workdir, 'media-validation.json');
      await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      return {
        outputs: [{
          kind: 'media_validation',
          status: 'completed',
          path,
          sourceArtifactIds: [cleanVideo.id, timelineArtifact.id],
          metadata: {
            validation: report.validation,
            sampleCount: report.sampledFrames.length,
            duration: report.duration,
            width: report.width,
            height: report.height
          }
        }],
        progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
      };
    }
  };
}

async function sampleVideoFrames(
  ffmpegPath: string,
  videoPath: string,
  duration: number,
  workdir: string
): Promise<FrameSample[]> {
  await mkdir(workdir, { recursive: true });
  const timestamps = [
    Math.min(0.1, duration / 4),
    duration / 2,
    Math.max(0, duration - Math.min(0.2, duration / 4))
  ];
  const result: FrameSample[] = [];
  for (const [position, timestampSeconds] of timestamps.entries()) {
    const path = join(workdir, `frame-${position + 1}.png`);
    await execFileAsync(ffmpegPath, [
      '-y', '-ss', timestampSeconds.toFixed(3), '-i', videoPath,
      '-frames:v', '1', '-f', 'image2', path
    ]);
    const [metadata, stats, sha256] = await Promise.all([
      sharp(path).metadata(),
      sharp(path).greyscale().stats(),
      sha256File(path)
    ]);
    const brightnessMean = stats.channels[0]?.mean ?? 0;
    const contrastStddev = stats.channels[0]?.stdev ?? 0;
    if (
      metadata.width !== 1280
      || metadata.height !== 720
      || brightnessMean < 3
      || brightnessMean > 252
      || contrastStddev < 2
    ) {
      throw new CreatorExecutorError(
        'creator_media_validation_blank_frame',
        `Decoded frame ${position + 1} is blank or unreadable`
      );
    }
    result.push({
      index: position + 1,
      timestampSeconds,
      sha256,
      width: 1280,
      height: 720,
      brightnessMean: roundMetric(brightnessMean),
      contrastStddev: roundMetric(contrastStddev)
    });
  }
  return result;
}

function requireArtifact(artifacts: CreatorArtifact[], kind: string): CreatorArtifact {
  const matches = artifacts.filter(artifact => artifact.kind === kind && artifact.status === 'completed');
  if (matches.length !== 1) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      `Media validation requires exactly one current ${kind}`
    );
  }
  return matches[0]!;
}

function assertInside(root: string, path: string): void {
  const value = relative(resolve(root), resolve(path));
  if (value.startsWith('..') || isAbsolute(value)) {
    throw new CreatorExecutorError('creator_artifact_path_escape', 'Media validation input escapes Job root');
  }
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 120_000 }, error => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
