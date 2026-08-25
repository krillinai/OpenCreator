import type {
  AgentContextEnvelope,
  CreatorActionRequest,
  CreatorSelection
} from '@opencreator/protocol';
import type {
  AppServerApprovalDecision,
  AppServerRequest
} from '../../codex/app-server-host-2026-07-28.js';

export type AgentRuntimeAction = Omit<CreatorActionRequest, 'actor'>;

export type AgentRuntimeTurnInput = {
  runId?: string;
  threadId: string;
  message: string;
  selection: CreatorSelection | null;
  context: AgentContextEnvelope;
  conflictAttempt: 0 | 1;
  onNotification?(notification: Record<string, unknown>): Promise<void> | void;
  onThreadRead?(thread: Record<string, unknown>): Promise<void> | void;
  onStarted?(input: { pid: number; generation: number; reused: boolean }): void;
  onApprovalRequest?(request: AppServerRequest): Promise<AppServerApprovalDecision>;
};

export type AgentRuntimeTurnResult = {
  content: string;
  runtimeThreadId?: string;
  runtimeTurnId?: string;
  processGeneration?: number;
  action?: AgentRuntimeAction;
};

export type AgentRuntimeExecution = {
  cancel(): void;
  started: Promise<{ pid: number; generation: number; reused: boolean }>;
  result: Promise<AgentRuntimeTurnResult>;
};

export interface AgentRuntimeAdapter {
  readonly id: string;
  readonly available: boolean;
  startTurn?(input: AgentRuntimeTurnInput): AgentRuntimeExecution;
  runTurn(input: AgentRuntimeTurnInput): Promise<AgentRuntimeTurnResult>;
  steer?(runId: string, message: string, clientMessageId?: string): Promise<string>;
  interrupt?(runId: string): boolean;
  closeScope?(jobId: string): Promise<void>;
}

export function createUnavailableAgentRuntimeAdapter(reason = 'Creator Agent runtime is unavailable'): AgentRuntimeAdapter {
  return {
    id: 'unavailable',
    available: false,
    startTurn() {
      const started = Promise.reject(new Error(reason));
      void started.catch(() => undefined);
      const result = Promise.reject(new Error(reason));
      void result.catch(() => undefined);
      return {
        cancel() {},
        started,
        result
      };
    },
    async runTurn() {
      throw new Error(reason);
    },
    async steer() { throw new Error(reason); },
    interrupt() { return false; },
    async closeScope() {}
  };
}
