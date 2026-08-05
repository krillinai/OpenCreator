import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type {
  EnterpriseKnowledgeManager
} from '../enterprise/knowledge-manager-2026-08-05.js';
import {
  ENTERPRISE_KNOWLEDGE_DOCUMENT_MAX_BYTES,
  EnterpriseKnowledgeManagerError
} from '../enterprise/knowledge-manager-2026-08-05.js';
import { apiError } from './errors.js';

export const ENTERPRISE_KNOWLEDGE_DOCUMENT_CONTENT_TYPE =
  'application/vnd.clawee.knowledge-document';

const uploadQuerySchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string(),
  sizeBytes: z.string().regex(/^\d+$/)
}).strict();

export async function registerEnterpriseKnowledgeRoutes(
  server: FastifyInstance,
  manager: EnterpriseKnowledgeManager,
  options: { maxDocumentBytes?: number } = {}
): Promise<void> {
  const maxDocumentBytes =
    options.maxDocumentBytes ?? ENTERPRISE_KNOWLEDGE_DOCUMENT_MAX_BYTES;
  server.addContentTypeParser(
    ENTERPRISE_KNOWLEDGE_DOCUMENT_CONTENT_TYPE,
    { bodyLimit: maxDocumentBytes },
    (_request, payload, done) => done(null, payload)
  );

  server.get('/enterprise/knowledge-bases', async (_request, reply) => {
    try {
      return await manager.listKnowledgeBases();
    } catch (error) {
      return sendKnowledgeError(reply, error);
    }
  });

  server.get<{ Params: { knowledgeBaseId: string } }>(
    '/enterprise/knowledge-bases/:knowledgeBaseId/documents',
    async (request, reply) => {
      try {
        return await manager.listDocuments(request.params.knowledgeBaseId);
      } catch (error) {
        return sendKnowledgeError(reply, error);
      }
    }
  );

  server.post<{
    Params: { knowledgeBaseId: string };
    Querystring: unknown;
    Body: AsyncIterable<Uint8Array>;
  }>(
    '/enterprise/knowledge-bases/:knowledgeBaseId/documents',
    async (request, reply) => {
      const parsed = uploadQuerySchema.safeParse(request.query);
      if (!parsed.success || !isAsyncIterable(request.body)) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'document upload request is invalid')
        );
      }
      const sizeBytes = Number(parsed.data.sizeBytes);
      if (!Number.isSafeInteger(sizeBytes)) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'document size is invalid')
        );
      }
      if (sizeBytes > maxDocumentBytes) {
        return reply.code(413).send(
          apiError(
            'ENTERPRISE_DOCUMENT_TOO_LARGE',
            'Enterprise document is too large'
          )
        );
      }
      try {
        const result = await manager.uploadDocument({
          knowledgeBaseId: request.params.knowledgeBaseId,
          fileName: parsed.data.fileName,
          mimeType: parsed.data.mimeType,
          expectedSizeBytes: sizeBytes,
          content: request.body
        });
        return reply.code(201).send(result);
      } catch (error) {
        return sendKnowledgeError(reply, error);
      }
    }
  );
}

function sendKnowledgeError(reply: FastifyReply, error: unknown) {
  if (error instanceof EnterpriseKnowledgeManagerError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, knowledgeErrorMessage(error.code)));
  }
  throw error;
}

function knowledgeErrorMessage(code: string): string {
  switch (code) {
    case 'ENTERPRISE_SESSION_EXPIRED':
    case 'ENTERPRISE_UNAUTHORIZED':
      return 'Enterprise session expired';
    case 'ENTERPRISE_AGENT_FORBIDDEN':
      return 'Enterprise agent access is unavailable';
    case 'ENTERPRISE_KNOWLEDGE_BASE_NOT_FOUND':
      return 'Enterprise knowledge base was not found';
    case 'ENTERPRISE_DOCUMENT_UPLOAD_FORBIDDEN':
      return 'Enterprise document upload is forbidden';
    case 'ENTERPRISE_DOCUMENT_TOO_LARGE':
      return 'Enterprise document is too large';
    case 'ENTERPRISE_DOCUMENT_TYPE_UNSUPPORTED':
      return 'Enterprise document type is unsupported';
    case 'ENTERPRISE_KNOWLEDGE_CONFLICT':
      return 'Enterprise knowledge state changed';
    case 'ENTERPRISE_KNOWLEDGE_PROVIDER_ERROR':
      return 'Enterprise knowledge provider is unavailable';
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return 'Enterprise service is unavailable';
    default:
      return 'Enterprise knowledge operation failed';
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
