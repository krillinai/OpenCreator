import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import type { CreatorArtifact } from '@opencreator/protocol';
import type { CreatorExecutor, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateMediaFile } from '../validators/media.js';
import { validateSrtFile } from '../validators/srt.js';
import {
  stickmanAudioTimingSchema,
  stickmanDeliveryManifestSchema,
  stickmanMediaValidationSchema,
  stickmanTimelineSchema,
  stickmanVisualValidationSchema
} from './contracts.js';

const deliveryFiles = [
  { kind: 'clean_video', name: 'stickman-video.mp4', mime: 'video/mp4' },
  { kind: 'narration_subtitle', name: 'narration.srt', mime: 'application/x-subrip' }
] as const;

type VideoValidator = typeof validateMediaFile;
type VideoFrameSampler = (input: {
  path: string;
  kind: 'clean_video';
  duration: number;
  workdir: string;
  ffmpegPath?: string;
}) => Promise<{ sampleCount: number }>;

export function createStickmanDeliveryExecutor(input: {
  ffprobePath: string;
  ffmpegPath?: string;
  validateVideo?: VideoValidator;
  sampleVideoFrames?: VideoFrameSampler;
}): CreatorExecutor {
  const validateVideo = input.validateVideo ?? validateMediaFile;
  const sampleVideoFrames = input.sampleVideoFrames
    ?? (input.ffmpegPath === undefined ? undefined : sampleFramesWithFfmpeg);
  return {
    id: 'stickman-delivery',
    async run(stage) {
      const jobRoot = dirname(resolve(stage.workdir));
      const deliveryRoot = join(stage.workdir, 'delivery');
      await mkdir(deliveryRoot, { recursive: true });
      const existing = await readdir(deliveryRoot);
      if (existing.length > 0) {
        throw new CreatorExecutorError(
          'creator_delivery_extra_file',
          `Delivery directory is not empty: ${existing[0]}`
        );
      }
      const manifestFiles = [];
      const outputs: CreatorExecutorOutput[] = [];
      const sampledVideos = new Set<string>();
      for (const definition of deliveryFiles) {
        const artifact = requireSingleArtifact(stage.inputArtifacts, definition.kind);
        const sourcePath = await validateSourcePath(jobRoot, artifact);
        const actualSha256 = await sha256File(sourcePath);
        if (artifact.sha256 === null || artifact.sha256.toLowerCase() !== actualSha256) {
          throw new CreatorExecutorError(
            'creator_delivery_hash_mismatch',
            `Artifact hash mismatch: ${definition.kind}`
          );
        }
        const targetPath = join(deliveryRoot, definition.name);
        await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
        const info = await stat(targetPath);
        const media = await validateDeliveryFile(definition.kind, targetPath, input.ffprobePath, validateVideo);
        if (
          media !== undefined
          && sampleVideoFrames !== undefined
          && definition.kind === 'clean_video'
        ) {
          const samples = await sampleVideoFrames({
            path: targetPath,
            kind: definition.kind,
            duration: media.duration,
            workdir: join(stage.workdir, `frame-samples-${definition.kind}`),
            ...(input.ffmpegPath === undefined ? {} : { ffmpegPath: input.ffmpegPath })
          });
          if (samples.sampleCount < 3) {
            throw new CreatorExecutorError(
              'creator_delivery_frame_sampling_failed',
              `${definition.kind} requires at least three decoded frame samples`
            );
          }
          sampledVideos.add(definition.kind);
        }
        manifestFiles.push({
          name: definition.name,
          relativePath: `delivery/${definition.name}`,
          sha256: actualSha256,
          bytes: info.size,
          mime: definition.mime,
          sourceArtifactId: artifact.id
        });
        outputs.push({
          kind: definition.kind,
          status: 'completed' as const,
          path: targetPath,
          sourceArtifactIds: [artifact.id],
          metadata: {
            fileName: definition.name,
            mimeType: definition.mime,
            bytes: info.size,
            delivery: true
          }
        });
      }
      const actualFiles = await readdir(deliveryRoot);
      const expectedFiles = deliveryFiles.map(file => file.name).sort();
      if (JSON.stringify([...actualFiles].sort()) !== JSON.stringify(expectedFiles)) {
        throw new CreatorExecutorError(
          'creator_delivery_file_set_mismatch',
          'Delivery file set is not exact'
        );
      }
      const placeholderAssets = findPlaceholderAssets(stage.inputArtifacts);
      const blockingChecks = await collectBlockingChecks({
        artifacts: stage.inputArtifacts,
        sampledVideos
      });
      const packageStatus = placeholderAssets.length === 0 && blockingChecks.length === 0
        ? 'publishable' as const
        : 'technical-draft' as const;
      const manifest = stickmanDeliveryManifestSchema.parse({
        packageStatus,
        placeholderAssets,
        blockingChecks,
        files: manifestFiles
      });
      const manifestPath = join(stage.workdir, 'delivery-manifest.json');
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return {
        outputs: [
          ...outputs,
          {
            kind: 'delivery_manifest',
            status: 'completed' as const,
            path: manifestPath,
            sourceArtifactIds: stage.inputArtifacts.map(artifact => artifact.id),
            metadata: {
              fileName: 'delivery-manifest.json',
              mimeType: 'application/json',
              fileCount: manifest.files.length,
              packageStatus,
              placeholderAssets,
              blockingChecks
            }
          }
        ],
        progress: { phase: 'completed', percent: 100, files: manifest.files.length }
      };
    }
  };
}

