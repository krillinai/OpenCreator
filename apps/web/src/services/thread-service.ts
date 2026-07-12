import type {
  CreateThreadRequest,
  ThreadHistoryQuery,
  ThreadHistoryResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadRunsResponse,
  UpdateThreadRequest
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createThreadService(client: RuntimeClient) {
  return {
    listActiveThreads(): Promise<ThreadListResponse> {
      return client.get('/threads?status=active&limit=50');
    },
    createThread(input: CreateThreadRequest = {}): Promise<{ thread: ThreadResponse }> {
      return client.post('/threads', input);
    },
    getThread(threadId: string): Promise<{ thread: ThreadResponse }> {
      return client.get(`/threads/${encodeURIComponent(threadId)}`);
    },
    updateThread(threadId: string, input: UpdateThreadRequest): Promise<{ thread: ThreadResponse }> {
      return client.patch(`/threads/${encodeURIComponent(threadId)}`, input);
    },
    listThreadRuns(threadId: string): Promise<ThreadRunsResponse> {
      return client.get(`/threads/${encodeURIComponent(threadId)}/runs?limit=50`);
    },
    getThreadHistory(
      threadId: string,
      query: ThreadHistoryQuery = {}
    ): Promise<ThreadHistoryResponse> {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.before !== undefined) params.set('before', query.before);
      if (query.targetItemId !== undefined) params.set('targetItemId', query.targetItemId);
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      return client.get(`/threads/${encodeURIComponent(threadId)}/history${suffix}`);
    }
  };
}
