import type { PublicRunStatus } from './events.js';

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type WorkspaceMode = 'managed' | 'external';
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high' | 'xhigh';
export type ResumeMode = 'auto' | 'new_thread' | 'resume_thread';
export type RunSubmissionMode = 'enqueue' | 'interrupt_and_enqueue';
export type ApprovalKind = 'command_execution' | 'file_change' | 'permissions';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled';
export type ApprovalRisk = 'medium' | 'high';
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

export type WorkspaceFileKind =
  | 'directory'
  | 'markdown'
  | 'text'
  | 'json'
  | 'code'
  | 'html'
  | 'image'
  | 'pdf'
  | 'binary'
  | 'unknown';

export type WorkspaceFileMeta = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  kind: WorkspaceFileKind;
  mime: string;
  size: number;
  mtimeMs: number;
  versionToken: string;
  previewable: boolean;
  editable: boolean;
  readonly: boolean;
  reason?: string;
};

export type WorkspaceFileMetaSummary = Pick<
  WorkspaceFileMeta,
  'kind' | 'mime' | 'size' | 'mtimeMs' | 'previewable' | 'editable' | 'readonly' | 'reason'
>;

export type WorkspaceFilePathRequest = {
  threadId: string;
  path: string;
};

export type WorkspaceDirectoryListRequest = WorkspaceFilePathRequest;
export type WorkspaceFileMetaRequest = WorkspaceFilePathRequest;
export type WorkspaceFileContentRequest = WorkspaceFilePathRequest;
export type WorkspaceFileBlobRequest = WorkspaceFilePathRequest;

export type WorkspaceFileNode =
  | {
      path: string;
      name: string;
      depth: number;
      type: 'directory';
      hasChildren?: boolean;
      childrenLoaded?: false;
      meta?: WorkspaceFileMetaSummary;
    }
  | {
      path: string;
      name: string;
      depth: number;
      type: 'file';
      meta?: WorkspaceFileMetaSummary;
    };

export type WorkspaceDirectoryResponse = {
  threadId: string;
  rootName: string;
  rootPathLabel: string;
  path: string;
  suggestedOpenPath?: string;
  truncated: boolean;
  warnings: string[];
  nodes: WorkspaceFileNode[];
};

export type WorkspaceFileContentResponse = {
  meta: WorkspaceFileMeta;
  content: string;
  encoding: 'utf8';
};

export type WorkspaceFileSaveRequest = {
  threadId: string;
  path: string;
  content: string;
  baseVersionToken: string;
  overwriteConflict?: boolean;
};

export type WorkspaceFileSaveResponse = {
  meta: WorkspaceFileMeta;
  saved: true;
};

export type WorkspaceFileRevealRequest = {
  threadId: string;
  path?: string;
  mode: 'file' | 'directory';
};

export type WorkspaceFileRevealResponse = {
  ok: true;
};

export type DiagnosticFileResponse = {
  name: string;
  content: string;
};

export type RunDiagnosticsResponse = {
  runId: string;
  files: DiagnosticFileResponse[];
  codexStatusSnapshot: CodexStatusResponse;
  warnings: string[];
};

export type CleanupItemType = 'run_logs' | 'managed_thread_workspace';

export type CleanupPreviewItem = {
  type: CleanupItemType;
  id: string;
  path: string;
  sizeBytes: number;
  lastModifiedAt: string;
  reason: string;
};

export type CleanupPreviewResponse = {
  olderThanDays: number;
  items: CleanupPreviewItem[];
  totalSizeBytes: number;
  warnings: string[];
};

export type CleanupDeleteRequest = {
  olderThanDays: number;
  confirm: true;
};

export type CleanupDeletedItem = Pick<CleanupPreviewItem, 'type' | 'id' | 'path' | 'sizeBytes'>;

export type CleanupFailedItem = CleanupDeletedItem & {
  error: string;
};

export type CleanupDeleteResponse = {
  deleted: CleanupDeletedItem[];
  failed: CleanupFailedItem[];
  totalDeletedBytes: number;
  warnings: string[];
};

export type AttachmentStatus = 'draft' | 'committed';

export type AttachmentResponse = {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  sha256: string;
  storageKey: string;
  draftId?: string;
  threadId?: string;
  runId?: string;
  status: AttachmentStatus;
  createdAt: string;
  updatedAt: string;
};

export type AttachmentUploadRequest = {
  fileName: string;
  mime: string;
  draftId?: string;
  threadId?: string;
};

