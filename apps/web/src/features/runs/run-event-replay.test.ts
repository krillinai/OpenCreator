import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../components/timeline/timeline-model.js';
import {
  createRunReplayDeduper,
  mergeTimelineHistoryWithCache
} from './run-event-replay.js';

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

  it('drops a completed cached run atomically when history already contains its turn', () => {
    const history = [
      user('history_user', '武汉天气如何'),
      assistant('history_assistant', '武汉今天约 36°C。', 'history_turn'),
      done('history_done', 'history_turn')
    ];
    const cached = [
      user('runtime_user', '武汉天气如何', 'run_weather'),
      status('runtime_running', 'run_weather', 'running'),
      reasoning('runtime_reasoning', 'run_weather', '先查询天气。'),
      assistant('runtime_assistant', '武汉今天约 36°C。', 'run_weather'),
      status('runtime_finalizing', 'run_weather', 'finalizing'),
      done('runtime_done', 'run_weather')
    ];

    expect(mergeTimelineHistoryWithCache(history, cached)).toEqual(history);
  });

  it('keeps an active cached process until its terminal event arrives', () => {
    const history = [
      user('history_user', '武汉天气如何'),
      assistant('history_assistant', '武汉今天约 36°C。', 'history_turn')
    ];
    const cached = [
      user('runtime_user', '武汉天气如何', 'run_weather'),
      status('runtime_running', 'run_weather', 'running'),
      assistant('runtime_assistant', '武汉今天约 36°C。', 'run_weather')
    ];

    expect(mergeTimelineHistoryWithCache(history, cached)).toEqual([
      ...history,
      status('runtime_running', 'run_weather', 'running')
    ]);
  });

  it('keeps failed cached diagnostics even when history contains a failed turn', () => {
    const history = [
      user('history_user', '检查项目'),
      failedDone('history_done', 'history_turn')
    ];
    const cached = [
      user('runtime_user', '检查项目', 'run_failed'),
      status('runtime_running', 'run_failed', 'running'),
      diagnostic('runtime_error', 'run_failed', '项目目录不存在'),
      failedDone('runtime_done', 'run_failed')
    ];

    expect(mergeTimelineHistoryWithCache(history, cached)).toEqual([
      ...history,
      status('runtime_running', 'run_failed', 'running'),
      diagnostic('runtime_error', 'run_failed', '项目目录不存在'),
      failedDone('runtime_done', 'run_failed')
    ]);
  });
});

function user(id: string, text: string, runId?: string): TimelineItem {
  return {
    kind: 'user_message',
    id,
    text,
    ...(runId === undefined ? {} : { runId }),
    source: 'runtime'
  };
}

function assistant(id: string, text: string, runId = 'run_1'): TimelineItem {
  return {
    kind: 'assistant_message',
    id,
    runId,
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

function status(id: string, runId: string, label: string): TimelineItem {
  return {
    kind: 'run_status',
    id,
    runId,
    label,
    source: 'runtime'
  };
}

function reasoning(id: string, runId: string, text: string): TimelineItem {
  return {
    kind: 'reasoning_summary',
    id,
    runId,
    text,
    source: 'runtime'
  };
}

function done(id: string, runId: string): TimelineItem {
  return {
    kind: 'done',
    id,
    runId,
    status: 'succeeded',
    terminationReason: 'completed',
    content: '{"type":"done","status":"succeeded","terminationReason":"completed"}',
    source: 'runtime'
  };
}

function failedDone(id: string, runId: string): TimelineItem {
  return {
    kind: 'done',
    id,
    runId,
    status: 'failed',
    terminationReason: 'stream_error',
    content: '{"type":"done","status":"failed","terminationReason":"stream_error"}',
    source: 'runtime'
  };
}

function diagnostic(
  id: string,
  runId: string,
  message: string
): TimelineItem {
  return {
    kind: 'diagnostic',
    id,
    runId,
    severity: 'error',
    message,
    content: message,
    source: 'runtime'
  };
}
