import type {
  AttachmentAccessRequest,
  AttachmentUploadRequest
} from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AttachmentService } from '../attachments/service.js';
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  AttachmentServiceError
} from '../attachments/service.js';
import { apiError } from './errors.js';

export async function registerAttachmentRoutes(
  server: FastifyInstance,
  service: AttachmentService,
  options: { maxSizeBytes?: number } = {}
): Promise<void> {
  const maxSizeBytes = options.maxSizeBytes ?? ATTACHMENT_MAX_SIZE_BYTES;
  server.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: maxSizeBytes },
    (_request, body, done) => done(null, body)
  );

  server.post<{ Body: Buffer }>('/attachments', {
    config: { bodyLimit: maxSizeBytes }
  }, async (request, reply) => {
    const parsed = parseUploadQuery(request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    if (!Buffer.isBuffer(request.body)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'body must be binary content'));
    }

    try {
      const result = await service.upload({ ...parsed.value, content: request.body });
      return reply.code(result.deduplicated ? 200 : 201).send(result);
    } catch (error) {
      return sendAttachmentError(reply, error);
    }
  });

  server.get<{ Params: { id: string } }>('/attachments/:id', async (request, reply) => {
    const parsed = parseAccess(request.params.id, request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    try {
      return { attachment: await service.getMetadata(parsed.value) };
    } catch (error) {
      return sendAttachmentError(reply, error);
    }
  });

  server.get<{ Params: { id: string } }>('/attachments/:id/content', async (request, reply) => {
    const parsed = parseAccess(request.params.id, request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    try {
      const result = await service.read(parsed.value);
      return reply
        .header('Content-Type', result.attachment.mime)
        .header('Content-Disposition', contentDisposition(result.attachment.fileName))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(result.content);
    } catch (error) {
      return sendAttachmentError(reply, error);
    }
  });

  server.delete<{ Params: { id: string } }>('/attachments/:id', async (request, reply) => {
    const parsed = parseAccess(request.params.id, request.query);
    if (!parsed.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', parsed.message));
    try {
      await service.delete(parsed.value);
      return { deleted: true };
    } catch (error) {
      return sendAttachmentError(reply, error);
    }
  });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseUploadQuery(query: unknown): ParseResult<AttachmentUploadRequest> {
  if (!isPlainObject(query)) return { ok: false, message: 'query must be an object' };
  const { fileName, mime, draftId, threadId } = query;
  if (typeof fileName !== 'string' || fileName.trim().length === 0) {
    return { ok: false, message: 'fileName must be a non-empty string' };
  }
  if (typeof mime !== 'string' || mime.trim().length === 0) {
    return { ok: false, message: 'mime must be a non-empty string' };
  }
  const owner = parseOwner(draftId, threadId);
  if (!owner.ok) return owner;
  return {
    ok: true,
    value: {
      fileName,
      mime,
      ...owner.value
    }
  };
}

function parseAccess(id: string, query: unknown): ParseResult<AttachmentAccessRequest> {
  if (id.trim().length === 0) return { ok: false, message: 'id must be a non-empty string' };
  if (!isPlainObject(query)) return { ok: false, message: 'query must be an object' };
  const owner = parseOwner(query.draftId, query.threadId);
  if (!owner.ok) return owner;
  return { ok: true, value: { id, ...owner.value } };
}

function parseOwner(
  draftId: unknown,
  threadId: unknown
): ParseResult<{ draftId?: string; threadId?: string }> {
  if (draftId !== undefined && (typeof draftId !== 'string' || draftId.trim().length === 0)) {
    return { ok: false, message: 'draftId must be a non-empty string' };
  }
  if (threadId !== undefined && (typeof threadId !== 'string' || threadId.trim().length === 0)) {
    return { ok: false, message: 'threadId must be a non-empty string' };
  }
  if (draftId === undefined && threadId === undefined) {
    return { ok: false, message: 'draftId or threadId is required' };
  }
  return {
    ok: true,
    value: {
      ...(draftId === undefined ? {} : { draftId }),
      ...(threadId === undefined ? {} : { threadId })
    }
  };
}

function sendAttachmentError(reply: FastifyReply, error: unknown) {
  if (error instanceof AttachmentServiceError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, error.message, error.details));
  }
  throw error;
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="attachment"; filename*=UTF-8''${encoded}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
