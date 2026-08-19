import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ENTERPRISE_SHARED_FILE_MAX_BYTES } from '../enterprise/config-2026-07-30.js';
import type {
  EnterpriseSharedDriveManager
} from '../enterprise/shared-drive-manager-2026-08-06.js';
import {
  EnterpriseSharedDriveManagerError
} from '../enterprise/shared-drive-manager-2026-08-06.js';
import { apiError } from './errors.js';

export const ENTERPRISE_SHARED_FILE_CONTENT_TYPE =
  'application/vnd.opencreator.shared-file';

const paginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  cursor: z.string().optional()
}).strict();

const fileListQuerySchema = paginationQuerySchema.extend({
  spaceId: z.string().optional(),
  query: z.string().optional(),
  logicalPathPrefix: z.string().optional()
}).strict();

const uploadQuerySchema = z.object({
  logicalPath: z.string().min(1),
  expectedRevision: z.string().regex(/^\d+$/).optional(),
  contentType: z.string(),
  sizeBytes: z.string().regex(/^\d+$/)
}).strict();

const downloadBodySchema = z.object({
  projectId: z.string().min(1),
  overwrite: z.boolean().optional()
}).strict();

export async function registerEnterpriseDriveRoutes(
  server: FastifyInstance,
  manager: EnterpriseSharedDriveManager,
  options: { maxFileBytes?: number } = {}
): Promise<void> {
  const maxFileBytes =
    options.maxFileBytes ?? ENTERPRISE_SHARED_FILE_MAX_BYTES;
  server.addContentTypeParser(
    ENTERPRISE_SHARED_FILE_CONTENT_TYPE,
    { bodyLimit: maxFileBytes },
    (_request, payload, done) => done(null, payload)
  );

  server.get('/enterprise/shared-spaces', async (request, reply) => {
    const parsed = paginationQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(reply);
    try {
      return await manager.listSpaces({
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: Number(parsed.data.limit) }),
        ...(parsed.data.cursor === undefined
          ? {}
          : { cursor: parsed.data.cursor })
      });
    } catch (error) {
      return sendDriveError(reply, error);
    }
  });

  server.get('/enterprise/shared-files', async (request, reply) => {
    const parsed = fileListQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidRequest(reply);
    try {
      return await manager.listFiles({
        ...(parsed.data.spaceId === undefined
          ? {}
          : { spaceId: parsed.data.spaceId }),
        ...(parsed.data.query === undefined
          ? {}
          : { query: parsed.data.query }),
        ...(parsed.data.logicalPathPrefix === undefined
          ? {}
          : { logicalPathPrefix: parsed.data.logicalPathPrefix }),
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: Number(parsed.data.limit) }),
        ...(parsed.data.cursor === undefined
          ? {}
          : { cursor: parsed.data.cursor })
      });
    } catch (error) {
      return sendDriveError(reply, error);
    }
  });

  server.get<{ Params: { fileId: string } }>(
    '/enterprise/shared-files/:fileId',
    async (request, reply) => {
      try {
        return await manager.getFileDetail(request.params.fileId);
      } catch (error) {
        return sendDriveError(reply, error);
      }
    }
  );

  server.post<{
    Params: { spaceId: string };
    Querystring: unknown;
    Body: AsyncIterable<Uint8Array>;
  }>(
    '/enterprise/shared-spaces/:spaceId/files',
    async (request, reply) => {
      const parsed = uploadQuerySchema.safeParse(request.query);
      if (!parsed.success || !isAsyncIterable(request.body)) {
        return invalidRequest(reply);
      }
      const sizeBytes = Number(parsed.data.sizeBytes);
      const expectedRevision = parsed.data.expectedRevision === undefined
        ? undefined
        : Number(parsed.data.expectedRevision);
      if (
        !Number.isSafeInteger(sizeBytes)
        || (
          expectedRevision !== undefined
          && !Number.isSafeInteger(expectedRevision)
        )
      ) {
        return invalidRequest(reply);
      }
      if (sizeBytes > maxFileBytes) {
        return reply
          .code(413)
          .send(apiError(
            'ENTERPRISE_SHARED_FILE_TOO_LARGE',
            'Enterprise shared file is too large'
          ));
      }
      try {
        const result = await manager.uploadFile({
          spaceId: request.params.spaceId,
          logicalPath: parsed.data.logicalPath,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          contentType: parsed.data.contentType,
          expectedSizeBytes: sizeBytes,
          content: request.body
        });
        return reply.code(result.created ? 201 : 200).send(result);
      } catch (error) {
        return sendDriveError(reply, error);
      }
    }
  );

  server.post<{
    Params: { fileId: string };
    Body: unknown;
  }>(
    '/enterprise/shared-files/:fileId/download',
    async (request, reply) => {
      const parsed = downloadBodySchema.safeParse(request.body);
      if (!parsed.success) return invalidRequest(reply);
      try {
        return await manager.downloadToProject({
          fileId: request.params.fileId,
          projectId: parsed.data.projectId,
          overwrite: parsed.data.overwrite === true
        });
      } catch (error) {
        return sendDriveError(reply, error);
      }
    }
  );
}

