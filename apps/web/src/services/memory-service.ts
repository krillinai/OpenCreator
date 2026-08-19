import type {
  ConversationSummaryListResponse,
  ConversationSummaryResponse,
  CreateMemoryRequest,
  MemoryDisableAllResponse,
  MemoryListQuery,
  MemoryListResponse,
  MemoryResponse,
  RunContextResponse,
  UpdateMemoryRequest
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post' | 'patch' | 'delete'>;

export function createMemoryService(client: ClientLike) {
  return {
    listMemories(query: MemoryListQuery = {}): Promise<MemoryListResponse> {
      const params = new URLSearchParams();
      if (query.query !== undefined) params.set('query', query.query);
      if (query.scope !== undefined) params.set('scope', query.scope);
      if (query.scopeKey !== undefined) params.set('scopeKey', query.scopeKey);
      if (query.enabled !== undefined) params.set('enabled', String(query.enabled));
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const suffix = params.toString();
      return client.get(`/memories${suffix.length === 0 ? '' : `?${suffix}`}`);
    },
    createMemory(input: CreateMemoryRequest): Promise<MemoryResponse> {
      return client.post('/memories', input);
    },
    updateMemory(id: string, input: UpdateMemoryRequest): Promise<MemoryResponse> {
      return client.patch(`/memories/${encodeURIComponent(id)}`, input);
    },
    deleteMemory(id: string): Promise<{ deleted: true }> {
      return client.delete(`/memories/${encodeURIComponent(id)}`);
    },
    disableAll(): Promise<MemoryDisableAllResponse> {
      return client.post('/memories/disable-all');
    },
    listSummaries(input: { threadId?: string; limit?: number } = {}): Promise<ConversationSummaryListResponse> {
      const params = new URLSearchParams();
      if (input.threadId !== undefined) params.set('threadId', input.threadId);
      if (input.limit !== undefined) params.set('limit', String(input.limit));
      const suffix = params.toString();
      return client.get(`/summaries${suffix.length === 0 ? '' : `?${suffix}`}`);
    },
    createSummary(threadId: string): Promise<ConversationSummaryResponse> {
      return client.post(`/threads/${encodeURIComponent(threadId)}/summaries`);
    },
    deleteSummary(id: string): Promise<{ deleted: true }> {
      return client.delete(`/summaries/${encodeURIComponent(id)}`);
    },
    getRunContext(runId: string): Promise<RunContextResponse> {
      return client.get(`/runs/${encodeURIComponent(runId)}/context`);
    }
  };
}
