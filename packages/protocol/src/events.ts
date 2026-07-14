export type PublicRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type TerminationReason =
  | 'completed'
  | 'user_canceled'
  | 'timeout'
  | 'spawn_timeout'
  | 'inactivity_timeout'
  | 'spawn_failed'
  | 'codex_exit_non_zero'
  | 'stream_error'
  | 'daemon_restart'
  | 'process_kill_failed';

export type AgentEventType =
  | 'status'
  | 'schedule_trigger'
  | 'reasoning_summary'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'file_change'
  | 'usage'
  | 'diagnostic'
  | 'approval'
  | 'error'
  | 'unknown_event'
  | 'done';

export type AgentEventPayload =
  | {
      type: 'status';
      label: 'queued' | 'initializing' | 'running' | 'canceling' | 'finalizing';
      threadId?: string;
      codexThreadId?: string;
    }
  | { type: 'schedule_trigger'; prompt: string; triggeredAt: string }
  | { type: 'reasoning_summary'; text: string; format: 'plain_text'; delivery: 'summary' | 'delta' }
  | { type: 'assistant_message'; text: string; format: 'plain_text'; delivery: 'message' | 'delta' }
  | { type: 'tool_use'; toolCallId: string; name: string; input: { command?: string; args?: string[]; raw?: unknown } }
  | { type: 'tool_result'; toolCallId: string; output: string; exitCode?: number | null; isError: boolean }
  | {
      type: 'file_change';
      changes: Array<{ path: string; kind: 'add' | 'modify' | 'delete' | 'unknown' }>;
      status: 'in_progress' | 'completed' | 'failed' | 'unknown';
    }
  | {
      type: 'usage';
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      reasoningOutputTokens?: number;
      source: 'stream_cumulative' | 'rollout_best_effort';
    }
  | { type: 'diagnostic'; code: string; severity: 'info' | 'warning' | 'error'; message: string; details?: Record<string, unknown> }
  | {
      type: 'approval';
      approval: {
        id: string;
        runId: string;
        threadId?: string | null;
        codexThreadId?: string | null;
        turnId: string;
        itemId: string;
        requestId: string;
        kind: 'command_execution' | 'file_change' | 'permissions';
        status: 'pending' | 'approved' | 'rejected' | 'expired' | 'canceled';
        risk: 'medium' | 'high';
        title: string;
        summary: string;
        details: Record<string, unknown>;
        requestedAt: string;
        expiresAt: string;
        resolvedAt?: string | null;
        resolutionReason?: string | null;
      };
    }
  | { type: 'error'; code: string; message: string; details?: Record<string, unknown> }
  | { type: 'unknown_event'; rawEventId: string; codexType?: string }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'canceled'; terminationReason: TerminationReason };

export type AgentEventEnvelope = {
  [Type in AgentEventType]: {
    id: string;
    runId: string;
    seq: number;
    ts: string;
    type: Type;
    payload: Extract<AgentEventPayload, { type: Type }>;
    normalizerVersion: number;
    rawEventId?: string;
  };
}[AgentEventType];
