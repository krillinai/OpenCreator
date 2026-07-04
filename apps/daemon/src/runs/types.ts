import type { SandboxMode } from '@clawee/protocol';

export type CreateRunInput = {
  prompt: string;
  cwd: string;
  profile: string;
  sandbox: SandboxMode;
  threadId?: string;
};

export type CreatedRun = {
  id: string;
  status: 'succeeded' | 'failed' | 'canceled';
};
