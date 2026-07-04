import type { ReasoningEffort, SandboxMode } from '@clawee/protocol';

export type CreateRunInput = {
  prompt: string;
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  threadId?: string;
  resumeMode?: 'new_thread' | 'resume_thread';
  model?: string;
  reasoning?: ReasoningEffort;
};

export type CreatedRun = {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'canceled';
};
