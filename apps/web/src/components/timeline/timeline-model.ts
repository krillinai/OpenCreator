import type {
  AgentEventEnvelope,
  AttachmentResponse,
  PublicRunStatus,
  RuntimeApproval,
  RunSubmissionMode
} from '@opencreator/protocol';

export type TimelineItem =
  | {
      kind: 'user_message';
      id: string;
      timestamp?: string;
      text: string;
      content?: string;
      attachments?: AttachmentResponse[];
      attachmentPreviewUrls?: Record<string, string>;
      runId?: string;
      runStatus?: PublicRunStatus;
      submissionMode?: RunSubmissionMode;
      queuePosition?: number;
      wasQueued?: boolean;
      source: 'runtime';
    }
  | {
      kind: 'schedule_trigger';
      id: string;
      runId: string;
      prompt: string;
      triggeredAt: string;
      source: 'runtime';
    }
  | { kind: 'approval'; id: string; runId: string; approval: RuntimeApproval; source: 'runtime' }
  | { kind: 'reasoning_summary'; id: string; runId?: string; timestamp?: string; text: string; content?: string; source: 'runtime' }
  | { kind: 'assistant_message'; id: string; runId?: string; timestamp?: string; text: string; content?: string; source: 'runtime' }
  | { kind: 'tool_step'; id: string; runId?: string; timestamp?: string; name: string; content: string; source: 'runtime' }
  | { kind: 'change_card'; id: string; runId?: string; title: string; path: string; delta: string; source: 'runtime' }
  | {
      kind: 'diagnostic';
      id: string;
      runId?: string;
      timestamp?: string;
      severity: 'info' | 'warning' | 'error';
      message: string;
      content: string;
      source: 'runtime';
    }
  | { kind: 'run_status'; id: string; runId?: string; timestamp?: string; label: string; content?: string; source: 'runtime' }
  | { kind: 'done'; id: string; runId?: string; timestamp?: string; status: string; terminationReason?: string; content: string; source: 'runtime' };

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

function formatChangeKind(kind: 'add' | 'modify' | 'delete' | 'unknown'): string {
  switch (kind) {
    case 'add':
      return '新增';
    case 'modify':
      return '修改';
    case 'delete':
      return '删除';
    case 'unknown':
      return '变更';
  }
}

function formatFileChangeTitle(changes: Array<{ kind: 'add' | 'modify' | 'delete' | 'unknown' }>): string {
  if (changes.length === 0) return '文件变更';

  const counts = new Map<'add' | 'modify' | 'delete' | 'unknown', number>();
  for (const change of changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);

  return (['add', 'modify', 'delete', 'unknown'] as const)
    .map(kind => {
      const count = counts.get(kind) ?? 0;
      return count === 0 ? undefined : `${formatChangeKind(kind)} ${count} 个文件`;
    })
    .filter((part): part is string => part !== undefined)
    .join('，');
}

export function eventToTimelineItem(event: AgentEventEnvelope): TimelineItem | null {
  switch (event.type) {
    case 'schedule_trigger':
      return {
        kind: 'schedule_trigger',
        id: event.id,
        runId: event.runId,
        prompt: event.payload.prompt,
        triggeredAt: event.payload.triggeredAt,
        source: 'runtime'
      };
    case 'assistant_message':
      return {
        kind: 'assistant_message',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
        text: event.payload.text,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'reasoning_summary':
      return {
        kind: 'reasoning_summary',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
        text: event.payload.text,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'tool_use':
      return {
        kind: 'tool_step',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
        name: event.payload.name,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'tool_result':
      return {
        kind: 'tool_step',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
        name: event.payload.toolCallId,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'file_change': {
      const primaryPath = event.payload.changes.find(change => change.path.length > 0)?.path ?? '文件变更';
      return {
        kind: 'change_card',
        id: event.id,
        runId: event.runId,
        title: formatFileChangeTitle(event.payload.changes),
        path: primaryPath,
        delta: `${event.payload.changes.length} 项变更`,
        source: 'runtime'
      };
    }
    case 'diagnostic':
      return {
        kind: 'diagnostic',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
        severity: event.payload.severity,
        message: event.payload.message,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'approval':
      return {
        kind: 'approval',
        id: event.id,
        runId: event.runId,
        approval: event.payload.approval,
        source: 'runtime'
      };
    case 'error':
      return {
        kind: 'diagnostic',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
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
        timestamp: event.ts,
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
        timestamp: event.ts,
        label: event.payload.label,
        content: safeStringify(event.payload),
        source: 'runtime'
      };
    case 'usage':
      return {
        kind: 'run_status',
        id: event.id,
        runId: event.runId,
        timestamp: event.ts,
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
