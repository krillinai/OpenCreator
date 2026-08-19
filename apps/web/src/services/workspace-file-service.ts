import type {
  WorkspaceDirectoryResponse,
  WorkspaceFileContentResponse,
  WorkspaceFileMeta,
  WorkspaceFileRevealRequest,
  WorkspaceFileRevealResponse,
  WorkspaceFileSaveRequest,
  WorkspaceFileSaveResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type WorkspaceFileClient = Pick<RuntimeClient, 'get' | 'post' | 'rawGet'>;

export function createWorkspaceFileService(client: WorkspaceFileClient) {
  return {
    listDirectory(threadId: string, path: string): Promise<WorkspaceDirectoryResponse> {
      return client.get(`/workspace/files/directory?${buildThreadPathQuery(threadId, path)}`);
    },
    getMeta(threadId: string, path: string): Promise<WorkspaceFileMeta> {
      return client.get(`/workspace/files/meta?${buildThreadPathQuery(threadId, path)}`);
    },
    openText(threadId: string, path: string): Promise<WorkspaceFileContentResponse> {
      return client.get(`/workspace/files/content?${buildThreadPathQuery(threadId, path)}`);
    },
    saveText(input: WorkspaceFileSaveRequest): Promise<WorkspaceFileSaveResponse> {
      return client.post('/workspace/files/content', input);
    },
    async openBlob(threadId: string, path: string): Promise<{ objectUrl: string; mime: string; size: number }> {
      const response = await client.rawGet(`/workspace/files/blob?${buildThreadPathQuery(threadId, path)}`);
      const blob = await response.blob();
      return {
        objectUrl: URL.createObjectURL(blob),
        mime: blob.type || response.headers.get('content-type') || 'application/octet-stream',
        size: blob.size
      };
    },
    revokeBlob(objectUrl: string): void {
      URL.revokeObjectURL(objectUrl);
    },
    reveal(input: WorkspaceFileRevealRequest): Promise<WorkspaceFileRevealResponse> {
      return client.post('/workspace/files/reveal', input);
    }
  };
}

function buildThreadPathQuery(threadId: string, path: string): string {
  const params = new URLSearchParams({ threadId, path });
  return params.toString();
}
