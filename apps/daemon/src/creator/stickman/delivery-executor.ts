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
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { stickmanCanvasForRatio, type CreatorArtifact } from '@opencreator/protocol';
import type { CreatorExecutor, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateMediaFile } from '../validators/media.js';
import { validateSrtFile } from '../validators/srt.js';
import {
  stickmanAudioTimingSchema,
  stickmanDeliveryManifestSchema,
  stickmanMediaValidationSchema,
  stickmanScriptManifestSchema,
  stickmanTimelineSchema,
  stickmanVisualValidationSchema
} from './contracts.js';
import { renderStickmanPublishCopy } from './publish-copy.js';

const deliveryFiles = [
  { kind: 'clean_video', name: 'short.mp4', mime: 'video/mp4' },
  { kind: 'narration_subtitle', name: 'subtitles.srt', mime: 'application/x-subrip' }
] as const;

type VideoValidator = typeof validateMediaFile;
type VideoFrameSampler = (input: {
  path: string;
  kind: 'clean_video';
  duration: number;
  workdir: string;
  ffmpegPath?: string;
}) => Promise<{ sampleCount: number }>;

type ThumbnailGenerator = (input: {
  path: string;
  duration: number;
  targetPath: string;
  width: number;
  height: number;
  ffmpegPath?: string;
}) => Promise<void>;