function invalidRequest(reply: FastifyReply) {
  return reply
    .code(400)
    .send(apiError('VALIDATION_FAILED', 'shared drive request is invalid'));
}

function sendDriveError(reply: FastifyReply, error: unknown) {
  if (error instanceof EnterpriseSharedDriveManagerError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, driveErrorMessage(error.code), error.details));
  }
  throw error;
}

function driveErrorMessage(code: string): string {
  switch (code) {
    case 'ENTERPRISE_SESSION_EXPIRED':
    case 'ENTERPRISE_UNAUTHORIZED':
      return 'Enterprise session expired';
    case 'ENTERPRISE_AGENT_FORBIDDEN':
      return 'Enterprise agent access is unavailable';
    case 'ENTERPRISE_SHARED_SPACE_NOT_FOUND':
      return 'Enterprise shared space was not found';
    case 'ENTERPRISE_SHARED_FILE_NOT_FOUND':
      return 'Enterprise shared file was not found';
    case 'ENTERPRISE_SHARED_FILE_WRITE_FORBIDDEN':
      return 'Enterprise shared file write is forbidden';
    case 'ENTERPRISE_SHARED_FILE_ALREADY_EXISTS':
      return 'Enterprise shared file already exists';
    case 'ENTERPRISE_SHARED_FILE_REVISION_CONFLICT':
      return 'Enterprise shared file revision changed';
    case 'ENTERPRISE_SHARED_FILE_TOO_LARGE':
      return 'Enterprise shared file is too large';
    case 'ENTERPRISE_SHARED_FILE_LENGTH_MISMATCH':
      return 'Enterprise shared file length mismatch';
    case 'ENTERPRISE_SHARED_FILE_DIGEST_MISMATCH':
      return 'Enterprise shared file digest mismatch';
    case 'ENTERPRISE_SHARED_FILE_STORAGE_UNAVAILABLE':
      return 'Enterprise shared file storage is unavailable';
    case 'ENTERPRISE_SHARED_FILE_LOCAL_EXISTS':
      return 'The project already contains this file';
    case 'PROJECT_NOT_FOUND':
      return 'Project was not found';
    case 'PROJECT_ARCHIVED':
      return 'Project is archived';
    case 'PROJECT_DIRECTORY_UNAVAILABLE':
      return 'Project directory is unavailable';
    case 'PATH_ESCAPE':
    case 'PATH_IGNORED':
      return 'The shared file path is not allowed in this project';
    default:
      return 'Enterprise shared drive operation failed';
  }
}

function isAsyncIterable(
  value: unknown
): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object'
    && value !== null
    && Symbol.asyncIterator in value
  );
}
