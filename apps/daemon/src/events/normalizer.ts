import type { AgentEventEnvelope } from '@clawee/protocol';

export const normalizerVersion = 1;

export type NormalizeInput = {
  runId: string;
  seq: number;
  raw: unknown;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function fallbackEventId(input: NormalizeInput): string {
  return `${input.runId}:${input.seq}`;
}

function baseEnvelope(input: NormalizeInput) {
  return {
    id: `evt_${input.runId}_${input.seq}`,
    runId: input.runId,
    seq: input.seq,
    ts: new Date().toISOString(),
    normalizerVersion
  };
}

function codexType(raw: JsonRecord | undefined): string | undefined {
  return stringValue(raw?.type);
}

export function normalizeCodexEvent(input: NormalizeInput): AgentEventEnvelope {
  const raw = isRecord(input.raw) ? input.raw : undefined;
  const type = codexType(raw);
  const rawEventId = stringValue(raw?.id) ?? stringValue(raw?.thread_id) ?? fallbackEventId(input);
  const base = baseEnvelope(input);

  if (type === 'thread.started') {
    return {
      ...base,
      type: 'status',
      rawEventId,
      payload: {
        type: 'status',
        label: 'initializing'
      }
    };
  }

  if (type === 'turn.started') {
    return {
      ...base,
      type: 'status',
      rawEventId,
      payload: {
        type: 'status',
        label: 'running'
      }
    };
  }

  const item = isRecord(raw?.item) ? raw.item : undefined;
  const itemType = stringValue(item?.type);

  if (type === 'item.completed' && item !== undefined && itemType === 'agent_message') {
    return {
      ...base,
      type: 'assistant_message',
      rawEventId,
      payload: {
        type: 'assistant_message',
        text: stringValue(item.text) ?? '',
        format: 'plain_text',
        delivery: 'message'
      }
    };
  }

  if (type === 'item.started' && item !== undefined && itemType === 'command_execution') {
    const toolCallId = stringValue(item.id) ?? fallbackEventId(input);
    const command = stringValue(item.command);

    return {
      ...base,
      type: 'tool_use',
      rawEventId,
      payload: {
        type: 'tool_use',
        toolCallId,
        name: 'command_execution',
        input: {
          ...(command === undefined ? {} : { command }),
          raw: item
        }
      }
    };
  }

  if (type === 'item.completed' && item !== undefined && itemType === 'command_execution') {
    const toolCallId = stringValue(item.id) ?? fallbackEventId(input);
    const exitCode = numberValue(item.exit_code) ?? null;

    return {
      ...base,
      type: 'tool_result',
      rawEventId,
      payload: {
        type: 'tool_result',
        toolCallId,
        output: stringValue(item.aggregated_output) ?? '',
        exitCode,
        isError: exitCode !== 0
      }
    };
  }

  if (type === 'turn.completed') {
    return {
      ...base,
      type: 'status',
      rawEventId,
      payload: {
        type: 'status',
        label: 'finalizing'
      }
    };
  }

  return {
    ...base,
    type: 'unknown_event',
    rawEventId,
    payload: {
      type: 'unknown_event',
      rawEventId: fallbackEventId(input),
      ...(type === undefined ? {} : { codexType: type })
    }
  };
}
