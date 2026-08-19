import type {
  WorkspaceDirectoryListRequest,
  WorkspaceFileBlobRequest,
  WorkspaceFileContentRequest,
  WorkspaceFileMetaRequest,
  WorkspaceFileRevealRequest,
  WorkspaceFileSaveRequest
} from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { WorkspaceFileError } from '../workspace-files/errors.js';
import type { WorkspaceFileService } from '../workspace-files/service.js';
import { apiError } from './errors.js';

export async function registerWorkspaceFileRoutes(
  server: FastifyInstance,
  service: WorkspaceFileService
): Promise<void> {
  server.get('/workspace/files/directory', async (request, reply) => {
    const parsed = parseThreadPathQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      return await service.listDirectory(parsed.value);
    } catch (error) {
      return sendWorkspaceFileError(reply, error);
    }
  });

  server.get('/workspace/files/meta', async (request, reply) => {
    const parsed = parseThreadPathQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      return await service.getMeta(parsed.value);
    } catch (error) {
      return sendWorkspaceFileError(reply, error);
    }
  });

  server.get('/workspace/files/content', async (request, reply) => {
    const parsed = parseThreadPathQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      return await service.readContent(parsed.value);
    } catch (error) {
      return sendWorkspaceFileError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/workspace/files/content', async (request, reply) => {
    const parsed = parseSaveContentBody(request.body);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      return await service.saveContent(parsed.value);
    } catch (error) {
      return sendWorkspaceFileError(reply, error);
    }
  });

  server.get('/workspace/files/blob', async (request, reply) => {
    const parsed = parseThreadPathQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      const blob = await service.readBlob(parsed.value);
      return reply
        .header('Content-Type', blob.meta.mime)
        .header('Cache-Control', 'no-store')
        .send(blob.buffer);
    } catch (error) {
      return sendWorkspaceFileError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/workspace/files/reveal', async (request, reply) => {
    const parsed = parseRevealBody(request.body);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));

    try {
      return await service.reveal(parsed.value);
    } catch (error) {
      return sendWorkspaceFileError(reply, error);
    }
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseThreadPathQuery(
  query: unknown
): ParseResult<
  | WorkspaceDirectoryListRequest
  | WorkspaceFileMetaRequest
  | WorkspaceFileContentRequest
  | WorkspaceFileBlobRequest
> {
  if (!isPlainObject(query)) return { ok: false, message: 'query must be an object' };

  const threadId = query.threadId;
  if (typeof threadId !== 'string' || threadId.length === 0) {
    return { ok: false, message: 'threadId must be a non-empty string' };
  }

  const path = query.path;
  if (typeof path !== 'string') return { ok: false, message: 'path must be a string' };

  return { ok: true, value: { threadId, path } };
}

function parseSaveContentBody(body: unknown): ParseResult<WorkspaceFileSaveRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const { threadId, path, content, baseVersionToken, overwriteConflict } = body;
  if (typeof threadId !== 'string' || threadId.length === 0) {
    return { ok: false, message: 'threadId must be a non-empty string' };
  }
  if (typeof path !== 'string') return { ok: false, message: 'path must be a string' };
  if (typeof content !== 'string') return { ok: false, message: 'content must be a string' };
  if (typeof baseVersionToken !== 'string' || baseVersionToken.length === 0) {
    return { ok: false, message: 'baseVersionToken must be a non-empty string' };
  }
  if (overwriteConflict !== undefined && typeof overwriteConflict !== 'boolean') {
    return { ok: false, message: 'overwriteConflict must be a boolean' };
  }

  return {
    ok: true,
    value: {
      threadId,
      path,
      content,
      baseVersionToken,
      ...(overwriteConflict === undefined ? {} : { overwriteConflict })
    }
  };
}

function parseRevealBody(body: unknown): ParseResult<WorkspaceFileRevealRequest> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };

  const { threadId, path, mode } = body;
  if (typeof threadId !== 'string' || threadId.length === 0) {
    return { ok: false, message: 'threadId must be a non-empty string' };
  }
  if (mode !== 'file' && mode !== 'directory') {
    return { ok: false, message: 'mode must be file or directory' };
  }
  if (path !== undefined && typeof path !== 'string') {
    return { ok: false, message: 'path must be a string' };
  }

  return {
    ok: true,
    value: {
      threadId,
      mode,
      ...(path === undefined ? {} : { path })
    }
  };
}

function sendWorkspaceFileError(reply: FastifyReply, error: unknown) {
  if (error instanceof WorkspaceFileError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, error.message, error.details));
  }
  throw error;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
