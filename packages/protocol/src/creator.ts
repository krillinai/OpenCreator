import type { SandboxMode } from './api.js';

export const creatorJobStatuses = [
  'draft',
  'running',
  'needs_input',
  'completed',
  'failed',
  'canceled'
] as const;

export const creatorStageRunStatuses = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'interrupted'
] as const;

export const creatorStageDispatchStatuses = [
  'queued',
  'claimed',
  'finished'
] as const;

export const creatorArtifactStatuses = [
  'draft',
  'technical_preview',
  'completed',
  'stale'
] as const;

export const creatorEventKinds = [
  'snapshot_changed',
  'activity_changed',
  'stage_progress',
  'agent_turn_changed',
  'agent_item_changed',
  'agent_approval_changed'
] as const;

export const creatorAgentSessionStatuses = [
  'active',
  'interrupted',
  'closed'
] as const;

export const creatorAgentTurnStatuses = [
  'queued',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'canceled',
  'interrupted',
  'needs_user_resolution'
] as const;

export const creatorAgentItemKinds = [
  'user_message',
  'assistant_message',
  'reasoning',
  'tool_call',
  'tool_result',
  'approval',
  'error'
] as const;

export const creatorAgentItemStatuses = [
  'queued',
  'running',
  'completed',
  'failed',
  'canceled',
  'interrupted'
] as const;

export const creatorAgentApprovalStatuses = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'canceled'
] as const;

export const creatorCommandReceiptStatuses = [
  'committed',
  'replayed',
  'rejected',
  'failed'
] as const;

export type CreatorJobStatus = typeof creatorJobStatuses[number];
export type CreatorStageRunStatus = typeof creatorStageRunStatuses[number];
export type CreatorStageDispatchStatus = typeof creatorStageDispatchStatuses[number];
export type CreatorArtifactStatus = typeof creatorArtifactStatuses[number];
export type CreatorEventKind = typeof creatorEventKinds[number];
export type CreatorAgentSessionStatus = typeof creatorAgentSessionStatuses[number];
export type CreatorAgentTurnStatus = typeof creatorAgentTurnStatuses[number];
export type CreatorAgentItemKind = typeof creatorAgentItemKinds[number];
export type CreatorAgentItemStatus = typeof creatorAgentItemStatuses[number];
export type CreatorAgentApprovalStatus = typeof creatorAgentApprovalStatuses[number];
export type CreatorCommandReceiptStatus = typeof creatorCommandReceiptStatuses[number];
export type CreatorActor = 'user' | 'agent' | 'system';
export type CreatorJson = null | boolean | number | string | CreatorJson[] | {
  [key: string]: CreatorJson;
};

export type CreatorArtifact = {
  id: string;
  jobId: string;
  kind: string;
  version: number;
  status: CreatorArtifactStatus;
  path: string | null;
  sourceArtifactIds: string[];
  metadata: Record<string, CreatorJson>;
  createdAt: string;
};

export type CreatorResultSnapshot = {
  version: number;
  createdAt: string;
  action: string;
  stageId: string | null;
  description: string;
  artifactRefs: Record<string, string[]>;
  changedArtifactIds: string[];
  staleArtifactIds: string[];
  state: Record<string, CreatorJson>;
};

