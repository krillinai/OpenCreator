import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type {
  CreatorArtifactImportRequest,
  CreatorArtifactImportResponse,
  RuntimeErrorCode
} from '@opencreator/protocol';
import type { CreatorService } from './service.js';

export type CreatorArtifactImportService = ReturnType<
  typeof createCreatorArtifactImportService
>;

type CreatorArtifactImportErrorCode = Extract<
  RuntimeErrorCode,
  | 'creator_job_not_found'
  | 'creator_revision_conflict'
  | 'creator_artifact_not_found'
  | 'creator_artifact_import_forbidden'
  | 'creator_artifact_import_unsupported'
  | 'creator_artifact_import_invalid'
>;

export class CreatorArtifactImportError extends Error {
  constructor(
    readonly code: CreatorArtifactImportErrorCode,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'CreatorArtifactImportError';
  }
}

export function createCreatorArtifactImportService(input: {
  jobsRoot: string;
  creator: CreatorService;
}) {
  const jobsRoot = resolve(input.jobsRoot);
  return {
    async importArtifact(
      targetJobId: string,
      request: CreatorArtifactImportRequest
    ): Promise<CreatorArtifactImportResponse> {
      const target = input.creator.getJob(targetJobId);
      const sourceJob = input.creator.getJob(request.sourceJobId);
      if (target === undefined || sourceJob === undefined) {
        throw new CreatorArtifactImportError(
          'creator_job_not_found',
          'Creator job not found',
          404
        );
      }
      if (target.revision !== request.expectedRevision) {
        throw new CreatorArtifactImportError(
          'creator_revision_conflict',
          'Creator job revision changed',
          409
        );
      }
      if (target.projectId !== sourceJob.projectId) {
        throw new CreatorArtifactImportError(
          'creator_artifact_import_forbidden',
          'Artifacts can only be imported within the same project',
          403
        );
      }
      if (
        target.templateId !== 'video-translation'
        && target.templateId !== 'auto-clip'
      ) {
        throw new CreatorArtifactImportError(
          'creator_artifact_import_unsupported',
          'Video artifacts can only be imported into video translation or auto clip jobs',
          400
        );
      }
      if (request.kind !== 'source_video') {
        throw new CreatorArtifactImportError(
          'creator_artifact_import_unsupported',
          'Only source video imports are supported',
          400
        );
      }
      const source = sourceJob.artifacts.find(
        artifact => artifact.id === request.artifactId
      );
      if (
        source === undefined
        || source.kind !== 'source_video'
        || source.status !== 'completed'
        || source.path === null
      ) {
        throw new CreatorArtifactImportError(
          'creator_artifact_not_found',
          'Completed source video artifact not found',
          404
        );
      }
      try {
        const info = await stat(source.path);
        if (!info.isFile() || info.size === 0) throw new Error('invalid file');
      } catch {
        throw new CreatorArtifactImportError(
          'creator_artifact_not_found',
          'Source video file not found',
          404
        );
      }

      const importDir = join(
        jobsRoot,
        safeJobSegment(targetJobId),
        'imports',
        artifactSegment(source.id)
      );
      await mkdir(importDir, { recursive: true });
      const fileName = safeFileName(
        typeof source.metadata.fileName === 'string'
          ? source.metadata.fileName
          : basename(source.path)
      );
      const destination = join(importDir, fileName);
      const created = await linkOrCopy(source.path, destination);
      try {
        return input.creator.registerImportedSourceVideo(targetJobId, {
          expectedRevision: request.expectedRevision,
          sourceJobId: sourceJob.id,
          sourceArtifactId: source.id,
          path: destination,
          metadata: {
            ...source.metadata,
            fileName
          }
        });
      } catch (error) {
        if (created) await rm(destination, { force: true }).catch(() => undefined);
        throw error;
      }
    }
  };
}

async function linkOrCopy(source: string, destination: string): Promise<boolean> {
  try {
    await link(source, destination);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw error;
  }
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function safeJobSegment(value: string): string {
  if (!/^creator_job_[A-Za-z0-9_-]+$/.test(value)) {
    throw new CreatorArtifactImportError(
      'creator_job_not_found',
      'Creator job not found',
      404
    );
  }
  return value;
}

function artifactSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function safeFileName(value: string): string {
  const safe = basename(value.replaceAll('\\', '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (safe.length === 0) {
    throw new CreatorArtifactImportError(
      'creator_artifact_import_invalid',
      'Artifact file name is invalid',
      400
    );
  }
  return safe.slice(0, 255);
}
