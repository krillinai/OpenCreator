import type {
  CreatorAgentEvent,
  CreatorAgentItemKind,
  CreatorAgentItemStatus,
  CreatorJson
} from '@opencreator/protocol';

export type NormalizedCreatorRuntimeEvent = {
  name: string;
  type: CreatorAgentEvent['type'];
  runtimeTurnId: string | null;
  runtimeItemId: string | null;
  runtimeEventKey: string | null;
  payload: Record<string, CreatorJson>;
  textDelta?: string;
  item?: {
    kind: CreatorAgentItemKind;
    status: CreatorAgentItemStatus;
    text?: string;
    toolName?: string;
    data: Record<string, CreatorJson>;
  };
};

export function normalizeCreatorRuntimeEvent(
  notification: Record<string, unknown>
): NormalizedCreatorRuntimeEvent {
  const method = stringValue(notification.method) ?? 'runtime/unknown';
  const params = recordValue(notification.params);
  const turn = recordValue(params?.turn);
  const item = recordValue(params?.item);
  const runtimeTurnId = stringValue(params?.turnId)
    ?? stringValue(turn?.id)
    ?? stringValue(item?.turnId)
    ?? null;
  const runtimeItemId = stringValue(params?.itemId)
    ?? stringValue(item?.id)
    ?? null;
  const textDelta = method === 'item/agentMessage/delta'
    ? stringValue(params?.delta)
    : undefined;
  const terminal = method.endsWith('/completed')
    || method.endsWith('/failed')
    || method.endsWith('/canceled')
    || method.endsWith('/started');
  return {
    name: method,
    type: method.startsWith('turn/')
      ? 'turn'
      : method.startsWith('item/')
        ? 'item'
        : 'runtime',
    runtimeTurnId,
    runtimeItemId,
    runtimeEventKey: terminal
      ? [method, runtimeTurnId ?? '', runtimeItemId ?? ''].join(':')
      : null,
    payload: creatorRuntimeEventMetadata(params, turn, item),
    ...(textDelta === undefined ? {} : { textDelta }),
    ...(item === undefined ? {} : { item: normalizeItem(item, method) })
  };
}

function normalizeItem(
  item: Record<string, unknown>,
  method: string
): NonNullable<NormalizedCreatorRuntimeEvent['item']> {
  const type = stringValue(item.type) ?? '';
  const text = type === 'userMessage' ? undefined : itemText(item);
  const kind: CreatorAgentItemKind = type === 'userMessage'
    ? 'user_message'
    : type === 'agentMessage'
    ? 'assistant_message'
    : type === 'reasoning'
      ? 'reasoning'
      : type.includes('Tool') || type.includes('tool')
        ? method.includes('completed') ? 'tool_result' : 'tool_call'
        : type.includes('Error') || type.includes('error')
          ? 'error'
          : 'reasoning';
  const status: CreatorAgentItemStatus = method.includes('failed')
    ? 'failed'
    : method.includes('canceled')
      ? 'canceled'
      : method.includes('completed')
      ? 'completed'
      : 'running';
  const toolName = creatorRuntimeToolName(item);
  return {
    kind,
    status,
    ...(text === undefined ? {} : { text }),
    ...(toolName === undefined ? {} : { toolName }),
    data: creatorRuntimeItemMetadata(item)
  };
}

export function creatorRuntimeToolName(item: Record<string, unknown>): string | undefined {
  if (typeof item.name === 'string' && item.name.length > 0) return item.name;
  if (typeof item.tool === 'string' && item.tool.length > 0) {
    return typeof item.server === 'string' && item.server.length > 0
      ? `${item.server}.${item.tool}`
      : item.tool;
  }
  return undefined;
}

export function creatorRuntimeItemMetadata(
  item: Record<string, unknown>
): Record<string, CreatorJson> {
  const result: Record<string, CreatorJson> = {};
  for (const key of [
    'type',
    'id',
    'clientId',
    'server',
    'tool',
    'name',
    'phase',
    'status',
    'readOnlyHint',
    'durationMs'
  ]) {
    const value = item[key];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) result[key] = value;
  }
  return result;
}

function creatorRuntimeEventMetadata(
  params: Record<string, unknown> | undefined,
  turn: Record<string, unknown> | undefined,
  item: Record<string, unknown> | undefined
): Record<string, CreatorJson> {
  const result: Record<string, CreatorJson> = {};
  for (const key of ['threadId', 'turnId', 'itemId', 'status']) {
    const value = params?.[key];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) result[key] = value;
  }
  if (turn !== undefined) {
    result.turn = scalarMetadata(turn, ['id', 'status']);
  }
  if (item !== undefined) {
    result.item = creatorRuntimeItemMetadata(item);
  }
  return result;
}

function scalarMetadata(
  source: Record<string, unknown>,
  keys: string[]
): Record<string, CreatorJson> {
  const result: Record<string, CreatorJson> = {};
  for (const key of keys) {
    const value = source[key];
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) result[key] = value;
  }
  return result;
}

function itemText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return undefined;
  const text = item.content
    .map(recordValue)
    .map(entry => typeof entry?.text === 'string' ? entry.text : '')
    .join('');
  return text || undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
