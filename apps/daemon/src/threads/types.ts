import type {
  CreateThreadRequest,
  ReasoningEffort,
  SandboxMode,
  ThreadPurpose,
  WorkspaceMode
} from '@clawee/protocol';

export type RuntimeThread = {
  id: string;
  scheduleId?: string;
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

export type CreateRuntimeThreadInput = Omit<CreateThreadRequest, 'purpose'> & {
  purpose?: ThreadPurpose;
};

export type UpdateRuntimeThreadInput = {
  sandbox: SandboxMode;
};

export type UpdateScheduleThreadInput = {
  title: string;
  cwd: string;
  profile: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
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
  listThreads(filter?: {
    status?: 'active' | 'archived' | 'all';
    purpose?: ThreadPurpose;
    excludePurpose?: ThreadPurpose;
    limit?: number;
  }): RuntimeThread[];
  importCodexThread(input: ImportCodexThreadInput): RuntimeThread;
  updateThread(id: string, input: UpdateRuntimeThreadInput): RuntimeThread;
  updateScheduleThread(id: string, input: UpdateScheduleThreadInput): RuntimeThread;
  setPurpose(id: string, purpose: ThreadPurpose): RuntimeThread;
  archiveThread(id: string): RuntimeThread;
  archiveScheduleThread(id: string): RuntimeThread;
  archiveCodexThread(codexThreadId: string): RuntimeThread | undefined;
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
