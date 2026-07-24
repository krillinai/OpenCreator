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
    async listActiveThreads(): Promise<ThreadListResponse> {
      try {
        const [interactive, scheduleTasks] = await Promise.all([
          client.get<ThreadListResponse>(
            '/threads?status=active&excludePurpose=schedule_task&limit=50'
          ),
          client.get<ThreadListResponse>(
            '/threads?status=active&purpose=schedule_task&limit=100'
          )
        ]);
        if (!hasExpectedPurposePartitions(interactive, scheduleTasks)) {
          return client.get('/threads?status=active&limit=50');
        }
        return {
          threads: mergeThreadLists(interactive.threads, scheduleTasks.threads)
        };
      } catch {
        return client.get('/threads?status=active&limit=50');
      }
    },
    createThread(input: CreateThreadRequest): Promise<{ thread: ThreadResponse }> {
      return client.post('/threads', input);
    },
    getThread(threadId: string): Promise<{ thread: ThreadResponse }> {
      return client.get(`/threads/${encodeURIComponent(threadId)}`);
    },
    updateThread(threadId: string, input: UpdateThreadRequest): Promise<{ thread: ThreadResponse }> {
      return client.patch(`/threads/${encodeURIComponent(threadId)}`, input);
    },
    archiveThread(threadId: string): Promise<{ thread: ThreadResponse }> {
      return client.post(`/threads/${encodeURIComponent(threadId)}/archive`, {});
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

function hasExpectedPurposePartitions(
  interactive: ThreadListResponse,
  scheduleTasks: ThreadListResponse
): boolean {
  return interactive.threads.every(thread => thread.purpose !== 'schedule_task')
    && scheduleTasks.threads.every(thread => thread.purpose === 'schedule_task');
}

function mergeThreadLists(
  first: ThreadResponse[],
  second: ThreadResponse[]
): ThreadResponse[] {
  const threads = [...first];
  const knownIds = new Set(first.map(thread => thread.id));
  for (const thread of second) {
    if (knownIds.has(thread.id)) continue;
    knownIds.add(thread.id);
    threads.push(thread);
  }
  return threads;
}
