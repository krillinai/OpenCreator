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
    if (
      timelineItems[index]?.kind !== 'user_message'
      && timelineItems[index]?.kind !== 'schedule_trigger'
    ) {
      continue;
    }
    lastUserIndex = index;
    break;
  }
  const latestInput = timelineItems[lastUserIndex];
  const latestTurnItems = timelineItems.slice(
    lastUserIndex + (latestInput?.kind === 'schedule_trigger' ? 0 : 1)
  );
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

export function mergeTimelineHistoryWithCache(
  historyItems: TimelineItem[],
  cachedItems: TimelineItem[]
): TimelineItem[] {
  const merged = [...historyItems];
  const historyIds = new Set(historyItems.map(item => item.id));
  const remainingHistoryKeys = countTimelineKeys(historyItems);
  const representedTerminalRunIds = findRepresentedTerminalRunIds(
    cachedItems,
    remainingHistoryKeys
  );

  function consumeHistoryKey(item: TimelineItem): boolean {
    if (item.kind === 'done' && item.status !== 'succeeded') return false;
    const key = timelineReplayMergeKey(item);
    if (key === undefined) return false;
    return consumeKey(remainingHistoryKeys, key);
  }

  for (const item of cachedItems) {
    if (
      item.runId !== undefined
      && representedTerminalRunIds.has(item.runId)
    ) {
      continue;
    }
    if (historyIds.has(item.id)) {
      consumeHistoryKey(item);
      continue;
    }
    if (consumeHistoryKey(item)) continue;
    merged.push(item);
    historyIds.add(item.id);
  }

  return merged;
}

export function timelineReplayMergeKey(item: TimelineItem): string | undefined {
  switch (item.kind) {
    case 'user_message':
      return `user:${item.text}`;
    case 'schedule_trigger':
      return `schedule:${item.prompt}:${item.triggeredAt}`;
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
    case 'approval':
      return `approval:${item.approval.id}`;
    case 'diagnostic':
    case 'run_status':
      return undefined;
  }
}

function findRepresentedTerminalRunIds(
  cachedItems: TimelineItem[],
  remainingHistoryKeys: Map<string, number>
): Set<string> {
  const itemsByRunId = new Map<string, TimelineItem[]>();
  for (const item of cachedItems) {
    if (item.runId === undefined) continue;
    const runItems = itemsByRunId.get(item.runId) ?? [];
    runItems.push(item);
    itemsByRunId.set(item.runId, runItems);
  }

  const represented = new Set<string>();
  for (const [runId, runItems] of itemsByRunId) {
    const done = runItems.find(item => item.kind === 'done');
    if (done?.kind !== 'done' || done.status !== 'succeeded') continue;
    const requiredKeys = countTimelineKeys(
      runItems,
      timelineRunRepresentationKey
    );
    if (
      requiredKeys.size === 0
      || !canConsumeKeys(remainingHistoryKeys, requiredKeys)
    ) {
      continue;
    }
    consumeKeys(remainingHistoryKeys, requiredKeys);
    represented.add(runId);
  }
  return represented;
}

function timelineRunRepresentationKey(item: TimelineItem): string | undefined {
  switch (item.kind) {
    case 'user_message':
    case 'schedule_trigger':
    case 'assistant_message':
    case 'done':
      return timelineReplayMergeKey(item);
    case 'reasoning_summary':
    case 'tool_step':
    case 'change_card':
    case 'approval':
    case 'diagnostic':
    case 'run_status':
      return undefined;
  }
}

function countTimelineKeys(
  items: TimelineItem[],
  getKey: (item: TimelineItem) => string | undefined = timelineReplayMergeKey
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = getKey(item);
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function canConsumeKeys(
  available: Map<string, number>,
  required: Map<string, number>
): boolean {
  for (const [key, count] of required) {
    if ((available.get(key) ?? 0) < count) return false;
  }
  return true;
}

function consumeKeys(
  available: Map<string, number>,
  required: Map<string, number>
): void {
  for (const [key, count] of required) {
    for (let index = 0; index < count; index += 1) {
      consumeKey(available, key);
    }
  }
}

function consumeKey(counts: Map<string, number>, key: string): boolean {
  const count = counts.get(key) ?? 0;
  if (count === 0) return false;
  if (count === 1) counts.delete(key);
  else counts.set(key, count - 1);
  return true;
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
