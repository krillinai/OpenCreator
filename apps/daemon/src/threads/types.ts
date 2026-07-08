import type {
  CreateThreadRequest,
  ReasoningEffort,
  SandboxMode,
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
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
};

export type CreateRuntimeThreadInput = CreateThreadRequest;

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
  archiveThread(id: string): RuntimeThread;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
