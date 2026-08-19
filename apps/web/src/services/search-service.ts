import type {
  ConversationSearchQuery,
  ConversationSearchResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createSearchService(client: RuntimeClient) {
  return {
    searchConversations(query: ConversationSearchQuery): Promise<ConversationSearchResponse> {
      const params = new URLSearchParams();
      params.set('query', query.query);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.cursor !== undefined) params.set('cursor', query.cursor);
      if (query.cwd !== undefined) params.set('cwd', query.cwd);
      if (query.itemTypes !== undefined && query.itemTypes.length > 0) {
        params.set('types', query.itemTypes.join(','));
      }
      if (query.createdAfter !== undefined) params.set('createdAfter', query.createdAfter);
      if (query.createdBefore !== undefined) params.set('createdBefore', query.createdBefore);
      return client.get(`/search/conversations?${params.toString()}`);
    }
  };
}
