export type PublicRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type TerminationReason =
  | 'completed'
  | 'user_canceled'
  | 'timeout'
  | 'inactivity_timeout'
  | 'spawn_failed'
  | 'codex_exit_non_zero'
  | 'stream_error'
  | 'daemon_restart'
  | 'process_kill_failed';

export type AgentEventType =
  | 'status'
  | 'assistant_message'
  | 'tool_use'
  | 'tool_result'
  | 'usage'
  | 'diagnostic'
  | 'error'
  | 'unknown_event'
  | 'done';

export type AgentEventPayload =
  | { type: 'status'; label: 'initializing' | 'running' | 'canceling' | 'finalizing' }
  | { type: 'assistant_message'; text: string; format: 'plain_text'; delivery: 'message' | 'delta' }
  | { type: 'tool_use'; toolCallId: string; name: string; input: { command?: string; args?: string[]; raw?: unknown } }
  | { type: 'tool_result'; toolCallId: string; output: string; exitCode?: number | null; isError: boolean }
  | {
      type: 'usage';
      inputTokens?: number;
      cachedInputTokens?: number;
      outputTokens?: number;
      reasoningOutputTokens?: number;
      source: 'stream_cumulative' | 'rollout_best_effort';
    }
  | { type: 'diagnostic'; code: string; severity: 'info' | 'warning' | 'error'; message: string; details?: Record<string, unknown> }
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
