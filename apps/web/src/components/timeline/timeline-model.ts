import type { AgentEventEnvelope } from '@clawee/protocol';

export type TimelineItem =
  | { kind: 'user_message'; id: string; text: string; source: 'runtime' | 'mock' }
  | { kind: 'assistant_message'; id: string; text: string; source: 'runtime' | 'mock' }
  | { kind: 'tool_step'; id: string; name: string; content: string; source: 'runtime' }
  | { kind: 'change_card'; id: string; title: string; path: string; delta: string; source: 'mock' }
  | { kind: 'diagnostic'; id: string; severity: 'info' | 'warning' | 'error'; message: string; source: 'runtime' }
  | { kind: 'run_status'; id: string; label: string; content?: string; source: 'runtime' }
  | { kind: 'done'; id: string; status: string; terminationReason?: string; source: 'runtime' };

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

export function eventToTimelineItem(event: AgentEventEnvelope): TimelineItem {
  switch (event.type) {
    case 'assistant_message':
      return { kind: 'assistant_message', id: event.id, text: event.payload.text, source: 'runtime' };
    case 'tool_use':
      return {
        kind: 'tool_step',
        id: event.id,
        name: event.payload.name,
        content: safeStringify(event.payload.input),
        source: 'runtime'
      };
    case 'tool_result':
      return {
        kind: 'tool_step',
        id: event.id,
        name: event.payload.toolCallId,
        content: event.payload.output,
        source: 'runtime'
      };
    case 'diagnostic':
      return {
        kind: 'diagnostic',
        id: event.id,
        severity: event.payload.severity,
        message: event.payload.message,
        source: 'runtime'
      };
    case 'error':
      return {
        kind: 'diagnostic',
        id: event.id,
        severity: 'error',
        message: event.payload.message,
        source: 'runtime'
      };
    case 'done':
      return {
        kind: 'done',
        id: event.id,
        status: event.payload.status,
        terminationReason: event.payload.terminationReason,
        source: 'runtime'
      };
    case 'status':
      return {
        kind: 'run_status',
        id: event.id,
        label: event.payload.label,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    default:
      return {
        kind: 'run_status',
        id: event.id,
        label: event.type,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
  }
}
