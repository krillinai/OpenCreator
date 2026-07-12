import type { TimelineItem } from '../../components/timeline/timeline-model.js';

export type RunReplayDeduper = {
  shouldAppend(item: TimelineItem): boolean;
};

export function createRunReplayDeduper(
  timelineItems: TimelineItem[]
): RunReplayDeduper {
  const existingIds = new Set(timelineItems.map(item => item.id));
  let lastUserIndex = -1;
  for (let index = timelineItems.length - 1; index >= 0; index -= 1) {
    if (timelineItems[index]?.kind !== 'user_message') continue;
    lastUserIndex = index;
    break;
  }
  const latestTurnItems = timelineItems.slice(lastUserIndex + 1);
  const remainingHistoryKeys = new Map<string, number>();

  for (const item of latestTurnItems) {
    const key = timelineReplayMergeKey(item);
    if (key === undefined) continue;
    remainingHistoryKeys.set(key, (remainingHistoryKeys.get(key) ?? 0) + 1);
  }

  function consumeHistoryKey(item: TimelineItem): boolean {
    const key = timelineReplayMergeKey(item);
    if (key === undefined) return false;
    const count = remainingHistoryKeys.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) remainingHistoryKeys.delete(key);
    else remainingHistoryKeys.set(key, count - 1);
    return true;
  }

  return {
    shouldAppend(item) {
      if (existingIds.has(item.id)) {
        consumeHistoryKey(item);
        return false;
      }
      if (consumeHistoryKey(item)) return false;
      existingIds.add(item.id);
      return true;
    }
  };
}

export function timelineReplayMergeKey(item: TimelineItem): string | undefined {
  switch (item.kind) {
    case 'user_message':
      return `user:${item.text}`;
    case 'assistant_message':
      return `assistant:${item.text}`;
    case 'reasoning_summary':
      return `reasoning:${item.text}`;
    case 'tool_step':
      return toolStepMergeKey(item);
    case 'change_card':
      return `change:${item.title}:${item.path}:${item.delta}`;
    case 'done':
      return `done:${item.status}`;
    case 'diagnostic':
    case 'run_status':
      return undefined;
  }
}

function toolStepMergeKey(item: Extract<TimelineItem, { kind: 'tool_step' }>): string {
  try {
    const parsed = JSON.parse(item.content) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return `tool:${item.name}:${item.content}`;
    }
    const payload = parsed as Record<string, unknown>;
    if (payload.type === 'tool_use') {
      return `tool-use:${String(payload.name ?? item.name)}:${JSON.stringify(payload.input)}`;
    }
    if (payload.type === 'tool_result') {
      return `tool-result:${JSON.stringify(payload.output)}:${String(payload.isError ?? false)}`;
    }
  } catch {
    return `tool:${item.name}:${item.content}`;
  }
  return `tool:${item.name}:${item.content}`;
}
