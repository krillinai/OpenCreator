import type {
  TaskListQuery,
  TaskListResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get'>;

export function createTaskService(client: ClientLike) {
  return {
    list(query: TaskListQuery = {}): Promise<TaskListResponse> {
      const params = new URLSearchParams();
      if (query.status !== undefined) params.set('status', query.status);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.cursor !== undefined) params.set('cursor', query.cursor);
      const suffix = params.toString();
      return client.get(`/tasks${suffix.length === 0 ? '' : `?${suffix}`}`);
    }
  };
}
