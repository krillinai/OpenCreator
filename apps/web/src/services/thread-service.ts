import type {
  CreateThreadRequest,
  ThreadHistoryResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadRunsResponse
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
    listThreadRuns(threadId: string): Promise<ThreadRunsResponse> {
      return client.get(`/threads/${encodeURIComponent(threadId)}/runs?limit=50`);
    },
    getThreadHistory(threadId: string): Promise<ThreadHistoryResponse> {
      return client.get(`/threads/${encodeURIComponent(threadId)}/history`);
    }
  };
}
