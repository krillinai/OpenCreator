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
export type CodexMcpTransport = 'stdio' | 'http' | 'sse' | 'unknown';
export type CodexMcpStatus = 'configured' | 'missing' | 'invalid' | 'unknown';
export type CodexMcpOperationType = 'add' | 'remove' | 'login' | 'logout' | 'get' | 'list';
export type CodexMcpOperationStatus = 'succeeded' | 'failed';

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

export type CodexMcpServerResponse = {
  name: string;
  transport: CodexMcpTransport;
  status: CodexMcpStatus;
  command?: string;
  args?: string[];
  url?: string;
  envKeys: string[];
  hasSecrets: boolean;
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  diagnostics: string[];
  raw?: string;
};

export type CodexMcpListResponse = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  requiresWriteConfirmation: boolean;
  servers: CodexMcpServerResponse[];
  diagnostics: string[];
};

export type AddCodexMcpRequest =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      confirmWriteToCodexHome?: true;
    }
  | {
      name: string;
      transport: 'http' | 'sse';
      url: string;
      env?: Record<string, string>;
      oauthClientId?: string;
      oauthResource?: string;
      bearerTokenEnvVar?: string;
      confirmWriteToCodexHome?: true;
    };

export type CodexMcpOperationResponse = {
  id: string;
  operation: CodexMcpOperationType;
  serverName?: string | null;
  codexHome: string;
  command: string[];
  status: CodexMcpOperationStatus;
  exitCode?: number | null;
  timedOut: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type CodexMcpOperationListResponse = {
  operations: CodexMcpOperationResponse[];
};

export type ScheduleConcurrencyPolicy = 'skip' | 'queue' | 'parallel';
export type ScheduleMisfirePolicy = 'skip';
export type ScheduleLastStatus = PublicRunStatus | 'skipped' | 'queued';
export type ScheduleOperationType =
  | 'create'
  | 'update'
  | 'delete'
  | 'run_now'
  | 'timer_trigger'
  | 'skip_misfire'
  | 'skip_concurrency'
  | 'queue_trigger'
  | 'run_queued';
export type ScheduleOperationStatus = 'succeeded' | 'failed' | 'skipped' | 'queued';
export type ScheduleRunSummary = Pick<RunResponse, 'id' | 'threadId' | 'status'>;

export type CreateScheduleRequest = {
  name: string;
  cron: string;
  timezone?: string;
  enabled?: boolean;
  prompt: string;
  profile?: string;
  cwd?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
  timeoutMs?: number;
  concurrencyPolicy?: ScheduleConcurrencyPolicy;
  misfirePolicy?: ScheduleMisfirePolicy;
};

export type UpdateScheduleRequest = Partial<
  Omit<CreateScheduleRequest, 'model' | 'reasoning' | 'timeoutMs'>
> & {
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  timeoutMs?: number | null;
};

export type ScheduleResponse = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  promptPreviewRedacted: string;
  profile: string;
  cwd: string;
  canonicalCwd: string;
  model?: string | null;
  reasoning?: ReasoningEffort | null;
  sandbox: SandboxMode;
  timeoutMs?: number | null;
  concurrencyPolicy: ScheduleConcurrencyPolicy;
  misfirePolicy: ScheduleMisfirePolicy;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunId?: string | null;
  lastStatus?: ScheduleLastStatus | null;
  pendingTrigger: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleDetailResponse = ScheduleResponse & {
  prompt: string;
};

export type ScheduleListResponse = {
  schedules: ScheduleResponse[];
};

export type RunScheduleNowResponse = {
  run: ScheduleRunSummary | null;
  schedule: ScheduleResponse;
  skipped: boolean;
  queued: boolean;
};

export type ScheduleOperationResponse = {
  id: string;
  operation: ScheduleOperationType;
  scheduleId: string;
  status: ScheduleOperationStatus;
  runId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type ScheduleOperationListResponse = {
  operations: ScheduleOperationResponse[];
};
