import type { CreateThreadRequest, SandboxMode, WorkspaceMode } from '@clawee/protocol';

export type RuntimeThread = {
  id: string;
  codexThreadId?: string;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  sandbox: SandboxMode;
  status: 'active' | 'archived' | 'resume_unavailable';
};

export type CreateRuntimeThreadInput = CreateThreadRequest;
