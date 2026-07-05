import type { PublicRunStatus } from './events.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type WorkspaceMode = 'managed' | 'external';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';
export type ResumeMode = 'auto' | 'new_thread' | 'resume_thread';
export type ThreadStatus = 'active' | 'archived';
export type CodexHomeMode = 'global' | 'isolated';
export type CodexHomeSource = 'env' | 'default' | 'isolated';
export type CodexSkillStatus = 'valid' | 'invalid';
export type CodexSkillOperationType = 'install' | 'overwrite' | 'delete';
export type CodexSkillOperationStatus = 'succeeded' | 'failed';

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

export type CodexSkillResponse = {
  id: string;
  name?: string;
  description?: string;
  status: CodexSkillStatus;
  diagnostics: string[];
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  skillsPath: string;
  skillPath: string;
  skillFilePath: string;
  updatedAt?: string;
};

export type CodexSkillListResponse = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  skillsPath: string;
  skillsWritable: boolean;
  requiresWriteConfirmation: boolean;
  skills: CodexSkillResponse[];
  diagnostics: string[];
};

export type InstallCodexSkillRequest = {
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
};

export type CodexSkillOperationResponse = {
  id: string;
  operation: CodexSkillOperationType;
  skillId: string;
  codexHome: string;
  skillsPath: string;
  sourcePath?: string | null;
  targetPath: string;
  backupPath?: string | null;
  status: CodexSkillOperationStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type CodexSkillOperationListResponse = {
  operations: CodexSkillOperationResponse[];
};