function requireSingleArtifact(artifacts: CreatorArtifact[], kind: string): CreatorArtifact {
  const candidates = artifacts.filter(artifact => artifact.kind === kind && artifact.status === 'completed');
  if (candidates.length !== 1) {
    throw new CreatorExecutorError(
      'creator_delivery_artifact_ambiguous',
      `Delivery requires exactly one completed ${kind}`
    );
  }
  return candidates[0]!;
}

async function validateSourcePath(jobRoot: string, artifact: CreatorArtifact): Promise<string> {
  if (artifact.path === null) {
    throw new CreatorExecutorError('creator_delivery_file_missing', `${artifact.kind} file is missing`);
  }
  const link = await lstat(artifact.path);
  if (link.isSymbolicLink()) {
    throw new CreatorExecutorError(
      'creator_delivery_symlink_forbidden',
      `${artifact.kind} cannot be a symbolic link`
    );
  }
  const path = await realpath(artifact.path);
  const value = relative(jobRoot, path);
  if (value.startsWith('..') || isAbsolute(value)) {
    throw new CreatorExecutorError(
      'creator_delivery_path_escape',
      `${artifact.kind} escapes the Job root`
    );
  }
  if (!(await stat(path)).isFile()) {
    throw new CreatorExecutorError('creator_delivery_file_missing', `${artifact.kind} is not a file`);
  }
  return path;
}

async function validateDeliveryFile(
  kind: string,
  path: string,
  ffprobePath: string,
  validateVideo: VideoValidator
): Promise<Awaited<ReturnType<VideoValidator>> | undefined> {
  if (kind === 'clean_video') {
    const media = await validateVideo(path, ffprobePath);
    if (!media.hasVideo || !media.hasAudio || media.width !== 1280 || media.height !== 720) {
      throw new CreatorExecutorError(
        'creator_delivery_video_invalid',
        `${kind} must be 1280x720 audio/video media`
      );
    }
    return media;
  }
  if (kind === 'narration_subtitle') await validateSrtFile(path);
  return undefined;
}

