import type {
  CreateThreadRequest,
  ReasoningEffort,
  SandboxMode,
  ThreadPurpose,
  WorkspaceMode
} from '@clawee/protocol';

export type RuntimeThread = {
  id: string;
  title: string | null;
  codexThreadId?: string | null;
  cwd: string;
  canonicalCwd: string;
  workspaceMode: WorkspaceMode;
  profile: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  status: 'active' | 'archived';
  purpose: ThreadPurpose;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type CreateRuntimeThreadInput = CreateThreadRequest;

export type UpdateRuntimeThreadInput = {
  sandbox: SandboxMode;
};

export type ImportCodexThreadInput = {
  codexThreadId: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  profile?: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox?: SandboxMode;
};

export type ThreadManager = {
  createThread(request: CreateRuntimeThreadInput): RuntimeThread;
  getThread(id: string): RuntimeThread | undefined;
  getThreadByCodexThreadId(codexThreadId: string): RuntimeThread | undefined;
  listThreads(filter?: { status?: 'active' | 'archived' | 'all'; limit?: number }): RuntimeThread[];
  importCodexThread(input: ImportCodexThreadInput): RuntimeThread;
  updateThread(id: string, input: UpdateRuntimeThreadInput): RuntimeThread;
  archiveThread(id: string): RuntimeThread;
  archiveCodexThread(codexThreadId: string): RuntimeThread | undefined;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
