export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getStringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

export function assertKnownEventType(type: string): boolean {
  return [
    'status',
    'reasoning_summary',
    'assistant_message',
    'tool_use',
    'tool_result',
    'usage',
    'diagnostic',
    'approval',
    'error',
    'unknown_event',
    'done'
  ].includes(type);
}
