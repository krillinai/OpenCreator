import { describe, expect, it } from 'vitest';
import {
  krillinEventProgress,
  mergeKrillinProgress
} from '../../src/creator/krillin/adapter.js';

describe('KrillinAI progress projection', () => {
  it('keeps the latest phase and percent when a status poll arrives', () => {
    const eventProgress = krillinEventProgress({
      id: 'task_1',
      jobId: 'job_1',
      stageRunId: 'stage_1',
      stageType: 'subtitle',
      status: 'running',
      lastEventSeq: 3,
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:01.000Z'
    }, {
      taskId: 'task_1',
      seq: 3,
      type: 'progress',
      payload: {
        phase: 'translating_subtitles',
        percent: 52,
        message: '正在翻译字幕'
      },
      createdAt: '2026-08-24T00:00:01.000Z'
    }, 3);

    const afterPoll = mergeKrillinProgress(eventProgress, {
      krillinTaskId: 'task_1',
      krillinEventCursor: 3,
      krillinStatus: 'running',
      providerStatus: 'running'
    });

    expect(afterPoll).toMatchObject({
      phase: 'translating_subtitles',
      percent: 52,
      providerStatus: 'running',
      krillinEventPayload: {
        phase: 'translating_subtitles',
        percent: 52
      }
    });
  });
});
