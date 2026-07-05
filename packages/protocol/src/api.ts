import type { PublicRunStatus } from './events.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type WorkspaceMode = 'managed' | 'external';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';
export type ResumeMode = 'auto' | 'new_thread' | 'resume_thread';
export type ThreadStatus = 'active' | 'archived';
export type CodexHomeMode = 'global' | 'isolated';
export type CodexHomeSource = 'env' | 'default' | 'isolated';

export type CodexStatusResponse = {
  codexBin: string;
  codexVersion: string;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  codexHomeSource: CodexHomeSource;
  codexHomeWritable: boolean;
  capabilities: unknown;
  diagnostics: string[];
};

export type RunRequest = {
  prompt: string;
  threadId?: string;
  resumeMode?: ResumeMode;
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
  codexThreadId?: string | null;
  status: PublicRunStatus;
};

export type CreateThreadRequest = {
  title?: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
};

export type ThreadResponse = {
  id: string;
  title?: string | null;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type ThreadListResponse = {
  threads: ThreadResponse[];
};

export type ThreadRunsResponse = {
  runs: RunResponse[];
};
