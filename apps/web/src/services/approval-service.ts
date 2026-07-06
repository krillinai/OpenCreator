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
