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
    'assistant_message',
    'tool_use',
    'tool_result',
    'usage',
    'diagnostic',
    'error',
    'unknown_event',
    'done'
  ].includes(type);
}
