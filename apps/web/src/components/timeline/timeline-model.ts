import type { AgentEventEnvelope } from '@clawee/protocol';

export type TimelineItem =
  | { kind: 'user_message'; id: string; text: string; content?: string; source: 'runtime' | 'mock' }
  | { kind: 'reasoning_summary'; id: string; runId?: string; text: string; content?: string; source: 'runtime' }
  | { kind: 'assistant_message'; id: string; runId?: string; text: string; content?: string; source: 'runtime' | 'mock' }
  | { kind: 'tool_step'; id: string; runId?: string; name: string; content: string; source: 'runtime' }
  | { kind: 'change_card'; id: string; title: string; path: string; delta: string; source: 'mock' }
  | {
      kind: 'diagnostic';
      id: string;
      runId?: string;
      severity: 'info' | 'warning' | 'error';
      message: string;
      content: string;
      source: 'runtime';
    }
  | { kind: 'run_status'; id: string; runId?: string; label: string; content?: string; source: 'runtime' }
  | { kind: 'done'; id: string; runId?: string; status: string; terminationReason?: string; content: string; source: 'runtime' };

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, field) => {
      if (typeof field === 'bigint') {
        return field.toString();
      }

      if (typeof field !== 'object' || field === null) {
        return field;
      }

      if (seen.has(field)) {
        return '[Circular]';
      }

      seen.add(field);
      return field;
    });

    return serialized ?? String(value);
  } catch {
    return '[Unserializable payload]';
  }
}

export function eventToTimelineItem(event: AgentEventEnvelope): TimelineItem | null {
  switch (event.type) {
    case 'assistant_message':
      return {
        kind: 'assistant_message',
        id: event.id,
        runId: event.runId,
        text: event.payload.text,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'reasoning_summary':
      return {
        kind: 'reasoning_summary',
        id: event.id,
        runId: event.runId,
        text: event.payload.text,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'tool_use':
      return {
        kind: 'tool_step',
        id: event.id,
        runId: event.runId,
        name: event.payload.name,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'tool_result':
      return {
        kind: 'tool_step',
        id: event.id,
        runId: event.runId,
        name: event.payload.toolCallId,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'diagnostic':
      return {
        kind: 'diagnostic',
        id: event.id,
        runId: event.runId,
        severity: event.payload.severity,
        message: event.payload.message,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'error':
      return {
        kind: 'diagnostic',
        id: event.id,
        runId: event.runId,
        severity: 'error',
        message: event.payload.message,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'done':
      return {
        kind: 'done',
        id: event.id,
        runId: event.runId,
        status: event.payload.status,
        terminationReason: event.payload.terminationReason,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'status':
      return {
        kind: 'run_status',
        id: event.id,
        runId: event.runId,
        label: event.payload.label,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'usage':
      return {
        kind: 'run_status',
        id: event.id,
        runId: event.runId,
        label: event.type,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'unknown_event':
      return null;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
