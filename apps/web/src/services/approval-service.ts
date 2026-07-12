import type {
  ApprovalDecisionResponse,
  ApprovalListQuery,
  ApprovalListResponse
} from '@clawee/protocol';
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

export type MockApproval = {
  id: string;
  title: string;
  risk: string;
  status: 'pending' | 'approved' | 'rejected';
  source: 'mock';
};

export function createMockApprovalService() {
  return {
    createFileWriteApproval(path: string): MockApproval {
      return {
        id: `approval_${Date.now()}`,
        title: `允许保存 ${path}`,
        risk: '当前为 mock 本地草稿保存，不会写入真实磁盘。',
        status: 'pending',
        source: 'mock'
      };
    }
  };
}
