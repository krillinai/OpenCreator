import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CreatorSourceUploadResponse } from '@opencreator/protocol';
import { CreatorServiceError, type CreatorService } from './service.js';
import type { MediaProbe } from './validators/media.js';

export const CREATOR_SOURCE_UPLOAD_CONTENT_TYPE =
  'application/vnd.opencreator.creator-source';
export const CREATOR_SOURCE_MAX_SIZE_BYTES = 8 * 1024 * 1024 * 1024;

export type CreatorSourceUploadService = ReturnType<typeof createCreatorSourceUploadService>;

export class CreatorSourceUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'CreatorSourceUploadError';
  }
}

export function createCreatorSourceUploadService(input: {
  jobsRoot: string;
  creator: CreatorService;
  probeMedia(path: string): Promise<MediaProbe>;
  maxSizeBytes?: number;
}) {
  const jobsRoot = resolve(input.jobsRoot);
  const maxSizeBytes = input.maxSizeBytes ?? CREATOR_SOURCE_MAX_SIZE_BYTES;

  return {
    async upload(request: {
      jobId: string;
      expectedRevision: number;
      fileName: string;
      mimeType: string;
      lastModified: number | null;
      source: Readable;
    }): Promise<CreatorSourceUploadResponse> {
      const current = input.creator.getJob(request.jobId);
      if (current === undefined) {
        throw new CreatorSourceUploadError('creator_job_not_found', 'Creator job not found', 404);
      }
      if (current.revision !== request.expectedRevision) {
        throw new CreatorSourceUploadError(
          'creator_revision_conflict',
          'Creator job revision changed',
          409
        );
      }
      const jobSegment = safeJobSegment(request.jobId);
      const fileName = safeFileName(request.fileName);
      const mimeType = safeMimeType(request.mimeType);
      const uploadDir = join(jobsRoot, jobSegment, 'source');
      await mkdir(uploadDir, { recursive: true });
      const token = randomBytes(12).toString('hex');
      const extension = safeExtension(fileName);
      const temporaryPath = join(uploadDir, `.${token}.upload`);
      const finalPath = join(uploadDir, `source-${token}${extension}`);
      const hash = createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > maxSizeBytes) {
            callback(new CreatorSourceUploadError(
              'creator_source_too_large',
              `Local source exceeds the ${maxSizeBytes} byte limit`,
              413
            ));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        }
      });

      try {
        await pipeline(
          request.source,
          meter,
          createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
        );
        if (size === 0) {
          throw new CreatorSourceUploadError(
            'creator_source_empty',
            'Local source must not be empty',
            400
          );
        }
        let media: MediaProbe;
        try {
          media = await input.probeMedia(temporaryPath);
        } catch {
          throw new CreatorSourceUploadError(
            'creator_source_invalid',
            'Uploaded file is not a readable video or audio source',
            415
          );
        }
        if (!media.hasVideo && !media.hasAudio) {
          throw new CreatorSourceUploadError(
            'creator_source_invalid',
            'Uploaded file has no readable video or audio stream',
            415
          );
        }
        const sha256 = hash.digest('hex');
        await rename(temporaryPath, finalPath);
        try {
          const response = input.creator.registerSourceVideo(request.jobId, {
            expectedRevision: request.expectedRevision,
            path: finalPath,
            fileName,
            mimeType,
            size,
            sha256,
            lastModified: request.lastModified,
            media
          });
          if (response.deduplicated) await rm(finalPath, { force: true });
          return response;
        } catch (error) {
          await rm(finalPath, { force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        if (error instanceof CreatorSourceUploadError) throw error;
        if (error instanceof CreatorServiceError) throw error;
        throw new CreatorSourceUploadError(
          'creator_source_upload_failed',
          error instanceof Error ? error.message : 'Local source upload failed',
          500
        );
      }
    }
  };
}

function safeJobSegment(value: string): string {
  if (!/^creator_job_[A-Za-z0-9_-]+$/.test(value)) {
    throw new CreatorSourceUploadError('creator_job_not_found', 'Creator job not found', 404);
  }
  return value;
}

function safeFileName(value: string): string {
  const safe = basename(value.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (safe.length === 0) {
    throw new CreatorSourceUploadError(
      'creator_source_invalid',
      'Local source file name is invalid',
      400
    );
  }
  return safe.slice(0, 255);
}

function safeMimeType(value: string): string {
  const mimeType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    mimeType !== 'application/octet-stream'
    && !mimeType.startsWith('video/')
    && !mimeType.startsWith('audio/')
  ) {
    throw new CreatorSourceUploadError(
      'creator_source_type_unsupported',
      `Local source type is not supported: ${mimeType || 'unknown'}`,
      415
    );
  }
  return mimeType;
}

function safeExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin';
}
