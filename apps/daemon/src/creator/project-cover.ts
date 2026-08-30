import type { CreatorArtifact, CreatorJob } from '@opencreator/protocol';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export type CreatorProjectCover = {
  path: string;
  fileName: string;
};

export type CreatorProjectCoverService = {
  resolve(job: CreatorJob): Promise<CreatorProjectCover | undefined>;
};

type FrameExtractor = (input: {
  sourcePath: string;
  outputPath: string;
  seconds: number;
}) => Promise<void>;

const videoArtifactKinds = [
  'source_video',
  'horizontal_video',
  'vertical_video',
  'dubbed_video',
  'auto_clip_video',
  'stickman_video',
  'clip_video'
] as const;

export function createCreatorProjectCoverService(input: {
  jobsRoot: string;
  ffmpegPath?: string;
  extractFrame?: FrameExtractor;
}): CreatorProjectCoverService {
  const pending = new Map<string, Promise<CreatorProjectCover | undefined>>();
  const extractFrame = input.extractFrame
    ?? (input.ffmpegPath === undefined ? undefined : createFfmpegFrameExtractor(input.ffmpegPath));

  return {
    async resolve(job) {
      const explicitCover = latestCoverArtifact(job.artifacts)
        ?? latestArtifact(job.artifacts, ['generated_image']);
      if (explicitCover?.path !== null && explicitCover !== undefined && await isNonEmptyFile(explicitCover.path)) {
        return {
          path: explicitCover.path,
          fileName: artifactFileName(explicitCover, 'project-cover')
        };
      }

      const sourceVideo = latestArtifact(job.artifacts, videoArtifactKinds);
      if (sourceVideo?.path === null || sourceVideo === undefined || extractFrame === undefined) return undefined;
      if (!await isNonEmptyFile(sourceVideo.path)) return undefined;

      const cacheKey = `${job.id}:${sourceVideo.id}`;
      const existing = pending.get(cacheKey);
      if (existing !== undefined) return existing;
      const task = resolveVideoFrameCover({
        jobsRoot: input.jobsRoot,
        job,
        sourceVideo,
        extractFrame
      });
      pending.set(cacheKey, task);
      try {
        return await task;
      } finally {
        pending.delete(cacheKey);
      }
    }
  };
}

async function resolveVideoFrameCover(input: {
  jobsRoot: string;
  job: CreatorJob;
  sourceVideo: CreatorArtifact;
  extractFrame: FrameExtractor;
}): Promise<CreatorProjectCover | undefined> {
  if (input.sourceVideo.path === null) return undefined;
  const fingerprint = createHash('sha256').update(input.sourceVideo.id).digest('hex').slice(0, 16);
  const cachePath = join(input.jobsRoot, input.job.id, 'previews', `project-cover-${fingerprint}.jpg`);
  if (await isNonEmptyFile(cachePath)) return { path: cachePath, fileName: basename(cachePath) };

  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = join(
    dirname(cachePath),
    `project-cover-${fingerprint}.${process.pid}.${Date.now()}.jpg`
  );
  try {
    for (const seconds of [5, 0]) {
      await rm(temporaryPath, { force: true });
      try {
        await input.extractFrame({
          sourcePath: input.sourceVideo.path,
          outputPath: temporaryPath,
          seconds
        });
      } catch {
        continue;
      }
      if (!await isNonEmptyFile(temporaryPath)) continue;
      await rename(temporaryPath, cachePath);
      return { path: cachePath, fileName: basename(cachePath) };
    }
    return undefined;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function latestCoverArtifact(artifacts: CreatorArtifact[]): CreatorArtifact | undefined {
  const covers = artifacts.filter(artifact => (
    artifact.kind === 'cover_image'
    && artifact.path !== null
    && artifact.status !== 'stale'
  ));
  const versioned = covers.filter(artifact => (
    positiveMetadataNumber(artifact, 'resultVersion') !== undefined
  ));
  if (versioned.length === 0) return latestArtifact(artifacts, ['cover_image']);

  const latestResultVersion = Math.max(...versioned.map(artifact => (
    positiveMetadataNumber(artifact, 'resultVersion')!
  )));
  return versioned
    .filter(artifact => positiveMetadataNumber(artifact, 'resultVersion') === latestResultVersion)
    .sort((left, right) => (
      (positiveMetadataNumber(left, 'candidate') ?? left.version)
      - (positiveMetadataNumber(right, 'candidate') ?? right.version)
      || left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id)
    ))
    .at(0);
}

function latestArtifact(
  artifacts: CreatorArtifact[],
  kinds: readonly string[]
): CreatorArtifact | undefined {
  for (const kind of kinds) {
    const artifact = artifacts
      .filter(candidate => (
        candidate.kind === kind
        && candidate.path !== null
        && candidate.status !== 'stale'
      ))
      .sort((left, right) => (
        left.version - right.version
        || left.createdAt.localeCompare(right.createdAt)
      ))
      .at(-1);
    if (artifact !== undefined) return artifact;
  }
  return undefined;
}

function positiveMetadataNumber(
  artifact: CreatorArtifact,
  field: string
): number | undefined {
  const value = artifact.metadata[field];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function artifactFileName(artifact: CreatorArtifact, fallback: string): string {
  const metadataName = artifact.metadata.fileName;
  if (typeof metadataName === 'string' && metadataName.trim().length > 0) return metadataName;
  return artifact.path === null ? `${fallback}.jpg` : basename(artifact.path);
}

async function isNonEmptyFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function createFfmpegFrameExtractor(ffmpegPath: string): FrameExtractor {
  return input => new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-ss', String(input.seconds),
      '-i', input.sourcePath,
      '-frames:v', '1',
      '-an',
      '-vf', 'scale=960:-2:force_original_aspect_ratio=decrease',
      '-q:v', '3',
      input.outputPath
    ], {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    }, error => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}