async function collectBlockingChecks(input: {
  artifacts: CreatorArtifact[];
  sampledVideos: Set<string>;
}): Promise<string[]> {
  const blocking = new Set<string>();
  const visual = singleCompleted(input.artifacts, 'visual_validation');
  if (visual?.path === null || visual?.path === undefined) {
    blocking.add('visual_validation_missing');
  } else {
    try {
      const report = stickmanVisualValidationSchema.parse(JSON.parse(await readFile(visual.path, 'utf8')));
      if (!report.publishable || report.ocrStatus !== 'passed') blocking.add('visual_ocr_unverified');
    } catch {
      blocking.add('visual_validation_invalid');
    }
  }

  const narration = input.artifacts.filter(artifact => (
    artifact.kind === 'narration_audio' && artifact.status === 'completed'
  ));
  if (
    narration.length === 0
    || !(await everyArtifactHashMatches(narration))
    || narration.some(artifact => (
      artifact.scopeKey === null
      || artifact.metadata.timingSource !== 'ffprobe'
      || typeof artifact.metadata.duration !== 'number'
      || artifact.metadata.duration <= 0
      || typeof artifact.metadata.provider !== 'string'
    ))
  ) blocking.add('narration_audio_unverified');

  const timingArtifact = singleCompleted(input.artifacts, 'audio_timing');
  if (timingArtifact?.path === null || timingArtifact?.path === undefined) {
    blocking.add('audio_timing_missing');
  } else {
    try {
      const timing = stickmanAudioTimingSchema.parse(JSON.parse(await readFile(timingArtifact.path, 'utf8')));
      const narrationById = new Map(narration.map(artifact => [artifact.id, artifact]));
      if (timing.segments.some(segment => {
        const artifact = narrationById.get(segment.audioArtifactId);
        return artifact === undefined || artifact.sha256?.toLowerCase() !== segment.audioSha256.toLowerCase();
      })) blocking.add('audio_timing_unverified');
    } catch {
      blocking.add('audio_timing_unverified');
    }
  }

  const timelineArtifact = singleCompleted(input.artifacts, 'timeline_manifest');
  if (timelineArtifact?.path === null || timelineArtifact?.path === undefined) {
    blocking.add('timeline_missing');
  } else {
    try {
      stickmanTimelineSchema.parse(JSON.parse(await readFile(timelineArtifact.path, 'utf8')));
      if (timelineArtifact.metadata.timingSource !== 'ffprobe_cumulative_tts_duration') {
        blocking.add('timeline_unverified');
      }
    } catch {
      blocking.add('timeline_unverified');
    }
  }

  const cleanVideo = singleCompleted(input.artifacts, 'clean_video');
  const mediaValidation = singleCompleted(input.artifacts, 'media_validation');
  if (
    cleanVideo === undefined
    || mediaValidation?.path === null
    || mediaValidation?.path === undefined
  ) {
    blocking.add('media_validation_missing');
  } else {
    try {
      const report = stickmanMediaValidationSchema.parse(JSON.parse(
        await readFile(mediaValidation.path, 'utf8')
      ));
      if (
        report.cleanVideoArtifactId !== cleanVideo.id
        || report.cleanVideoSha256.toLowerCase() !== cleanVideo.sha256?.toLowerCase()
      ) blocking.add('media_validation_unverified');
    } catch {
      blocking.add('media_validation_unverified');
    }
  }
  if (
    cleanVideo?.metadata.renderEngine !== 'remotion'
    || cleanVideo.metadata.renderKind !== 'final'
  ) blocking.add('remotion_final_unverified');
  if (
    !input.sampledVideos.has('clean_video')
  ) blocking.add('video_frame_sampling_unverified');
  return [...blocking].sort();
}

function findPlaceholderAssets(artifacts: CreatorArtifact[]): string[] {
  return artifacts.filter(artifact => (
    artifact.metadata.placeholder === true
    || artifact.metadata.placeholderAsset === true
    || artifact.metadata.fakeProvider === true
    || artifact.metadata.technicalDraft === true
  )).map(artifact => `${artifact.kind}:${artifact.id}`).sort();
}

function singleCompleted(artifacts: CreatorArtifact[], kind: string): CreatorArtifact | undefined {
  const matches = artifacts.filter(artifact => artifact.kind === kind && artifact.status === 'completed');
  return matches.length === 1 ? matches[0] : undefined;
}

async function everyArtifactHashMatches(artifacts: CreatorArtifact[]): Promise<boolean> {
  for (const artifact of artifacts) {
    if (artifact.path === null || artifact.sha256 === null) return false;
    try {
      if ((await sha256File(artifact.path)) !== artifact.sha256.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function sampleFramesWithFfmpeg(input: {
  path: string;
  kind: 'clean_video';
  duration: number;
  workdir: string;
  ffmpegPath?: string;
}): Promise<{ sampleCount: number }> {
  if (input.ffmpegPath === undefined) return { sampleCount: 0 };
  await mkdir(input.workdir, { recursive: true });
  const timestamps = [
    Math.min(0.1, input.duration / 4),
    input.duration / 2,
    Math.max(0, input.duration - Math.min(0.2, input.duration / 4))
  ];
  for (const [index, timestamp] of timestamps.entries()) {
    const target = join(input.workdir, `frame-${index + 1}.png`);
    await execFileAsync(input.ffmpegPath, [
      '-y', '-ss', timestamp.toFixed(3), '-i', input.path,
      '-frames:v', '1', '-f', 'image2', target
    ]);
    const stats = await sharp(target).greyscale().stats();
    const channel = stats.channels[0];
    if (channel === undefined || channel.mean < 3 || channel.mean > 252 || channel.stdev < 2) {
      throw new CreatorExecutorError(
        'creator_delivery_frame_sampling_failed',
        `${input.kind} contains a blank or unreadable sampled frame`
      );
    }
  }
  return { sampleCount: timestamps.length };
}

function execFileAsync(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 120_000 }, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