export type AttachmentAccessRequest = {
  id: string;
  draftId?: string;
  threadId?: string;
};

export type AttachmentUploadResponse = {
  attachment: AttachmentResponse;
  deduplicated: boolean;
};

export type AttachmentMetadataResponse = {
  attachment: AttachmentResponse;
};

export type AttachmentDeleteResponse = {
  deleted: true;
};

export type RunRequest = {
  prompt: string;
  threadId?: string;
  draftId?: string;
  attachmentIds?: string[];
  submissionMode?: RunSubmissionMode;
  resumeMode?: ResumeMode;
  cwd?: string;
  profile?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  sandbox?: SandboxMode;
};

export type RunResponse = {
  id: string;
  threadId?: string;
  codexThreadId?: string | null;
  status: PublicRunStatus;
  lastEventSeq?: number;
  attachments?: AttachmentResponse[];
  submissionMode?: RunSubmissionMode;
  queuePosition?: number;
};

export type RuntimeApproval = {
  id: string;
  runId: string;
  threadId?: string | null;
  codexThreadId?: string | null;
  turnId: string;
  itemId: string;
  requestId: string;
  kind: ApprovalKind;
  status: ApprovalStatus;
  risk: ApprovalRisk;
  title: string;
  summary: string;
  details: Record<string, unknown>;
  requestedAt: string;
  expiresAt: string;
  resolvedAt?: string | null;
  resolutionReason?: string | null;
};

export type ApprovalListQuery = {
  status?: ApprovalStatus | 'all';
  runId?: string;
  threadId?: string;
  limit?: number;
};

export type ApprovalListResponse = {
  approvals: RuntimeApproval[];
};

export type ApprovalDecisionResponse = {
  approval: RuntimeApproval;
  changed: boolean;
};

export type TaskStatusFilter =
  | 'all'
  | 'active'
  | 'terminal'
  | 'waiting_approval'
  | PublicRunStatus;

export type TaskItemStatus = PublicRunStatus | 'waiting_approval';

export type TaskListQuery = {
  status?: TaskStatusFilter;
  limit?: number;
  cursor?: string;
};

export type TaskItem = {
  id: string;
  runId: string;
  threadId?: string;
  title: string;
  status: TaskItemStatus;
  runStatus: PublicRunStatus;
  cwd: string;
  profile: string;
  createdBy: string;
  submissionMode: RunSubmissionMode;
  queuePosition?: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  terminationReason?: string;
  errorCode?: string;
  errorMessage?: string;
  pendingApproval?: RuntimeApproval;
};

export type TaskListResponse = {
  tasks: TaskItem[];
  hasMore: boolean;
  nextCursor?: string;
};

export type MemoryScope = 'global' | 'project' | 'thread';
export type MemorySource = 'user' | 'agent_suggestion';

