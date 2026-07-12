import type {
  PublicRunStatus,
  ReasoningEffort,
  RunContextItem,
  RunSubmissionMode,
  SandboxMode
} from '@clawee/protocol';

export type CreateRunInput = {
  prompt: string;
  executionPrompt?: string;
  contextItems?: RunContextItem[];
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  threadId?: string;
  resumeMode?: 'auto' | 'new_thread' | 'resume_thread';
  codexThreadId?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  createdBy?: 'api' | 'schedule';
  sourceId?: string;
  timeoutMs?: number;
  imagePaths?: string[];
  attachmentIds?: string[];
  submissionMode?: RunSubmissionMode;
};

export type CreatedRun = {
  id: string;
  threadId?: string;
  status: PublicRunStatus;
  submissionMode: RunSubmissionMode;
  queuePosition?: number;
};
