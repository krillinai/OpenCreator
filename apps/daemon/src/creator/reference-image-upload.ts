import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CreatorSourceUploadResponse } from '@opencreator/protocol';
import { CreatorServiceError, type CreatorService } from './service.js';
import { validateImageFile } from './validators/image.js';

export const CREATOR_REFERENCE_IMAGE_CONTENT_TYPE =
  'application/vnd.opencreator.creator-reference-image';
export const CREATOR_REFERENCE_IMAGE_MAX_SIZE_BYTES = 20 * 1024 * 1024;

export type CreatorReferenceImageUploadService =
  ReturnType<typeof createCreatorReferenceImageUploadService>;

export class CreatorReferenceImageUploadError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'CreatorReferenceImageUploadError';
  }
}

export function createCreatorReferenceImageUploadService(input: {
  jobsRoot: string;
  creator: CreatorService;
  maxSizeBytes?: number;
}) {
  const jobsRoot = resolve(input.jobsRoot);
  const maxSizeBytes = input.maxSizeBytes ?? CREATOR_REFERENCE_IMAGE_MAX_SIZE_BYTES;

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
        throw new CreatorReferenceImageUploadError(
          'creator_job_not_found',
          'Creator job not found',
          404
        );
      }
      if (current.revision !== request.expectedRevision) {
        throw new CreatorReferenceImageUploadError(
          'creator_revision_conflict',
          'Creator job revision changed',
          409
        );
      }

      const jobSegment = safeJobSegment(request.jobId);
      const fileName = safeFileName(request.fileName);
      const mimeType = safeMimeType(request.mimeType);
      const uploadDir = join(jobsRoot, jobSegment, 'references');
      await mkdir(uploadDir, { recursive: true });
      const token = randomBytes(12).toString('hex');
      const extension = safeExtension(fileName, mimeType);
      const temporaryPath = join(uploadDir, `.${token}.upload`);
      const finalPath = join(uploadDir, `reference-${token}${extension}`);
      const hash = createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > maxSizeBytes) {
            callback(new CreatorReferenceImageUploadError(
              'creator_reference_too_large',
              `Reference image exceeds the ${maxSizeBytes} byte limit`,
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
          throw new CreatorReferenceImageUploadError(
            'creator_reference_empty',
            'Reference image must not be empty',
            400
          );
        }
        let image: Awaited<ReturnType<typeof validateImageFile>>;
        try {
          image = await validateImageFile(temporaryPath);
        } catch {
          throw new CreatorReferenceImageUploadError(
            'creator_reference_invalid',
            'Uploaded reference is not a supported image',
            415
          );
        }
        const sha256 = hash.digest('hex');
        await rename(temporaryPath, finalPath);
        try {
          const response = input.creator.registerReferenceImage(request.jobId, {
            expectedRevision: request.expectedRevision,
            path: finalPath,
            fileName,
            mimeType,
            size,
            sha256,
            lastModified: request.lastModified,
            format: image.format
          });
          if (response.deduplicated) await rm(finalPath, { force: true });
          return response;
        } catch (error) {
          await rm(finalPath, { force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await rm(temporaryPath, { force: true }).catch(() => undefined);
        if (error instanceof CreatorReferenceImageUploadError) throw error;
        if (error instanceof CreatorServiceError) throw error;
        throw new CreatorReferenceImageUploadError(
          'creator_reference_upload_failed',
          error instanceof Error ? error.message : 'Reference image upload failed',
          500
        );
      }
    }
  };
}

function safeJobSegment(value: string): string {
  if (!/^creator_job_[A-Za-z0-9_-]+$/.test(value)) {
    throw new CreatorReferenceImageUploadError(
      'creator_job_not_found',
      'Creator job not found',
      404
    );
  }
  return value;
}

function safeFileName(value: string): string {
  const safe = basename(value.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!safe) {
    throw new CreatorReferenceImageUploadError(
      'creator_reference_invalid',
      'Reference image file name is invalid',
      400
    );
  }
  return safe.slice(0, 255);
}

function safeMimeType(value: string): string {
  const mimeType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(mimeType)) {
    throw new CreatorReferenceImageUploadError(
      'creator_reference_type_unsupported',
      `Reference image type is not supported: ${mimeType || 'unknown'}`,
      415
    );
  }
  return mimeType;
}

function safeExtension(fileName: string, mimeType: string): string {
  const extension = extname(fileName).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return extension;
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return '.png';
}