export type MemoryEntry = {
  id: string;
  content: string;
  scope: MemoryScope;
  scopeKey?: string;
  source: MemorySource;
  enabled: boolean;
  sensitive: boolean;
  userConfirmedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryListQuery = {
  query?: string;
  scope?: MemoryScope | 'all';
  scopeKey?: string;
  enabled?: boolean | 'all';
  limit?: number;
};

export type MemoryListResponse = {
  memories: MemoryEntry[];
};

export type CreateMemoryRequest = {
  content: string;
  scope: MemoryScope;
  scopeKey?: string;
  source: MemorySource;
  acknowledgeSensitive?: boolean;
};

export type UpdateMemoryRequest = {
  content?: string;
  enabled?: boolean;
  acknowledgeSensitive?: boolean;
};

export type MemoryResponse = {
  memory: MemoryEntry;
};

export type MemoryDisableAllResponse = {
  disabledCount: number;
};

export type ConversationSummary = {
  id: string;
  threadId: string;
  content: string;
  coveredFromCursor: string;
  coveredToCursor: string;
  itemCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSummaryResponse = {
  summary: ConversationSummary;
};

export type ConversationSummaryListResponse = {
  summaries: ConversationSummary[];
};

export type RunContextItem = {
  kind: 'memory' | 'summary';
  sourceId: string;
  content: string;
  order: number;
  scope?: MemoryScope;
  scopeKey?: string;
  summaryVersion?: number;
};

export type RunContextResponse = {
  runId: string;
  items: RunContextItem[];
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

export type ThreadPurpose = 'conversation' | 'schedule_draft' | 'schedule_task';

export type UpdateThreadRequest = {
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
  purpose: ThreadPurpose;
  scheduleId?: string;
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

export type ThreadHistoryItem =
  | { id: string; type: 'user_message'; text: string; createdAt: string; turnId?: string }
  | { id: string; type: 'assistant_message'; text: string; createdAt: string; turnId?: string }
  | { id: string; type: 'reasoning_summary'; text: string; createdAt: string; turnId?: string }
  | { id: string; type: 'tool_use'; name: string; input: Record<string, unknown>; createdAt: string; turnId?: string }
  | { id: string; type: 'tool_result'; name: string; output: string; isError: boolean; createdAt: string; turnId?: string }
  | {
      id: string;
      type: 'file_change';
      changes: Array<{ path: string; kind: 'add' | 'modify' | 'delete' | 'unknown' }>;
      status: 'in_progress' | 'completed' | 'failed' | 'unknown';
      createdAt: string;
      turnId?: string;
    }
  | { id: string; type: 'done'; status: 'succeeded' | 'failed' | 'canceled'; createdAt: string; turnId?: string };

export type ThreadHistoryResponse = {
  threadId: string;
  codexThreadId?: string | null;
  items: ThreadHistoryItem[];
  hasMore?: boolean;
  nextCursor?: string;
  oldestItemAt?: string;
  targetItemId?: string;
};

export type ThreadHistoryQuery = {
  limit?: number;
  before?: string;
  targetItemId?: string;
};

export type ConversationSearchItemType =
  | 'title'
  | 'user_message'
  | 'assistant_message'
  | 'reasoning_summary'
  | 'tool_use'
  | 'tool_result'
  | 'file_change';

export type ConversationSearchQuery = {
  query: string;
  limit?: number;
  cursor?: string;
  cwd?: string;
  itemTypes?: ConversationSearchItemType[];
  createdAfter?: string;
  createdBefore?: string;
};

export type ConversationSearchSnippetSegment = {
  text: string;
  highlighted: boolean;
};

export type ConversationSearchResult = {
  threadId: string;
  codexThreadId: string;
  title: string;
  cwd: string;
  itemId?: string;
  itemType: ConversationSearchItemType;
  createdAt: string;
  snippet: ConversationSearchSnippetSegment[];
};

export type ConversationSearchResponse = {
  results: ConversationSearchResult[];
  hasMore: boolean;
  nextCursor?: string;
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

export type CodexSkillMarketInstallRecordResponse = {
  skillId: string;
  repository: string;
  skillPath: string;
  commit: string;
  marketRevision: number;
  installedAt: string;
  updatedAt: string;
};

export type CodexSkillMarketInstallRecordListResponse = {
  records: CodexSkillMarketInstallRecordResponse[];
};

export type CodexSkillMarketMutationResponse = {
  skill: CodexSkillResponse;
  operation: CodexSkillOperationResponse;
  record: CodexSkillMarketInstallRecordResponse;
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

export type CodexMcpServerDetailResponse = {
  server: CodexMcpServerResponse;
};

export type CodexMcpAddResponse = {
  server?: CodexMcpServerResponse;
  operation: CodexMcpOperationResponse;
};

export type CodexMcpRemoveResponse = {
  removed: true;
};

export type CodexMcpAuthResponse = {
  operation: CodexMcpOperationResponse;
};

export type CodexProfileStatus = 'valid' | 'invalid';
export type CodexProfilePrimitive = string | number | boolean;
export type CodexProfileValue = CodexProfilePrimitive | CodexProfilePrimitive[];
export type CodexProfileConfig = Record<string, CodexProfileValue>;

export type CodexProfileResponse = {
  name: string;
  status: CodexProfileStatus;
  config: CodexProfileConfig;
  diagnostics: string[];
  source: string;
  codexHomeMode: CodexHomeMode;
  updatedAt?: string;
};

export type CodexProfileListResponse = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  writable: boolean;
  baseConfigValid: boolean;
  profiles: CodexProfileResponse[];
  diagnostics: string[];
};

export type CodexProfileDetailResponse = {
  profile: CodexProfileResponse;
};

export type CreateCodexProfileRequest = {
  name: string;
  config: CodexProfileConfig;
};

export type UpdateCodexProfileRequest = {
  config: CodexProfileConfig;
};

export type CodexProfileMutationResponse = {
  profile: CodexProfileResponse;
};

export type CodexProfileDeleteResponse = {
  deleted: true;
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
  threadId?: string | null;
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
