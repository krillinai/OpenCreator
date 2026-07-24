import type {
  CreateThreadRequest,
  ReasoningEffort,
  SandboxMode,
  ThreadOrigin,
  ThreadPurpose,
  WorkspaceMode
} from '@clawee/protocol';

export type RuntimeThread = {
  id: string;
  scheduleId?: string;
  title: string | null;
  projectId: string | null;
  origin: ThreadOrigin;
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

export type CreateConversationThreadInput = Extract<
  CreateThreadRequest,
  { projectId: string }
>;

export type CreateScheduleThreadInput = Extract<
  CreateThreadRequest,
  { purpose: 'schedule_draft' }
> | {
  purpose: 'schedule_task';
  title?: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
};

export type CreateRuntimeThreadInput = {
  title?: string;
  cwd?: string;
  workspaceMode?: WorkspaceMode;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
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

export type ThreadManagerErrorCode =
  | 'THREAD_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ARCHIVED'
  | 'PROJECT_DIRECTORY_UNAVAILABLE'
  | 'THREAD_ALREADY_ASSIGNED'
  | 'THREAD_CODEX_ID_CONFLICT';

export class ThreadManagerError extends Error {
  constructor(
    readonly code: ThreadManagerErrorCode,
    message: string
  ) {
    super(message);
  }
}

export type ThreadManager = {
  createConversationThread(request: CreateConversationThreadInput): RuntimeThread;
  createScheduleThread(request: CreateScheduleThreadInput): RuntimeThread;
  createThread(request: CreateRuntimeThreadInput): RuntimeThread;
  assertRunnableThread(id: string): RuntimeThread;
  getThread(id: string): RuntimeThread | undefined;
  getPublicThread(id: string): RuntimeThread | undefined;
  getThreadByCodexThreadId(codexThreadId: string): RuntimeThread | undefined;
  listThreads(filter?: {
    status?: 'active' | 'archived' | 'all';
    purpose?: ThreadPurpose;
    excludePurpose?: ThreadPurpose;
    limit?: number;
  }): RuntimeThread[];
  listPublicThreads(filter?: {
    status?: 'active' | 'archived' | 'all';
    purpose?: ThreadPurpose;
    excludePurpose?: ThreadPurpose;
    assignment?: 'assigned' | 'unassigned';
    limit?: number;
  }): RuntimeThread[];
  assignProject(id: string, projectId: string): RuntimeThread;
  updateThread(id: string, input: UpdateRuntimeThreadInput): RuntimeThread;
  updateScheduleThread(id: string, input: UpdateScheduleThreadInput): RuntimeThread;
  setPurpose(id: string, purpose: ThreadPurpose): RuntimeThread;
  archiveThread(id: string): RuntimeThread;
  archiveScheduleThread(id: string): RuntimeThread;
  archiveCodexThread(codexThreadId: string): RuntimeThread | undefined;
  repairCodexThreadBindings(): {
    repairedThreadIds: string[];
    unresolvedThreadIds: string[];
  };
  setCodexThreadId(threadId: string, codexThreadId: string): void;
  touchThread(threadId: string): void;
};
