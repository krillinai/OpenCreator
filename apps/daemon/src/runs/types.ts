import type { PublicRunStatus, ReasoningEffort, SandboxMode } from '@clawee/protocol';

export type CreateRunInput = {
  prompt: string;
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
};

export type CreatedRun = {
  id: string;
  threadId?: string;
  status: PublicRunStatus;
};
