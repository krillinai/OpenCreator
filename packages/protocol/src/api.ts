import type { PublicRunStatus } from './events.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type WorkspaceMode = 'managed' | 'external';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';

export type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: 'new_thread' | 'resume_thread';
  cwd?: string;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
  images?: string[];
};

export type RunResponse = {
  id: string;
  threadId?: string;
  status: PublicRunStatus;
};

export type CreateThreadRequest = {
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
};

export type ThreadResponse = {
  id: string;
  codexThreadId?: string;
  cwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  sandbox: SandboxMode;
  status: 'active' | 'archived' | 'resume_unavailable';
};