export function createStickmanDeliveryExecutor(input: {
  ffprobePath: string;
  ffmpegPath?: string;
  validateVideo?: VideoValidator;
  sampleVideoFrames?: VideoFrameSampler;
  createThumbnail?: ThumbnailGenerator;
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
      const timelineArtifact = requireSingleArtifact(stage.inputArtifacts, 'timeline_manifest');
      const timelinePath = await validateSourcePath(jobRoot, timelineArtifact);
      const timeline = stickmanTimelineSchema.parse(JSON.parse(await readFile(timelinePath, 'utf8')));
      const canvas = stickmanCanvasForRatio(timeline.ratio);
      const scriptArtifact = requireSingleArtifact(stage.inputArtifacts, 'script_manifest');
      const scriptPath = await validateSourcePath(jobRoot, scriptArtifact);
      const script = stickmanScriptManifestSchema.parse(JSON.parse(await readFile(scriptPath, 'utf8')));
      const manifestFiles = [];
      const outputs: CreatorExecutorOutput[] = [];
      const sampledVideos = new Set<string>();
      let cleanVideoMedia: Awaited<ReturnType<VideoValidator>> | undefined;
      for (const definition of deliveryFiles) {
        const artifact = requireSingleArtifact(stage.inputArtifacts, definition.kind);
        const sourcePath = await validateSourcePath(jobRoot, artifact);
        const actualSha256 = await assertArtifactHash(artifact, sourcePath);
        const targetPath = join(deliveryRoot, definition.name);
        await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
        const info = await stat(targetPath);
        const media = await validateDeliveryFile(
          definition.kind,
          targetPath,
          input.ffprobePath,
          validateVideo,
          canvas
        );
        if (definition.kind === 'clean_video' && media !== undefined) {
          cleanVideoMedia = media;
          if (sampleVideoFrames !== undefined) {
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
            delivery: true,
            ratio: timeline.ratio,
            width: canvas.width,
            height: canvas.height
          }
        });
      }
      if (cleanVideoMedia === undefined) {
        throw new CreatorExecutorError('creator_delivery_video_invalid', 'Clean video media was not validated');
      }
      const cleanVideoArtifact = requireSingleArtifact(stage.inputArtifacts, 'clean_video');
      const thumbnailPath = join(deliveryRoot, 'thumbnail.png');
      const thumbnailGenerator = input.createThumbnail
        ?? (input.ffmpegPath === undefined ? undefined : renderThumbnailWithFfmpeg);
      if (thumbnailGenerator === undefined) {
        throw new CreatorExecutorError(
          'creator_delivery_thumbnail_failed',
          'FFmpeg is required to generate the delivery thumbnail'
        );
      }
      await thumbnailGenerator({
        path: join(deliveryRoot, 'short.mp4'),
        duration: cleanVideoMedia.duration,
        targetPath: thumbnailPath,
        width: canvas.width,
        height: canvas.height,
        ...(input.ffmpegPath === undefined ? {} : { ffmpegPath: input.ffmpegPath })
      });
      const thumbnailInfo = await stat(thumbnailPath);
      const thumbnailMetadata = await sharp(thumbnailPath).metadata();
      if (thumbnailMetadata.width !== canvas.width || thumbnailMetadata.height !== canvas.height) {
        throw new CreatorExecutorError(
          'creator_delivery_thumbnail_failed',
          `Thumbnail must be ${canvas.width}x${canvas.height} media`
        );
      }
      const thumbnailSha256 = await sha256File(thumbnailPath);
      manifestFiles.push({
        name: 'thumbnail.png',
        relativePath: 'delivery/thumbnail.png',
        sha256: thumbnailSha256,
        bytes: thumbnailInfo.size,
        mime: 'image/png',
        sourceArtifactId: cleanVideoArtifact.id
      });
      outputs.push({
        kind: 'thumbnail',
        status: 'completed',
        path: thumbnailPath,
        sourceArtifactIds: [cleanVideoArtifact.id],
        metadata: {
          fileName: 'thumbnail.png',
          mimeType: 'image/png',
          bytes: thumbnailInfo.size,
          delivery: true,
          ratio: timeline.ratio,
          width: canvas.width,
          height: canvas.height
        }
      });
      const publishCopyPath = join(deliveryRoot, 'publish-copy.md');
      await writeFile(publishCopyPath, renderStickmanPublishCopy({
        title: script.title,
        language: script.language,
        durationSeconds: cleanVideoMedia.duration,
        ratio: timeline.ratio,
        narration: script.segments.map(segment => segment.narration)
      }), 'utf8');
      const publishCopyInfo = await stat(publishCopyPath);
      const publishCopySha256 = await sha256File(publishCopyPath);
      manifestFiles.push({
        name: 'publish-copy.md',
        relativePath: 'delivery/publish-copy.md',
        sha256: publishCopySha256,
        bytes: publishCopyInfo.size,
        mime: 'text/markdown',
        sourceArtifactId: scriptArtifact.id
      });
      outputs.push({
        kind: 'publish_copy',
        status: 'completed',
        path: publishCopyPath,
        sourceArtifactIds: [scriptArtifact.id],
        metadata: {
          fileName: 'publish-copy.md',
          mimeType: 'text/markdown',
          bytes: publishCopyInfo.size,
          delivery: true,
          ratio: timeline.ratio
        }
      });
      const actualFiles = await readdir(deliveryRoot);
      const expectedFiles = ['short.mp4', 'subtitles.srt', 'thumbnail.png', 'publish-copy.md'].sort();
      if (JSON.stringify([...actualFiles].sort()) !== JSON.stringify(expectedFiles)) {
        throw new CreatorExecutorError(
          'creator_delivery_file_set_mismatch',
          'Delivery file set is not exact'
        );
      }
      const placeholderAssets = findPlaceholderAssets(stage.inputArtifacts);
      const blockingChecks = await collectBlockingChecks({
        jobRoot,
        artifacts: stage.inputArtifacts,
        sampledVideos
      });
      const packageStatus = placeholderAssets.length === 0 && blockingChecks.length === 0
        ? 'publishable' as const
        : 'technical-draft' as const;
      const manifest = stickmanDeliveryManifestSchema.parse({
        packageStatus,
        ratio: timeline.ratio,
        width: canvas.width,
        height: canvas.height,
        duration: cleanVideoMedia.duration,
        providers: {
          image: readProvider(stage.inputArtifacts, 'shot_image'),
          video: readVideoProvider(cleanVideoArtifact),
          voice: readProvider(stage.inputArtifacts, 'narration_audio')
        },
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
  const actualJobRoot = await realpath(jobRoot);
  const value = relative(actualJobRoot, path);
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
  validateVideo: VideoValidator,
  canvas: { width: number; height: number }
): Promise<Awaited<ReturnType<VideoValidator>> | undefined> {
  if (kind === 'clean_video') {
    const media = await validateVideo(path, ffprobePath);
    if (!media.hasVideo || !media.hasAudio || media.width !== canvas.width || media.height !== canvas.height) {
      throw new CreatorExecutorError(
        'creator_delivery_video_invalid',
        `${kind} must be ${canvas.width}x${canvas.height} audio/video media`
      );
    }
    return media;
  }
  if (kind === 'narration_subtitle') await validateSrtFile(path);
  return undefined;
}

async function assertArtifactHash(artifact: CreatorArtifact, path: string): Promise<string> {
  const actualSha256 = await sha256File(path);
  if (artifact.sha256 === null || artifact.sha256.toLowerCase() !== actualSha256) {
    throw new CreatorExecutorError(
      'creator_delivery_hash_mismatch',
      `Artifact hash mismatch: ${artifact.kind}`
    );
  }
  return actualSha256;
}

function readProvider(artifacts: CreatorArtifact[], kind: string): string {
  const providers = artifacts
    .filter(artifact => artifact.kind === kind && artifact.status === 'completed')
    .map(artifact => artifact.metadata.provider)
    .filter((provider): provider is string => typeof provider === 'string' && provider.trim().length > 0);
  return providers[0] ?? 'unknown';
}

function readVideoProvider(artifact: CreatorArtifact): string {
  const provider = artifact.metadata.provider;
  if (typeof provider === 'string' && provider.trim().length > 0) return provider;
  const renderEngine = artifact.metadata.renderEngine;
  return typeof renderEngine === 'string' && renderEngine.trim().length > 0
    ? renderEngine
    : 'unknown';
}

async function renderThumbnailWithFfmpeg(input: {
  path: string;
  duration: number;
  targetPath: string;
  width: number;
  height: number;
  ffmpegPath?: string;
}): Promise<void> {
  if (input.ffmpegPath === undefined) {
    throw new CreatorExecutorError(
      'creator_delivery_thumbnail_failed',
      'FFmpeg is required to generate the delivery thumbnail'
    );
  }
  const sourcePath = `${input.targetPath}.source.png`;
  const timestamp = Math.max(0, Math.min(input.duration / 2, Math.max(0, input.duration - 0.1)));
  try {
    await execFileAsync(input.ffmpegPath, [
      '-y', '-ss', timestamp.toFixed(3), '-i', input.path,
      '-frames:v', '1', '-f', 'image2', sourcePath
    ]);
    await sharp(sourcePath)
      .resize(input.width, input.height, { fit: 'cover', position: 'centre' })
      .png()
      .toFile(input.targetPath);
  } finally {
    await rm(sourcePath, { force: true });
  }
}

async function collectBlockingChecks(input: {
  jobRoot: string;
  artifacts: CreatorArtifact[];
  sampledVideos: Set<string>;
}): Promise<string[]> {
  const blocking = new Set<string>();
  const visual = singleCompleted(input.artifacts, 'visual_validation');
  if (visual?.path === null || visual?.path === undefined) {
    blocking.add('visual_validation_missing');
  } else {
    try {
      const visualPath = await validateSourcePath(input.jobRoot, visual);
      await assertArtifactHash(visual, visualPath);
      const report = stickmanVisualValidationSchema.parse(
        JSON.parse(await readFile(visualPath, 'utf8'))
      );
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
    || !(await everyArtifactHashMatches(input.jobRoot, narration))
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
      const timingPath = await validateSourcePath(input.jobRoot, timingArtifact);
      await assertArtifactHash(timingArtifact, timingPath);
      const timing = stickmanAudioTimingSchema.parse(
        JSON.parse(await readFile(timingPath, 'utf8'))
      );
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
      const timelinePath = await validateSourcePath(input.jobRoot, timelineArtifact);
      await assertArtifactHash(timelineArtifact, timelinePath);
      stickmanTimelineSchema.parse(
        JSON.parse(await readFile(timelinePath, 'utf8'))
      );
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
      const mediaValidationPath = await validateSourcePath(input.jobRoot, mediaValidation);
      await assertArtifactHash(mediaValidation, mediaValidationPath);
      const report = stickmanMediaValidationSchema.parse(JSON.parse(
        await readFile(mediaValidationPath, 'utf8')
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

async function everyArtifactHashMatches(
  jobRoot: string,
  artifacts: CreatorArtifact[]
): Promise<boolean> {
  for (const artifact of artifacts) {
    if (artifact.path === null || artifact.sha256 === null) return false;
    try {
      const path = await validateSourcePath(jobRoot, artifact);
      if ((await sha256File(path)) !== artifact.sha256.toLowerCase()) return false;
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
