import type {
  PublicRunStatus,
  ReasoningEffort,
  RunContextItem,
  RunSubmissionMode,
  SandboxMode
} from '@opencreator/protocol';

type CreateRunBase = {
  prompt: string;
  executionPrompt?: string;
  publicPrompt?: string;
  triggeredAt?: string;
  contextItems?: RunContextItem[];
  resumeMode?: 'auto' | 'new_thread' | 'resume_thread';
  codexThreadId?: string;
  createdBy?: 'api' | 'schedule';
  sourceId?: string;
  timeoutMs?: number;
  imagePaths?: string[];
  attachmentIds?: string[];
  submissionMode?: RunSubmissionMode;
};

type RunExecutionConfig = {
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  model?: string;
  reasoning?: ReasoningEffort;
};

export type CreateRunInput = CreateRunBase & (
  | ({ threadId: string } & Partial<RunExecutionConfig>)
  | ({ threadId?: undefined } & RunExecutionConfig)
);

export type ResolvedCreateRunInput = CreateRunBase & RunExecutionConfig & {
  threadId?: string;
};

export type CreatedRun = {
  id: string;
  threadId?: string;
  status: PublicRunStatus;
  submissionMode: RunSubmissionMode;
  queuePosition?: number;
};
