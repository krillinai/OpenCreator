import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../components/timeline/timeline-model.js';
import { createRunReplayDeduper } from './run-event-replay.js';

describe('run event replay deduper', () => {
  it('deduplicates replay items against only the latest conversation turn', () => {
    const deduper = createRunReplayDeduper([
      assistant('old_assistant', '相同内容'),
      user('latest_user', '继续'),
      assistant('latest_assistant', '最新回复')
    ]);

    expect(deduper.shouldAppend(assistant('replay_same_as_old', '相同内容'))).toBe(true);
    expect(deduper.shouldAppend(assistant('replay_latest', '最新回复'))).toBe(false);
  });

  it('consumes matching history counts without dropping valid repeated replay content', () => {
    const deduper = createRunReplayDeduper([
      user('user_1', '开始'),
      assistant('history_assistant', '重复内容')
    ]);

    expect(deduper.shouldAppend(assistant('replay_1', '重复内容'))).toBe(false);
    expect(deduper.shouldAppend(assistant('replay_2', '重复内容'))).toBe(true);
  });

  it('rejects an item whose stable id is already present', () => {
    const deduper = createRunReplayDeduper([
      user('user_1', '开始'),
      assistant('shared_id', '回复')
    ]);

    expect(deduper.shouldAppend(assistant('shared_id', '回复'))).toBe(false);
  });

  it('deduplicates a live schedule trigger against refreshed public history', () => {
    const deduper = createRunReplayDeduper([
      scheduleTrigger('history_schedule', 'run_schedule')
    ]);

    expect(deduper.shouldAppend(scheduleTrigger('evt_schedule', 'run_schedule'))).toBe(false);
  });
});

function user(id: string, text: string): TimelineItem {
  return { kind: 'user_message', id, text, source: 'runtime' };
}

function assistant(id: string, text: string): TimelineItem {
  return {
    kind: 'assistant_message',
    id,
    runId: 'run_1',
    text,
    source: 'runtime'
  };
}

function scheduleTrigger(id: string, runId: string): TimelineItem {
  return {
    kind: 'schedule_trigger',
    id,
    runId,
    prompt: '生成每日项目摘要',
    triggeredAt: '2026-07-14T14:05:00.000Z',
    source: 'runtime'
  };
}
