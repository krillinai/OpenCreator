import { createHash } from 'node:crypto';
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
import { stickmanDeliveryManifestSchema } from './contracts.js';

const deliveryFiles = [
  { kind: 'clean_video', name: 'landscape-clean.mp4', mime: 'video/mp4' },
  { kind: 'cover_image', name: 'youtube-cover.png', mime: 'image/png' },
  { kind: 'publish_copy', name: 'publish-copy-youtube.md', mime: 'text/markdown' },
  { kind: 'bilingual_video', name: 'horizontal_bilingual.mp4', mime: 'video/mp4' },
  { kind: 'bilingual_subtitle', name: 'bilingual_srt.srt', mime: 'application/x-subrip' }
] as const;

type VideoValidator = typeof validateMediaFile;

export function createStickmanDeliveryExecutor(input: {
  ffprobePath: string;
  validateVideo?: VideoValidator;
}): CreatorExecutor {
  const validateVideo = input.validateVideo ?? validateMediaFile;
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
        await validateDeliveryFile(definition.kind, targetPath, input.ffprobePath, validateVideo);
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
      const manifest = stickmanDeliveryManifestSchema.parse({ files: manifestFiles });
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
              fileCount: manifest.files.length
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
): Promise<void> {
  if (kind === 'clean_video' || kind === 'bilingual_video') {
    const media = await validateVideo(path, ffprobePath);
    if (!media.hasVideo || !media.hasAudio || media.width !== 1280 || media.height !== 720) {
      throw new CreatorExecutorError(
        'creator_delivery_video_invalid',
        `${kind} must be 1280x720 audio/video media`
      );
    }
    return;
  }
  if (kind === 'cover_image') {
    const metadata = await sharp(path).metadata();
    if (metadata.format !== 'png' || metadata.width !== 1280 || metadata.height !== 720) {
      throw new CreatorExecutorError(
        'creator_delivery_cover_invalid',
        'Cover must be a 1280x720 PNG'
      );
    }
    return;
  }
  if (kind === 'publish_copy') {
    const content = await readFile(path, 'utf8');
    if (!/^#\s+\S+/m.test(content) || !/^##\s+Tags\s*$/mi.test(content) || !/^-\s+\S+/m.test(content)) {
      throw new CreatorExecutorError(
        'creator_delivery_publish_copy_invalid',
        'Publish copy is incomplete'
      );
    }
    return;
  }
  if (kind === 'bilingual_subtitle') await validateSrtFile(path);
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
