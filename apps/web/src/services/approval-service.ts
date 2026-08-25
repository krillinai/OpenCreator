import type {
  ApprovalDecisionResponse,
  ApprovalListQuery,
  ApprovalListResponse
} from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

type ClientLike = Pick<RuntimeClient, 'get' | 'post'>;

export function createApprovalService(client: ClientLike) {
  return {
    list(query: ApprovalListQuery = {}): Promise<ApprovalListResponse> {
      const params = new URLSearchParams();
      if (query.status !== undefined) params.set('status', query.status);
      if (query.runId !== undefined) params.set('runId', query.runId);
      if (query.threadId !== undefined) params.set('threadId', query.threadId);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const suffix = params.toString();
      return client.get(`/approvals${suffix.length === 0 ? '' : `?${suffix}`}`);
    },
    approve(id: string): Promise<ApprovalDecisionResponse> {
      return client.post(`/approvals/${encodeURIComponent(id)}/approve`);
    },
    reject(id: string): Promise<ApprovalDecisionResponse> {
      return client.post(`/approvals/${encodeURIComponent(id)}/reject`);
    }
  };
}
