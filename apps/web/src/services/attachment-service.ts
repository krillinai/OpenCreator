import type {
  AttachmentAccessRequest,
  AttachmentDeleteResponse,
  AttachmentMetadataResponse,
  AttachmentUploadResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type AttachmentClient = Pick<RuntimeClient, 'postBinary' | 'get' | 'rawGet' | 'delete'>;

export function createAttachmentService(client: AttachmentClient) {
  return {
    upload(input: {
      file: File;
      draftId?: string;
      threadId?: string;
    }): Promise<AttachmentUploadResponse> {
      return client.postBinary(
        `/attachments?${buildQuery({
          fileName: input.file.name,
          mime: input.file.type || 'application/octet-stream',
          draftId: input.draftId,
          threadId: input.threadId
        })}`,
        input.file
      );
    },
    getMetadata(input: AttachmentAccessRequest): Promise<AttachmentMetadataResponse> {
      return client.get(`/attachments/${encodeURIComponent(input.id)}?${buildAccessQuery(input)}`);
    },
    openContent(input: AttachmentAccessRequest): Promise<Response> {
      return client.rawGet(
        `/attachments/${encodeURIComponent(input.id)}/content?${buildAccessQuery(input)}`
      );
    },
    delete(input: AttachmentAccessRequest): Promise<AttachmentDeleteResponse> {
      return client.delete(
        `/attachments/${encodeURIComponent(input.id)}?${buildAccessQuery(input)}`
      );
    }
  };
}

function buildAccessQuery(input: AttachmentAccessRequest): string {
  return buildQuery({
    draftId: input.draftId,
    threadId: input.threadId
  });
}

function buildQuery(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, value);
  }
  return params.toString();
}