export type CreatorStageRun = {
  id: string;
  jobId: string;
  stageId: string;
  executor: string;
  status: CreatorStageRunStatus;
  dispatchStatus: CreatorStageDispatchStatus;
  claimOwner: string | null;
  claimExpiresAt: string | null;
  attempt: number;
  idempotencyKey: string | null;
  progress: Record<string, CreatorJson>;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CreatorActivity = {
  id: string;
  jobId: string;
  revision: number;
  actor: CreatorActor;
  action: string;
  summary: string;
  details: Record<string, CreatorJson>;
  createdAt: string;
};

export type CreatorJob = {
  id: string;
  projectId: string;
  templateId: string;
  templateVersion: number;
  status: CreatorJobStatus;
  revision: number;
  state: Record<string, CreatorJson>;
  agentThreadId: string | null;
  stages: CreatorStageRun[];
  artifacts: CreatorArtifact[];
  activities: CreatorActivity[];
  createdAt: string;
  updatedAt: string;
};

export type CreatorTemplateSummary = {
  id: string;
  version: number;
  renderer: string;
  outputs: Array<{ kind: string; required: boolean }>;
};

export type CreatorActionRequest = {
  action: string;
  expectedRevision: number;
  actor?: CreatorActor;
  input: Record<string, CreatorJson>;
};

export type CreatorCommandRequest = CreatorActionRequest & {
  idempotencyKey: string;
};

export type CreatorActionReceipt = {
  actor: CreatorActor;
  action: string;
  summary: string;
  affectedArtifacts: string[];
  newRevision: number;
  createdAt: string;
};

export type CreatorActionResponse = {
  job: CreatorJob;
  receipt: CreatorActionReceipt;
};

export type CreatorSourceUploadResponse = {
  job: CreatorJob;
  artifact: CreatorArtifact;
  deduplicated: boolean;
};

export type CreatorArtifactImportRequest = {
  expectedRevision: number;
  sourceJobId: string;
  artifactId: string;
  kind: 'source_video';
};

export type CreatorArtifactImportResponse = {
  job: CreatorJob;
  artifact: CreatorArtifact;
  deduplicated: boolean;
};

export type CreateCreatorJobRequest = {
  projectId: string;
  templateId: string;
  templateVersion?: number;
  state?: Record<string, CreatorJson>;
  creationKey?: string;
};

export type CreatorJobListResponse = { jobs: CreatorJob[] };
export type CreatorTemplateListResponse = { templates: CreatorTemplateSummary[] };

export type CreatorYtDlpStatus = {
  channel: 'nightly';
  source: 'bundled' | 'managed';
  currentVersion: string;
  bundledVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkDue: boolean;
  lastCheckedAt: string | null;
  lastCheckAttemptAt: string | null;
  installedAt: string | null;
};

export type CreatorYtDlpStatusResponse = {
  ytDlp: CreatorYtDlpStatus;
};

export type CreatorSelection = {
  kind: string;
  id?: string;
  range?: { start: number; end: number };
};

export type AgentContextEnvelope = {
  contractVersion: 1;
  jobId: string;
  projectId: string;
  templateId: string;
  templateVersion: number;
  jobStatus: CreatorJobStatus;
  revision: number;
  selectedResultVersion: number | null;
  latestResultVersion: number | null;
  selectedResultSnapshot: {
    version: number;
    description: string;
    artifactRefs: Record<string, string[]>;
    staleArtifactIds: string[];
  } | null;
  currentStage: string | null;
  state: Record<string, CreatorJson>;
  stateTruncated: boolean;
  templateGuidance?: string;
  availableStageIds: string[];
  stages: Array<{
    stageId: string;
    status: CreatorStageRunStatus;
    dispatchStatus: CreatorStageDispatchStatus;
    attempt: number;
    progress: {
      percent: number | null;
      providerStatus: string | null;
      phase: string | null;
    };
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  artifacts: Array<{
    id: string;
    kind: string;
    version: number;
    projectVersion: number | null;
    status: CreatorArtifactStatus;
    fileName: string | null;
    cueCount: number | null;
    duration: number | null;
    width: number | null;
    height: number | null;
  }>;
  selection: CreatorSelection | null;
  recentChanges: Array<{
    revision: number;
    actor: CreatorActor;
    action: string;
    summary: string;
    createdAt: string;
  }>;
  allowedActions: string[];
};

export type CreatorHostScope = {
  projectId: string;
  jobId: string;
  sessionId: string;
  turnId: string;
  capabilityScopes: Array<'creator:read' | 'creator:write' | 'artifact:read'>;
};

export type CreatorAgentSession = {
  id: string;
  jobId: string;
  threadId: string;
  runtimeThreadId: string | null;
  status: CreatorAgentSessionStatus;
  hostGeneration: number | null;
  createdAt: string;
  updatedAt: string;
  interruptedAt: string | null;
  closedAt: string | null;
  sandbox?: Extract<SandboxMode, 'workspace-write' | 'danger-full-access'>;
};

export type CreatorAgentTurn = {
  id: string;
  jobId: string;
  sessionId?: string;
  clientMessageId?: string | null;
  runtimeTurnId?: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: CreatorAgentTurnStatus;
  audit: Array<{
    tool: string;
    revision: number | null;
    result: string;
  }>;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

export type CreatorAgentItem = {
  id: string;
  jobId: string;
  sessionId: string;
  turnId: string;
  runtimeItemId: string | null;
  kind: CreatorAgentItemKind;
  status: CreatorAgentItemStatus;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  toolName?: string;
  approvalId?: string;
  data: Record<string, CreatorJson>;
  sequence: number;
  createdAt: string;
  updatedAt: string;
};

export type CreatorAgentEvent = {
  id: string;
  jobId: string;
  sessionId: string;
  turnId: string | null;
  itemId: string | null;
  sequence: number;
  type: 'session' | 'turn' | 'item' | 'approval' | 'runtime';
  name: string;
  payload: Record<string, CreatorJson>;
  createdAt: string;
};

export type CreatorAgentApproval = {
  id: string;
  jobId: string;
  sessionId: string;
  turnId: string;
  itemId: string;
  runtimeRequestId: string;
  processGeneration: number;
  kind: 'command_execution' | 'file_change' | 'permissions' | 'tool_call';
  status: CreatorAgentApprovalStatus;
  title: string;
  summary: string;
  details: Record<string, CreatorJson>;
  requestedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
};

export type CreatorCommandReceipt = {
  id: string;
  jobId: string;
  actor: CreatorActor;
  command: string;
  idempotencyKey: string;
  requestHash: string;
  expectedRevision: number;
  committedRevision: number | null;
  status: CreatorCommandReceiptStatus;
  result: Record<string, CreatorJson> | null;
  errorCode: string | null;
  errorMessage: string | null;
  stageRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatorAgentTurnRequest = {
  message: string;
  clientMessageId?: string;
  selection?: CreatorSelection | null;
  sandbox?: Extract<SandboxMode, 'workspace-write' | 'danger-full-access'>;
};

export type CreatorAgentSessionResponse = {
  session: CreatorAgentSession;
};

export type CreatorAgentTimelineResponse = {
  session: CreatorAgentSession | null;
  turns: CreatorAgentTurn[];
  items: CreatorAgentItem[];
  approvals: CreatorAgentApproval[];
  lastEventSequence: number;
};

export type CreatorAgentHistoryResponse = CreatorAgentTimelineResponse;

export type CreatorAgentApprovalDecisionRequest = {
  decision: Extract<CreatorAgentApprovalStatus, 'approved' | 'rejected' | 'canceled'>;
  processGeneration: number;
};

export type CreatorAgentSteerRequest = {
  message: string;
  clientMessageId?: string;
};

export type CreatorEventEnvelope = {
  id: string;
  jobId: string;
  revision: number;
  kind: CreatorEventKind;
  payload: Record<string, CreatorJson>;
  createdAt: string;
};

export function isCreatorAgentTurnStatus(value: unknown): value is CreatorAgentTurnStatus {
  return typeof value === 'string'
    && (creatorAgentTurnStatuses as readonly string[]).includes(value);
}

export function isCreatorAgentApprovalStatus(value: unknown): value is CreatorAgentApprovalStatus {
  return typeof value === 'string'
    && (creatorAgentApprovalStatuses as readonly string[]).includes(value);
}

export function readCreatorResultSnapshots(value: CreatorJson | undefined): CreatorResultSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isCreatorJsonRecord(item)) return [];
    if (
      typeof item.version !== 'number'
      || !Number.isInteger(item.version)
      || item.version < 1
      || typeof item.createdAt !== 'string'
      || typeof item.action !== 'string'
      || (item.stageId !== null && typeof item.stageId !== 'string')
      || typeof item.description !== 'string'
      || !isCreatorJsonRecord(item.artifactRefs)
      || !Array.isArray(item.changedArtifactIds)
      || !Array.isArray(item.staleArtifactIds)
      || !isCreatorJsonRecord(item.state)
    ) return [];
    const artifactRefs = Object.fromEntries(Object.entries(item.artifactRefs).flatMap(([kind, ids]) => (
      Array.isArray(ids) && ids.every(id => typeof id === 'string')
        ? [[kind, ids as string[]]]
        : []
    )));
    if (Object.keys(artifactRefs).length !== Object.keys(item.artifactRefs).length) return [];
    if (
      item.changedArtifactIds.some(id => typeof id !== 'string')
      || item.staleArtifactIds.some(id => typeof id !== 'string')
    ) return [];
    return [{
      version: item.version,
      createdAt: item.createdAt,
      action: item.action,
      stageId: item.stageId,
      description: item.description,
      artifactRefs,
      changedArtifactIds: item.changedArtifactIds as string[],
      staleArtifactIds: item.staleArtifactIds as string[],
      state: item.state
    }];
  }).sort((left, right) => left.version - right.version);
}

function isCreatorJsonRecord(value: CreatorJson | undefined): value is Record<string, CreatorJson> {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);
}
